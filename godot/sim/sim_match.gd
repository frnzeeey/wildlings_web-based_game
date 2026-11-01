class_name SimMatch
extends RefCounted
## The game rules for one match (port of shared/src/sim/match.ts), used for offline play.
## Mutate only through command(); advance with step(); drain events with take_events().
## Events and commands are Dictionaries with exactly the same keys as the TS sim and protocol.

var seed_value: int
var map: Dictionary
var settings: Dictionary
var terrain: TerrainMask
var characters: Array[SimCharacter] = []
var rng: Rng
var dry := false
var projectiles: Array[SimProjectile] = []
var mines: Array[SimProp] = []
var barrels: Array[SimProp] = []
var events: Array[Dictionary] = []
var tick := 0
var phase := "idle"
var phase_time := 0.0
var calm := 0.0
var turn_number := 0
var active_slot := -1
var time_left := 0.0
var wind := 0.0
var water_level: float
var result = null

var _order: Array[int] = []
var _id_counter := 0
var _shot_counter := 0
var _shot_hits := {}
var C: Dictionary
var DT: float

const DEFAULT_SETTINGS := {"turnTime": 30, "wind": "normal", "startHP": 100, "suddenDeath": true}


## players: [{name, species, team}], settings: partial {turnTime, wind, startHP, suddenDeath}.
func _init(map_id: String, p_seed: int, players: Array, p_settings: Dictionary = {}) -> void:
	C = Spec.character
	DT = 1.0 / float(Spec.world["tickRate"])
	seed_value = p_seed & 0xFFFFFFFF
	rng = Rng.new(seed_value)
	map = Spec.map_def(map_id)
	settings = DEFAULT_SETTINGS.duplicate()
	settings.merge(p_settings, true)
	water_level = float(Spec.world["waterLevel"])
	terrain = TerrainGen.generate(map, seed_value, int(Spec.world["width"]), int(Spec.world["height"]), water_level)
	for i in players.size():
		var p: Dictionary = players[i]
		characters.append(SimCharacter.new(i, p["name"], p["species"], int(p["team"]), int(settings["startHP"])))
	for c in characters:
		_order.append(c.slot)
	_order.sort_custom(func(a: int, b: int) -> bool:
		var ta := _team_index(a)
		var tb := _team_index(b)
		return ta < tb if ta != tb else characters[a].team < characters[b].team)
	_spawn_characters()
	_spawn_props()


func _team_index(slot: int) -> int:
	var c := characters[slot]
	var n := 0
	for o in characters:
		if o.team == c.team and o.slot < slot:
			n += 1
	return n


func active() -> SimCharacter:
	return characters[active_slot] if active_slot >= 0 and active_slot < characters.size() else null


func _spawn_characters() -> void:
	var n := characters.size()
	var slots: Array[int] = []
	for i in n:
		slots.append(i)
	for i in range(n - 1, 0, -1):
		var j := rng.range_i(0, i)
		var tmp := slots[i]
		slots[i] = slots[j]
		slots[j] = tmp
	var margin := float(map["spawn"]["margin"])
	var jitter := float(map["spawn"]["jitter"])
	var width := float(Spec.world["width"])
	var span := width - margin * 2.0
	var r := float(C["radius"])
	for i in n:
		var p := characters[i]
		var x := margin + ((slots[i] + 0.5) / n) * span + rng.range_f(-jitter, jitter)
		for tries in 60:
			var top := terrain.surface_at(x, 0, int(water_level))
			var l := terrain.surface_at(x - 12, 0, int(water_level))
			var rr := terrain.surface_at(x + 12, 0, int(water_level))
			var flat := top >= 0 and l >= 0 and rr >= 0 and absi(l - top) < 8 + tries and absi(rr - top) < 8 + tries
			if flat and top < water_level - 40:
				p.x = x
				p.y = top - r - 1
				while SimPhysics.circle_hits(terrain, p.x, p.y, r):
					p.y -= 1
				while not SimPhysics.has_ground(terrain, p.x, p.y, r) and not SimPhysics.circle_hits(terrain, p.x, p.y + 1, r):
					p.y += 1
				p.on_ground = SimPhysics.has_ground(terrain, p.x, p.y, r)
				var k := 0
				while k < 120 and not p.on_ground:
					p.fly(DT, terrain)
					k += 1
				break
			x += tries * 9 if tries % 2 else -tries * 9
		p.facing = 1 if p.x < width / 2.0 else -1
		p.aim = -PI / 4.0 if p.facing > 0 else -3.0 * PI / 4.0


