class_name LocalSession
extends RefCounted
## Offline match: the GDScript simulation plus bots (vs bot) or several humans (hot-seat).

var online := false
var sim: SimMatch
var world: SimMatch
var slots: Array = []
var _bots := {}
var _acc := 0.0
var _dt: float


## players: [{name, species, team, bot: "" | "easy" | "normal" | "hard"}]
func _init(map_id: String, seed_value: int, players: Array, settings: Dictionary) -> void:
	_dt = 1.0 / float(Spec.world["tickRate"])
	sim = SimMatch.new(map_id, seed_value, players, settings)
	world = sim
	for i in players.size():
		var p: Dictionary = players[i]
		var bot: String = p.get("bot", "")
		slots.append({"slot": i, "name": p["name"], "team": p["team"], "kind": "bot" if bot != "" else "human", "detail": bot, "connected": true})
		if bot != "":
			_bots[i] = SimBot.new(bot, seed_value + i * 7919)
	sim.start()


func controlled_slot() -> int:
	var s := sim.active_slot
	return s if s >= 0 and slots[s]["kind"] == "human" else -1


func update(dt: float) -> Array[Dictionary]:
	_acc += minf(dt, 0.1)
	var n := 0
	while _acc >= _dt and n < 6:
		var s := sim.active_slot
		if _bots.has(s):
			for c in _bots[s].update(_dt, sim, s):
				sim.command(s, c)
		sim.step()
		_acc -= _dt
		n += 1
	if n >= 6:
		_acc = 0.0
	return sim.take_events()


func send(cmd: Dictionary) -> String:
	var s := controlled_slot()
	if s < 0:
		return "not-your-turn"
	var r := sim.command(s, cmd)
	return "" if r["ok"] else String(r["error"])


func result():
	return sim.result


func status() -> String:
	return ""


func take_rejections() -> Array:
	return []


func dispose() -> void:
	pass
