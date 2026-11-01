class_name Predict
extends RefCounted
## Trajectory preview for aim guides, using the real projectile code (port of sim/predict.ts).


static func path(world, weapon: Dictionary, owner: int, x: float, y: float, angle: float, power: float, wind: float, max_time: float) -> Dictionary:
	var pw := _PathWorld.new(world, wind)
	var l := SimPhysics.launch(x, y, angle, 1.0 if weapon.get("fixedPower", false) else power, weapon)
	var pr := SimProjectile.new(pw, weapon, l["x"], l["y"], l["vx"], l["vy"], owner, 0)
	var dt := 1.0 / float(Spec.world["tickRate"])
	var points := PackedVector2Array([Vector2(l["x"], l["y"])])
	var t := 0.0
	while t < max_time and pr.alive:
		pr.update(dt, pw)
		points.append(Vector2(pr.x, pr.y))
		t += dt
	return {"points": points, "impact": null if pr.alive else pw.impact}


class _PathWorld:
	var terrain: TerrainMask
	var wind: float
	var water_level: float
	var dry := true
	var characters: Array
	var barrels: Array
	var impact = null

	func _init(w, p_wind: float) -> void:
		terrain = w.terrain
		wind = p_wind
		water_level = w.water_level
		characters = w.characters
		barrels = w.barrels.map(func(b) -> Dictionary: return {"x": b.x, "y": b.y, "alive": true})

	func next_id() -> int:
		return 0

	func random() -> float:
		return 0.5

	func explode(_pr, x: float, y: float, _d: Dictionary, _direct: int) -> void:
		if impact == null:
			impact = Vector2(x, y)

	func spawn(_pr) -> void:
		pass

	func splash(_pr, x: float) -> void:
		if impact == null:
			impact = Vector2(x, water_level)

	func tunnel(_x: float, _y: float, _r: float) -> void:
		pass

	func bounced(_pr, _x: float, _y: float, _s: float) -> void:
		pass

	func settle_mine(pr) -> void:
		pr.alive = false
		if impact == null:
			impact = Vector2(pr.x, pr.y)

	func fizzle(pr) -> void:
		if impact == null:
			impact = Vector2(pr.x, pr.y)
