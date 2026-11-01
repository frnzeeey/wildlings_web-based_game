class_name TerrainView
extends Node2D
## Shows a TerrainMask through terrain.gdshader. Carves re-upload the mask texture once per frame;
## no per-pixel painting happens in GDScript.

var mask: TerrainMask
var _sprite := Sprite2D.new()
var _mask_img: Image
var _mask_tex: ImageTexture
var _orig_tex: ImageTexture
var _scorch: PackedByteArray
var _scorch_img: Image
var _scorch_tex: ImageTexture
var _surf_tex: ImageTexture
var _dirty := false
var _scorch_dirty := false
var decor: Decor


func setup(p_mask: TerrainMask, map: Dictionary, seed_value: int) -> void:
	mask = p_mask
	var w := mask.width
	var h := mask.height
	_mask_img = Image.create_from_data(w, h, false, Image.FORMAT_R8, mask.data)
	_mask_tex = ImageTexture.create_from_image(_mask_img)
	_orig_tex = ImageTexture.create_from_image(Image.create_from_data(w, h, false, Image.FORMAT_R8, mask.data.duplicate()))
	_scorch.resize(w * h)
	_scorch_img = Image.create_from_data(w, h, false, Image.FORMAT_R8, _scorch)
	_scorch_tex = ImageTexture.create_from_image(_scorch_img)
	var surf := PackedByteArray()
	surf.resize(w * 2)
	for x in w:
		var s := maxi(0, mask.surface[x])
		surf[x * 2] = s & 255
		surf[x * 2 + 1] = (s >> 8) & 255
	_surf_tex = ImageTexture.create_from_image(Image.create_from_data(w, 1, false, Image.FORMAT_RG8, surf))

	var mat := ShaderMaterial.new()
	mat.shader = preload("res://game/terrain.gdshader")
	var p: Dictionary = map["palette"]
	mat.set_shader_parameter("mask_tex", _mask_tex)
	mat.set_shader_parameter("orig_tex", _orig_tex)
	mat.set_shader_parameter("scorch_tex", _scorch_tex)
	mat.set_shader_parameter("surf_tex", _surf_tex)
	mat.set_shader_parameter("world_size", Vector2(w, h))
	for key in ["top", "dirt", "dirt2", "deep", "rock", "rock2", "wood", "wood2"]:
		mat.set_shader_parameter("c_" + key, _rgb(p[key]))
	mat.set_shader_parameter("c_light", _rgb(p["topLight"]))
	var deep := Color(p["deep"])
	mat.set_shader_parameter("c_back", Vector3(deep.r * 0.62 + 10.0 / 255.0, deep.g * 0.56 + 6.0 / 255.0, deep.b * 0.6 + 14.0 / 255.0))
	mat.set_shader_parameter("seed", float(absi(seed_value) % 1000))
	_sprite.texture = _mask_tex
	_sprite.centered = false
	_sprite.material = mat
	_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	add_child(_sprite)
	decor = Decor.new()
	add_child(decor)
	decor.setup(mask, map, seed_value)


static func _rgb(hex: String) -> Vector3:
	var c := Color(hex)
	return Vector3(c.r, c.g, c.b)


## A carve happened (the mask is already updated): add scorch and schedule an upload.
func carved(cx: float, cy: float, r: float, scorch: bool) -> void:
	_dirty = true
	if scorch and r > 3.0:
		var rim := minf(10.0, r * 0.22 + 2.0)
		var outer := r + rim
		var x0 := maxi(0, int(floor(cx - outer)))
		var x1 := mini(mask.width - 1, int(ceil(cx + outer)))
		var y0 := maxi(0, int(floor(cy - outer)))
		var y1 := mini(mask.height - 1, int(ceil(cy + outer)))
		for y in range(y0, y1 + 1):
			for x in range(x0, x1 + 1):
				var d := Vector2(x - cx, y - cy).length()
				if d > outer:
					continue
				var k := int(150.0 * (1.0 - maxf(0.0, d - r) / rim))
				var i := y * mask.width + x
				if k > _scorch[i]:
					_scorch[i] = k
		_scorch_dirty = true
	decor.carved(cx, cy, r)


func refresh_all() -> void:
	_dirty = true
	decor.prune()


func _process(_dt: float) -> void:
	if _dirty:
		_dirty = false
		_mask_img.set_data(mask.width, mask.height, false, Image.FORMAT_R8, mask.data)
		_mask_tex.update(_mask_img)
	if _scorch_dirty:
		_scorch_dirty = false
		_scorch_img.set_data(mask.width, mask.height, false, Image.FORMAT_R8, _scorch)
		_scorch_tex.update(_scorch_img)
