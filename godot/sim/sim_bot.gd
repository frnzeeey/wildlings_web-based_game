class_name SimBot
extends RefCounted
## Bot opponent for offline play (behaviour port of shared/src/ai.ts).
## Plans by simulating candidate shots against the real terrain and scoring the landing spots.
## Planning is time-sliced (a job queue processed within a per-frame budget) so frames never stall.

const LEVELS := {
	"easy": {"angleNoise": 0.1, "powerNoise": 0.08, "windSense": 0.35, "think": 1.3, "weapons": ["rocket", "grenade", "shotgun"], "reposition": false, "hazardSense": false, "blunder": 0.25},
	"normal": {"angleNoise": 0.04, "powerNoise": 0.035, "windSense": 0.85, "think": 1.0, "weapons": [], "reposition": true, "hazardSense": false, "blunder": 0.05},
	"hard": {"angleNoise": 0.016, "powerNoise": 0.016, "windSense": 1.0, "think": 0.7, "weapons": [], "reposition": true, "hazardSense": true, "blunder": 0.0},
}
const SKIP := ["teleport", "mine"]

var difficulty: String
var cfg: Dictionary
var rng: Rng
var state := "idle"
var timer := 0.0
var plan: Dictionary = {}
var walked := false
var aim0 := 0.0
var power0 := 0.0
var aim_dur := 1.0
var last_x := 0.0
var stuck := 0.0
var turn_seen := -1

# planner
var _jobs: Array = []
var _best_by_weapon := {}
var _phase := ""
var _m: SimMatch
var _me: SimCharacter
var _enemies: Array = []
var _wind := 0.0
var _spot_best: Dictionary = {}


func _init(p_difficulty: String = "normal", seed_value: int = 1) -> void:
	difficulty = p_difficulty
	cfg = LEVELS.get(difficulty, LEVELS["normal"])
	rng = Rng.new(seed_value)


func update(dt: float, m: SimMatch, slot: int, budget_usec: int = 6000) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var me := m.characters[slot]
	if m.turn_number != turn_seen:
		turn_seen = m.turn_number
		state = "think"
		timer = float(cfg["think"]) + rng.range_f(0, 0.5)
		plan = {}
		walked = false
	if m.phase != "aim" or m.active_slot != slot or not me.alive:
		return out
	timer -= dt
	match state:
		"think":
			if timer <= 0.0 and me.on_ground:
				_begin_plan(m, me)
				state = "plan"
		"plan":
			if _plan_step(budget_usec):
				out.append({"t": "weapon", "id": plan["weaponId"]})
				if plan.has("walkTo") and not walked:
					walked = true
					state = "walk"
					timer = 4.0
					last_x = me.x
					stuck = 0.0
				else:
					_start_aim(me)
		"walk":
			var dx: float = plan["walkTo"] - me.x
			var dir := signi(int(signf(dx)))
			if absf(dx) < 4.0 or timer <= 0.0 or me.energy <= float(Spec.character["jumpCost"]):
				out.append({"t": "input", "move": 0, "up": false, "down": false})
				state = "think"
				timer = 0.4
			else:
				out.append({"t": "input", "move": dir, "up": true, "down": false})
				if absf(me.x - last_x) < 0.2 and me.on_ground:
					stuck += dt
					if stuck > 0.25:
						out.append({"t": "jump"})
						stuck = 0.0
				else:
					stuck = 0.0
				last_x = me.x
		"aim":
			var t := clampf(1.0 - timer / aim_dur, 0.0, 1.0)
			var e := t * t * (3.0 - 2.0 * t)
			out.append({"t": "aim", "angle": lerp_angle(aim0, plan["angle"], e), "power": lerpf(power0, plan["power"], e)})
			if timer <= 0.0:
				state = "fire"
				timer = 0.3
		"fire":
			if timer <= 0.0:
				var cmd := {"t": "fire", "weapon": plan["weaponId"], "angle": plan["angle"], "power": plan["power"]}
				if plan.has("target"):
					cmd["tx"] = plan["target"].x
					cmd["ty"] = plan["target"].y
				out.append(cmd)
				state = "done"
	return out


func _start_aim(me: SimCharacter) -> void:
	state = "aim"
	aim_dur = 0.9 + rng.range_f(0, 0.4)
	timer = aim_dur
	aim0 = me.aim
	power0 = me.power


# ------------------------------------------------------------------ planning

