class_name Backdrop
extends Node2D
## Sky gradient, the shared parallax layers (bg_<map>_far/mid/near placed by manifest.backgrounds,
## identical to the web client), drifting clouds, ambient particles and the animated water/lava.
## Mirrors web/src/game/Backdrop.ts.

var map: Dictionary
var level: float
var _shown: float
var _t := 0.0
var _liquid_back := Node2D.new()
var _liquid_front := Node2D.new()
var _clouds: Array[Sprite2D] = []
var _cam: Camera2D
var _layers: Array = [] # [Node2D, factor]: positioned like Phaser scrollFactor (see _process)


func setup(p_map: Dictionary, seed_value: int, cam: Camera2D, world_parent: Node2D) -> void:
	map = p_map
	_cam = cam
	level = float(Spec.world["waterLevel"])
	_shown = level
	var p: Dictionary = map["palette"]
	var W := float(Spec.world["width"])

	var sky_layer := CanvasLayer.new()
	sky_layer.layer = -10
	add_child(sky_layer)
	var sky := TextureRect.new()
	var grad := GradientTexture2D.new()
	grad.gradient = Gradient.new()
	grad.gradient.set_color(0, Color(p["sky"][0]))
	grad.gradient.set_color(1, Color(p["sky"][1]))
	grad.fill_from = Vector2(0, 0)
	grad.fill_to = Vector2(0, 1)
	sky.texture = grad
	sky.set_anchors_preset(Control.PRESET_FULL_RECT)
	sky.stretch_mode = TextureRect.STRETCH_SCALE
	sky.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	sky_layer.add_child(sky)

	var layers := Art.backgrounds(map["id"])
	var rng := Rng.new(seed_value ^ 0xb6)
	for i in layers.size():
		var l: Dictionary = layers[i]
		var px := _parallax(float(l["factor"]), -60 + i * 4)
		var s := Art.sprite(l["key"])
		s.position = Vector2(float(l["x"]), float(l["y"]))
		px.add_child(s)
		if i == 0:
			# Clouds drift between the far and mid layers.
			for k in 8:
				var layer := _parallax(0.18 + k * 0.02, -58)
				var c := Art.sprite("cloud")
				c.position = Vector2(rng.range_f(-600, W + 600), rng.range_f(40, 360))
				var sc := rng.range_f(0.45, 1.05)
				c.scale = Vector2(sc, sc) / Art.scale
				c.modulate = Color(0.42, 0.29, 0.35, 0.22) if map["id"] == "volcano" else Color(1, 1, 1, 0.9)
				layer.add_child(c)
				_clouds.append(c)

	_liquid_back.draw.connect(func() -> void: _draw_liquid(_liquid_back, 1.7, 1.0, 4.0, false))
	_liquid_front.draw.connect(func() -> void: _draw_liquid(_liquid_front, 0.0, 0.85 if map["hazard"] == "lava" else 0.7, 5.0, true))
	world_parent.add_child(_liquid_back)
	world_parent.move_child(_liquid_back, 0)
	_liquid_front.z_index = 20
	world_parent.add_child(_liquid_front)

	var parts := CPUParticles2D.new()
	parts.amount = 60
	parts.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	parts.gravity = Vector2.ZERO
	if p["decor"] == "embers":
		parts.texture = Art.texture("fx_spark")
		parts.lifetime = 4.0
		parts.emission_rect_extents = Vector2(W * 0.5, 4)
		parts.position = Vector2(W / 2.0, level)
		parts.direction = Vector2(0, -1)
		parts.initial_velocity_min = 20
		parts.initial_velocity_max = 60
		parts.scale_amount_min = 0.25 / Art.scale
		parts.scale_amount_max = 0.4 / Art.scale
		parts.color = Color("#ffa040")
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		parts.material = m
		parts.z_index = -1
	elif map["id"] == "snow":
		parts.texture = Art.texture("fx_drop")
		parts.lifetime = 9.0
		parts.emission_rect_extents = Vector2(W * 0.6, 4)
		parts.position = Vector2(W / 2.0, -40)
		parts.direction = Vector2(0, 1)
		parts.spread = 20
		parts.initial_velocity_min = 40
		parts.initial_velocity_max = 80
		parts.scale_amount_min = 0.12 / Art.scale * 3.0
		parts.scale_amount_max = 0.25 / Art.scale * 3.0
		parts.z_index = 18
	else:
		parts.texture = Art.texture("fx_spark")
		parts.lifetime = 5.0
		parts.amount = 20
		parts.emission_rect_extents = Vector2(W * 0.5, 300)
		parts.position = Vector2(W / 2.0, 600)
		parts.direction = Vector2(1, -0.2)
		parts.spread = 180
		parts.initial_velocity_min = 4
		parts.initial_velocity_max = 14
		parts.scale_amount_min = 0.15 * 3.0 / Art.scale
		parts.scale_amount_max = 0.2 * 3.0 / Art.scale
		parts.color = Color("#d8ffb0", 0.7) if map["id"] == "jungle" else Color(1, 1, 1, 0.6)
		var m2 := CanvasItemMaterial.new()
		m2.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		parts.material = m2
		parts.z_index = 2
	world_parent.add_child(parts)


