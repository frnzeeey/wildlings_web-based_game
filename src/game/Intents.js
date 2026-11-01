/**
 * Controllers (human, AI, and later network) all produce the same intent object each tick.
 * The Game applies intents to the active player, so a remote controller only has to
 * deliver these values to plug online play in.
 */
export function emptyIntents() {
  return {
    move: 0, // -1 left, 0, 1 right
    jump: false,
    crouch: false,
    aim: null, // angle in radians (canvas space, up is negative)
    power: null, // 0..1
    target: null, // { x, y } world point for targeted weapons
    fire: false,
    weaponDelta: 0,
    selectIndex: null,
    selectWeaponId: null,
  };
}
