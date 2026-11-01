import {
  RULES, MAPS, mapById, decodeTerrain, FLAG_ALIVE, FLAG_CROUCH, FLAG_DROWNED, FLAG_FIRED, FLAG_GROUND,
  type Command, type MatchResult, type MatchSettings, type MatchStartMsg, type Phase, type ServerMsg, type SimEvent,
  type Snapshot, type TerrainMask, type MapDef,
} from '@wildlings/shared';
import type { CharView, ProjView, PropView, Session, SlotInfo, WorldView } from './view.ts';
import type { NetClient } from '../net/NetClient.ts';

const TICK = RULES.world.tickRate;
const DELAY_TICKS = (RULES.net.interpDelayMs / 1000) * TICK;

/** The server's match as this client sees it: decoded terrain + interpolated snapshots. */
class NetWorld implements WorldView {
  terrain: TerrainMask;
  characters: CharView[];
  projectiles: ProjView[] = [];
  mines: PropView[] = [];
  barrels: PropView[] = [];
  phase: Phase = 'idle';
  activeSlot = -1;
  turnNumber = 0;
  timeLeft = 0;
  wind = 0;
  waterLevel: number = RULES.world.waterLevel;
  map: MapDef;
  settings: MatchSettings;

  constructor(start: MatchStartMsg) {
    this.terrain = decodeTerrain(start.terrain);
    this.map = mapById(start.mapId) ?? MAPS[0];
    this.settings = start.settings;
    this.characters = start.players.map((p) => {
      const st = start.chars.find((c) => c.slot === p.slot);
      return {
        slot: p.slot, name: p.name, species: p.species, team: p.team, x: 0, y: 0, vx: 0, vy: 0, hp: st?.maxHp ?? 100,
        maxHp: st?.maxHp ?? 100, alive: true, drowned: false, onGround: true, crouching: false, aim: 0, power: 0.5,
        facing: 1, energy: 100, weaponId: 'rocket', fired: false, inventory: { ...(st?.inv ?? {}) }, cooldowns: { ...(st?.cd ?? {}) },
      };
    });
  }
}

/** Online match: the server simulates; this client renders, interpolates and sends commands. */
export class NetSession implements Session {
  readonly online = true;
  world: NetWorld;
  slots: SlotInfo[];
  you: number;
  matchId: string;
  private net: NetClient;
  private snaps: Snapshot[] = [];
  private pendingEvents: { tick: number; e: SimEvent }[] = [];
  private pendingSums: { tick: number; sum: string }[] = [];
  private tickOffset: number | null = null;
  private seq = 0;
  private finalResult: MatchResult | null = null;
  private rejected: string[] = [];
  private grace = new Map<number, number>();
  private playerIds = new Map<string, number>();
  private unsub: () => void;
  /** Set to true when the terrain was replaced by a resync; the scene repaints. */
  terrainReset = false;
  checking = false;

  constructor(net: NetClient, start: MatchStartMsg) {
    this.net = net;
    this.world = new NetWorld(start);
    this.you = start.you;
    this.matchId = start.matchId;
    this.slots = start.players.map((p) => ({
      slot: p.slot, name: p.name, team: p.team, kind: p.slot === start.you ? 'human' : 'remote', detail: p.client, connected: true,
    }));
    for (const p of start.players) this.playerIds.set(p.playerId, p.slot);
    this.applySnapshotNow(start.snap);
    this.unsub = net.on((m) => this.onMessage(m));
  }

