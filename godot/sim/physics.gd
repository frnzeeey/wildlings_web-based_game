class_name SimPhysics
extends RefCounted
## Circle-vs-mask collision helpers (port of shared/src/sim/physics.ts).

static var RING: PackedVector2Array = _ring()
static var PROBES: PackedVector2Array = _probes()


static func _ring() -> PackedVector2Array:
	var r := PackedVector2Array()
	for i in 16:
		var a := (i / 16.0) * TAU
		r.append(Vector2(cos(a), sin(a)))
	return r


static func _probes() -> PackedVector2Array:
	var r := PackedVector2Array()
	for k in 7:
		var a := PI / 2.0 + (k - 3) * 0.3
		r.append(Vector2(cos(a), sin(a)))
	return r


static func circle_hits(t: TerrainMask, x: float, y: float, r: float) -> bool:
	if t.is_solid(x, y):
		return true
	for p in RING:
		if t.is_solid(x + p.x * r, y + p.y * r):
			return true
	return false


static func has_ground(t: TerrainMask, x: float, y: float, r: float) -> bool:
	for p in PROBES:
		if t.is_solid(x + p.x * (r + 1.5), y + p.y * (r + 1.5)):
			return true
	return false


static func surface_normal(t: TerrainMask, x: float, y: float, radius: int = 6) -> Vector2:
	var nx := 0.0
	var ny := 0.0
	for dy in range(-radius, radius + 1, 2):
		for dx in range(-radius, radius + 1, 2):
			if dx * dx + dy * dy > radius * radius:
				continue
			if t.is_solid(x + dx, y + dy):
				nx -= dx
				ny -= dy
	var v := Vector2(nx, ny)
	return v.normalized() if v.length() > 0.0 else Vector2(0, -1)


## Damage at `dist` px from a blast (contact = full damage).
static func damage_at(dist: float, def: Dictionary) -> int:
	var dmg := Spec.num(def, "damage")
	if dmg <= 0.0:
		return 0
	var radius := Spec.num(def, "radius")
	var eff := maxf(0.0, dist - float(Spec.character["radius"]) - float(Spec.rules["damage"]["contactPad"]))
	if eff >= radius:
		return 0
	return int(roundf(dmg * (1.0 - eff / radius)))


## Muzzle position and launch velocity: {x, y, vx, vy}.
static func launch(x: float, y: float, angle: float, power: float, w: Dictionary) -> Dictionary:
	var c := cos(angle)
	var s := sin(angle)
	var speed := Spec.num(w, "speed")
	if not w.get("fixedPower", false):
		speed *= 0.15 + 0.85 * power
	var off := float(Spec.character["muzzleOffset"])
	return {"x": x + c * off, "y": y - float(Spec.character["muzzleLift"]) + s * off, "vx": c * speed, "vy": s * speed}


static func pellet_angles(w: Dictionary, angle: float) -> Array[float]:
	var n := int(Spec.num(w, "pellets", 1))
	var out: Array[float] = []
	if n <= 1:
		out.append(angle)
		return out
	for i in n:
		out.append(angle + (float(i) / (n - 1) - 0.5) * 2.0 * Spec.num(w, "spread"))
	return out


static func strike_columns(w: Dictionary, tx: float) -> Array[float]:
	var n := int(Spec.num(w, "count", 1))
	var out: Array[float] = []
	for i in n:
		out.append(tx + (i - (n - 1) / 2.0) * Spec.num(w, "spacing"))
	return out
