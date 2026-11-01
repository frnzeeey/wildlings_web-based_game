class_name Battle
extends Node2D
## One match on screen: renders a session's world, turns input into commands, and turns sim
## events into effects and sounds. Mirrors web/src/game/BattleScene.ts.

signal game_over(result: Dictionary)
signal banner(title: String, color: Color, sub: String)
signal toast(msg: String)

const FIRE_SFX := {"rocket": "fire", "heavy": "heavy", "shotgun": "shotgun", "grenade": "throw", "cluster": "throw",
	"mine": "throw", "airstrike": "airstrike", "drill": "fire", "teleport": "teleport"}
const ROTATING := ["rocket", "heavy", "drill", "airbomb", "pellet"]

var session
var world
var cam := Camera2D.new()
var terrain_view := TerrainView.new()
var backdrop := Backdrop.new()
var fx := Fx.new()
var aim_gfx := Node2D.new()
var crosshair: Sprite2D
var critters := {}
var proj_sprites := {}
var prop_sprites := {}
var local_aim = null # {angle, power, target: Vector2, weapon}
var ui_weapon := ""
var _entities := Node2D.new()
var _focus := Vector2.ZERO
var _last_explosion = null
var _hit_stop := 0.0
var _over_timer := -1.0
var _reported := false
var _panned := false
var _dragging := false
var _pressed := {}
var _clicked := false
var _wheel := 0
var _sent_move := {"move": 0, "up": false, "down": false}
var _last_aim_sent := 0
var _last_aim := Vector2(NAN, NAN)
var _fired_turn := -1
var _power_override = null
var _last_tick := -1


func setup(p_session) -> void:
	session = p_session
	world = session.world
	var seed_value: int = world.terrain.width * 31 + String(world.map["id"]).length()
	add_child(backdrop)
	var world_root := Node2D.new()
	add_child(world_root)
	backdrop.setup(world.map, seed_value, cam, world_root)
	world_root.add_child(terrain_view)
	terrain_view.setup(world.terrain, world.map, String(world.map["id"]).unicode_at(0) * 7919)
	world_root.add_child(_entities)
	fx.ground_color = Color(world.map["palette"]["dirt"])
	fx.liquid_color = Color(world.map["palette"]["liquid"])
	fx.shake_enabled = bool(Settings.client["screenShake"])
	fx.cam = cam
	fx.z_index = 0
	world_root.add_child(fx)
	aim_gfx.z_index = 25
	aim_gfx.draw.connect(_draw_aim)
	world_root.add_child(aim_gfx)
	crosshair = Art.sprite("crosshair")
	crosshair.z_index = 26
	crosshair.visible = false
	world_root.add_child(crosshair)
	for c in world.characters:
		var cr := Critter.new()
		_entities.add_child(cr)
		cr.setup(c)
		critters[c.slot] = cr
	add_child(cam)
	cam.limit_left = -500
	cam.limit_top = -700
	cam.limit_right = int(Spec.world["width"]) + 500
	cam.limit_bottom = int(Spec.world["height"]) + 200
	cam.make_current()
	var a = world.characters[world.active_slot] if world.active_slot >= 0 else world.characters[0]
	_focus = Vector2(a.x, a.y)
	cam.position = _focus
	_apply_zoom()
	get_viewport().size_changed.connect(_apply_zoom)


func _apply_zoom() -> void:
	var vp := get_viewport_rect().size
	var z := clampf(minf(vp.x / 1280.0, vp.y / 760.0) * float(Settings.client["zoom"]), 0.45, 2.2)
	cam.zoom = Vector2(z, z)


# ------------------------------------------------------------------ input

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		for action in ["jump", "weapon_next", "weapon_prev", "zoom_in", "zoom_out"]:
			if event.is_action_pressed(action):
				_pressed[action] = true
		if event.physical_keycode >= KEY_1 and event.physical_keycode <= KEY_9:
			_pressed["digit"] = event.physical_keycode - KEY_1
	elif event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
			_clicked = true
		elif event.button_index in [MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE]:
			_dragging = event.pressed
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_wheel = -1
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_wheel = 1
	elif event is InputEventMouseMotion and _dragging:
		cam.position -= event.relative / cam.zoom
		_focus = cam.position
		_panned = true


