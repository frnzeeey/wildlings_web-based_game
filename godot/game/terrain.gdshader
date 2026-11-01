shader_type canvas_item;
// Paints the destructible terrain from its material mask on the GPU. Same shading model and
// formulas as the web client's TerrainLayer.paintRect (docs/ART_DIRECTION.md): material bands
// from the terrain as generated, pebbles, strata, an ink rim against air, top-left light,
// occlusion under overhangs, scorch, and a darkened backdrop behind craters and caves.

uniform sampler2D mask_tex : filter_nearest;
uniform sampler2D orig_tex : filter_nearest;
uniform sampler2D scorch_tex : filter_nearest;
uniform sampler2D surf_tex : filter_nearest;
uniform vec2 world_size;
uniform vec3 c_light;
uniform vec3 c_top;
uniform vec3 c_dirt;
uniform vec3 c_dirt2;
uniform vec3 c_deep;
uniform vec3 c_rock;
uniform vec3 c_rock2;
uniform vec3 c_wood;
uniform vec3 c_wood2;
uniform vec3 c_back;
uniform float seed = 0.0;

const vec3 SHADE = vec3(52.0, 26.0, 34.0) / 255.0;

// Identical to hash2() in web/src/game/TerrainLayer.ts (32-bit integer maths).
uint hash2(int x, int y) {
	uint h = uint(x) * 374761393u + uint(y) * 668265263u;
	h = (h ^ (h >> 13u)) * 1274126177u;
	return h ^ (h >> 16u);
}

bool air(ivec2 p) {
	if (p.x < 0 || p.x >= int(world_size.x) || p.y < 0) return true;
	if (p.y >= int(world_size.y)) return false;
	return texelFetch(mask_tex, p, 0).r < 0.5 / 255.0;
}

float orig_mat(ivec2 p) {
	if (p.y < 0 || p.x < 0 || p.x >= int(world_size.x)) return 0.0;
	return floor(texelFetch(orig_tex, p, 0).r * 255.0 + 0.5);
}

// Stacked rock blocks with rounded corners, a top-left bevel and dark mortar. Identical to
// blocks() in TerrainLayer.paintRect.
vec3 blocks(int x, float fy, float wv, float row_h, uint bw_base, uint bw_var, float cr, vec3 ca, vec3 cb, uint hs) {
	float sy = fy + wv * 0.6;
	float rowf = floor(sy / row_h);
	int row = int(rowf);
	float v = sy - rowf * row_h;
	uint rh = hash2(row, 5);
	int bw = int(bw_base + rh % bw_var);
	int bx = x + int((rh >> 8u) % uint(bw));
	int col = bx / bw;
	float u = float(bx - col * bw);
	float fbw = float(bw);
	uint bh = hash2(col, row);
	float du = max(max(cr - u, u - (fbw - 1.0 - cr)), 0.0);
	float dv = max(max(cr - v, v - (row_h - 1.0 - cr)), 0.0);
	float e = cr - sqrt(du * du + dv * dv);
	vec3 c = (bh & 1u) == 1u ? ca : cb;
	float tone = float((bh >> 3u) & 7u) - 3.5;
	c = tone > 0.0 ? mix(c, vec3(1.0), tone * 0.045) : mix(c, SHADE, -tone * 0.05);
	if (e < 1.0) return mix(c, SHADE, 0.42);
	if (e < 4.0) {
		float k = 1.0 - (e - 1.0) / 3.0;
		if ((u - fbw * 0.5) / fbw + (v - row_h * 0.5) / row_h < 0.0) c = mix(c, vec3(1.0), k * 0.26);
		else c = mix(c, SHADE, k * 0.3);
	}
	c = mix(c, SHADE, v / row_h * 0.12);
	if ((hs & 63u) == 0u) c = mix(c, SHADE, 0.2);
	else if (((hs >> 6u) & 63u) == 0u) c = mix(c, vec3(1.0), 0.12);
	return c;
}

