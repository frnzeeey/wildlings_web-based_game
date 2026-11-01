import type { TerrainPayload } from './sim/terrain.ts';
import type { Command, MatchResult, MatchSettings, SimEvent, Snapshot } from './sim/types.ts';

/** JSON-over-WebSocket protocol shared by the server, the web client and the Godot client. See docs/PROTOCOL.md. */

export type ClientKind = 'web' | 'godot' | 'bot' | 'test';

export type ClientMsg =
  | { t: 'hello'; v: number; spec: string; client: ClientKind; name: string; species?: string; token?: string }
  | { t: 'profile'; name: string; species: string }
  | { t: 'queue' }
  | { t: 'unqueue' }
  | { t: 'createRoom'; mapId?: string; settings?: Partial<MatchSettings> }
  | { t: 'joinRoom'; code: string }
  | { t: 'leaveRoom' }
  | { t: 'ready'; ready: boolean }
  | { t: 'roomConfig'; mapId?: string; settings?: Partial<MatchSettings> }
  | { t: 'cmd'; seq: number; c: Command }
  | { t: 'resync' }
  | { t: 'rematch' }
  | { t: 'resign' }
  | { t: 'ping'; id: number };

export interface RoomMember {
  id: string;
  name: string;
  species: string;
  client: ClientKind;
  ready: boolean;
  connected: boolean;
  host: boolean;
}

export interface MatchPlayerInfo {
  slot: number;
  playerId: string;
  name: string;
  species: string;
  team: number;
  client: ClientKind;
}

export interface CharState {
  slot: number;
  maxHp: number;
  inv: Record<string, number>;
  cd: Record<string, number>;
}

export interface MatchStartMsg {
  t: 'matchStart';
  matchId: string;
  mapId: string;
  seed: number;
  settings: MatchSettings;
  players: MatchPlayerInfo[];
  you: number; // your slot, -1 for spectators
  terrain: TerrainPayload;
  terrainSum: string;
  chars: CharState[];
  snap: Snapshot;
  resumed: boolean;
}

export type ServerMsg =
  | { t: 'welcome'; playerId: string; token: string; name: string; spec: string }
  | { t: 'error'; code: string; msg: string }
  | { t: 'queued'; players: number }
  | { t: 'room'; code: string; quick: boolean; state: 'lobby' | 'playing' | 'results'; mapId: string; settings: MatchSettings; members: RoomMember[]; rematch: string[] }
  | { t: 'left' }
  | MatchStartMsg
  | { t: 'snap'; s: Snapshot }
  | { t: 'ev'; tick: number; list: SimEvent[] }
  | { t: 'tsum'; turn: number; tick: number; sum: string }
  | { t: 'nack'; seq: number; error: string }
  | { t: 'matchEnd'; result: MatchResult; players: MatchPlayerInfo[]; reason: 'finished' | 'forfeit' | 'abandoned' }
  | { t: 'presence'; playerId: string; connected: boolean; graceLeft: number }
  | { t: 'pong'; id: number; time: number };

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 5;
export const MAX_NAME_LENGTH = 16;

export function sanitizeName(name: unknown): string {
  const s = String(name ?? '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  return s || 'Critter';
}