func _usable(c, id: String) -> bool:
	return c.inventory.has(id) and int(c.inventory[id]) != 0 and int(c.cooldowns.get(id, 0)) <= 0


func _cycle(c, from: String, dir: int) -> String:
	var i := Spec.weapon_index(from)
	var n := Spec.weapons.size()
	for k in range(1, n + 1):
		var w: Dictionary = Spec.weapons[posmod(i + dir * k, n)]
		if _usable(c, w["id"]):
			return w["id"]
	return from


func _input_commands(me) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var pressed := _pressed
	_pressed = {}
	var clicked := _clicked
	_clicked = false
	var wheel := _wheel
	_wheel = 0
	if pressed.has("zoom_in") or pressed.has("zoom_out"):
		Settings.client["zoom"] = clampf(float(Settings.client["zoom"]) * (1.15 if pressed.has("zoom_in") else 1.0 / 1.15), 0.5, 2.5)
		_apply_zoom()
	var can_act: bool = me != null and me.alive and (world.phase == "aim" or world.phase == "start") and world.active_slot == me.slot
	if not can_act:
		local_aim = null
		_power_override = null
		_sent_move = {"move": 0, "up": false, "down": false}
		return out
	var aiming: bool = world.phase == "aim"
	var mv := int(Input.is_action_pressed("move_right")) - int(Input.is_action_pressed("move_left"))
	var up := Input.is_action_pressed("climb")
	var down := Input.is_action_pressed("crouch")
	if aiming and (mv != _sent_move["move"] or up != _sent_move["up"] or down != _sent_move["down"]):
		_sent_move = {"move": mv, "up": up, "down": down}
		out.append({"t": "input", "move": mv, "up": up, "down": down})
	if aiming and pressed.has("jump"):
		out.append({"t": "jump"})

	var weapon_id: String = local_aim["weapon"] if local_aim != null else me.weapon_id
	if not _usable(me, weapon_id):
		weapon_id = me.weapon_id
	var cyc := int(pressed.has("weapon_next")) - int(pressed.has("weapon_prev"))
	if Settings.client["wheelMode"] == "weapon":
		cyc += wheel
	if cyc != 0:
		weapon_id = _cycle(me, weapon_id, signi(cyc))
	if pressed.has("digit"):
		var d: int = pressed["digit"]
		if d < Spec.weapons.size() and _usable(me, Spec.weapons[d]["id"]):
			weapon_id = Spec.weapons[d]["id"]
	if ui_weapon != "" and _usable(me, ui_weapon):
		weapon_id = ui_weapon
	ui_weapon = ""
	var prev_weapon: String = local_aim["weapon"] if local_aim != null else ""
	if weapon_id != me.weapon_id and weapon_id != prev_weapon:
		out.append({"t": "weapon", "id": weapon_id})

	var mouse := get_global_mouse_position()
	var angle := atan2(mouse.y - me.y, mouse.x - me.x)
	var power := clampf(Vector2(mouse.x - me.x, mouse.y - me.y).length() / float(Spec.character["maxAimDistance"]), 0.1, 1.0)
	if Settings.client["wheelMode"] == "power":
		if _power_override == null:
			_power_override = me.power
		if wheel != 0:
			_power_override = clampf(_power_override - wheel * 0.03, 0.05, 1.0)
		power = _power_override
	if Spec.weapon(weapon_id).get("fixedPower", false):
		power = 1.0
	local_aim = {"angle": angle, "power": power, "target": mouse, "weapon": weapon_id}
	var now := Time.get_ticks_msec()
	var gap := 1000.0 / float(Spec.rules["net"]["aimSendRate"]) if session.online else 0.0
	var changed := absf(angle - _last_aim.x) > 0.002 or absf(power - _last_aim.y) > 0.002 or is_nan(_last_aim.x)
	if changed and now - _last_aim_sent >= gap:
		_last_aim_sent = now
		_last_aim = Vector2(angle, power)
		out.append({"t": "aim", "angle": angle, "power": power})
	if clicked and aiming and not me.fired and _fired_turn != world.turn_number and _usable(me, weapon_id):
		_fired_turn = world.turn_number
		out.append({"t": "fire", "weapon": weapon_id, "angle": angle, "power": power, "tx": mouse.x, "ty": mouse.y})
	return out