func _spawn_props() -> void:
	for i in int(map["gen"]["barrels"]):
		var p = _place(110.0)
		if p != null:
			barrels.append(SimProp.new(next_id(), snappedf(p.x, 0.01), p.y - float(Spec.hazards["barrel"]["bodyRadius"]) - 0.5, false))
	for i in int(map["gen"]["fieldMines"]):
		var p = _place(140.0)
		if p != null:
			mines.append(SimProp.new(next_id(), snappedf(p.x, 0.01), p.y - 5.5, true, Spec.hazards["fieldMine"], -1))


func _place(min_gap: float):
	var width := float(Spec.world["width"])
	for tries in 30:
		var x := rng.range_f(width * 0.12, width * 0.88)
		var y := terrain.surface_at(x, 0, int(water_level))
		if y < 0 or y > water_level - 50:
			continue
		var near := false
		for o in characters:
			near = near or absf(o.x - x) < min_gap
		for o in barrels + mines:
			near = near or absf(o.x - x) < min_gap
		if not near:
			return Vector2(x, y)
	return null


func start() -> void:
	if phase == "idle":
		_next_turn()


# ------------------------------------------------------------------ commands

func command(slot: int, cmd: Dictionary) -> Dictionary:
	if slot < 0 or slot >= characters.size():
		return _err("bad-slot")
	var p := characters[slot]
	if phase == "over":
		return _err("match-over")
	if slot != active_slot:
		return _err("not-your-turn")
	if not p.alive:
		return _err("dead")
	var aiming := phase == "aim"
	match String(cmd.get("t", "")):
		"input":
			if not aiming:
				return _err("wrong-phase")
			var mv := float(cmd.get("move", 0))
			p.input = {"move": 1 if mv > 0 else (-1 if mv < 0 else 0), "up": bool(cmd.get("up", false)), "down": bool(cmd.get("down", false))}
			return _ok()
		"jump":
			if not aiming:
				return _err("wrong-phase")
			if not p.on_ground:
				return _err("airborne")
			if p.energy < float(C["jumpCost"]):
				return _err("no-energy")
			p.pending_jump = true
			return _ok()
		"aim":
			if not aiming and phase != "start":
				return _err("wrong-phase")
			var a := float(cmd.get("angle", NAN))
			var pw := float(cmd.get("power", NAN))
			if is_nan(a) or is_nan(pw) or is_inf(a) or is_inf(pw):
				return _err("bad-aim")
			p.aim = norm_angle(a)
			p.power = clampf(pw, 0.0, 1.0)
			p.facing = 1 if cos(p.aim) >= 0 else -1
			return _ok()
		"weapon":
			if not aiming and phase != "start":
				return _err("wrong-phase")
			var id := String(cmd.get("id", ""))
			if Spec.weapon(id).is_empty():
				return _err("unknown-weapon")
			if not p.can_use(id):
				return _err("weapon-unavailable")
			if p.weapon_id != id:
				p.weapon_id = id
				_emit({"e": "weapon", "slot": slot, "id": id})
			return _ok()
		"fire":
			return _fire(p, cmd)
		"skip":
			if not aiming:
				return _err("wrong-phase")
			_end_aim()
			return _ok()
	return _err("bad-command")