## A layer that scrolls at factor x the camera, matching Phaser's scrollFactor exactly
## (screen = (x - scroll * f - W/2) * zoom + W/2 with scroll = centre - W/2).
func _parallax(factor: float, z: int) -> Node2D:
	var n := Node2D.new()
	n.z_index = z
	add_child(n)
	_layers.append([n, factor])
	return n


func _process(dt: float) -> void:
	_t += dt
	var scroll := _cam.get_screen_center_position() - get_viewport_rect().size / 2.0
	for l in _layers:
		l[0].position = scroll * (1.0 - float(l[1]))
	_shown += (level - _shown) * minf(1.0, dt * 2.0)
	for c in _clouds:
		c.position.x += dt * 7.0
		if c.position.x > float(Spec.world["width"]) + 800:
			c.position.x = -800
	_liquid_back.queue_redraw()
	_liquid_front.queue_redraw()


func _draw_liquid(n: Node2D, phase: float, alpha: float, amp: float, front: bool) -> void:
	var vp := get_viewport_rect().size / _cam.zoom
	var center := _cam.get_screen_center_position()
	var x0 := floorf((center.x - vp.x) / 16.0) * 16.0
	var x1 := center.x + vp.x
	var bottom := maxf(center.y + vp.y, float(Spec.world["height"])) + 400.0
	var lava: bool = map["hazard"] == "lava"
	var base := Color(map["palette"]["liquid"])
	var light := Color(map["palette"]["liquidLight"])
	var deep := base.darkened(0.1 if lava else 0.22)
	var surface := PackedVector2Array()
	var x := x0
	while x <= x1:
		surface.append(Vector2(x, _shown + sin(x * 0.02 + _t * (1.2 if lava else 2.0) + phase) * amp + sin(x * 0.045 - _t * 1.3) * amp * 0.5))
		x += 16.0
	var body := surface.duplicate()
	body.append(Vector2(x1, bottom))
	body.append(Vector2(x0, bottom))
	n.draw_colored_polygon(body, Color(base, alpha))
	# Darker with depth.
	var depth_poly := PackedVector2Array([Vector2(x0, _shown + 14), Vector2(x1, _shown + 14), Vector2(x1, _shown + 90), Vector2(x0, _shown + 90)])
	n.draw_polygon(depth_poly, PackedColorArray([Color(deep, 0), Color(deep, 0), Color(deep, 0.95), Color(deep, 0.95)]))
	n.draw_rect(Rect2(x0, _shown + 90, x1 - x0, maxf(0.0, bottom - _shown - 90)), Color(deep, 0.95))
	if front:
		var band := surface.duplicate()
		for i in range(surface.size() - 1, -1, -1):
			band.append(surface[i] + Vector2(0, 10))
		n.draw_colored_polygon(band, Color(light, 0.55 if lava else 0.35))
		n.draw_polyline(surface, Color("#fff0a0", 0.9) if lava else Color(1, 1, 1, 0.75), 3.0, true)
	else:
		n.draw_polyline(surface, Color(light, 0.6), 2.0, true)
