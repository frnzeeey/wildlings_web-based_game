import { randomInt } from 'node:crypto';
import {
  PROTOCOL_VERSION, SPEC_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, sanitizeName, type ClientMsg, type ClientKind,
} from '@wildlings/shared';
import { Conn } from './conn.ts';
import { Room, sanitizeSettings, sanitizeSpecies } from './room.ts';
import type { Db } from './db.ts';
import { log } from './log.ts';

const CLIENTS: ClientKind[] = ['web', 'godot', 'bot', 'test'];

/** Every connection, the quick-match queue and all rooms. Pure logic: no sockets are created here. */
export class Lobby {
  readonly db: Db;
  readonly rooms = new Map<string, Room>();
  private conns = new Map<string, Conn>(); // by player id
  private queue: Conn[] = [];
  graceMs?: number;

  constructor(db: Db) {
    this.db = db;
  }

  get stats() {
    return { players: this.conns.size, rooms: this.rooms.size, queued: this.queue.length, matches: [...this.rooms.values()].filter((r) => r.state === 'playing').length };
  }

  tick(now: number): void {
    for (const r of this.rooms.values()) r.tick(now);
  }

  closed(conn: Conn): void {
    conn.alive = false;
    this.queue = this.queue.filter((c) => c !== conn);
    if (conn.identified && this.conns.get(conn.playerId) === conn) this.conns.delete(conn.playerId);
    if (conn.roomCode) this.rooms.get(conn.roomCode)?.disconnected(conn);
  }

  handle(conn: Conn, raw: string): void {
    if (raw.length > 8192) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return conn.send({ t: 'error', code: 'bad-json', msg: 'Malformed message' });
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (!conn.allow()) return;
    if (msg.t === 'hello') return this.hello(conn, msg);
    if (!conn.identified) return conn.send({ t: 'error', code: 'no-hello', msg: 'Say hello first' });
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;

    switch (msg.t) {
      case 'profile':
        conn.name = sanitizeName(msg.name);
        conn.species = sanitizeSpecies(msg.species);
        this.db.updateProfile(conn.playerId, conn.name, conn.species);
        room?.updateProfile(conn);
        break;
      case 'ping':
        conn.send({ t: 'pong', id: Number(msg.id) || 0, time: Date.now() });
        break;
      case 'queue':
        if (room) return conn.send({ t: 'error', code: 'in-room', msg: 'Leave your room first' });
        if (!this.queue.includes(conn)) this.queue.push(conn);
        this.matchmake();
        break;
      case 'unqueue':
        this.queue = this.queue.filter((c) => c !== conn);
        break;
      case 'createRoom': {
        if (room) room.remove(conn.playerId);
        this.queue = this.queue.filter((c) => c !== conn);
        const r = this.newRoom(false);
        if (msg.mapId) r.mapId = msg.mapId === 'random' || this.mapOk(msg.mapId) ? msg.mapId : 'random';
        if (msg.settings) r.settings = sanitizeSettings(msg.settings);
        r.add(conn);
        break;
      }
      case 'joinRoom': {
        const code = String(msg.code ?? '').toUpperCase().trim();
        const target = this.rooms.get(code);
        if (!target || target.quick) return conn.send({ t: 'error', code: 'no-room', msg: `No room with code ${code}` });
        if (room && room !== target) room.remove(conn.playerId);
        this.queue = this.queue.filter((c) => c !== conn);
        if (!target.add(conn)) conn.send({ t: 'error', code: 'room-full', msg: target.state === 'lobby' ? 'That room is full' : 'That match is already in progress' });
        break;
      }
      case 'leaveRoom':
        room?.remove(conn.playerId);
        conn.send({ t: 'left' });
        break;
      case 'ready':
        room?.setReady(conn.playerId, !!msg.ready);
        break;
      case 'roomConfig': {
        const err = room?.configure(conn.playerId, msg.mapId, msg.settings);
        if (err) conn.send({ t: 'error', code: 'config', msg: err });
        break;
      }
      case 'cmd':
        room?.command(conn.playerId, Number(msg.seq) || 0, msg.c, conn);
        break;
      case 'resync':
        room?.resync(conn);
        break;
      case 'rematch':
        room?.voteRematch(conn.playerId);
        break;
      case 'resign':
        room?.resign(conn.playerId);
        break;
      default:
        conn.send({ t: 'error', code: 'unknown', msg: `Unknown message ${(msg as { t: string }).t}` });
    }
  }

  private hello(conn: Conn, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (msg.v !== PROTOCOL_VERSION) {
      conn.send({ t: 'error', code: 'version', msg: `Protocol ${msg.v} is not supported (server speaks ${PROTOCOL_VERSION}). Please update the game.` });
      return void conn.ws.close(1008, 'version');
    }
    if (msg.spec !== SPEC_VERSION) {
      conn.send({ t: 'error', code: 'spec', msg: `Game data ${msg.spec} does not match the server (${SPEC_VERSION}). Please update the game.` });
      return void conn.ws.close(1008, 'spec');
    }
    if (conn.identified) return;
    conn.client = CLIENTS.includes(msg.client) ? msg.client : 'web';
    const name = sanitizeName(msg.name);
    const species = sanitizeSpecies(msg.species);
    const { player, token } = this.db.identify(typeof msg.token === 'string' ? msg.token : undefined, name, species);
    conn.playerId = player.id;
    conn.name = player.name;
    conn.species = player.species;
    // Same player on a newer socket: the old one is retired.
    const old = this.conns.get(player.id);
    if (old && old !== conn) {
      this.queue = this.queue.filter((c) => c !== old);
      old.roomCode = null;
      old.ws.close(4000, 'replaced');
    }
    this.conns.set(player.id, conn);
    conn.send({ t: 'welcome', playerId: player.id, token, name: player.name, spec: SPEC_VERSION });
    // Back into the room (and match) this player belongs to.
    for (const r of this.rooms.values()) {
      if (r.has(player.id)) {
        r.reattach(conn);
        break;
      }
    }
  }

  private matchmake(): void {
    this.queue = this.queue.filter((c) => c.alive && !c.roomCode);
    while (this.queue.length >= 2) {
      const a = this.queue.shift()!;
      const b = this.queue.shift()!;
      const r = this.newRoom(true);
      r.add(a);
      r.add(b);
    }
    for (const c of this.queue) c.send({ t: 'queued', players: this.queue.length });
  }

  private mapOk(id: string): boolean {
    return /^[a-z]+$/.test(id);
  }

  newRoom(quick: boolean): Room {
    let code = '';
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, quick, this.db, (r) => {
      this.rooms.delete(r.code);
      log.info(`room ${r.code} closed`);
    });
    if (this.graceMs !== undefined) room.graceMs = this.graceMs;
    this.rooms.set(code, room);
    log.info(`room ${code} opened (${quick ? 'quick match' : 'private'})`);
    return room;
  }
}

export { Conn };