func _fire(p: SimCharacter, cmd: Dictionary) -> Dictionary:
	if phase != "aim":
		return _err("wrong-phase")
	if p.fired:
		return _err("already-fired")
	var w := Spec.weapon(String(cmd.get("weapon", "")))
	if w.is_empty():
		return _err("unknown-weapon")
	var wid: String = w["id"]
	if int(p.inventory[wid]) == 0:
		return _err("no-ammo")
	if int(p.cooldowns.get(wid, 0)) > 0:
		return _err("cooldown")
	var angle := float(cmd.get("angle", NAN))
	var power := float(cmd.get("power", NAN))
	if is_nan(angle) or is_nan(power) or is_inf(angle) or power < 0.0 or power > 1.0:
		return _err("bad-aim")
	var tx := 0.0
	var ty := 0.0
	if w.has("targeted"):
		tx = float(cmd.get("tx", NAN))
		ty = float(cmd.get("ty", NAN))
		if is_nan(tx) or is_nan(ty) or tx < 0 or tx > float(Spec.world["width"]) or ty < -600 or ty > float(Spec.world["height"]):
			return _err("bad-target")
		if w["behavior"] == "teleport" and not can_stand_at(tx, ty):
			return _err("blocked-target")

	p.weapon_id = wid
	p.aim = norm_angle(angle)
	p.power = power
	p.facing = 1 if cos(p.aim) >= 0 else -1
	_shot_counter += 1
	var shot := _shot_counter
	if w["behavior"] == "teleport":
		var fx := p.x
		var fy := p.y
		p.x = snappedf(tx, 0.01)
		p.y = snappedf(ty, 0.01)
		p.vx = 0.0
		p.vy = 0.0
		p.on_ground = false
		_emit({"e": "teleport", "slot": p.slot, "fx": fx, "fy": fy, "x": p.x, "y": p.y})
	elif w["behavior"] == "strike":
		var dir := 1.0 if tx >= p.x else -1.0
		var drift := Spec.num(w, "dropDrift")
		for x in SimPhysics.strike_columns(w, tx):
			spawn(SimProjectile.new(self, w, x - dir * drift * 0.4, Spec.num(w, "dropHeight", -140), dir * drift, Spec.num(w, "dropSpeed", 300), p.slot, shot, true))
		_emit({"e": "fire", "slot": p.slot, "weapon": wid, "x": tx, "y": 0.0, "angle": p.aim})
	else:
		var pw := 1.0 if w.get("fixedPower", false) else power
		for a in SimPhysics.pellet_angles(w, p.aim):
			var l := SimPhysics.launch(p.x, p.y, a, pw, w)
			spawn(SimProjectile.new(self, w, l["x"], l["y"], l["vx"], l["vy"], p.slot, shot))
		var l0 := SimPhysics.launch(p.x, p.y, p.aim, pw, w)
		_emit({"e": "fire", "slot": p.slot, "weapon": wid, "x": snappedf(l0["x"], 0.01), "y": snappedf(l0["y"], 0.01), "angle": p.aim})
	if int(w["ammo"]) > 0:
		p.inventory[wid] = int(p.inventory[wid]) - 1
	if int(w["cooldown"]) > 0:
		p.cooldowns[wid] = int(w["cooldown"]) + 1
	p.fired = true
	p.stats["shots"] += 1
	p.crouching = false
	p.input = {"move": 0, "up": false, "down": false}
	_set_phase("action")
	return _ok()


func can_stand_at(x: float, y: float) -> bool:
	return x > 20 and x < float(Spec.world["width"]) - 20 and y > 20 and y < water_level - 30 and not SimPhysics.circle_hits(terrain, x, y, float(C["radius"]) + 1)


func forfeit(slot: int) -> void:
	if slot < 0 or slot >= characters.size():
		return
	var p := characters[slot]
	if not p.alive or phase == "over":
		return
	p.alive = false
	p.hp = 0
	_emit({"e": "death", "slot": slot, "cause": "forfeit"})
	if not _check_game_over() and slot == active_slot:
		_end_aim()


# ------------------------------------------------------------------ simulation

func step() -> void:
	if phase == "idle":
		return
	tick += 1
	_update_turn(DT)
	var p := active()
	if p != null and phase == "aim" and p.alive:
		_apply_movement(p, DT)
	elif p != null:
		p.crouching = false
	for c in characters:
		_update_character(c, DT)
	for pr in projectiles:
		if pr.alive:
			pr.update(DT, self)
	projectiles = projectiles.filter(func(pr: SimProjectile) -> bool: return pr.alive)
	_update_mines(DT)
	_update_barrels(DT)


func _apply_movement(p: SimCharacter, dt: float) -> void:
	var inp := p.input
	var mv: int = inp["move"]
	p.crouching = inp["down"] and p.on_ground and mv == 0
	if mv != 0 and p.on_ground and not p.crouching:
		p.walk(mv, dt, terrain, inp["up"])
	if p.pending_jump:
		p.pending_jump = false
		if p.jump(mv):
			_emit({"e": "jump", "slot": p.slot})