void fragment() {
	ivec2 p = ivec2(floor(UV * world_size));
	int x = p.x;
	int y = p.y;
	float fy = float(y);
	float m = floor(texelFetch(mask_tex, p, 0).r * 255.0 + 0.5);
	vec2 sv = texelFetch(surf_tex, ivec2(x, 0), 0).rg;
	float surf = floor(sv.r * 255.0 + 0.5) + floor(sv.g * 255.0 + 0.5) * 256.0;
	uint hs = hash2(x, y);
	vec3 c;
	if (m < 0.5) {
		if (fy > surf + 2.0) {
			c = c_back;
			c = mix(c, SHADE, min(1.0, (fy - surf) / 700.0) * 0.35);
			if (!air(p + ivec2(0, -3)) || !air(p + ivec2(-3, 0)) || !air(p + ivec2(3, 0)) || !air(p + ivec2(0, 3))) c = mix(c, SHADE, 0.28);
			c += (float((hs >> 5u) & 7u) - 3.0) * 1.2 / 255.0;
			COLOR = vec4(c, 1.0);
		} else {
			COLOR = vec4(0.0);
		}
	} else {
		float s0 = seed;
		float fx = float(x);
		float wv = (sin(fx * 0.021 + s0) * 0.5 + sin(fx * 0.047 + s0 * 1.7) * 0.5 + 1.0) * 13.0;
		float top_band = 14.0 + 3.0 * sin(fx * 0.13 + s0) + 2.0 * sin(fx * 0.37 + s0 * 2.0);
		// Grass cap: thick, hanging over the cliff in rounded scallops.
		float sc = float((x + int(s0)) % 22) / 22.0 * 2.0 - 1.0;
		float lip = top_band + sqrt(max(0.0, 1.0 - sc * sc)) * 7.0;
		// Depth of solid pixels above in the generated terrain (capped).
		float depth = 1.0;
		for (int k = 1; k <= 40; k++) { // deeper than the cap plus its occlusion band (~38px)
			if (orig_mat(p - ivec2(0, k)) < 0.5) break;
			depth += 1.0;
		}
		float v = float((hs >> 4u) & 15u) - 7.0;
		if (m > 2.5) {
			// Planks with bevelled edges, dark gaps and nails.
			int px = x % 14;
			c = (px == 0 || depth >= 8.0) ? c_wood2 : c_wood;
			if (px == 0) c = mix(c, SHADE, 0.3);
			else if (px == 1 || depth == 1.0) c = mix(c, vec3(1.0), 0.22);
			else if (px == 13) c = mix(c, SHADE, 0.2);
			if (px == 7 && depth == 4.0) c = mix(c, SHADE, 0.6);
			v *= 0.5;
		} else if (m > 1.5) {
			// Stone platform: thin grass cap over small masonry blocks.
			if (depth <= 2.0) c = c_light;
			else if (depth <= 7.0) c = mix(c_top, vec3(1.0), max(0.0, 1.0 - (depth - 2.0) / 4.0) * 0.4);
			else if (depth <= 9.0) c = mix(c_top, SHADE, 0.5);
			else {
				c = blocks(x, fy, wv, 14.0, 18u, 14u, 3.0, c_rock, c_rock2, hs);
				if (depth < 16.0) c = mix(c, SHADE, (1.0 - (depth - 10.0) / 6.0) * 0.4);
			}
			v *= 0.35;
		} else if (depth <= 2.0) {
			c = c_light;
		} else if (depth <= lip) {
			// Grass cap: bright crest fading into the base colour, darker toward its scalloped edge.
			c = mix(c_top, vec3(1.0), max(0.0, 1.0 - (depth - 2.0) / 6.0) * 0.7);
			float t = depth / lip;
			c = mix(c, SHADE, t * t * 0.3);
			if (((hash2(x, 7) >> 3u) & 3u) == 0u && depth > 3.0 && depth < lip - 3.0) c = mix(c, vec3(1.0), 0.12);
		} else if (depth <= lip + 2.0) {
			c = mix(c_top, SHADE, 0.5); // dark under-edge of the cap
		} else {
			// Cliff of chunky rock blocks with occlusion under the cap, fading into deep soil.
			c = blocks(x, fy, wv, 30.0, 40u, 40u, 7.0, c_dirt, c_dirt2, hs);
			float k = depth - lip - 2.0;
			if (k < 10.0) c = mix(c, SHADE, (1.0 - k / 10.0) * 0.45);
			float t = clamp((fy - surf - 150.0) / 180.0, 0.0, 1.0);
			c = mix(c, c_deep, t * t * (3.0 - 2.0 * t));
		}
		if (air(p + ivec2(0, -1)) || air(p + ivec2(0, 1)) || air(p + ivec2(-1, 0)) || air(p + ivec2(1, 0))) {
			c = mix(c, SHADE, 0.45);
		} else {
			if (air(p + ivec2(0, -2)) || air(p + ivec2(0, -3))) c = mix(c, vec3(1.0), 0.1);
			if (air(p + ivec2(-2, 0))) c = mix(c, vec3(1.0), 0.07);
			if (air(p + ivec2(2, 0))) c = mix(c, SHADE, 0.08);
			for (int k = 2; k <= 7; k++) {
				if (air(p + ivec2(0, k))) {
					c = mix(c, SHADE, 0.3 * float(8 - k) / 6.0);
					break;
				}
			}
		}
		float s = texelFetch(scorch_tex, p, 0).r;
		c = mix(c, SHADE, s * 0.85);
		COLOR = vec4(c + v / 255.0, 1.0);
	}
}
