class_name Fx
extends Node2D
## Cartoon effects from the shared fx_* sprites: star flash, fire blobs, puffy smoke, terrain-
## coloured debris, sparks, droplets, shockwave rings, damage numbers and camera shake.
## Layering keeps combat readable: smoke (4) < critters (5) < projectiles (6) < fire (12).
## Mirrors web/src/game/Fx.ts.

static var _soft: Texture2D

var ground_color := Color.SADDLE_BROWN
var liquid_color := Color.DODGER_BLUE
var shake_enabled := true
var cam: Camera2D
var _shake := 0.0
var _shake_time := 0.0


static func soft_texture() -> Texture2D:
	if _soft == null:
		var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
		for y in 32:
			for x in 32:
				var d := Vector2(x - 15.5, y - 15.5).length() / 16.0
				img.set_pixel(x, y, Color(1, 1, 1, clampf(1.0 - d, 0.0, 1.0) * 0.9))
		_soft = ImageTexture.create_from_image(img)
	return _soft


func _burst(pos: Vector2, amount: int, life: float, tex: Texture2D, cfg: Dictionary) -> void:
	if amount <= 0:
		return
	var k := 1.0 / Art.scale
	var p := CPUParticles2D.new()
	p.texture = tex
	p.one_shot = true
	p.explosiveness = 1.0
	p.amount = amount
	p.lifetime = life
	p.lifetime_randomness = 0.35
	p.position = pos
	p.spread = cfg.get("spread", 180.0)
	p.direction = cfg.get("dir", Vector2.UP)
	p.gravity = cfg.get("gravity", Vector2.ZERO)
	p.initial_velocity_min = cfg.get("vmin", 60.0)
	p.initial_velocity_max = cfg.get("vmax", 200.0)
	p.scale_amount_min = cfg.get("smin", 0.5) * (k if cfg.get("art", true) else 1.0)
	p.scale_amount_max = cfg.get("smax", 1.0) * (k if cfg.get("art", true) else 1.0)
	p.angle_min = -40
	p.angle_max = 40
	if cfg.has("spin"):
		p.angular_velocity_min = -cfg["spin"]
		p.angular_velocity_max = cfg["spin"]
	if cfg.has("ramp"):
		p.color_ramp = cfg["ramp"]
	else:
		p.color = cfg.get("color", Color.WHITE)
	if cfg.has("scale_curve"):
		p.scale_amount_curve = cfg["scale_curve"]
	if cfg.get("add", false):
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		p.material = m
	p.z_index = cfg.get("z", 10)
	p.emitting = true
	add_child(p)
	p.finished.connect(p.queue_free)


func _grad(colors: Array) -> Gradient:
	var g := Gradient.new()
	g.colors = PackedColorArray(colors)
	var offs := PackedFloat32Array()
	for i in colors.size():
		offs.append(float(i) / (colors.size() - 1))
	g.offsets = offs
	return g


func _curve(a: float, b: float) -> Curve:
	var c := Curve.new()
	c.max_value = maxf(a, b)
	c.add_point(Vector2(0, a))
	c.add_point(Vector2(1, b))
	return c


func explosion(pos: Vector2, r: float) -> void:
	var k := maxf(0.4, r / 55.0)
	var star := Art.sprite("fx_star")
	star.position = pos
	star.z_index = 13
	star.rotation = randf() * TAU
	star.modulate.a = 0.8
	var add := CanvasItemMaterial.new()
	add.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	star.material = add
	var s0 := star.scale * k * 0.8
	star.scale = s0
	add_child(star)
	var tw := star.create_tween().set_parallel()
	tw.tween_property(star, "scale", s0 / 0.8 * 2.6, 0.17).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(star, "modulate:a", 0.0, 0.17)
	tw.chain().tween_callback(star.queue_free)
	# Cartoon blast: pops out, holds briefly, then shrinks away (never hides the result for long).
	var blast := Art.sprite("fx_burst")
	blast.position = pos
	blast.z_index = 11
	blast.rotation = randf() * TAU
	var bs := blast.scale * maxf(0.5, r / 34.0)
	blast.scale = bs * 0.3
	add_child(blast)
	var bt := blast.create_tween()
	bt.tween_property(blast, "scale", bs, 0.09).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	bt.tween_interval(0.06)
	bt.tween_property(blast, "scale", bs * 0.4, 0.17).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	bt.parallel().tween_property(blast, "modulate:a", 0.0, 0.17)
	bt.parallel().tween_property(blast, "rotation", blast.rotation + 0.44, 0.17)
	bt.tween_callback(blast.queue_free)
	_burst(pos, int(12 * k), 0.4, Art.texture("fx_fire"), {"vmin": 70, "vmax": 260, "smin": 1.5, "smax": 1.5, "add": true, "gravity": Vector2(0, -120),
		"scale_curve": _curve(1.0, 0.17), "ramp": _grad([Color("#fff3a0"), Color("#ffc24a"), Color("#ff7a2a"), Color("#c8321a00")]), "z": 12})
	get_tree().create_timer(0.06).timeout.connect(func() -> void:
		_burst(pos - Vector2(0, 4), int(9 * k), 1.5, Art.texture("fx_puff"), {"vmin": 20, "vmax": 100, "smin": 0.9, "smax": 0.9, "gravity": Vector2(0, -50),
			"scale_curve": _curve(1.0, 2.7), "ramp": _grad([Color(0.55, 0.52, 0.58, 0.72), Color(0.55, 0.52, 0.58, 0.0)]), "z": 4}))
	_burst(pos, int(14 * k), 1.0, Art.texture("fx_chunk"), {"vmin": 140, "vmax": 400, "smin": 0.6, "smax": 1.3, "gravity": Vector2(0, 950),
		"spread": 80.0, "color": ground_color, "spin": 540.0, "z": 7})
	_burst(pos, int(12 * k), 0.45, Art.texture("fx_spark"), {"vmin": 180, "vmax": 460, "smin": 1.4, "smax": 1.4, "gravity": Vector2(0, 320),
		"add": true, "scale_curve": _curve(1.0, 0.0), "color": Color("#ffd23f"), "spin": 360.0, "z": 13})
	ring(pos, r * 1.05, Color("#fff3c4"), 0.28, 5.0)
	ring(pos, r * 0.7, Color.WHITE, 0.2, 3.0)