  /** A fresh matchStart for the same match (reconnect / resync): replace terrain and state. */
  reset(start: MatchStartMsg): void {
    const fresh = new NetWorld(start);
    this.world.terrain.data.set(fresh.terrain.data);
    this.world.terrain.surface = fresh.terrain.surface;
    for (const c of this.world.characters) {
      const st = start.chars.find((s) => s.slot === c.slot);
      if (st) {
        c.inventory = { ...st.inv };
        c.cooldowns = { ...st.cd };
      }
    }
    this.snaps = [];
    this.pendingEvents = [];
    this.pendingSums = [];
    this.tickOffset = null;
    this.applySnapshotNow(start.snap);
    this.terrainReset = true;
  }

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'snap':
        this.addSnapshot(m.s);
        break;
      case 'ev':
        for (const e of m.list) this.pendingEvents.push({ tick: m.tick, e });
        break;
      case 'tsum':
        this.pendingSums.push({ tick: m.tick, sum: m.sum });
        break;
      case 'nack':
        this.rejected.push(m.error);
        break;
      case 'presence': {
        const s = this.slotOf(m.playerId);
        if (s >= 0) {
          this.slots[s].connected = m.connected;
          this.grace.set(s, performance.now() + m.graceLeft * 1000);
        }
        break;
      }
      case 'matchEnd':
        this.finalResult = m.result;
        break;
      case 'matchStart':
        if (m.matchId === this.matchId) this.reset(m);
        break;
    }
  }

  private slotOf(playerId: string): number {
    return this.playerIds.get(playerId) ?? -1;
  }

  private addSnapshot(s: Snapshot): void {
    const est = s.tick - (performance.now() / 1000) * TICK;
    // Track the newest server clock estimate; drift slowly so jitter doesn't jerk the view.
    if (this.tickOffset === null || est > this.tickOffset) this.tickOffset = est;
    else this.tickOffset += (est - this.tickOffset) * 0.02;
    this.snaps.push(s);
    if (this.snaps.length > 60) this.snaps.splice(0, this.snaps.length - 60);
  }

  private applySnapshotNow(s: Snapshot): void {
    this.snaps = [s];
    this.tickOffset = s.tick - (performance.now() / 1000) * TICK + DELAY_TICKS;
    this.interpolate(s.tick);
  }

  controlledSlot(): number {
    return this.world.activeSlot === this.you && this.you >= 0 ? this.you : -1;
  }

  update(): SimEvent[] {
    if (this.tickOffset === null) return [];
    const renderTick = (performance.now() / 1000) * TICK + this.tickOffset - DELAY_TICKS;
    this.interpolate(renderTick);
    const out: SimEvent[] = [];
    while (this.pendingEvents.length && this.pendingEvents[0].tick <= renderTick) {
      const { e } = this.pendingEvents.shift()!;
      this.applyEvent(e);
      out.push(e);
    }
    while (this.pendingSums.length && this.pendingSums[0].tick <= renderTick) this.verify(this.pendingSums.shift()!.sum);
    return out;
  }

  private applyEvent(e: SimEvent): void {
    const w = this.world;
    switch (e.e) {
      case 'carve':
        w.terrain.carve(e.x, e.y, e.r);
        break;
      case 'turn': {
        const c = w.characters[e.slot];
        if (c) {
          c.inventory = { ...e.inv };
          c.cooldowns = { ...e.cd };
        }
        break;
      }
      case 'fire': {
        const c = w.characters[e.slot];
        if (c && c.inventory[e.weapon] > 0) c.inventory[e.weapon]--;
        break;
      }
      case 'water':
        w.waterLevel = e.level;
        break;
      case 'gameover':
        this.finalResult = e.result;
        break;
    }
  }

  /** Compare our terrain with the server's checksum; ask for a resync if they differ. */
  private async verify(sum: string): Promise<void> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || this.checking) return;
    this.checking = true;
    try {
      const d = await subtle.digest('SHA-256', this.world.terrain.data as Uint8Array<ArrayBuffer>);
      const hex = [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
      if (hex !== sum) {
        console.warn('[net] terrain drift detected, requesting resync');
        this.net.send({ t: 'resync' });
      }
    } finally {
      this.checking = false;
    }
  }

  private interpolate(renderTick: number): void {
    const snaps = this.snaps;
    if (!snaps.length) return;
    let a = snaps[0];
    let b = snaps[0];
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].tick <= renderTick) a = snaps[i];
      if (snaps[i].tick >= renderTick) {
        b = snaps[i];
        break;
      }
      b = snaps[i];
    }
    // Drop snapshots older than the one we interpolate from.
    const ia = snaps.indexOf(a);
    if (ia > 0) snaps.splice(0, ia);
    const t = b.tick > a.tick ? Math.min(1, Math.max(0, (renderTick - a.tick) / (b.tick - a.tick))) : 0;
    const L = (x: number, y: number) => x + (y - x) * t;
    const w = this.world;
    w.phase = a.ph;
    w.activeSlot = a.ts;
    w.turnNumber = a.tn;
    w.timeLeft = a.tl < 0 ? Infinity : Math.max(0, a.tl - (renderTick - a.tick) / TICK);
    w.wind = a.wind;
    w.waterLevel = a.water;
    for (const ca of a.c) {
      const cb = b.c.find((c) => c.s === ca.s) ?? ca;
      const c = w.characters[ca.s];
      if (!c) continue;
      c.x = L(ca.x, cb.x);
      c.y = L(ca.y, cb.y);
      c.vx = ca.vx;
      c.vy = ca.vy;
      c.hp = ca.hp;
      c.alive = !!(ca.f & FLAG_ALIVE);
      c.drowned = !!(ca.f & FLAG_DROWNED);
      c.onGround = !!(ca.f & FLAG_GROUND);
      c.crouching = !!(ca.f & FLAG_CROUCH);
      c.fired = !!(ca.f & FLAG_FIRED);
      const da = cb.a - ca.a;
      c.aim = Math.abs(da) < Math.PI ? L(ca.a, cb.a) : cb.a;
      c.power = L(ca.p, cb.p);
      c.facing = ca.d;
      c.energy = ca.en;
      c.weaponId = ca.w;
    }
    w.projectiles = a.pr.map((pa) => {
      const pb = b.pr.find((p) => p.id === pa.id);
      return pb
        ? { id: pa.id, kind: pa.k, x: L(pa.x, pb.x), y: L(pa.y, pb.y), vx: pb.vx, vy: pb.vy, drilling: !!pa.dr }
        : { id: pa.id, kind: pa.k, x: pa.x + (pa.vx * (renderTick - a.tick)) / TICK, y: pa.y + (pa.vy * (renderTick - a.tick)) / TICK, vx: pa.vx, vy: pa.vy, drilling: !!pa.dr };
    });
    const props = (pa: Snapshot['mn'], pb: Snapshot['mn']): PropView[] =>
      pa.map((m) => {
        const n = pb.find((o) => o.id === m.id) ?? m;
        return { id: m.id, x: L(m.x, n.x), y: L(m.y, n.y), state: m.st };
      });
    w.mines = props(a.mn, b.mn);
    w.barrels = props(a.br, b.br);
  }

  send(cmd: Command): string | null {
    if (!this.net.send({ t: 'cmd', seq: ++this.seq, c: cmd })) return cmd.t === 'fire' ? 'offline' : null;
    return null;
  }

  takeRejections(): string[] {
    const r = this.rejected;
    this.rejected = [];
    return r;
  }

  result(): MatchResult | null {
    return this.finalResult;
  }

  status(): string | null {
    if (this.net.state !== 'online') return 'Connection lost. Reconnecting…';
    for (const s of this.slots) {
      if (s.kind === 'remote' && !s.connected) {
        const left = Math.max(0, Math.ceil(((this.grace.get(s.slot) ?? 0) - performance.now()) / 1000));
        return `${s.name} disconnected. Waiting ${left}s for them to return…`;
      }
    }
    return null;
  }

  dispose(): void {
    this.unsub();
  }
}
