/** Commands are the only way to change a match. Clients, bots and the network all produce them. */
export type Command =
  | { t: 'input'; move: number; up: boolean; down: boolean }
  | { t: 'jump' }
  | { t: 'aim'; angle: number; power: number }
  | { t: 'weapon'; id: string }
  | { t: 'fire'; weapon: string; angle: number; power: number; tx?: number; ty?: number }
  | { t: 'skip' };

export type CommandResult = { ok: true } | { ok: false; error: string };

export type Phase = 'idle' | 'start' | 'aim' | 'action' | 'settle' | 'over';

export type DeathCause = 'hp' | 'water' | 'lava' | 'void' | 'forfeit';

/** Everything that happened during a tick, in order. Renderers turn these into effects and sounds. */
export type SimEvent =
  | { e: 'turn'; slot: number; turn: number; wind: number; time: number; water: number; inv: Record<string, number>; cd: Record<string, number> }
  | { e: 'aimPhase'; slot: number }
  | { e: 'fire'; slot: number; weapon: string; x: number; y: number; angle: number }
  | { e: 'carve'; x: number; y: number; r: number }
  | { e: 'explode'; x: number; y: number; r: number; id: string; shake: number }
  | { e: 'damage'; slot: number; amount: number; hp: number; by: number }
  | { e: 'death'; slot: number; cause: DeathCause }
  | { e: 'splash'; x: number; big: boolean }
  | { e: 'bounce'; x: number; y: number }
  | { e: 'jump'; slot: number }
  | { e: 'land'; slot: number; impact: number }
  | { e: 'teleport'; slot: number; fx: number; fy: number; x: number; y: number }
  | { e: 'mineArmed'; id: number }
  | { e: 'mineTrigger'; id: number }
  | { e: 'barrelLit'; id: number }
  | { e: 'fizzle'; x: number; y: number }
  | { e: 'weapon'; slot: number; id: string }
  | { e: 'timeUp'; slot: number }
  | { e: 'water'; level: number }
  | { e: 'gameover'; result: MatchResult };

export interface PlayerStats {
  damageDealt: number;
  damageTaken: number;
  selfDamage: number;
  shots: number;
  hits: number;
  kills: number;
  turns: number;
}

export interface MatchResult {
  winnerTeam: number | null;
  winners: number[];
  turns: number;
  duration: number;
  map: string;
  players: { slot: number; name: string; team: number; alive: boolean; stats: PlayerStats }[];
}

export interface CharSnap {
  s: number; // slot
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  f: number; // flags: 1 onGround, 2 alive, 4 drowned, 8 crouching, 16 fired
  a: number; // aim angle
  p: number; // power
  d: number; // facing -1 | 1
  en: number; // energy
  w: string; // weapon id
}

export interface ProjSnap {
  id: number;
  k: string; // sprite kind
  x: number;
  y: number;
  vx: number;
  vy: number;
  dr?: 1; // drilling
}

export interface PropSnap {
  id: number;
  x: number;
  y: number;
  st: number; // mine: 0 unarmed, 1 armed, 2 triggered. barrel: 0 idle, 2 lit
}

export interface Snapshot {
  tick: number;
  ph: Phase;
  ts: number; // active slot
  tn: number; // turn number
  tl: number; // time left (s), -1 = unlimited
  wind: number;
  water: number;
  c: CharSnap[];
  pr: ProjSnap[];
  mn: PropSnap[];
  br: PropSnap[];
}

export interface MatchPlayerConfig {
  name: string;
  species: string;
  team: number;
  bot?: 'easy' | 'normal' | 'hard' | null;
}

export interface MatchSettings {
  turnTime: number; // seconds, 0 = unlimited
  wind: 'off' | 'low' | 'normal' | 'high';
  startHP: number;
  suddenDeath: boolean;
}

export const FLAG_GROUND = 1;
export const FLAG_ALIVE = 2;
export const FLAG_DROWNED = 4;
export const FLAG_CROUCH = 8;
export const FLAG_FIRED = 16;
