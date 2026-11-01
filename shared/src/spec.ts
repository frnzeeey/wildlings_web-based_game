import rulesJson from '../spec/rules.json' with { type: 'json' };
import weaponsJson from '../spec/weapons.json' with { type: 'json' };
import mapsJson from '../spec/maps.json' with { type: 'json' };
import charactersJson from '../spec/characters.json' with { type: 'json' };

/** Everything an explosion needs. Weapons, sub-munitions and hazards all satisfy it. */
export interface BlastDef {
  id: string;
  damage: number;
  directHit?: number;
  radius: number;
  terrain?: number;
  knockback?: number;
  shake?: number;
}

export interface ProjectileDef extends BlastDef {
  behavior: 'impact' | 'bounce' | 'drill' | 'mine' | 'strike' | 'teleport';
  gravity?: number;
  wind?: number;
  speed?: number;
  projectileRadius?: number;
  fuse?: number;
  bounce?: number;
  maxRange?: number;
  drillDistance?: number;
  tunnelRadius?: number;
  sprite?: string;
  trail?: string;
  armTime?: number;
  triggerRadius?: number;
  triggerFuse?: number;
  maxFlight?: number;
  sub?: SubDef;
}

export interface SubDef extends ProjectileDef {
  count: number;
  spread: number;
  lift: number;
  liftJitter: number;
}

export interface WeaponDef extends ProjectileDef {
  name: string;
  desc: string;
  ammo: number; // -1 = unlimited
  cooldown: number;
  pellets?: number;
  spread?: number;
  fixedPower?: boolean;
  targeted?: 'column' | 'point';
  count?: number;
  spacing?: number;
  dropHeight?: number;
  dropSpeed?: number;
  dropDrift?: number;
  aimGuide?: number;
}

export interface MapDef {
  id: string;
  name: string;
  hazard: 'water' | 'lava';
  wind: { scale: number; bias: number };
  spawn: { margin: number; jitter: number };
  gen: {
    base: number; amp: number; rough: number; caves: number; platforms: number; gaps: number; bridges: number;
    pillars: number; mesa: boolean; peaks: number; barrels: number; fieldMines: number;
  };
  palette: Record<string, string> & { sky: string[]; hills: string[]; decor: string };
}

export interface CharacterDef {
  id: string;
  name: string;
  body: string;
  dark: string;
  belly: string;
  ears: string;
  inner?: string;
  tail: string;
  face: string;
  earColor?: string;
  feet?: string;
}

export const RULES = rulesJson;
export type Rules = typeof rulesJson;
export const WEAPONS = weaponsJson.weapons as WeaponDef[];
export const HAZARDS = weaponsJson.hazards as unknown as {
  barrel: BlastDef & { bodyRadius: number; fuse: number };
  fieldMine: BlastDef & { armTime: number; triggerRadius: number; triggerFuse: number };
};
export const MAPS = mapsJson.maps as unknown as MapDef[];
export const CHARACTERS = charactersJson.characters as CharacterDef[];
export const TEAM_COLORS = charactersJson.teamColors;
export const SPEC_VERSION = rulesJson.specVersion;
export const PROTOCOL_VERSION = rulesJson.protocolVersion;

export const weaponById = (id: string): WeaponDef | undefined => WEAPONS.find((w) => w.id === id);
export const weaponIndex = (id: string): number => WEAPONS.findIndex((w) => w.id === id);
export const mapById = (id: string): MapDef | undefined => MAPS.find((m) => m.id === id);
export const characterById = (id: string): CharacterDef => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