func _update_character(c: SimCharacter, dt: float) -> void:
	if c.drowned:
		return
	var r := float(C["radius"])
	if c.on_ground and not SimPhysics.has_ground(terrain, c.x, c.y, r):
		c.on_ground = false
	if not c.on_ground:
		var impact := c.fly(dt, terrain)
		if impact >= 0.0:
			_emit({"e": "land", "slot": c.slot, "impact": roundi(impact)})
			if impact > float(C["fallSafeSpeed"]) and c.alive:
				_damage(c, roundi((impact - float(C["fallSafeSpeed"])) * float(C["fallDamagePerSpeed"])), -1)
	var edge := float(Spec.world["edgeKill"])
	if c.y > water_level + 4:
		_drown(c, "lava" if map["hazard"] == "lava" else "water")
	elif c.x < -edge or c.x > float(Spec.world["width"]) + edge:
		_drown(c, "void")


func _update_mines(dt: float) -> void:
	var r := float(C["radius"])
	for m in mines:
		if not m.alive:
			continue
		if m.update_body(dt, terrain, water_level):
			m.alive = false
			_emit({"e": "splash", "x": snappedf(m.x, 0.01), "big": false})
			continue
		if not m.armed():
			m.arm_timer -= dt
			if m.armed():
				_emit({"e": "mineArmed", "id": m.id})
			continue
		if m.fuse < 0.0:
			var reach := Spec.num(m.def, "triggerRadius", 38) + r
			for c in characters:
				if c.alive and not c.drowned and Vector2(c.x - m.x, c.y - m.y).length() < reach:
					m.fuse = Spec.num(m.def, "triggerFuse", 1)
					_emit({"e": "mineTrigger", "id": m.id})
					break
		else:
			m.fuse -= dt
			if m.fuse <= 0.0:
				m.alive = false
				_blast(m.x, m.y, m.def, m.owner, -1, 0)
	mines = mines.filter(func(m: SimProp) -> bool: return m.alive)


func _update_barrels(dt: float) -> void:
	for b in barrels:
		if not b.alive:
			continue
		if b.update_body(dt, terrain, water_level):
			b.alive = false
			_emit({"e": "splash", "x": snappedf(b.x, 0.01), "big": false})
			continue
		if b.fuse >= 0.0:
			b.fuse -= dt
			if b.fuse < 0.0:
				b.alive = false
				_blast(b.x, b.y, Spec.hazards["barrel"], -1, -1, 0)
	barrels = barrels.filter(func(b: SimProp) -> bool: return b.alive)


# ------------------------------------------------------------------ world interface (projectiles)

func next_id() -> int:
	_id_counter += 1
	return _id_counter


func random() -> float:
	return rng.next()


func spawn(pr: SimProjectile) -> void:
	projectiles.append(pr)


func explode(pr: SimProjectile, x: float, y: float, def: Dictionary, direct_slot: int) -> void:
	_blast(x, y, def, pr.owner, direct_slot, pr.shot_id)


func splash(_pr: SimProjectile, x: float) -> void:
	_emit({"e": "splash", "x": snappedf(x, 0.01), "big": false})


func tunnel(x: float, y: float, r: float) -> void:
	_carve(x, y, r)


func bounced(_pr: SimProjectile, x: float, y: float, speed: float) -> void:
	if speed > 120.0:
		_emit({"e": "bounce", "x": snappedf(x, 0.01), "y": snappedf(y, 0.01)})


func settle_mine(pr: SimProjectile) -> void:
	pr.alive = false
	var d := pr.def
	var mdef := {
		"id": d["id"], "damage": d["damage"], "directHit": 0, "radius": d["radius"], "terrain": Spec.num(d, "terrain", 1),
		"knockback": Spec.num(d, "knockback"), "shake": Spec.num(d, "shake"), "armTime": Spec.num(d, "armTime", 1),
		"triggerRadius": Spec.num(d, "triggerRadius", 38), "triggerFuse": Spec.num(d, "triggerFuse", 1),
	}
	mines.append(SimProp.new(next_id(), snappedf(pr.x, 0.01), snappedf(pr.y, 0.01), true, mdef, pr.owner))


func fizzle(pr: SimProjectile) -> void:
	_emit({"e": "fizzle", "x": snappedf(pr.x, 0.01), "y": snappedf(pr.y, 0.01)})


