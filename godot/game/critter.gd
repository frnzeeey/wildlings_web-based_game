class_name Critter
extends Node2D
## A critter assembled from the shared SVG parts and animated procedurally.
## Mirrors web/src/game/Critter.ts: same rig, expressions, squash/stretch spring, tumble and shadow.

const PIVOT := 14.0 # the pose rotates around the body centre, 14px above the feet

var team_color: Color
var show_hud := true
var _pose := Node2D.new()
var _tail: Sprite2D
var _foot_b: Sprite2D
var _foot_f: Sprite2D
var _body: Sprite2D
var _head: Sprite2D
var _mouth: Sprite2D
var _eyes: Array = []
var _arm := Node2D.new()
var _weapon: Sprite2D
var _label := Label.new()
var _bar := Node2D.new()
var _shadow: Sprite2D
var _ring := Node2D.new()
var _t := randf() * 10.0
var _walk := 0.0
var _walking := 0.0
var _last_x := 0.0
var _hurt := 0.0
var _flash := 0.0
var _recoil := 0.0
var _blink := 0.0
var _next_blink := 1.0 + randf() * 3.0
var _glance := 0.0
var _glance_x := 0.0
var _sq := 0.0
var _sq_vel := 0.0
var _spin := 0.0
var _was_ground := true
var _happy := false
var _shown_hp := -1
var _hp_frac := 1.0
var _weapon_key := ""
var _gone := false
var _rig: Dictionary = {}
var _feet: Array = [Vector2(5, -3), Vector2(-5, -3)]
var _top := -60.0


func setup(c) -> void:
	team_color = Spec.team_color(c.team)
	var sp: String = c.species
	var info: Dictionary = Art.species(sp)
	_shadow = Art.sprite("shadow")
	_shadow.z_index = -1
	add_child(_shadow)
	_ring.z_index = -1
	_ring.draw.connect(func() -> void:
		_ring.draw_polyline(_ellipse(17, 5), team_color, 2.5, true)
		_ring.draw_polyline(_ellipse(15, 4), Color(1, 1, 1, 0.8), 1.0, true))
	add_child(_ring)
	_pose.position = Vector2(0, -PIVOT)
	_rig = info
	var feet: Array = info["feet"]
	_feet = [Vector2(feet[0][0], feet[0][1]), Vector2(feet[1][0], feet[1][1])]
	# Each species wears a team-coloured garment (hat, scarf, backpack, belt...) in its own layer.
	var layer: String = info.get("team", "body")
	if layer == "back":
		_team_part(sp)
	if Art.has(sp + "_tail"):
		_tail = _part(sp + "_tail")
	_foot_b = _part(sp + "_foot", _feet[0])
	_body = _part(sp + "_body")
	if layer == "body":
		_team_part(sp)
	_head = _part(sp + "_head")
	if layer == "head":
		_team_part(sp)
	for e in info["eyes"]:
		var ex := float(e["x"])
		var ey := float(e["y"])
		var r := float(e["r"])
		var far: bool = e.get("far", false)
		var k := r / 4.0
		var eye := {"x": ex, "y": ey, "r": r, "far": far}
		for key in ["eye_white", "eye_pupil", "eye_closed", "eye_hurt", "eye_happy"]:
			var s := _part(key, Vector2(ex, ey))
			s.scale *= k
			if key == "eye_hurt" and far:
				s.scale.x *= -1
			eye[key] = s
		var brow := _part("brow", Vector2(ex, ey - r - 2.6))
		brow.scale *= k
		if far:
			brow.scale.x *= -1
		eye["brow"] = brow
		_eyes.append(eye)
	_mouth = _part("mouth_open", Vector2(float(info["mouth"]["x"]), float(info["mouth"]["y"])))
	_mouth.visible = false
	_foot_f = _part(sp + "_foot", _feet[1])
	_arm.position = Vector2(float(info["arm"]["x"]), float(info["arm"]["y"]) + PIVOT)
	_weapon = Art.sprite("held_rocket")
	_arm.add_child(_weapon)
	var hand := Art.sprite(sp + "_hand")
	hand.position = Vector2(4, 2)
	_arm.add_child(hand)
	_pose.add_child(_arm)
	add_child(_pose)
	_bar.draw.connect(_draw_bar)
	add_child(_bar)
	_label.text = c.name
	_top = float(info.get("top", -60))
	_label.add_theme_font_override("font", UI.font(true))
	_label.add_theme_font_size_override("font_size", 13)
	_label.add_theme_color_override("font_color", Color.WHITE)
	_label.add_theme_color_override("font_outline_color", Color("#16203f"))
	_label.add_theme_constant_override("outline_size", 7)
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.size = Vector2(160, 20)
	_label.position = Vector2(-80, _top - 32)
	add_child(_label)
	position = Vector2(c.x, c.y + float(Spec.character["radius"]))
	_last_x = c.x
	z_index = 5


