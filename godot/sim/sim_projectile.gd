class_name SimProjectile
extends RefCounted
## A projectile in flight (port of Projectile in shared/src/sim/entities.ts).
## `world` is a SimMatch or a dry-run world with the same methods.

var id: int
var def: Dictionary
var owner: int
var shot_id: int
var kind: String
var x: float
var y: float
var vx: float
var vy: float
var radius: float
var fuse: float
var age := 0.0
var alive := true
var left_owner: bool
var drilling := false
var drilled := 0.0
var travelled := 0.0
var rest := 0.0
var behavior: String


func _init(world, p_def: Dictionary, px: float, py: float, pvx: float, pvy: float, p_owner: int, p_shot: int, p_left_owner := false) -> void:
	id = world.next_id()
	def = p_def
	owner = p_owner
	shot_id = p_shot
	kind = def.get("sprite", def["id"])
	x = px
	y = py
	vx = pvx
	vy = pvy
	radius = Spec.num(def, "projectileRadius", 4)
	fuse = Spec.num(def, "fuse", INF)
	left_owner = p_left_owner
	behavior = def["behavior"]


func update(dt: float, w) -> void:
	age += dt
	if age > float(Spec.turn["maxProjectileAge"]):
		alive = false
		return
	if behavior == "mine" and age > Spec.num(def, "maxFlight", 6):
		w.settle_mine(self)
		return
	fuse -= dt
	if fuse <= 0.0:
		explode(w, -1)
		return
	if not drilling:
		vx += w.wind * float(Spec.world["windAccel"]) * Spec.num(def, "wind") * dt
		vy += float(Spec.world["gravity"]) * Spec.num(def, "gravity", 1) * dt

	var steps := maxi(1, int(ceil((Vector2(vx, vy).length() * dt) / 2.0)))
	var sx := (vx * dt) / steps
	var sy := (vy * dt) / steps
	var step_len := Vector2(sx, sy).length()
	var t: TerrainMask = w.terrain
	for i in steps:
		var nx := x + sx
		var ny := y + sy
		var hit = _touching_character(nx, ny, w)
		if hit != null:
			if behavior == "bounce" or behavior == "mine":
				var d := Vector2(x - hit.x, y - hit.y)
				var n := d / maxf(d.length(), 1e-9) if d.length() > 0.0 else Vector2(0, -1)
				_bounce_off(n.x, n.y, w)
				break
			x = nx
			y = ny
			explode(w, hit.slot)
			return
		var barrel = _touching_barrel(nx, ny, w)
		if barrel != null and behavior != "mine":
			x = nx
			y = ny
			if behavior == "bounce":
				var d2 := Vector2(x - barrel.x, y - barrel.y)
				var n2 := d2.normalized() if d2.length() > 0.0 else Vector2(0, -1)
				_bounce_off(n2.x, n2.y, w)
				break
			explode(w, -1)
			return
		if drilling:
			x = nx
			y = ny
			drilled += step_len
			w.tunnel(nx, ny, Spec.num(def, "tunnelRadius", 10))
			if drilled >= Spec.num(def, "drillDistance"):
				explode(w, -1)
				return
			continue
		if t.is_solid(nx, ny):
			if behavior == "bounce" or behavior == "mine":
				var sn := SimPhysics.surface_normal(t, nx, ny, 6)
				_bounce_off(sn.x, sn.y, w)
				if behavior == "mine":
					_check_rest(dt, w)
				break
			x = nx
			y = ny
			if behavior == "drill":
				drilling = true
				continue
			explode(w, -1)
			return
		x = nx
		y = ny
		travelled += step_len
		if def.has("maxRange") and travelled > float(def["maxRange"]):
			alive = false
			w.fizzle(self)
			return
		if y > w.water_level:
			alive = false
			w.splash(self, x)
			return
		var edge := float(Spec.world["edgeKill"])
		if x < -edge or x > float(Spec.world["width"]) + edge:
			alive = false
			return
	if behavior == "mine" and alive:
		_check_rest(dt, w)


func _check_rest(dt: float, w) -> void:
	if not alive:
		return
	var slow := Vector2(vx, vy).length() < 40.0
	var grounded: bool = w.terrain.is_solid(x, y + radius + 2)
	rest = rest + dt if slow and grounded else 0.0
	if rest > 0.15:
		w.settle_mine(self)


func _touching_character(nx: float, ny: float, w):
	var rr := float(Spec.character["radius"]) + radius
	for p in w.characters:
		if not p.alive:
			continue
		var dx: float = nx - p.x
		var dy: float = ny - p.y
		var d2 := dx * dx + dy * dy
		if p.slot == owner and not left_owner:
			if d2 > (rr + 6) * (rr + 6):
				left_owner = true
			continue
		if d2 < rr * rr:
			return p
	return null


func _touching_barrel(nx: float, ny: float, w):
	var rr := float(Spec.hazards["barrel"]["bodyRadius"]) + radius
	for b in w.barrels:
		if not b.alive:
			continue
		var dx: float = nx - b.x
		var dy: float = ny - b.y
		if dx * dx + dy * dy < rr * rr:
			return b
	return null


func _bounce_off(nx: float, ny: float, w) -> void:
	var dot := vx * nx + vy * ny
	if dot < 0.0:
		vx -= 2.0 * dot * nx
		vy -= 2.0 * dot * ny
	var b := Spec.num(def, "bounce", 0.5)
	vx *= b
	vy *= b
	if absf(dot) > 120.0:
		w.bounced(self, x, y, absf(dot))


func explode(w, direct_slot: int) -> void:
	alive = false
	w.explode(self, x, y, def, direct_slot)
	if def.has("sub") and not w.dry:
		var s: Dictionary = def["sub"]
		var count := int(s["count"])
		for i in count:
			var tt := (float(i) / (count - 1) - 0.5) if count > 1 else 0.0
			var svx: float = tt * 2.0 * float(s["spread"]) + (w.random() - 0.5) * 40.0
			var svy: float = -float(s["lift"]) - w.random() * float(s["liftJitter"])
			w.spawn(SimProjectile.new(w, s, x, y - 6, svx, svy, owner, shot_id, true))