func _begin_plan(m: SimMatch, me: SimCharacter) -> void:
	_m = m
	_me = me
	_wind = m.wind * float(cfg["windSense"])
	_enemies = m.characters.filter(func(c: SimCharacter) -> bool: return c.alive and c.team != me.team)
	_best_by_weapon = {}
	_jobs = []
	_phase = "coarse"
	var allowed: Array = cfg["weapons"]
	for w in Spec.weapons:
		var id: String = w["id"]
		if not me.can_use(id) or SKIP.has(id) or (not allowed.is_empty() and not allowed.has(id)):
			continue
		if w.get("targeted", "") == "column":
			for e in _enemies:
				_jobs.append({"kind": "column", "w": w, "e": e})
		elif w.has("pellets"):
			_jobs.append({"kind": "pellets", "w": w})
		else:
			var a_step := 0.15 if w["behavior"] == "bounce" else 0.1
			var p_step := 0.15 if w["behavior"] == "bounce" else 0.1
			var a := -PI - 0.45
			while a <= 0.45:
				var p := 0.3
				while p <= 1.001:
					_jobs.append({"kind": "shot", "w": w, "a": a, "p": p, "x": me.x, "y": me.y})
					p += p_step
				a += a_step


## Process queued jobs within the budget. Returns true once the plan is final.
func _plan_step(budget_usec: int) -> bool:
	var until := Time.get_ticks_usec() + budget_usec
	while not _jobs.is_empty():
		_run_job(_jobs.pop_back())
		if Time.get_ticks_usec() > until:
			return false
	match _phase:
		"coarse":
			_phase = "refine"
			for id in _best_by_weapon:
				var b: Dictionary = _best_by_weapon[id]
				if b.get("kind", "") != "shot":
					continue
				var da := -0.08
				while da <= 0.081:
					var dp := -0.08
					while dp <= 0.081:
						_jobs.append({"kind": "shot", "w": Spec.weapon(id), "a": b["angle"] + da, "p": clampf(b["power"] + dp, 0.15, 1.0), "x": _me.x, "y": _me.y})
						dp += 0.04
					da += 0.04
			return false
		"refine":
			_phase = "choose"
			_choose()
			if plan.get("score", 0.0) < 18.0 and not walked and _me.energy > 40.0 and bool(cfg["reposition"]):
				_phase = "spots"
				_spot_best = {}
				var rocket := Spec.weapon("rocket")
				for dist in [60.0, 120.0, -60.0, -120.0]:
					var spot = _probe_walk(dist)
					if spot == null:
						continue
					var a := -PI - 0.45
					while a <= 0.45:
						var p := 0.35
						while p <= 1.001:
							_jobs.append({"kind": "spot", "w": rocket, "a": a, "p": p, "x": spot.x, "y": spot.y})
							p += 0.15
						a += 0.15
				return false
			_finalize()
			return true
		"spots":
			if not _spot_best.is_empty() and _spot_best["score"] > plan["score"] + 8.0:
				plan = _spot_best.duplicate()
				plan["walkTo"] = _spot_best["sx"]
				return true
			_finalize()
			return true
	return true


func _run_job(j: Dictionary) -> void:
	var w: Dictionary = j["w"]
	var id: String = w["id"]
	var scarcity := 1.0 if int(w["ammo"]) < 0 else (0.8 if int(w["ammo"]) <= 1 else 0.9)
	match j["kind"]:
		"column":
			var e: SimCharacter = j["e"]
			var s := _score(e.x, e.y, w, _me.x, _me.y, -1) * 1.4 * scarcity
			_consider(id, {"kind": "column", "score": s, "weaponId": id, "angle": _me.aim, "power": _me.power, "target": Vector2(e.x, e.y - 200)})
		"pellets":
			var nearest: SimCharacter = null
			for e in _enemies:
				if nearest == null or Vector2(e.x - _me.x, e.y - _me.y).length() < Vector2(nearest.x - _me.x, nearest.y - _me.y).length():
					nearest = e
			if nearest == null or Vector2(nearest.x - _me.x, nearest.y - _me.y).length() > Spec.num(w, "maxRange", 500) * 0.8:
				return
			var base := atan2(nearest.y - _me.y, nearest.x - _me.x)
			for da in [-0.06, 0.0, 0.06]:
				var r = _simulate(w, _me.x, _me.y, base + da, 1.0)
				if r == null or r.get("water", false):
					continue
				var s := _score(r["x"], r["y"], w, _me.x, _me.y, r.get("direct", -1)) * Spec.num(w, "pellets", 1) * 0.65 * scarcity
				_consider(id, {"kind": "pellets", "score": s, "weaponId": id, "angle": base + da, "power": 1.0})
		"shot", "spot":
			var r = _simulate(w, j["x"], j["y"], j["a"], j["p"])
			var s := -1000.0
			if r != null:
				s = -100.0 if r.get("water", false) else _score(r["x"], r["y"], w, j["x"], j["y"], r.get("direct", -1))
			if w.has("sub"):
				s *= 1.25 if s > 0 else 1.0
			s *= scarcity
			var c := {"kind": "shot", "score": s, "weaponId": id, "angle": j["a"], "power": j["p"]}
			if j["kind"] == "spot":
				if _spot_best.is_empty() or s > _spot_best["score"]:
					c["sx"] = j["x"]
					_spot_best = c
			else:
				_consider(id, c)


