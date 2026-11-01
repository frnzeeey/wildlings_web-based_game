/**
 * Optional image overrides for the procedurally drawn art.
 *
 * Drop a PNG into this folder and map a species id to it, e.g.
 *
 *   fox: new URL('./fox.png', import.meta.url).href,
 *
 * The image is drawn facing right with its bottom-centre on the character's feet,
 * scaled to ~42px tall (world units). The held weapon is still drawn on top.
 * Any species without an entry keeps its procedural look.
 */
export const SPRITE_OVERRIDES = {};
