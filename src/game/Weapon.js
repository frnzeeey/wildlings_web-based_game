import { PLAYER } from './config.js';

/**
 * Weapon registry. To add a weapon, append a definition here; behaviour is chosen by
 * `behavior` ('impact' | 'bounce' | 'drill' | 'teleport'), plus optional modifiers:
 *   pellets/spread  -> fires several projectiles in a fan (shotgun)
 *   targeted        -> 'column' drops projectiles from the sky on the cursor, 'point' uses the cursor
 *   sub             -> definition of child projectiles spawned on explosion (cluster)
 *   fuse/bounce     -> timed, bouncing projectiles
 * Sprites are looked up by `sprite` (defaults to `id`) in rendering/Sprites.js.
 */
export const WEAPONS = [
  {
    id: 'rocket', name: 'Rocket', ammo: Infinity, behavior: 'impact',
    damage: 45, radius: 55, speed: 1050, gravity: 1, wind: 1, terrain: 1, knockback: 330,
    projectileRadius: 4, shake: 9, trail: true,
    desc: 'Trusty rocket. Explodes on impact and rides the wind.',
  },
  {
    id: 'grenade', name: 'Grenade', ammo: 6, behavior: 'bounce',
    damage: 48, radius: 58, speed: 800, gravity: 1, wind: 0.35, terrain: 1, knockback: 330,
    projectileRadius: 5, fuse: 3, bounce: 0.5, shake: 10,
    desc: 'Bouncy! Blows up 3 seconds after throwing.',
  },
  {
    id: 'cluster', name: 'Cluster Bomb', ammo: 3, behavior: 'impact',
    damage: 25, radius: 40, speed: 900, gravity: 1, wind: 0.8, terrain: 1, knockback: 220,
    projectileRadius: 5, shake: 8,
    sub: {
      id: 'bomblet', sprite: 'bomblet', count: 5, spread: 230, behavior: 'impact',
      damage: 22, radius: 34, gravity: 1, wind: 0.5, terrain: 1, knockback: 200, projectileRadius: 3, shake: 5,
    },
    desc: 'Bursts into five bomblets on impact.',
  },
  {
    id: 'shotgun', name: 'Shotgun', ammo: 4, behavior: 'impact', sprite: 'pellet',
    pellets: 6, spread: 0.07, fixedPower: true,
    damage: 9, radius: 16, speed: 1700, gravity: 0.15, wind: 0, terrain: 0.9, knockback: 110,
    projectileRadius: 2, shake: 3,
    desc: 'Six-pellet blast. Short range, ignores wind.',
  },
  {
    id: 'mega', name: 'Mega Bomb', ammo: 1, behavior: 'impact',
    damage: 80, radius: 105, speed: 780, gravity: 1.25, wind: 0.5, terrain: 1.15, knockback: 520,
    projectileRadius: 8, shake: 24,
    desc: 'Enormous blast. Heavy and slow to fly.',
  },
  {
    id: 'drill', name: 'Burrow Drill', ammo: 2, behavior: 'drill',
    drillDistance: 160, tunnelRadius: 11,
    damage: 50, radius: 55, speed: 950, gravity: 1, wind: 0.5, terrain: 1, knockback: 330,
    projectileRadius: 4, shake: 10,
    desc: 'Tunnels through the ground, then explodes.',
  },
  {
    id: 'meteor', name: 'Meteor Shower', ammo: 1, behavior: 'impact', targeted: 'column',
    count: 5, spread: 150,
    damage: 30, radius: 42, gravity: 1, wind: 0.25, terrain: 1, knockback: 260,
    projectileRadius: 7, shake: 9, trail: true,
    desc: 'Calls five meteors down on the cursor.',
  },
  {
    id: 'teleport', name: 'Teleporter', ammo: 2, behavior: 'teleport', targeted: 'point', damage: 0,
    desc: 'Blink to any open spot. Ends your turn.',
  },
];

export const getWeapon = (id) => WEAPONS.find((w) => w.id === id);

export function createInventory() {
  return Object.fromEntries(WEAPONS.map((w) => [w.id, w.ammo]));
}

/** Damage dealt to a character whose centre is `dist` px from the blast. Contact = full damage. */
export function damageAt(dist, def) {
  if (!def.damage) return 0;
  const eff = Math.max(0, dist - PLAYER.radius - 3);
  if (eff >= def.radius) return 0;
  return Math.round(def.damage * (1 - eff / def.radius));
}

/** Muzzle position and launch velocity for a shot. Shared by the game and the AI simulator. */
export function launchParams(player, angle, power, weapon) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const off = PLAYER.radius + 6;
  const speed = weapon.fixedPower ? weapon.speed : weapon.speed * (0.15 + 0.85 * power);
  return { x: player.x + c * off, y: player.y - 4 + s * off, vx: c * speed, vy: s * speed };
}