func _consider(id: String, c: Dictionary) -> void:
	if not _best_by_weapon.has(id) or c["score"] > _best_by_weapon[id]["score"]:
		_best_by_weapon[id] = c


func _choose() -> void:
	var list: Array = _best_by_weapon.values()
	list.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a["score"] > b["score"])
	if list.is_empty():
		plan = {"score": -INF, "weaponId": "rocket", "angle": _me.aim, "power": _me.power}
		return
	plan = list[0].duplicate()
	if list.size() > 1 and rng.next() < float(cfg["blunder"]):
		plan = list[1].duplicate()
	if not bool(cfg["reposition"]) and plan["score"] <= 0.0 and not walked and not _enemies.is_empty():
		var e: SimCharacter = _enemies[0]
		plan["walkTo"] = _me.x + signf(e.x - _me.x) * rng.range_f(40, 110)


func _finalize() -> void:
	if plan.has("walkTo"):
		return
	plan["angle"] = float(plan["angle"]) + Rng.gaussian(rng) * float(cfg["angleNoise"])
	plan["power"] = clampf(float(plan["power"]) + Rng.gaussian(rng) * float(cfg["powerNoise"]), 0.12, 1.0)
	if plan.has("target"):
		var t: Vector2 = plan["target"]
		plan["target"] = Vector2(clampf(t.x + Rng.gaussian(rng) * float(cfg["angleNoise"]) * 500.0, 0, float(Spec.world["width"])), t.y)


## Fast trajectory for planning; bouncing weapons use the real projectile code.
func _simulate(w: Dictionary, x: float, y: float, angle: float, power: float):
	var dt := 1.0 / float(Spec.world["tickRate"])
	if w["behavior"] == "bounce":
		var dw := _DryWorld.new(_m, _wind)
		var l := SimPhysics.launch(x, y, angle, power, w)
		var pr := SimProjectile.new(dw, w, l["x"], l["y"], l["vx"], l["vy"], _me.slot, 0)
		var t := 0.0
		while t < 7.0 and pr.alive and dw.result.is_empty():
			pr.update(dt, dw)
			t += dt
		return null if dw.result.is_empty() else dw.result
	var l := SimPhysics.launch(x, y, angle, 1.0 if w.get("fixedPower", false) else power, w)
	var px: float = l["x"]
	var py: float = l["y"]
	var vx: float = l["vx"]
	var vy: float = l["vy"]
	var g := float(Spec.world["gravity"]) * Spec.num(w, "gravity", 1)
	var wa := _wind * float(Spec.world["windAccel"]) * Spec.num(w, "wind")
	var rr := float(Spec.character["radius"]) + Spec.num(w, "projectileRadius", 4)
	var max_range := Spec.num(w, "maxRange", INF)
	var travelled := 0.0
	var left_owner := false
	var t: TerrainMask = _m.terrain
	var width := float(Spec.world["width"])
	for tick in 420:
		vx += wa * dt
		vy += g * dt
		var steps := maxi(1, int(ceil(Vector2(vx, vy).length() * dt / 5.0)))
		var sx := vx * dt / steps
		var sy := vy * dt / steps
		for s in steps:
			px += sx
			py += sy
			travelled += 5.0
			for c in _m.characters:
				if not c.alive:
					continue
				var d2 := (px - c.x) * (px - c.x) + (py - c.y) * (py - c.y)
				if c.slot == _me.slot and not left_owner:
					if d2 > (rr + 6) * (rr + 6):
						left_owner = true
					continue
				if d2 < rr * rr:
					return {"x": px, "y": py, "direct": c.slot}
			if t.is_solid(px, py):
				return {"x": px, "y": py}
			if travelled > max_range:
				return {"x": px, "y": py, "water": true}
			if py > _m.water_level:
				return {"x": px, "y": _m.water_level, "water": true}
			if px < -400 or px > width + 400:
				return null
	return null


