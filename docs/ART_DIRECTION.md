# Wildlings — Art Direction: "Sunlit Isles"

A modern, stylised 2.5D cartoon look: chunky animal adventurers with soft volumetric shading and
coloured line art, fighting over bright floating-island worlds with stacked-stone cliffs, grassy
caps, waterfalls and layered parallax scenery. Every asset is original and authored as vector code:

- `tools/gen-art.mjs` generates critters, gear, weapons, projectiles, props, effects, icons, the
  logo and the UI kit into `shared/assets/art` (SVG + `manifest.json`).
- `tools/art-kit.mjs` holds the shared colour helpers and the volume shader `vol()`.
- `tools/art-worlds.mjs` builds the painted parallax backgrounds and the terrain decor sprites.
- Terrain is painted procedurally from the destruction mask. The web `TerrainLayer` and Godot's
  `terrain.gdshader` use identical formulas, including the same integer hash.
- Both clients load the same files, so the web and Godot versions look the same.

Art is presentation only. Nothing here touches the terrain mask, collision, physics, weapons or
networking; map palettes in `shared/spec/maps.json` are cosmetic and do not change the spec version.

## Technical frame

| Item | Value |
| --- | --- |
| View | 2D side view with 2.5D shading. Characters face right (mirrored at runtime); light comes from the top-left everywhere. |
| World | 2600 × 1300 px. Critters are 40–78 px tall at zoom 1 (each species has its own size). |
| Rasterisation | Characters, weapons, props, FX and decor at 3×. UI kit at 2× (nine-slice, 24-unit corners). Backgrounds at 0.5×. Logo at 1×. |
| Renderer limits | No SVG filters: Godot rasterises with ThorVG, which ignores them. Softness comes from gradients, clip paths and offset strokes. |
| Fonts | **Lilita One** (display) and **Fredoka** (body), both SIL OFL, served locally in both clients. |

## Rendering model: `vol()`

Every character part, weapon and prop is drawn with the same volume shader, so everything belongs
to one world:

1. Base fill, then detail patches (belly, stripes, bands) so they receive the same lighting.
2. A soft key-light gradient from the top-left, and a warm-violet form shadow toward the lower right.
3. Ambient-occlusion blobs where parts meet (under the head, under a scarf, under a cap).
4. A rim light hugging the upper-left edge and a faint warm bounce light on the lower right
   (strokes offset and clipped to the shape).
5. A soft radial specular highlight.
6. **Coloured line art**: each critter's outline is a deep, warm version of its own fur, and props
   use a dark version of their fill. UI and logo keep one navy ink (`#16203f`). Body outlines are
   1.7–1.9 units and details 1.1–1.5.

Team garments are drawn white with neutral shading and tinted (multiplied) at runtime.

## Characters

Same roster, roles and rig anchors as before; each critter has its own body plan, signature gear
and a team-coloured garment.

| Critter | Body plan | Signature gear | Team garment |
| --- | --- | --- | --- |
| Fox | Lanky, tall wedge head, white-tipped brush tail, dark socks | Aviator goggles on the crown | Neck bandana with knot tails |
| Bear | Big round body, tiny limbs, crown tuft | Plaster on the brow, work boots | Overalls |
| Bunny | Small egg body, huge ears (one flopped), long feet | Buck teeth, freckles | Knotted commando headband with flying tails |
| Frog | Squat dome, eye domes on top, wide grin | Yellow wellies | Rain slicker |
| Panda | Pear body with dark shoulder band, teardrop patches | Round tummy, sleepy blush | Pompom beanie |
| Cat | Slim, wide cheeky head, S-curve tail | Studded leather jacket, gold earring | Neckerchief |
| Penguin | Bowling-pin body, heart-shaped face, big beak | Leather aviator cap with goggles | Knitted scarf |
| Raccoon | Hunched bean, domino mask, ringed tail | Mask | Backwards cap |

Faces are shared parts: tall eye whites with a lid shadow and lash line, a glossy brown iris with
two catch-lights, and thick brows that slope down toward the nose for a "cute but competitive"
expression. Closed, hurt and happy eyes and the open mouth are unchanged in function.

## Weapons, projectiles and effects