# ------------------------------------------------------------------ frame

func _process(delta: float) -> void:
	var dt := minf(delta, 0.1)
	var events: Array[Dictionary] = []
	if _hit_stop > 0.0 and not session.online:
		_hit_stop -= dt
	else:
		events = session.update(dt)
	var my_slot: int = session.controlled_slot()
	var me = world.characters[my_slot] if my_slot >= 0 else null
	var cmds := _input_commands(me)
	if autoplay and me != null:
		cmds.append_array(_autoplay_commands(me, dt))
	for cmd in cmds:
		var err: String = session.send(cmd)
		if err != "" and cmd["t"] == "fire":
			_fired_turn = -1
			_reject(err)
	for err in session.take_rejections():
		_fired_turn = -1
		_reject(err)
	if session.get("terrain_reset"):
		session.terrain_reset = false
		terrain_view.refresh_all()
	for e in events:
		_handle(e)
	for c in world.characters:
		var active: bool = c.slot == world.active_slot and world.phase != "over"
		var show_weapon: bool = active and (world.phase == "aim" or world.phase == "start") and not c.fired
		var mine: bool = me != null and c.slot == me.slot and local_aim != null
		critters[c.slot].sync(dt, c, show_weapon, active, world.terrain, local_aim["angle"] if mine else null, local_aim["weapon"] if mine else "")
	_sync_projectiles(dt)
	_sync_props()
	backdrop.level = world.water_level
	aim_gfx.queue_redraw()
	_update_camera(dt, me)
	_turn_ticks(me)
	var res = session.result()
	if res != null and _over_timer < 0.0:
		_over_timer = 2.4
	if _over_timer >= 0.0:
		_over_timer -= dt
		if _over_timer <= 0.0 and not _reported:
			_reported = true
			game_over.emit(res)


## Test automation: after a short delay on our turn, walk a little and lob a rocket at the enemy.
func _autoplay_commands(me, dt: float) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if world.phase != "aim" or world.active_slot != me.slot or me.fired:
		_auto_t = 0.0
		return out
	_auto_t += dt
	var enemy = null
	for c in world.characters:
		if c.alive and c.team != me.team:
			enemy = c
	if enemy == null:
		return out
	var dir := 1 if enemy.x > me.x else -1
	if _auto_t > 0.4 and _auto_t < 0.9:
		out.append({"t": "input", "move": dir, "up": true, "down": false})
	elif _auto_t >= 0.9 and _auto_t < 1.0:
		out.append({"t": "input", "move": 0, "up": false, "down": false})
	elif _auto_t >= 1.6 and _fired_turn != world.turn_number:
		_fired_turn = world.turn_number
		var angle := atan2(-1.0, float(dir))
		out.append({"t": "aim", "angle": angle, "power": 0.75})
		out.append({"t": "fire", "weapon": "rocket", "angle": angle, "power": 0.75})
	return out


var _auto_t := 0.0
var autoplay := false


func _reject(err: String) -> void:
	var msgs := {"no-ammo": "Out of ammo!", "cooldown": "Still cooling down", "blocked-target": "Can't teleport there!",
		"bad-target": "Pick a target on the map", "already-fired": "Already fired this turn"}
	if msgs.has(err):
		toast.emit(msgs[err])
	Sfx.play("error")


func _turn_ticks(me) -> void:
	if me == null or world.phase != "aim" or is_inf(world.time_left):
		return
	var sec := int(ceil(world.time_left))
	if sec != _last_tick:
		_last_tick = sec
		if sec <= 5 and sec > 0:
			Sfx.play("tick")