func _score(x: float, y: float, w: Dictionary, sx: float, sy: float, direct: int) -> float:
	var s := 0.0
	var min_d := INF
	var hazard: bool = cfg["hazardSense"]
	var barrel_def: Dictionary = Spec.hazards["barrel"]
	var radius := Spec.num(w, "radius")
	for e in _enemies:
		var d := Vector2(e.x - x, e.y - y).length()
		min_d = minf(min_d, d)
		var dmg := float(SimPhysics.damage_at(d, w)) + (Spec.num(w, "directHit") if e.slot == direct else 0.0)
		if hazard:
			for b in _m.barrels:
				if Vector2(b.x - x, b.y - y).length() < radius + b.body_radius:
					dmg += SimPhysics.damage_at(Vector2(e.x - b.x, e.y - b.y).length(), barrel_def) * 0.8
			if dmg > 0.0 and _near_drop(e.x, signf(e.x - x) if e.x != x else 1.0):
				dmg += 18.0
		if dmg > 0.0:
			s += dmg + (40.0 if dmg >= e.hp else 0.0)
	var self_dmg := float(SimPhysics.damage_at(Vector2(sx - x, sy - y).length(), w))
	if hazard:
		for b in _m.barrels:
			if Vector2(b.x - x, b.y - y).length() < radius + b.body_radius:
				self_dmg += SimPhysics.damage_at(Vector2(sx - b.x, sy - b.y).length(), barrel_def)
	if self_dmg > 0.0:
		s -= self_dmg * 2.5 + (200.0 if self_dmg >= _me.hp else 0.0)
	if s == 0.0:
		s = -min_d * 0.05
	return s


func _near_drop(x: float, dir: float) -> bool:
	for off in [40.0, 80.0, 120.0]:
		if _m.terrain.surface_at(x + dir * off, 0, int(_m.water_level)) < 0:
			return true
	return false


func _probe_walk(dist: float):
	var c := SimCharacter.new(_me.slot, _me.name, _me.species, _me.team, _me.hp)
	c.x = _me.x
	c.y = _me.y
	c.on_ground = true
	c.energy = _me.energy - 25.0
	var dir := int(signf(dist))
	var dt := 1.0 / float(Spec.world["tickRate"])
	var i := 0
	while i < 400 and absf(c.x - _me.x) < absf(dist):
		if c.walk(dir, dt, _m.terrain, true) <= 0.0:
			break
		if not c.on_ground:
			return null
		i += 1
	if absf(c.x - _me.x) < absf(dist) * 0.6:
		return null
	if not SimPhysics.has_ground(_m.terrain, c.x, c.y, float(Spec.character["radius"])) or c.y > _m.water_level - 60:
		return null
	for mn in _m.mines:
		if Vector2(mn.x - c.x, mn.y - c.y).length() < 70.0:
			return null
	return Vector2(c.x, c.y)


## Projectile world that records the first explosion and changes nothing.
class _DryWorld:
	var terrain: TerrainMask
	var wind: float
	var water_level: float
	var dry := true
	var characters: Array
	var barrels: Array
	var result := {}
	var _ids := 1000000

	func _init(m: SimMatch, w: float) -> void:
		terrain = m.terrain
		wind = w
		water_level = m.water_level
		characters = m.characters.filter(func(c: SimCharacter) -> bool: return c.alive)
		barrels = m.barrels

	func next_id() -> int:
		_ids += 1
		return _ids

	func random() -> float:
		return 0.5

	func explode(_pr, x: float, y: float, _d: Dictionary, direct: int) -> void:
		if result.is_empty():
			result = {"x": x, "y": y, "direct": direct}

	func spawn(_pr) -> void:
		pass

	func splash(_pr, x: float) -> void:
		if result.is_empty():
			result = {"x": x, "y": water_level, "water": true}

	func tunnel(_x: float, _y: float, _r: float) -> void:
		pass

	func bounced(_pr, _x: float, _y: float, _s: float) -> void:
		pass

	func settle_mine(pr) -> void:
		pr.alive = false
		if result.is_empty():
			result = {"x": pr.x, "y": pr.y}

	func fizzle(pr) -> void:
		if result.is_empty():
			result = {"x": pr.x, "y": pr.y, "water": true}
