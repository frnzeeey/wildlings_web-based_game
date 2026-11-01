class_name SimProp
extends RefCounted
## Gravity-only prop resting on terrain: a mine or a barrel (port of Prop/Mine/Barrel).

var id: int
var x: float
var y: float
var vy := 0.0
var alive := true
var falling := false
var is_mine: bool
var body_radius: float
var fuse := -1.0
# Mines only
var def: Dictionary = {}
var owner := -1
var arm_timer := 0.0


func _init(p_id: int, px: float, py: float, mine: bool, p_def: Dictionary = {}, p_owner: int = -1) -> void:
	id = p_id
	x = px
	y = py
	is_mine = mine
	def = p_def
	owner = p_owner
	body_radius = 5.0 if mine else float(Spec.hazards["barrel"]["bodyRadius"])
	if mine:
		arm_timer = Spec.num(def, "armTime")


func armed() -> bool:
	return arm_timer <= 0.0


func state() -> int:
	if fuse >= 0.0:
		return 2
	if is_mine and armed():
		return 1
	return 0


## Fall when the ground beneath is removed. Returns true when it lands in the water.
func update_body(dt: float, t: TerrainMask, water: float) -> bool:
	if not falling and not t.is_solid(x, y + body_radius + 1):
		falling = true
	if not falling:
		return false
	vy = minf(vy + float(Spec.world["gravity"]) * dt, float(Spec.character["maxFallSpeed"]))
	var steps := maxi(1, int(ceil(vy * dt)))
	var sy := (vy * dt) / steps
	for i in steps:
		if t.is_solid(x, y + body_radius + sy):
			falling = false
			vy = 0.0
			break
		y += sy
	return y > water