- **Held weapons** are chunkier: a grey bazooka with red bands and muzzle, a green heavy launcher
  with scope, a wood-and-steel shotgun, a hand drill, a grenade, a black skull bomb with a lit fuse,
  a disc mine, a field radio and a star wand.
- **Projectiles**: striped rockets with flame, a skull-marked heavy missile, skull bombs with fuse
  sparks, a glowing pellet, a finned air bomb.
- **Explosions** (`Fx.explosion` / `fx.gd`): flash star → a new **`fx_burst`** cartoon blast (jagged
  orange ring, yellow core) that pops for about 0.3 s → additive fire → soft grey cumulus smoke →
  debris chunks tinted to the ground → sparks → shockwave rings. Smoke draws under critters, and
  fire and blasts are brief, so results stay readable.

## Environments

- **Terrain** (identical in both renderers):
  - a thick grass, sand, ash or snow **cap** with a bright crest, darkening toward rounded
    scalloped drips, and a dark under-edge
  - occlusion cast by the cap onto the cliff below
  - **cliff faces of chunky stacked rock blocks** with rounded corners, a top-left bevel, dark
    mortar, per-block tone variation and pits, fading into deep soil with depth
  - stone platforms with small masonry blocks, plank bridges with bevels, gaps and nails
  - persistent scorch marks; crater floors expose rock instead of regrowing grass
- **Decor sprites** (`deco_<map>_tuft/bloom/bush/tree/tree2`): grass tufts, flowers, bushes and
  trees placed on the surface by the same seeded rule in both clients. They are not solid and
  disappear when their ground is destroyed.
- **Backgrounds**: three painted parallax layers per map with atmospheric haze (far 36 %, mid 14 %,
  near 8 % toward the horizon colour):

| Map | Far | Mid | Near |
| --- | --- | --- | --- |
| Grasslands | Castle on a mesa with twin waterfalls, floating islands with falls, distant mesas | Grass-capped cliffs, wooden watchtower, waterfall | Rolling hills, round trees, palms, flowers |
| Canyon | Striped buttes and a natural arch | Striped mesas with cacti | Dunes, cacti, shrubs |
| Volcano | Three volcanoes, lava streams, ash plumes, red sun | Ash-capped basalt cliffs with a lava fall | Charred hills, dead trees, glowing rocks |
| Snow | Jagged snow-capped peaks | Snow-capped ice cliffs, frozen fall, pines | Snowy hills, pines, snow bushes |
| Jungle | Stepped temple on a mesa with waterfalls | Jungle cliffs, waterfall, palms | Dense foliage, palms, tropical flowers |

Clouds are soft cumulus with a cool blue underside and no outline.

## UI

- **Kit**: the nine-slice SVGs (`ui_btn_*`, `ui_panel`, `ui_card`, `ui_card_light`, `ui_slot`,
  `ui_slot_active`, `ui_field`), used through CSS `border-image` (web) and `StyleBoxTexture` (Godot).
- **Palette**: sky-navy panels (`#1f4482`, deep `#132b58`) with a light-blue inset line, cream cards,
  orange primary buttons, gold for selection and emphasis. Layout, controls and screens are unchanged.

## Motion

The animation states and their gameplay triggers are unchanged (`Critter.ts` / `critter.gd`): idle
breathing, blinking and glancing; a forward lean while walking; take-off stretch and landing squash;
a tumble spin when knocked back; determined brows while aiming; recoil and an open mouth when
firing; a white flash, squint and wince when hit; a spin and tombstone drop on death; happy eyes and
hops on victory.

## QA

`node tools/art-sheet.mjs out.png` renders the logo, every critter (all expressions, at 1×, 2× and
4×), the UI kit, props, weapons, FX, decor and backgrounds, plus viewport-sized slices.
`node tools/shot.mjs <mapId|menu> out.png [waitMs] [explodeMs]` captures the running web client.
The Godot client takes screenshots with `-- --map=<id> --auto=bot --shot=<png> --shot-delay=<s>`.

## Provenance

- **Art**: generated by the tools above, written for this project. No third-party images.
- **Fonts**: Lilita One (Juan Montoreano) and Fredoka, both SIL Open Font License. Licence texts
  are in `shared/assets/fonts/`.
- **Logo**: glyph outlines come from Lilita One via `opentype.js`, as the OFL permits.
- **Audio**: synthesised by `tools/gen-sfx.mjs`.