func _handle(e: Dictionary) -> void:
	var r := float(Spec.character["radius"])
	match e["e"]:
		"turn":
			var s := int(e["slot"])
			var c = world.characters[s]
			var info: Dictionary = session.slots[s]
			var mine: bool = session.controlled_slot() == s
			var sub := "Your turn!" if mine else ("Bot · %s" % info["detail"] if info["kind"] == "bot" else ("Opponent" if info["kind"] == "remote" else "Get ready"))
			banner.emit("%s's turn" % c.name, critters[s].team_color, sub)
			Sfx.play("turn")
			_panned = false
			_last_explosion = null
		"fire":
			var s := int(e["slot"])
			critters[s].on_fire()
			var wid: String = e["weapon"]
			if wid != "airstrike" and wid != "teleport":
				fx.muzzle(Vector2(e["x"], e["y"]))
			if wid == "airstrike":
				_fly_plane(float(e["x"]), world.characters[s].x)
			Sfx.play(FIRE_SFX.get(wid, "fire"))
			_panned = false
		"carve":
			terrain_view.carved(float(e["x"]), float(e["y"]), float(e["r"]), float(e["r"]) > 14.0)
			if float(e["r"]) <= 14.0 and randf() < 0.15:
				fx.dust(Vector2(e["x"], e["y"]), 2)
		"explode":
			var rr := float(e["r"])
			fx.explosion(Vector2(e["x"], e["y"]), rr)
			fx.shake(float(e["shake"]))
			Sfx.play("bigboom" if rr >= 80 else ("smallboom" if rr < 30 else "boom"))
			if rr >= 70:
				_hit_stop = 0.08
			_last_explosion = Vector2(e["x"], e["y"])
		"damage":
			var s := int(e["slot"])
			var c = world.characters[s]
			critters[s].on_hurt()
			fx.float_text(Vector2(c.x, c.y - 34), "-%d" % int(e["amount"]), Color("#ffd23f") if int(e["by"]) == s else Color("#ff4d4d"))
			Sfx.play("hurt")
		"death":
			var s := int(e["slot"])
			var c = world.characters[s]
			var cause: String = e["cause"]
			var msg := "%s is knocked out!" % c.name
			match cause:
				"water": msg = "%s went for a swim!" % c.name
				"lava": msg = "%s got toasted!" % c.name
				"forfeit": msg = "%s left the battle" % c.name
				"void": msg = "%s flew off the map!" % c.name
			toast.emit(msg)
			Sfx.play("ko")
			if cause == "hp" or cause == "forfeit":
				fx.poof(Vector2(c.x, c.y), critters[s].team_color)
		"splash":
			fx.splash(Vector2(e["x"], world.water_level), bool(e["big"]))
			Sfx.play("sizzle" if world.map["hazard"] == "lava" else "splash", 1.0 if e["big"] else 0.6)
		"bounce":
			Sfx.play("bounce", 0.7)
		"jump":
			Sfx.play("jump")
		"land":
			if float(e["impact"]) > 250:
				var c = world.characters[int(e["slot"])]
				fx.dust(Vector2(c.x, c.y + r), 5)
				Sfx.play("land", minf(1.0, float(e["impact"]) / 600.0))
		"teleport":
			fx.poof(Vector2(e["fx"], e["fy"]), Color("#b28dff"))
			fx.poof(Vector2(e["x"], e["y"]), Color("#b28dff"))
		"mineArmed":
			Sfx.play("beep", 0.5)
		"mineTrigger":
			Sfx.play("mine")
		"barrelLit":
			var key := "b%d" % int(e["id"])
			if prop_sprites.has(key):
				fx.spark(prop_sprites[key]["img"].position - Vector2(0, 8), 10)
		"fizzle":
			fx.dust(Vector2(e["x"], e["y"]), 2)
		"weapon":
			if session.controlled_slot() == int(e["slot"]):
				Sfx.play("click")
		"timeUp":
			toast.emit("Time's up!")
		"water":
			toast.emit("Sudden death: the %s is rising!" % ("lava" if world.map["hazard"] == "lava" else "water"))
			Sfx.play("water")
		"gameover":
			var res: Dictionary = e["result"]
			var names: Array = []
			for s in res["winners"]:
				names.append(world.characters[int(s)].name)
			banner.emit("%s wins!" % " & ".join(names) if not names.is_empty() else "It's a draw!", Color("#ffbe0b"), "Victory")
			var won := false
			for s in res["winners"]:
				won = won or session.slots[int(s)]["kind"] == "human"
			Sfx.play("win" if won or not session.online else "lose")
			for s in res["winners"]:
				critters[int(s)].victory()


