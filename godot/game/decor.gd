class_name Decor
extends Node2D
## Non-solid surface details: the deco_<map>_* sprites (tufts, blooms, bushes, trees), placed
## exactly like web TerrainLayer.placeDecor. Items standing on removed ground disappear.

var mask: TerrainMask
var items: Array = [] # [x, y, kind, r]
var map_id := ""

const KEYS := ["tuft", "bloom", "bush", "tree"]


func setup(p_mask: TerrainMask, map: Dictionary, seed_value: int) -> void:
	mask = p_mask
	map_id = map["id"]
	var rng := Rng.new(seed_value ^ 0xdec0)
	var x := 6
	while x < mask.width - 6:
		var y := mask.surface_at(x)
		if y >= 0 and mask.material(x, y) == TerrainMask.EARTH:
			var r := rng.next()
			var kind := 0
			if r < 0.025:
				kind = 3
			elif r < 0.12:
				kind = 1
			elif r < 0.16:
				kind = 2
			items.append([x, y, kind, rng.next()])
		x += rng.range_i(5, 11)
	queue_redraw()


func carved(cx: float, cy: float, r: float) -> void:
	var before := items.size()
	items = items.filter(func(d: Array) -> bool:
		return Vector2(d[0] - cx, d[1] - cy).length() > r + 4.0 and mask.is_solid(d[0], d[1] + 2))
	if items.size() != before:
		queue_redraw()


func prune() -> void:
	items = items.filter(func(d: Array) -> bool: return mask.is_solid(d[0], d[1] + 2))
	queue_redraw()


func _draw() -> void:
	var id: String = map_id
	for d in items:
		var kind: int = d[2]
		var r: float = d[3]
		var key := "deco_%s_%s%s" % [id, KEYS[kind], "2" if kind == 3 and r >= 0.5 else ""]
		if not Art.has(key):
			continue
		var tex := Art.texture(key)
		var b := Art.box(key)
		var k := 0.85 + r * 0.3
		var flip := -1.0 if fmod(r * 1000.0, 2.0) < 1.0 else 1.0
		draw_set_transform(Vector2(d[0], d[1] + 1.0), 0.0, Vector2(k * flip, k))
		draw_texture_rect(tex, Rect2(float(b["x"]), float(b["y"]), float(b["w"]), float(b["h"])), false)
	draw_set_transform(Vector2.ZERO)
