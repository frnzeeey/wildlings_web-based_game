import type { Command, MapDef, MatchResult, MatchSettings, Phase, SimEvent, TerrainMask } from '@wildlings/shared';

/** What the renderer needs to know about a critter. Satisfied by the sim's Character directly. */
export interface CharView {
  slot: number;
  name: string;
  species: string;
  team: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  drowned: boolean;
  onGround: boolean;
  crouching: boolean;
  aim: number;
  power: number;
  facing: number;
  energy: number;
  weaponId: string;
  fired: boolean;
  inventory: Record<string, number>;
  cooldowns: Record<string, number>;
}

export interface ProjView {
  id: number;
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  drilling: boolean;
}

export interface PropView {
  id: number;
  x: number;
  y: number;
  state: number;
}

/** Read-only world state. The local Match implements it; NetWorld mirrors the server's. */
export interface WorldView {
  readonly terrain: TerrainMask;
  readonly characters: readonly CharView[];
  readonly projectiles: readonly ProjView[];
  readonly mines: readonly PropView[];
  readonly barrels: readonly PropView[];
  readonly phase: Phase;
  readonly activeSlot: number;
  readonly turnNumber: number;
  readonly timeLeft: number;
  readonly wind: number;
  readonly waterLevel: number;
  readonly map: MapDef;
  readonly settings: MatchSettings;
}

export interface SlotInfo {
  slot: number;
  name: string;
  team: number;
  kind: 'human' | 'bot' | 'remote';
  detail?: string; // bot difficulty, client type
  connected: boolean;
}

/** A running match as seen by one client. */
export interface Session {
  readonly world: WorldView;
  readonly slots: SlotInfo[];
  readonly online: boolean;
  /** Slot the local player controls right now (or -1). For hot-seat this follows the active slot. */
  controlledSlot(): number;
  /** Advance by real elapsed time. Returns new events, in order. */
  update(dtMs: number): SimEvent[];
  /** Send a command for the controlled slot. Returns an error code if rejected locally. */
  send(cmd: Command): string | null;
  /** Result once the match is over. */
  result(): MatchResult | null;
  /** Errors for commands the server rejected since the last call (online only). */
  takeRejections?(): string[];
  /** Set when the session wants to show a status line (connection issues, waiting). */
  status(): string | null;
  dispose(): void;
}
