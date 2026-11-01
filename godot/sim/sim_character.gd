class_name SimCharacter
extends RefCounted
## A critter in the simulation (port of Character in shared/src/sim/entities.ts).

var slot: int
var name: String
var species: String
var team: int
var hp: int
var max_hp: int
var x := 0.0
var y := 0.0
var vx := 0.0
var vy := 0.0
var on_ground := false
var alive := true
var drowned := false
var facing := 1
var aim := -PI / 4.0
var power := 0.6
var energy: float
var crouching := false
var fired := false
var weapon_id := "rocket"
var inventory := {}
var cooldowns := {}
var last_attacker := -1
var input := {"move": 0, "up": false, "down": false}
var pending_jump := false
var stats := {"damageDealt": 0, "damageTaken": 0, "selfDamage": 0, "shots": 0, "hits": 0, "kills": 0, "turns": 0}

var C: Dictionary


func _init(p_slot: int, p_name: String, p_species: String, p_team: int, p_hp: int) -> void:
	C = Spec.character
	slot = p_slot
	name = p_name
	species = p_species
	team = p_team
	hp = p_hp
	max_hp = p_hp
	energy = float(C["maxEnergy"])
	for w in Spec.weapons:
		inventory[w["id"]] = int(w["ammo"])
		cooldowns[w["id"]] = 0


func can_use(id: String) -> bool:
	return inventory.has(id) and int(inventory[id]) != 0 and int(cooldowns.get(id, 0)) <= 0


func ensure_weapon() -> void:
	if can_use(weapon_id):
		return
	var i := Spec.weapon_index(weapon_id)
	var n := Spec.weapons.size()
	for k in range(1, n + 1):
		var w: Dictionary = Spec.weapons[(i + k) % n]
		if can_use(w["id"]):
			weapon_id = w["id"]
			return


func walk(dir: int, dt: float, t: TerrainMask, boost: bool) -> float:
	if not on_ground or energy <= 0.0:
		return 0.0
	var r := float(C["radius"])
	var max_up := int(C["boostClimb"]) if boost else int(C["maxClimb"])
	var budget := float(C["walkSpeed"]) * dt
	var cost := 0.0
	var moved := 0.0
	while budget > 0.0:
		var dx := dir * minf(1.0, budget)
		budget -= 1.0
		var stepped := -1
		for up in range(0, max_up + 1):
			if not SimPhysics.circle_hits(t, x + dx, y - up, r):
				x += dx
				y -= up
				stepped = up
				break
		if stepped < 0:
			break
		moved += absf(dx)
		cost += absf(dx) * float(C["energyPerPx"]) * (float(C["boostCostMul"]) if stepped > int(C["maxClimb"]) else 1.0)
		var k := 0
		while k < 6 and not SimPhysics.has_ground(t, x, y, r) and not SimPhysics.circle_hits(t, x, y + 1, r):
			y += 1
			k += 1
		if not SimPhysics.has_ground(t, x, y, r):
			on_ground = false
			vx = dir * 60.0
			vy = 0.0
			break
		if cost >= energy:
			break
	energy = maxf(0.0, energy - cost)
	if moved > 0.0:
		facing = dir
	return moved


func jump(dir: int) -> bool:
	if not on_ground or energy < float(C["jumpCost"]):
		return false
	energy -= float(C["jumpCost"])
	vy = float(C["jumpVY"])
	vx = dir * float(C["jumpVX"])
	on_ground = false
	return true


func impulse(ix: float, iy: float) -> void:
	vx += ix
	vy += iy
	on_ground = false


## Airborne motion. Returns the landing impact speed, or -1 while still flying.
func fly(dt: float, t: TerrainMask) -> float:
	var r := float(C["radius"])
	vy = minf(vy + float(Spec.world["gravity"]) * dt, float(C["maxFallSpeed"]))
	var steps := maxi(1, int(ceil(maxf(absf(vx), absf(vy)) * dt)))
	var sx := (vx * dt) / steps
	var sy := (vy * dt) / steps
	for i in steps:
		if sx != 0.0:
			if not SimPhysics.circle_hits(t, x + sx, y, r):
				x += sx
			elif not SimPhysics.circle_hits(t, x + sx, y - 2, r):
				x += sx
				y -= 2
			else:
				vx *= -0.3
				sx = 0.0
		if not SimPhysics.circle_hits(t, x, y + sy, r):
			y += sy
			continue
		if sy > 0.0:
			if SimPhysics.has_ground(t, x, y, r):
				var impact := vy
				vx = 0.0
				vy = 0.0
				on_ground = true
				return impact
			var n := SimPhysics.surface_normal(t, x, y + r, int(r))
			var nudge := 1.0 if n.x >= 0.0 else -1.0
			if not SimPhysics.circle_hits(t, x + nudge, y, r):
				x += nudge
			vy *= 0.5
		else:
			vy = 0.0
		break
	return -1.0