func _fly_plane(tx: float, from_x: float) -> void:
	var dir := 1.0 if tx >= from_x else -1.0
	var y := maxf(-100.0, cam.get_screen_center_position().y - get_viewport_rect().size.y / cam.zoom.y / 2.0 + 60.0)
	var plane := Art.sprite("plane")
	plane.position = Vector2(tx - dir * 900, y)
	plane.scale = Vector2(1.4 * dir, 1.4) / Art.scale
	plane.z_index = 19
	_entities.add_child(plane)
	var tw := plane.create_tween()
	tw.tween_property(plane, "position:x", tx + dir * 900, 1.8)
	tw.tween_callback(plane.queue_free)


func _sync_projectiles(dt: float) -> void:
	var seen := {}
	for p in world.projectiles:
		seen[p.id] = true
		var v: Dictionary = proj_sprites.get(p.id, {})
		if v.is_empty():
			var key: String = "proj_" + p.kind if Art.has("proj_" + p.kind) else "proj_rocket"
			var s := Art.sprite(key)
			s.z_index = 6
			_entities.add_child(s)
			v = {"img": s, "trail": 0.0}
			proj_sprites[p.id] = v
		var img: Sprite2D = v["img"]
		img.position = Vector2(p.x, p.y)
		if ROTATING.has(p.kind):
			img.rotation = atan2(p.vy, p.vx)
		else:
			img.rotation += p.vx * dt * 0.03
		var def := Spec.weapon(p.kind)
		if def.is_empty() and p.kind == "airbomb":
			def = Spec.weapon("airstrike")
		v["trail"] = float(v["trail"]) - dt
		if float(v["trail"]) <= 0.0 and (def.has("trail") or p.drilling):
			v["trail"] = 0.022
			fx.trail(Vector2(p.x, p.y), def.get("trail", "") == "fire")
	for id in proj_sprites.keys():
		if not seen.has(id):
			proj_sprites[id]["img"].queue_free()
			proj_sprites.erase(id)


func _sync_props() -> void:
	var seen := {}
	var t := Time.get_ticks_msec() / 1000.0
	for m in world.mines:
		var key := "m%d" % m.id
		seen[key] = true
		if not prop_sprites.has(key):
			var img := Art.sprite("mine_idle")
			var light := Art.sprite("mine_light")
			img.z_index = 4
			light.z_index = 4
			_entities.add_child(img)
			_entities.add_child(light)
			prop_sprites[key] = {"img": img, "light": light}
		var v: Dictionary = prop_sprites[key]
		var st: int = m.state()
		v["img"].position = Vector2(m.x, m.y + 3)
		var rate := 14.0 if st == 2 else 3.0
		var on := st > 0 and sin(t * rate) > 0
		v["light"].position = Vector2(m.x, m.y - 1)
		v["light"].modulate = Color("#77ff77") if st == 0 else Color("#ff3b3b")
		v["light"].visible = st == 0 or on
	for b in world.barrels:
		var key := "b%d" % b.id
		seen[key] = true
		if not prop_sprites.has(key):
			var img := Art.sprite("barrel")
			img.z_index = 4
			_entities.add_child(img)
			prop_sprites[key] = {"img": img}
		var v: Dictionary = prop_sprites[key]
		v["img"].position = Vector2(b.x, b.y)
		if b.state() == 2:
			v["img"].modulate = Color(3, 3, 3) if sin(t * 40) > 0 else Color(1, 0.6, 0.24)
	for k in prop_sprites.keys():
		if not seen.has(k):
			prop_sprites[k]["img"].queue_free()
			if prop_sprites[k].has("light"):
				prop_sprites[k]["light"].queue_free()
			prop_sprites.erase(k)


# ------------------------------------------------------------------ aiming