func ring(pos: Vector2, r: float, color: Color, duration: float, width := 4.0) -> void:
	var n := Node2D.new()
	n.position = pos
	n.z_index = 12
	var st := {"t": 0.0}
	n.draw.connect(func() -> void:
		var t: float = st["t"]
		n.draw_arc(Vector2.ZERO, r * (0.3 + t * 0.9), 0, TAU, 48, Color(color, 1.0 - t), width * (1.0 - t) + 1.0, true))
	add_child(n)
	var tw := n.create_tween()
	tw.tween_method(func(v: float) -> void:
		st["t"] = v
		n.queue_redraw(), 0.0, 1.0, duration).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_callback(n.queue_free)


func _smoke(pos: Vector2, n: int) -> void:
	_burst(pos, n, 1.3, Art.texture("fx_puff"), {"vmin": 20, "vmax": 90, "smin": 0.7, "smax": 0.9, "gravity": Vector2(0, -50),
		"scale_curve": _curve(1.0, 2.4), "ramp": _grad([Color(0.6, 0.57, 0.63, 0.7), Color(0.6, 0.57, 0.63, 0.0)]), "z": 4})


func dust(pos: Vector2, n := 6) -> void:
	_smoke(pos, n)


func splash(pos: Vector2, big: bool) -> void:
	_burst(pos, 30 if big else 12, 0.9, Art.texture("fx_drop"), {"vmin": 130, "vmax": 390, "spread": 35.0, "gravity": Vector2(0, 950),
		"smin": 1.2, "smax": 1.2, "scale_curve": _curve(1.0, 0.4), "color": liquid_color, "z": 21})
	ring(pos, 44.0 if big else 24.0, Color.WHITE, 0.42)


func muzzle(pos: Vector2) -> void:
	_burst(pos, 5, 0.3, Art.texture("fx_fire"), {"vmin": 30, "vmax": 120, "smin": 0.9, "smax": 1.1, "add": true, "ramp": _grad([Color("#fff3a0"), Color("#ff7a2a00")]), "z": 12})
	_smoke(pos, 2)


func poof(pos: Vector2, color: Color) -> void:
	_smoke(pos, 14)
	spark(pos, 8)
	ring(pos, 32, color, 0.36)


func spark(pos: Vector2, n := 6) -> void:
	_burst(pos, n, 0.45, Art.texture("fx_spark"), {"vmin": 180, "vmax": 400, "smin": 1.2, "smax": 1.4, "add": true, "color": Color("#ffd23f"),
		"gravity": Vector2(0, 320), "scale_curve": _curve(1.0, 0.0), "spin": 360.0, "z": 13})


func trail(pos: Vector2, fire: bool) -> void:
	var s := Sprite2D.new()
	s.position = pos
	s.z_index = 4
	if fire:
		s.texture = soft_texture()
		s.scale = Vector2(0.5, 0.5)
		s.modulate = Color("#ffb03b")
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		s.material = m
	else:
		Art.apply(s, "fx_puff")
		s.scale *= 0.35
		s.rotation = randf() * TAU
		s.modulate = Color(0.89, 0.87, 0.91, 0.5)
	add_child(s)
	var tw := s.create_tween().set_parallel()
	var life := 0.26 if fire else 0.52
	tw.tween_property(s, "scale", s.scale * (0.3 if fire else 2.6), life)
	tw.tween_property(s, "modulate:a", 0.0, life)
	tw.chain().tween_callback(s.queue_free)


func float_text(pos: Vector2, text: String, color: Color, size := 22) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", UI.font(true))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color("#1a2140"))
	l.add_theme_constant_override("outline_size", 9)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.size = Vector2(120, 30)
	l.pivot_offset = Vector2(60, 15)
	l.position = pos - Vector2(60, 15)
	l.z_index = 30
	l.scale = Vector2(0.3, 0.3)
	add_child(l)
	var tw := l.create_tween()
	tw.tween_property(l, "scale", Vector2.ONE * 1.15, 0.16).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(l, "scale", Vector2.ONE, 0.12)
	tw.tween_interval(0.42)
	tw.set_parallel()
	tw.tween_property(l, "position:y", l.position.y - 54, 0.65).set_ease(Tween.EASE_IN)
	tw.tween_property(l, "modulate:a", 0.0, 0.65)
	tw.chain().tween_callback(l.queue_free)


func shake(amount: float) -> void:
	if not shake_enabled or amount <= 0.0:
		return
	_shake = maxf(_shake, minf(18.0, amount * 0.8))
	_shake_time = minf(0.5, 0.12 + amount * 0.014)


func _process(dt: float) -> void:
	if cam == null:
		return
	if _shake_time > 0.0:
		_shake_time -= dt
		cam.offset = Vector2(randf_range(-1, 1), randf_range(-1, 1)) * _shake
		_shake *= 0.9
	else:
		cam.offset = Vector2.ZERO
