export const WORLD = {
  width: 2600,
  height: 1300,
  waterLevel: 1235,
  gravity: 620,
  windAccel: 160,
};

export const PLAYER = {
  radius: 13,
  walkSpeed: 80,
  maxClimb: 3, // px of rise allowed per px walked
  jumpVX: 130,
  jumpVY: -300,
  maxEnergy: 100,
  energyPerPx: 0.45,
  jumpCost: 12,
  fallSafeSpeed: 500,
  fallDamagePerSpeed: 0.09,
  maxAimDistance: 260,
};

export const WIND_LEVELS = { off: 0, low: 0.5, normal: 1, high: 1.6 };

export const TEAM_COLORS = ['#ff4d6d', '#3a86ff', '#ffbe0b', '#8ac926'];

export const SPECIES = [
  { id: 'fox', name: 'Fox', body: '#f2843a', dark: '#9a4a17', belly: '#fff4e3', ears: 'pointy', inner: '#fff4e3', tail: 'bushy', face: 'muzzle' },
  { id: 'bunny', name: 'Bunny', body: '#efe6dc', dark: '#9c8b7a', belly: '#ffffff', ears: 'long', inner: '#ffb3c6', tail: 'puff', face: 'muzzle' },
  { id: 'bear', name: 'Bear', body: '#a0693f', dark: '#5c3820', belly: '#e3c08f', ears: 'round', inner: '#e3c08f', tail: 'stub', face: 'muzzle' },
  { id: 'frog', name: 'Frog', body: '#6cc551', dark: '#2f7a22', belly: '#d8f5a2', ears: 'none', tail: 'none', face: 'frog' },
  { id: 'panda', name: 'Panda', body: '#f7f7f2', dark: '#2d2d33', belly: '#ffffff', ears: 'round', earColor: '#2d2d33', inner: '#55555e', feet: '#2d2d33', tail: 'stub', face: 'panda' },
  { id: 'cat', name: 'Cat', body: '#9aa0b3', dark: '#4f5466', belly: '#eef0f6', ears: 'pointy', inner: '#ffb3c6', tail: 'long', face: 'muzzle' },
  { id: 'penguin', name: 'Penguin', body: '#2f3446', dark: '#11131c', belly: '#ffffff', ears: 'none', feet: '#ffab2e', tail: 'none', face: 'beak' },
  { id: 'raccoon', name: 'Raccoon', body: '#8d929c', dark: '#3f434c', belly: '#e9e6df', ears: 'round', inner: '#3f434c', tail: 'striped', face: 'mask' },
];

export const MAPS = [
  {
    id: 'meadow',
    name: 'Sunny Meadow',
    sky: ['#4fc3ff', '#d4f4ff'],
    hills: ['#a8e08a', '#79c45a'],
    tree: '#4f9e3a',
    decor: 'round',
    ground: { top: '#5fc23b', topLight: '#94e862', dirt: '#9b6a3d', dirt2: '#8a5c32', deep: '#6e4826' },
    water: '#3a9fe8',
    gen: { base: 0.58, amp: 420, rough: 30, caves: 4, platforms: 2, islands: 0 },
  },
  {
    id: 'desert',
    name: 'Canyon Dunes',
    sky: ['#ff8f5a', '#ffe3a6'],
    hills: ['#f0b878', '#d9955a'],
    tree: '#4f8a3c',
    decor: 'cactus',
    ground: { top: '#f2c46d', topLight: '#ffe29e', dirt: '#d58c4a', dirt2: '#c27a3c', deep: '#a5612c' },
    water: '#2fb5b0',
    gen: { base: 0.6, amp: 540, rough: 16, caves: 2, platforms: 3, islands: 0, mesa: true },
  },
  {
    id: 'tundra',
    name: 'Frosty Peaks',
    sky: ['#86b2ea', '#eef6ff'],
    hills: ['#dbe8f5', '#b8cde4'],
    tree: '#3e6e5c',
    decor: 'pine',
    ground: { top: '#f4f9ff', topLight: '#ffffff', dirt: '#7d8aa0', dirt2: '#6f7c92', deep: '#566176' },
    water: '#5a8fd8',
    gen: { base: 0.56, amp: 600, rough: 38, caves: 3, platforms: 1, islands: 0 },
  },
  {
    id: 'islands',
    name: 'Coconut Isles',
    sky: ['#33b4ea', '#bff2ff'],
    hills: ['#6fd4b2', '#45b08c'],
    tree: '#2f8f5a',
    decor: 'palm',
    ground: { top: '#4fc94a', topLight: '#86e66f', dirt: '#e8c785', dirt2: '#dab673', deep: '#b8935a' },
    water: '#1f9ed8',
    gen: { base: 0.66, amp: 300, rough: 20, caves: 1, platforms: 3, islands: 3 },
  },
];

export const DEFAULT_SETTINGS = {
  turnTime: 30, // seconds, 0 = unlimited
  wind: 'normal',
  startHP: 100,
  screenShake: true,
  aimGuide: true,
  sound: true,
};

export const DEFAULT_ROSTER = [
  { name: 'Pip', species: 'fox' },
  { name: 'Bramble', species: 'bear' },
  { name: 'Clover', species: 'bunny' },
  { name: 'Ribbit', species: 'frog' },
];

export const DEFAULT_SETUP = { mode: 'bots', count: 2, difficulty: 'normal', mapId: 'random' };