func _team_part(sp: String) -> void:
	var t := _part(sp + "_team")
	t.modulate = team_color


func _part(key: String, pos := Vector2.ZERO) -> Sprite2D:
	var s := Art.sprite(key)
	s.position = pos + Vector2(0, PIVOT)
	_pose.add_child(s)
	return s


## Menus: hide the HP bar, name, ring and shadow.
func set_preview() -> void:
	show_hud = false
	_bar.visible = false
	_label.visible = false
	_ring.visible = false


func on_hurt() -> void:
	_hurt = 0.6
	_flash = 0.12


func on_fire() -> void:
	_recoil = 1.0
	_sq = -0.1


func victory() -> void:
	_happy = true
	var tw := create_tween().set_loops(6)
	tw.tween_property(_pose, "position:y", -PIVOT - 26.0, 0.26).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(_pose, "position:y", -PIVOT, 0.26).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)


func sync(dt: float, c, show_weapon: bool, active: bool, terrain: TerrainMask = null, aim_override = null, weapon_override = "") -> void:
	if _gone:
		return
	if c.drowned:
		visible = false
		_gone = true
		return
	if not c.alive:
		_die(c)
		return
	_t += dt
	_hurt = maxf(0.0, _hurt - dt)
	_flash = maxf(0.0, _flash - dt)
	_recoil = maxf(0.0, _recoil - dt * 5.0)
	_blink = maxf(0.0, _blink - dt)
	_next_blink -= dt
	if _next_blink <= 0.0:
		_blink = 0.13
		_next_blink = 2.0 + randf() * 4.0
	_glance -= dt
	if _glance <= 0.0:
		_glance = 1.5 + randf() * 3.0
		_glance_x = (randf() - 0.5) * 1.6
	var moved := absf(c.x - _last_x)
	_last_x = c.x
	if c.on_ground and moved > 0.05 and moved < 8.0:
		_walk += moved
		_walking = 0.12
	else:
		_walking = maxf(0.0, _walking - dt)

	# Squash on landing, stretch on take-off; a damped spring brings it back.
	if _was_ground and not c.on_ground and c.vy < -100.0:
		_sq = 0.2
	if not _was_ground and c.on_ground:
		_sq = -0.12 - (0.14 if absf(_spin) > 0.3 else 0.06)
	_was_ground = c.on_ground
	_sq_vel += (-_sq * 180.0 - _sq_vel * 13.0) * dt
	_sq += _sq_vel * dt

	# Knocked-back critters tumble, then settle upright on the ground.
	var speed := Vector2(c.vx, c.vy).length()
	if not c.on_ground and (_hurt > 0.0 or speed > 420.0):
		_spin += c.vx * dt * 0.022
	else:
		_spin = atan2(sin(_spin), cos(_spin))
		_spin += (0.0 - _spin) * minf(1.0, dt * 12.0)

	var R := float(Spec.character["radius"])
	position = Vector2(c.x, c.y + R)
	var f := 1.0 if c.facing >= 0 else -1.0
	var breathe := sin(_t * 3.2) * 0.025
	var sx := 1.0 - _sq * 0.6 - breathe * 0.5
	var sy := 1.0 + _sq + breathe
	if c.crouching:
		sx *= 1.12
		sy *= 0.8
	var bob := -absf(sin(_walk * 0.3)) * 2.5 if _walking > 0.0 else 0.0
	var shake := sin(_t * 70.0) * 1.4 if _hurt > 0.35 else 0.0
	var lean := 0.08 * f if _walking > 0.0 else 0.0
	if not _pose_tweening():
		_pose.position = Vector2(shake, -PIVOT + bob)
	_pose.scale = Vector2(f * sx, sy)
	_pose.rotation = lean + _spin
	var step := sin(_walk * 0.3) * 3.0 if _walking > 0.0 else 0.0
	_foot_b.position = Vector2(_feet[0].x - step, _feet[0].y + PIVOT + (0.0 if c.on_ground else -2.0))
	_foot_f.position = Vector2(_feet[1].x + step, _feet[1].y + PIVOT + (0.0 if c.on_ground else 1.0))
	if _tail:
		_tail.rotation = sin(_t * 4.0) * 0.12

	var aiming := active and show_weapon
	var aim: float = c.aim if aim_override == null else aim_override
	var la := atan2(sin(aim), cos(aim) * f)
	var lx := cos(la) * 1.1 if aiming else _glance_x
	var ly := sin(la) * 1.1 if aiming else 0.2
	var hurt := _hurt > 0.0
	for e in _eyes:
		var closed := not hurt and not _happy and _blink > 0.0
		var open := not hurt and not closed and not _happy
		e["eye_white"].visible = open
		e["eye_pupil"].visible = open
		e["eye_pupil"].position = Vector2(e["x"] + lx, e["y"] + ly + PIVOT)
		e["eye_closed"].visible = closed
		e["eye_hurt"].visible = hurt
		e["eye_happy"].visible = _happy and not hurt
		var far: bool = e["far"]
		var tilt := (0.28 if far else -0.28) if aiming else ((-0.32 if far else 0.32) if hurt else 0.0)
		e["brow"].rotation = tilt
		e["brow"].position.y = e["y"] - e["r"] - 2.6 + PIVOT + (-0.8 if hurt else (0.4 if aiming else sin(_t * 1.7) * 0.2))
	_mouth.visible = hurt or _recoil > 0.4 or _happy
	_head.rotation = la * 0.08 if aiming else sin(_t * 1.3) * 0.02

	_arm.visible = show_weapon
	if show_weapon:
		var wid: String = c.weapon_id if weapon_override == "" else weapon_override
		var key := "held_" + wid if Art.has("held_" + wid) else "held_rocket"
		if key != _weapon_key:
			_weapon_key = key
			Art.apply(_weapon, key)
		_arm.rotation = la
		_weapon.position.x = -_recoil * 4.0
	var tint := Color(4, 4, 4) if _flash > 0.0 else Color.WHITE
	for s in [_body, _head, _foot_b, _foot_f, _tail]:
		if s:
			s.modulate = tint

	# Contact shadow on the ground below (local coords: root is at the feet).
	if terrain == null:
		_shadow.visible = true
		_shadow.position = Vector2.ZERO
	else:
		var feet_y: float = c.y + R
		var ground := terrain.surface_at(c.x, int(feet_y - 2), mini(terrain.height, int(feet_y + 320)))
		if ground < 0:
			_shadow.visible = false
		else:
			var k := 1.0 - minf(1.0, (ground - feet_y) / 220.0) * 0.7
			_shadow.visible = true
			_shadow.position = Vector2(0, ground - feet_y)
			_shadow.scale = Vector2.ONE * k / Art.scale
			_shadow.modulate.a = k
	_ring.visible = show_hud and active and c.on_ground
	_ring.modulate.a = 0.65 + sin(_t * 5.0) * 0.3
	if _shown_hp != c.hp:
		_shown_hp = c.hp
		_hp_frac = clampf(float(c.hp) / c.max_hp, 0.0, 1.0)
		_bar.queue_redraw()


