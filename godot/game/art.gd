extends Node
## Shared SVG art (res://assets/art, synced from shared/assets/art). Rasterised at runtime at
## `scale`x so sprites stay crisp under camera zoom; each part has a local origin from manifest.json.

var manifest := {}
var scale := 3.0
var _cache := {}


func _init() -> void:
	var text := FileAccess.get_file_as_string("res://assets/art/manifest.json")
	var m = JSON.parse_string(text)
	if typeof(m) == TYPE_DICTIONARY:
		manifest = m
		scale = float(m.get("scale", 3))


func has(key: String) -> bool:
	return manifest.get("parts", {}).has(key)


func box(key: String) -> Dictionary:
	return manifest["parts"].get(key, {"x": 0, "y": 0, "w": 1, "h": 1})


func species(id: String) -> Dictionary:
	var s: Dictionary = manifest.get("species", {})
	return s.get(id, s.values()[0] if not s.is_empty() else {"eyes": [], "tail": false})


func texture(key: String) -> Texture2D:
	if _cache.has(key):
		return _cache[key]
	var svg := FileAccess.get_file_as_string("res://assets/art/%s.svg" % key)
	var img := Image.new()
	var tex: Texture2D = null
	if svg != "" and img.load_svg_from_string(svg, 1.0) == OK:
		img.generate_mipmaps()
		tex = ImageTexture.create_from_image(img)
	else:
		push_warning("Art: missing %s" % key)
	_cache[key] = tex
	return tex


## Texture rasterised at unit_scale px per art unit (used for crisp nine-slice UI at a chosen size).
func texture_at(key: String, unit_scale: float) -> Texture2D:
	var ck := "%s@%.3f" % [key, unit_scale]
	if _cache.has(ck):
		return _cache[ck]
	var svg := FileAccess.get_file_as_string("res://assets/art/%s.svg" % key)
	var img := Image.new()
	var tex: Texture2D = null
	if svg != "" and img.load_svg_from_string(svg, unit_scale / part_scale(key)) == OK:
		tex = ImageTexture.create_from_image(img)
	_cache[ck] = tex
	return tex


## A Sprite2D whose position (0,0) is the part's local origin, drawn at 1/scale.
func sprite(key: String) -> Sprite2D:
	var s := Sprite2D.new()
	apply(s, key)
	return s


## Raster scale of a part (background layers are rasterised smaller than characters).
func part_scale(key: String) -> float:
	return float(box(key).get("scale", scale))


func backgrounds(map_id: String) -> Array:
	return manifest.get("backgrounds", {}).get(map_id, [])


func apply(s: Sprite2D, key: String) -> void:
	s.texture = texture(key)
	s.centered = false
	var b := box(key)
	var k := part_scale(key)
	s.offset = Vector2(float(b["x"]), float(b["y"])) * k
	s.scale = Vector2.ONE / k
	s.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS


## For UI: a TextureRect showing an icon.
func icon(key: String, size: float) -> TextureRect:
	var t := TextureRect.new()
	t.texture = texture(key)
	t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	t.custom_minimum_size = Vector2(size, size)
	return t
