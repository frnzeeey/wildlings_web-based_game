import { RULES, type MatchSettings } from '@wildlings/shared';

export interface ClientSettings extends MatchSettings {
  screenShake: boolean;
  aimGuide: boolean;
  sfxVolume: number; // 0..1
  musicVolume: number;
  wheelMode: 'weapon' | 'power';
  zoom: number;
}

export interface Profile {
  name: string;
  species: string;
}

export interface Roster {
  players: Profile[]; // hot-seat / bot match lineup; [0] is "you"
}

export interface Setup {
  mode: 'bots' | 'local';
  count: number;
  difficulty: 'easy' | 'normal' | 'hard';
  mapId: string; // map id or 'random'
}

export const DEFAULT_SETTINGS: ClientSettings = {
  turnTime: RULES.turn.defaultTime,
  wind: 'normal',
  startHP: RULES.character.hp,
  suddenDeath: true,
  screenShake: true,
  aimGuide: true,
  sfxVolume: 0.7,
  musicVolume: 0.35,
  wheelMode: 'weapon',
  zoom: 1,
};

export const DEFAULT_ROSTER: Roster = {
  players: [
    { name: 'Pip', species: 'fox' },
    { name: 'Bramble', species: 'bear' },
    { name: 'Clover', species: 'bunny' },
    { name: 'Ribbit', species: 'frog' },
  ],
};

export const DEFAULT_SETUP: Setup = { mode: 'bots', count: 2, difficulty: 'normal', mapId: 'random' };

/** localStorage with graceful fallback (private windows, blocked storage). */
export function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`wildlings:${key}`);
    if (raw) return { ...structuredClone(fallback), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return structuredClone(fallback);
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(`wildlings:${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