func _carve(x: float, y: float, r: float) -> void:
	var cx := snappedf(x, 0.01)
	var cy := snappedf(y, 0.01)
	var cr := snappedf(r, 0.01)
	terrain.carve(cx, cy, cr)
	_emit({"e": "carve", "x": cx, "y": cy, "r": cr})


func _blast(x: float, y: float, def: Dictionary, owner: int, direct_slot: int, shot_id: int) -> void:
	x = snappedf(x, 0.01)
	y = snappedf(y, 0.01)
	var radius := Spec.num(def, "radius")
	var tr := radius * Spec.num(def, "terrain", 1)
	if tr > 0.0:
		_carve(x, y, tr)
	var reach := radius + float(C["radius"])
	var knock := Spec.num(def, "knockback")
	var attacker: SimCharacter = characters[owner] if owner >= 0 and owner < characters.size() else null
	for c in characters:
		if not c.alive or c.drowned:
			continue
		var d := Vector2(c.x - x, c.y - y).length()
		if d < reach and knock > 0.0:
			var f := 1.0 - d / reach
			var nx := (c.x - x) / d if d > 0.0 else 0.0
			var ny := (c.y - y) / d if d > 0.0 else -1.0
			var k := knock * f
			c.impulse(nx * k, ny * k - k * float(Spec.rules["damage"]["knockbackLift"]))
		var dmg := SimPhysics.damage_at(d, def)
		if c.slot == direct_slot:
			dmg += int(Spec.num(def, "directHit"))
		if dmg > 0:
			_damage(c, dmg, owner)
			if attacker != null and c.slot != owner and shot_id != 0 and not _shot_hits.has(shot_id):
				_shot_hits[shot_id] = true
				attacker.stats["hits"] += 1
	for b in barrels:
		if b.alive and b.fuse < 0.0 and Vector2(b.x - x, b.y - y).length() < radius + b.body_radius:
			b.fuse = float(Spec.hazards["barrel"]["fuse"])
			_emit({"e": "barrelLit", "id": b.id})
	for m in mines:
		if m.alive and Vector2(m.x - x, m.y - y).length() < radius + m.body_radius and (m.fuse < 0.0 or m.fuse > 0.12):
			m.arm_timer = 0.0
			m.fuse = 0.12
	_emit({"e": "explode", "x": x, "y": y, "r": radius, "id": def["id"], "shake": Spec.num(def, "shake", radius * 0.15)})


# ------------------------------------------------------------------ health and deaths

func _damage(c: SimCharacter, amount: int, by: int) -> void:
	if not c.alive or amount <= 0:
		return
	var real := mini(c.hp, amount)
	c.hp -= real
	c.stats["damageTaken"] += real
	var attacker: SimCharacter = characters[by] if by >= 0 and by < characters.size() else null
	if attacker != null and attacker != c:
		attacker.stats["damageDealt"] += real
		c.last_attacker = by
	elif attacker == c:
		c.stats["selfDamage"] += real
	_emit({"e": "damage", "slot": c.slot, "amount": amount, "hp": c.hp, "by": by})


func _drown(c: SimCharacter, cause: String) -> void:
	if c.drowned:
		return
	c.drowned = true
	c.vx = 0.0
	c.vy = 0.0
	_emit({"e": "splash", "x": snappedf(c.x, 0.01), "big": true})
	if c.alive:
		c.hp = 0
		c.alive = false
		_credit_kill(c)
		_emit({"e": "death", "slot": c.slot, "cause": cause})


func _resolve_deaths() -> void:
	for c in characters:
		if c.alive and c.hp <= 0:
			c.alive = false
			_credit_kill(c)
			_emit({"e": "death", "slot": c.slot, "cause": "hp"})


func _credit_kill(c: SimCharacter) -> void:
	if c.last_attacker >= 0 and c.last_attacker != c.slot:
		characters[c.last_attacker].stats["kills"] += 1


func is_settled() -> bool:
	if not projectiles.is_empty():
		return false
	for c in characters:
		if not (c.drowned or c.on_ground or not c.alive):
			return false
	for m in mines:
		if m.fuse >= 0.0 or m.falling:
			return false
	for b in barrels:
		if b.fuse >= 0.0 or b.falling:
			return false
	return true


func _teams_alive() -> Dictionary:
	var teams := {}
	for c in characters:
		if c.alive:
			teams[c.team] = true
	return teams