func _draw_aim() -> void:
	crosshair.visible = false
	if world.active_slot < 0:
		return
	var a = world.characters[world.active_slot]
	if not a.alive or world.phase != "aim" or a.fired:
		return
	var my_slot: int = session.controlled_slot()
	var local = local_aim if my_slot == a.slot else null
	var angle: float = local["angle"] if local != null else a.aim
	var power: float = local["power"] if local != null else a.power
	var w := Spec.weapon(local["weapon"] if local != null else a.weapon_id)
	if w.is_empty():
		return
	var color: Color = critters[a.slot].team_color
	var r := float(Spec.character["radius"])
	if w.has("targeted"):
		if local == null:
			return
		var t: Vector2 = local["target"]
		if w["behavior"] == "teleport":
			var ok: bool = t.x > 20 and t.x < float(Spec.world["width"]) - 20 and t.y > 20 and t.y < world.water_level - 30 and not SimPhysics.circle_hits(world.terrain, t.x, t.y, r + 1)
			var c := Color("#7cff7c") if ok else Color("#ff4d4d")
			aim_gfx.draw_arc(t, r + 2, 0, TAU, 32, c, 3.0, true)
			aim_gfx.draw_line(Vector2(a.x, a.y), t, Color(c, 0.5), 2.0)
		else:
			for x in SimPhysics.strike_columns(w, t.x):
				aim_gfx.draw_line(Vector2(x, t.y - 600), Vector2(x, t.y + 200), Color(1, 0.3, 0.3, 0.35), 2.0)
				aim_gfx.draw_colored_polygon(PackedVector2Array([Vector2(x - 6, t.y - 14), Vector2(x + 6, t.y - 14), Vector2(x, t.y - 4)]), Color(1, 0.3, 0.3, 0.8))
			crosshair.position = t
			crosshair.visible = true
		return
	var reach := 40.0 + power * 110.0
	var origin := Vector2(a.x, a.y)
	var dir := Vector2(cos(angle), sin(angle))
	for i in range(1, 10):
		var k := i / 9.0
		var d := 22.0 + (reach - 22.0) * k
		var col := color if k <= power + 0.01 else Color.WHITE
		aim_gfx.draw_circle(origin + dir * d, 2.0 + k * 2.2, Color(col, 0.95 if local != null else 0.55))
	crosshair.position = origin + dir * (reach + 14.0)
	crosshair.visible = true
	crosshair.modulate.a = 1.0 if local != null else 0.6
	aim_gfx.draw_arc(origin, 30, -PI / 2, -PI / 2 + TAU * power, 40, Color("#1a2140", 0.5), 4.0, true)
	aim_gfx.draw_arc(origin, 30, -PI / 2, -PI / 2 + TAU * power, 40, Color(color, 0.95), 2.5, true)
	if local != null and Settings.client["aimGuide"] and w.has("speed"):
		var me = world.characters[my_slot]
		var steady: bool = me.crouching
		var pred := Predict.path(world, w, a.slot, a.x, a.y, angle, power, world.wind if steady else 0.0, Spec.num(w, "aimGuide", 0.4) * (3.0 if steady else 1.4))
		var pts: PackedVector2Array = pred["points"]
		var i := 4
		while i < pts.size():
			var k := 1.0 - float(i) / pts.size()
			aim_gfx.draw_circle(pts[i], 1.5 + k * 1.8, Color(1, 1, 1, 0.25 + k * 0.6))
			i += 4
		if steady and pred["impact"] != null:
			var br := Spec.num(w, "radius")
			aim_gfx.draw_circle(pred["impact"], br, Color(1, 0.3, 0.3, 0.12))
			aim_gfx.draw_arc(pred["impact"], br, 0, TAU, 48, Color(1, 0.3, 0.3, 0.85), 2.0, true)


# ------------------------------------------------------------------ camera

func _update_camera(dt: float, me) -> void:
	if _panned:
		return
	var active = world.characters[world.active_slot] if world.active_slot >= 0 else null
	var f := Vector2(active.x, active.y) if active != null else Vector2(float(Spec.world["width"]) / 2.0, 600)
	if not world.projectiles.is_empty():
		var p = world.projectiles[0]
		f = Vector2(p.x, maxf(p.y, -200.0))
	elif world.phase in ["action", "settle", "over"]:
		var moving = null
		for c in world.characters:
			if not c.drowned and not c.on_ground and c.alive:
				moving = c
				break
		if moving != null:
			f = Vector2(moving.x, moving.y)
		elif _last_explosion != null:
			f = _last_explosion
	elif world.phase == "aim" and me != null and active != null and me.slot == active.slot and local_aim != null:
		var t: Vector2 = local_aim["target"]
		f += Vector2(clampf((t.x - active.x) * 0.25, -300, 300), clampf((t.y - active.y) * 0.25, -200, 200))
	var k := 1.0 - exp(-dt * (6.0 if not world.projectiles.is_empty() else 3.5))
	_focus += (f - _focus) * k
	cam.position = _focus