static func _ellipse(rx: float, ry: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for i in 41:
		var a := TAU * i / 40.0
		pts.append(Vector2(cos(a) * rx, sin(a) * ry))
	return pts


func _pose_tweening() -> bool:
	return _happy


func _draw_bar() -> void:
	var w := 36.0
	var k := _hp_frac
	var y := _top - 8.0
	_bar.draw_rect(Rect2(-w / 2 - 2, y, w + 4, 8), Color("#16203f", 0.9))
	var col := Color("#5ee05e") if k > 0.5 else (Color("#ffd23f") if k > 0.25 else Color("#ff4d4d"))
	_bar.draw_rect(Rect2(-w / 2, y + 2, maxf(2.0, w * k), 4), col)
	_bar.draw_circle(Vector2(-w / 2 - 8, y + 4), 4, team_color)
	_bar.draw_arc(Vector2(-w / 2 - 8, y + 4), 4, 0, TAU, 16, Color("#16203f"), 1.5, true)


func _die(c) -> void:
	_gone = true
	_bar.visible = false
	_shadow.visible = false
	_ring.visible = false
	_label.modulate.a = 0.5
	var tw := create_tween().set_parallel()
	tw.tween_property(_pose, "rotation", TAU * 1.5 * (1 if c.facing >= 0 else -1), 0.65)
	tw.tween_property(_pose, "scale", Vector2(0.2, 0.2), 0.65).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_IN)
	tw.tween_property(_pose, "modulate:a", 0.0, 0.65)
	tw.tween_property(_pose, "position:y", -PIVOT - 34.0, 0.65)
	var tomb := Art.sprite("tombstone")
	tomb.position = Vector2(0, -40)
	tomb.modulate.a = 0.0
	add_child(tomb)
	var t2 := create_tween().set_parallel()
	t2.tween_property(tomb, "position:y", 0.0, 0.5).set_delay(0.45).set_trans(Tween.TRANS_BOUNCE).set_ease(Tween.EASE_OUT)
	t2.tween_property(tomb, "modulate:a", 1.0, 0.3).set_delay(0.45)