func _check_game_over() -> bool:
	var teams := _teams_alive()
	if teams.size() > 1:
		return false
	var winner_team = teams.keys()[0] if teams.size() == 1 else null
	var winners: Array = []
	var players: Array = []
	for c in characters:
		if winner_team != null and c.team == winner_team:
			winners.append(c.slot)
		players.append({"slot": c.slot, "name": c.name, "team": c.team, "alive": c.alive, "stats": c.stats.duplicate()})
	result = {"winnerTeam": winner_team, "winners": winners, "turns": turn_number, "duration": roundi(tick * DT), "map": map["id"], "players": players}
	_set_phase("over")
	_emit({"e": "gameover", "result": result})
	return true


# ------------------------------------------------------------------ turns

func _set_phase(p: String) -> void:
	phase = p
	phase_time = 0.0
	calm = 0.0


func _end_aim() -> void:
	var p := active()
	if p != null:
		p.input = {"move": 0, "up": false, "down": false}
		p.pending_jump = false
		p.crouching = false
	_set_phase("action")


func _next_turn() -> void:
	var prev := _order.find(active_slot)
	var n := _order.size()
	for k in range(1, n + 1):
		var s: int = _order[posmod(prev + k, n)]
		if characters[s].alive:
			active_slot = s
			break
	var p := characters[active_slot]
	turn_number += 1
	var level := float(Spec.rules["wind"]["levels"].get(settings["wind"], 1.0))
	var raw := clampf(rng.range_f(-1, 1) + float(map["wind"]["bias"]), -1.0, 1.0)
	var step_w := float(Spec.rules["wind"]["step"])
	wind = roundf((raw * level * float(map["wind"]["scale"])) / step_w) * step_w
	wind = roundf(wind * 100.0) / 100.0
	var sd: Dictionary = Spec.rules["suddenDeath"]
	if settings["suddenDeath"] and turn_number > int(sd["startTurn"]):
		var lvl := maxf(float(sd["minWaterLevel"]), water_level - float(sd["waterRisePerTurn"]))
		if lvl != water_level:
			water_level = lvl
			_emit({"e": "water", "level": lvl})
	p.energy = float(C["maxEnergy"])
	p.crouching = false
	p.fired = false
	p.input = {"move": 0, "up": false, "down": false}
	p.pending_jump = false
	p.stats["turns"] += 1
	for id in p.cooldowns.keys():
		if int(p.cooldowns[id]) > 0:
			p.cooldowns[id] = int(p.cooldowns[id]) - 1
	p.ensure_weapon()
	var tt := float(settings["turnTime"])
	time_left = tt if tt > 0 else INF
	_set_phase("start")
	_emit({"e": "turn", "slot": p.slot, "turn": turn_number, "wind": wind, "time": tt, "water": water_level, "inv": p.inventory.duplicate(), "cd": p.cooldowns.duplicate()})


func _update_turn(dt: float) -> void:
	phase_time += dt
	match phase:
		"start":
			if phase_time >= float(Spec.turn["startDelay"]):
				_set_phase("aim")
				_emit({"e": "aimPhase", "slot": active_slot})
		"aim":
			var p := active()
			if p == null or not p.alive or p.hp <= 0 or _teams_alive().size() <= 1:
				_end_aim()
				return
			if not is_inf(time_left):
				time_left -= dt
				if time_left <= 0.0:
					time_left = 0.0
					_emit({"e": "timeUp", "slot": p.slot})
					_end_aim()
		"action":
			calm = calm + dt if is_settled() else 0.0
			if calm >= float(Spec.turn["settleCalm"]) or phase_time > float(Spec.turn["actionTimeout"]):
				_resolve_deaths()
				_set_phase("settle")
		"settle":
			if phase_time >= float(Spec.turn["settleMin"]) and (is_settled() or phase_time > float(Spec.turn["settleTimeout"])):
				_resolve_deaths()
				if not _check_game_over():
					_next_turn()


func _emit(ev: Dictionary) -> void:
	events.append(ev)


func take_events() -> Array[Dictionary]:
	var e := events
	events = []
	return e


func _ok() -> Dictionary:
	return {"ok": true}


func _err(code: String) -> Dictionary:
	return {"ok": false, "error": code}


static func norm_angle(a: float) -> float:
	var r := fmod(a, TAU)
	if r > PI:
		r -= TAU
	if r < -PI:
		r += TAU
	return r
