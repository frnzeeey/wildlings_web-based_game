import { createHash, randomBytes } from 'node:crypto';
import {
  MAPS, RULES, Match, DEFAULT_SETTINGS, mapById, encodeTerrain, CHARACTERS, WEAPONS,
  type ClientKind, type Command, type MatchPlayerInfo, type MatchResult, type MatchSettings, type MatchStartMsg,
  type RoomMember, type ServerMsg, type SimEvent,
} from '@wildlings/shared';
import type { Conn } from './conn.ts';
import type { Db } from './db.ts';
import { log } from './log.ts';

interface Member {
  playerId: string;
  name: string;
  species: string;
  client: ClientKind;
  conn: Conn | null;
  ready: boolean;
  host: boolean;
  disconnectedAt: number;
}

const ACTIVE_SNAP_TICKS = Math.round(RULES.world.tickRate / RULES.net.snapshotRateActive);
const IDLE_SNAP_TICKS = Math.round(RULES.world.tickRate / RULES.net.snapshotRateIdle);
const RESPONSE_ON_REJECT = new Set(['fire', 'weapon', 'skip', 'jump']);

export function terrainSum(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * A room: members, lobby settings, and (while playing) the authoritative Match.
 * Holds 2 players today; the Match supports up to 4 with teams.
 */
export class Room {
  readonly code: string;
  readonly quick: boolean;
  readonly capacity: number;
  members: Member[] = [];
  state: 'lobby' | 'playing' | 'results' = 'lobby';
  mapId = 'random';
  settings: MatchSettings = { ...DEFAULT_SETTINGS };
  match: Match | null = null;
  matchId = '';
  private slots: MatchPlayerInfo[] = [];
  private rematch = new Set<string>();
  private snapCountdown = 0;
  private lastMoving = false;
  private db: Db;
  private onEmpty: (room: Room) => void;
  graceMs: number = RULES.net.reconnectGrace * 1000;

  constructor(code: string, quick: boolean, db: Db, onEmpty: (room: Room) => void, capacity = 2) {
    this.code = code;
    this.quick = quick;
    this.db = db;
    this.onEmpty = onEmpty;
    this.capacity = capacity;
  }

  get full(): boolean {
    return this.members.length >= this.capacity;
  }

  has(playerId: string): boolean {
    return this.members.some((m) => m.playerId === playerId);
  }

  // ------------------------------------------------------------------ membership

  add(conn: Conn): boolean {
    if (this.has(conn.playerId)) return this.reattach(conn);
    if (this.full || this.state !== 'lobby') return false;
    this.members.push({
      playerId: conn.playerId, name: conn.name, species: conn.species, client: conn.client, conn,
      ready: this.quick, host: this.members.length === 0, disconnectedAt: 0,
    });
    conn.roomCode = this.code;
    this.broadcastRoom();
    this.maybeStart();
    return true;
  }

  /** A known member came back (new socket after a drop). */
  reattach(conn: Conn): boolean {
    const m = this.members.find((x) => x.playerId === conn.playerId);
    if (!m) return false;
    if (m.conn && m.conn !== conn) m.conn.roomCode = null;
    m.conn = conn;
    m.disconnectedAt = 0;
    m.client = conn.client;
    conn.roomCode = this.code;
    this.broadcastRoom();
    if (this.state === 'playing' && this.match) {
      conn.send(this.startMsg(this.slotOf(m.playerId), true));
      this.broadcast({ t: 'presence', playerId: m.playerId, connected: true, graceLeft: 0 });
      log.info(`room ${this.code}: ${m.name} reconnected`);
    }
    return true;
  }

  /** Socket closed. In a match the slot is kept for the grace period. */
  disconnected(conn: Conn): void {
    const m = this.members.find((x) => x.conn === conn);
    if (!m) return;
    m.conn = null;
    if (this.state === 'playing') {
      m.disconnectedAt = Date.now();
      this.broadcast({ t: 'presence', playerId: m.playerId, connected: false, graceLeft: Math.round(this.graceMs / 1000) });
      log.info(`room ${this.code}: ${m.name} disconnected, holding slot ${this.graceMs / 1000}s`);
    } else this.remove(m.playerId);
  }

  remove(playerId: string): void {
    const i = this.members.findIndex((m) => m.playerId === playerId);
    if (i < 0) return;
    const [m] = this.members.splice(i, 1);
    if (m.conn) {
      m.conn.roomCode = null;
      m.conn.send({ t: 'left' });
    }
    if (this.state === 'playing' && this.match) this.forfeit(playerId, 'forfeit');
    this.rematch.delete(playerId);
    if (this.members.length === 0) {
      this.onEmpty(this);
      return;
    }
    if (!this.members.some((x) => x.host)) this.members[0].host = true;
    if (this.state === 'results') {
      // Back to the lobby; a quick-match leftover room closes instead.
      if (this.quick) {
        for (const x of [...this.members]) this.remove(x.playerId);
        return;
      }
      this.state = 'lobby';
      for (const x of this.members) x.ready = false;
    }
    this.broadcastRoom();
  }

  setReady(playerId: string, ready: boolean): void {
    const m = this.members.find((x) => x.playerId === playerId);
    if (!m || this.state !== 'lobby') return;
    m.ready = ready;
    this.broadcastRoom();
    this.maybeStart();
  }

  configure(playerId: string, mapId?: string, settings?: Partial<MatchSettings>): string | null {
    const m = this.members.find((x) => x.playerId === playerId);
    if (!m?.host || this.quick) return 'Only the host can change the room settings';
    if (this.state !== 'lobby') return 'The match has already started';
    if (mapId !== undefined) {
      if (mapId !== 'random' && !mapById(mapId)) return 'Unknown map';
      this.mapId = mapId;
    }
    if (settings) this.settings = sanitizeSettings({ ...this.settings, ...settings });
    for (const x of this.members) x.ready = false;
    this.broadcastRoom();
    return null;
  }

  updateProfile(conn: Conn): void {
    const m = this.members.find((x) => x.playerId === conn.playerId);
    if (!m || this.state === 'playing') return;
    m.name = conn.name;
    m.species = conn.species;
    this.broadcastRoom();
  }

  voteRematch(playerId: string): void {
    if (this.state !== 'results' || !this.has(playerId)) return;
    this.rematch.add(playerId);
    this.broadcastRoom();
    if (this.members.length >= 2 && this.members.every((m) => this.rematch.has(m.playerId) && m.conn)) this.startMatch();
  }

  // ------------------------------------------------------------------ match lifecycle

  private maybeStart(): void {
    if (this.state === 'lobby' && this.members.length >= RULES.match.minPlayers && this.members.every((m) => m.ready && m.conn)) this.startMatch();
  }

  startMatch(): void {
    const mapId = this.mapId === 'random' ? MAPS[Math.floor(Math.random() * MAPS.length)].id : this.mapId;
    const seed = randomBytes(4).readUInt32LE(0) >>> 1;
    this.slots = this.members.map((m, i) => ({ slot: i, playerId: m.playerId, name: m.name, species: m.species, team: i, client: m.client }));
    this.match = new Match({ mapId, seed, players: this.slots.map((s) => ({ name: s.name, species: s.species, team: s.team })), settings: this.settings });
    this.matchId = randomBytes(6).toString('hex');
    this.state = 'playing';
    this.rematch.clear();
    this.snapCountdown = 0;
    this.match.start(); // its first 'turn' event goes out with the first tick
    try {
      this.db.matchStarted({ id: this.matchId, code: this.code, quick: this.quick, map: mapId, seed, settings: this.settings, players: this.slots });
    } catch (e) {
      log.error('db matchStarted failed', e);
    }
    log.info(`room ${this.code}: match ${this.matchId} on ${mapId} (${this.slots.map((s) => `${s.name}/${s.client}`).join(' vs ')})`);
    this.broadcastRoom();
    for (const m of this.members) m.conn?.send(this.startMsg(this.slotOf(m.playerId), false));
  }

  private slotOf(playerId: string): number {
    return this.slots.find((s) => s.playerId === playerId)?.slot ?? -1;
  }

  private startMsg(you: number, resumed: boolean): MatchStartMsg {
    const m = this.match!;
    return {
      t: 'matchStart', matchId: this.matchId, mapId: m.map.id, seed: m.seed, settings: m.settings, players: this.slots, you,
      terrain: encodeTerrain(m.terrain), terrainSum: terrainSum(m.terrain.data),
      chars: m.characters.map((c) => ({ slot: c.slot, maxHp: c.maxHp, inv: { ...c.inventory }, cd: { ...c.cooldowns } })),
      snap: m.snapshot(), resumed,
    };
  }

  command(playerId: string, seq: number, cmd: Command, conn: Conn): void {
    const m = this.match;
    if (!m || this.state !== 'playing') return;
    const slot = this.slotOf(playerId);
    if (slot < 0) return conn.send({ t: 'nack', seq, error: 'not-in-match' });
    if (!cmd || typeof cmd !== 'object' || typeof cmd.t !== 'string') return conn.send({ t: 'nack', seq, error: 'bad-command' });
    const r = m.command(slot, cmd);
    if (!r.ok && RESPONSE_ON_REJECT.has(cmd.t)) conn.send({ t: 'nack', seq, error: r.error });
    if (r.ok && (cmd.t === 'fire' || cmd.t === 'weapon' || cmd.t === 'jump')) this.snapCountdown = 0;
  }

  resync(conn: Conn): void {
    if (this.state === 'playing' && this.match) conn.send(this.startMsg(this.slotOf(conn.playerId), true));
  }

  resign(playerId: string): void {
    if (this.state === 'playing') this.forfeit(playerId, 'forfeit');
  }

  private forfeit(playerId: string, reason: 'forfeit' | 'abandoned'): void {
    const slot = this.slotOf(playerId);
    if (slot < 0 || !this.match) return;
    this.match.forfeit(slot);
    this.flush(reason);
  }

  /** Advance one tick (called by the server loop at the sim rate). */
  tick(now: number): void {
    if (this.state !== 'playing' || !this.match) return;
    for (const m of this.members) {
      if (!m.conn && m.disconnectedAt && now - m.disconnectedAt > this.graceMs) {
        log.info(`room ${this.code}: ${m.name} did not return in time, forfeiting`);
        m.disconnectedAt = 0;
        this.forfeit(m.playerId, 'abandoned');
        if (this.state !== 'playing') return;
      }
    }
    this.match.step();
    this.flush('finished');
  }

  /** Send this tick's events, a snapshot when due, and handle the end of the match. */
  private flush(reason: 'finished' | 'forfeit' | 'abandoned'): void {
    const m = this.match!;
    const events = m.takeEvents();
    if (events.length) {
      this.broadcast({ t: 'ev', tick: m.tick, list: events });
      this.snapCountdown = 0;
    }
    const moving = m.phase === 'action' || m.phase === 'settle' || m.projectiles.length > 0 ||
      m.characters.some((c) => !c.onGround && !c.drowned) || (m.phase === 'aim' && (m.active?.input.move ?? 0) !== 0);
    if (moving !== this.lastMoving) this.snapCountdown = 0;
    this.lastMoving = moving;
    if (--this.snapCountdown <= 0 || m.phase === 'over') {
      this.snapCountdown = moving ? ACTIVE_SNAP_TICKS : IDLE_SNAP_TICKS;
      this.broadcast({ t: 'snap', s: m.snapshot() });
    }
    const turn = events.find((e): e is Extract<SimEvent, { e: 'turn' }> => e.e === 'turn');
    if (turn) this.broadcast({ t: 'tsum', turn: turn.turn, tick: m.tick, sum: terrainSum(m.terrain.data) });
    if (m.phase === 'over' && m.result) this.finish(m.result, reason);
  }

  private finish(result: MatchResult, reason: 'finished' | 'forfeit' | 'abandoned'): void {
    this.state = 'results';
    const ids = new Map(this.slots.map((s) => [s.slot, s.playerId]));
    try {
      this.db.matchEnded(this.matchId, result, reason, ids);
    } catch (e) {
      log.error('db matchEnded failed', e);
    }
    log.info(`room ${this.code}: match ${this.matchId} over (${reason}), winners ${result.winners.join(',') || 'none'}`);
    this.broadcast({ t: 'matchEnd', result, players: this.slots, reason });
    // Members who never came back are dropped now.
    for (const m of [...this.members]) if (!m.conn) this.remove(m.playerId);
    if (this.members.length) this.broadcastRoom();
  }

  // ------------------------------------------------------------------ messaging

  roomMsg(): ServerMsg {
    return {
      t: 'room', code: this.code, quick: this.quick, state: this.state, mapId: this.mapId, settings: this.settings,
      members: this.members.map((m): RoomMember => ({ id: m.playerId, name: m.name, species: m.species, client: m.client, ready: m.ready, connected: !!m.conn, host: m.host })),
      rematch: [...this.rematch],
    };
  }

  broadcastRoom(): void {
    this.broadcast(this.roomMsg());
  }

  broadcast(msg: ServerMsg): void {
    const json = JSON.stringify(msg);
    for (const m of this.members) m.conn?.sendRaw(json);
  }
}

export function sanitizeSettings(s: Partial<MatchSettings>): MatchSettings {
  const turnTime = RULES.turn.timeOptions.includes(Number(s.turnTime)) ? Number(s.turnTime) : DEFAULT_SETTINGS.turnTime;
  const wind = (['off', 'low', 'normal', 'high'] as const).includes(s.wind as never) ? (s.wind as MatchSettings['wind']) : 'normal';
  const startHP = RULES.match.startHPOptions.includes(Number(s.startHP)) ? Number(s.startHP) : DEFAULT_SETTINGS.startHP;
  return { turnTime, wind, startHP, suddenDeath: s.suddenDeath !== false };
}

export function sanitizeSpecies(s: unknown): string {
  return CHARACTERS.some((c) => c.id === s) ? String(s) : 'fox';
}

export const WEAPON_IDS = new Set(WEAPONS.map((w) => w.id));
