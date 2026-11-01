class_name NetSession
extends RefCounted
## Online match: the server simulates; this client decodes the terrain, interpolates snapshots,
## applies tick-stamped events in sync with them, verifies terrain checksums and sends commands.
## Port of web/src/game/NetSession.ts.

const FLAG_GROUND := 1
const FLAG_ALIVE := 2
const FLAG_DROWNED := 4
const FLAG_CROUCH := 8
const FLAG_FIRED := 16

var online := true
var world: NetWorld
var slots: Array = []
var you := -1
var match_id := ""
var terrain_reset := false

var _snaps: Array = []
var _pending_events: Array = []
var _pending_sums: Array = []
var _tick_offset = null
var _seq := 0
var _result = null
var _rejected: Array = []
var _grace := {}
var _player_slots := {}
var _tick_rate: float
var _delay_ticks: float


class NetProj:
	var id: int
	var kind: String
	var x: float
	var y: float
	var vx: float
	var vy: float
	var drilling: bool


class NetProp:
	var id: int
	var x: float
	var y: float
	var st: int
	var body_radius := 5.0

	func state() -> int:
		return st


class NetWorld:
	var terrain: TerrainMask
	var characters: Array[SimCharacter] = []
	var projectiles: Array = []
	var mines: Array = []
	var barrels: Array = []
	var phase := "idle"
	var active_slot := -1
	var turn_number := 0
	var time_left := 0.0
	var wind := 0.0
	var water_level: float
	var map: Dictionary
	var settings: Dictionary

	func _init(start: Dictionary) -> void:
		terrain = TerrainMask.from_payload(start["terrain"])
		map = Spec.map_def(start["mapId"])
		settings = start["settings"]
		water_level = float(Spec.world["waterLevel"])
		for p in start["players"]:
			var st: Dictionary = {}
			for c in start["chars"]:
				if int(c["slot"]) == int(p["slot"]):
					st = c
			var ch := SimCharacter.new(int(p["slot"]), p["name"], p["species"], int(p["team"]), int(st.get("maxHp", 100)))
			if st.has("inv"):
				ch.inventory = _ints(st["inv"])
				ch.cooldowns = _ints(st["cd"])
			characters.append(ch)

	static func _ints(d: Dictionary) -> Dictionary:
		var out := {}
		for k in d:
			out[k] = int(d[k])
		return out


func _init(start: Dictionary) -> void:
	_tick_rate = float(Spec.world["tickRate"])
	_delay_ticks = float(Spec.rules["net"]["interpDelayMs"]) / 1000.0 * _tick_rate
	world = NetWorld.new(start)
	you = int(start["you"])
	match_id = start["matchId"]
	for p in start["players"]:
		var s := int(p["slot"])
		_player_slots[p["playerId"]] = s
		slots.append({"slot": s, "name": p["name"], "team": int(p["team"]), "kind": "human" if s == you else "remote", "detail": p["client"], "connected": true})
	_apply_now(start["snap"])
	Net.message.connect(_on_message)


func dispose() -> void:
	if Net.message.is_connected(_on_message):
		Net.message.disconnect(_on_message)


func reset(start: Dictionary) -> void:
	var fresh := NetWorld.new(start)
	world.terrain.data = fresh.terrain.data
	world.terrain.surface = fresh.terrain.surface
	for c in world.characters:
		for f in fresh.characters:
			if f.slot == c.slot:
				c.inventory = f.inventory
				c.cooldowns = f.cooldowns
	_snaps = []
	_pending_events = []
	_pending_sums = []
	_apply_now(start["snap"])
	terrain_reset = true


func _now_ticks() -> float:
	return Time.get_ticks_msec() / 1000.0 * _tick_rate


func _on_message(m: Dictionary) -> void:
	match m.get("t", ""):
		"snap":
			var s: Dictionary = m["s"]
			var est := float(s["tick"]) - _now_ticks()
			if _tick_offset == null or est > _tick_offset:
				_tick_offset = est
			else:
				_tick_offset += (est - _tick_offset) * 0.02
			_snaps.append(s)
			if _snaps.size() > 60:
				_snaps = _snaps.slice(_snaps.size() - 60)
		"ev":
			for e in m["list"]:
				_pending_events.append({"tick": float(m["tick"]), "e": e})
		"tsum":
			_pending_sums.append({"tick": float(m["tick"]), "sum": m["sum"]})
		"nack":
			_rejected.append(m["error"])
		"presence":
			var s: int = _player_slots.get(m["playerId"], -1)
			if s >= 0:
				slots[s]["connected"] = m["connected"]
				_grace[s] = Time.get_ticks_msec() / 1000.0 + float(m["graceLeft"])
		"matchEnd":
			_result = m["result"]
		"matchStart":
			if m["matchId"] == match_id:
				reset(m)


func _apply_now(s: Dictionary) -> void:
	_snaps = [s]
	_tick_offset = float(s["tick"]) - _now_ticks() + _delay_ticks
	_interpolate(float(s["tick"]))


func controlled_slot() -> int:
	return you if world.active_slot == you and you >= 0 else -1


func update(_dt: float) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if _tick_offset == null:
		return out
	var render_tick: float = _now_ticks() + _tick_offset - _delay_ticks
	_interpolate(render_tick)
	while not _pending_events.is_empty() and _pending_events[0]["tick"] <= render_tick:
		var e: Dictionary = _pending_events.pop_front()["e"]
		_apply_event(e)
		out.append(e)
	while not _pending_sums.is_empty() and _pending_sums[0]["tick"] <= render_tick:
		var sum: String = _pending_sums.pop_front()["sum"]
		if world.terrain.checksum() != sum:
			print("TERRAIN_DRIFT turn %d" % world.turn_number)
			push_warning("[net] terrain drift detected, requesting resync")
		else:
			print("TERRAIN_OK turn %d %s" % [world.turn_number, sum])
			Net.send({"t": "resync"})
	return out


func _apply_event(e: Dictionary) -> void:
	match e["e"]:
		"carve":
			world.terrain.carve(float(e["x"]), float(e["y"]), float(e["r"]))
		"turn":
			var c := world.characters[int(e["slot"])]
			c.inventory = NetWorld._ints(e["inv"])
			c.cooldowns = NetWorld._ints(e["cd"])
		"fire":
			var c := world.characters[int(e["slot"])]
			var wid: String = e["weapon"]
			if int(c.inventory.get(wid, 0)) > 0:
				c.inventory[wid] = int(c.inventory[wid]) - 1
		"water":
			world.water_level = float(e["level"])
		"gameover":
			_result = e["result"]


func _interpolate(render_tick: float) -> void:
	if _snaps.is_empty():
		return
	var a: Dictionary = _snaps[0]
	var b: Dictionary = _snaps[0]
	for s in _snaps:
		if float(s["tick"]) <= render_tick:
			a = s
		b = s
		if float(s["tick"]) >= render_tick:
			break
	var ia := _snaps.find(a)
	if ia > 0:
		_snaps = _snaps.slice(ia)
	var ta := float(a["tick"])
	var tb := float(b["tick"])
	var t := clampf((render_tick - ta) / (tb - ta), 0.0, 1.0) if tb > ta else 0.0
	var w := world
	w.phase = a["ph"]
	w.active_slot = int(a["ts"])
	w.turn_number = int(a["tn"])
	var tl := float(a["tl"])
	w.time_left = INF if tl < 0 else maxf(0.0, tl - (render_tick - ta) / _tick_rate)
	w.wind = float(a["wind"])
	w.water_level = float(a["water"])
	for ca in a["c"]:
		var cb: Dictionary = ca
		for x in b["c"]:
			if x["s"] == ca["s"]:
				cb = x
		var c := w.characters[int(ca["s"])]
		var f := int(ca["f"])
		c.x = lerpf(ca["x"], cb["x"], t)
		c.y = lerpf(ca["y"], cb["y"], t)
		c.vx = float(ca["vx"])
		c.vy = float(ca["vy"])
		c.hp = int(ca["hp"])
		c.alive = (f & FLAG_ALIVE) != 0
		c.drowned = (f & FLAG_DROWNED) != 0
		c.on_ground = (f & FLAG_GROUND) != 0
		c.crouching = (f & FLAG_CROUCH) != 0
		c.fired = (f & FLAG_FIRED) != 0
		c.aim = lerp_angle(float(ca["a"]), float(cb["a"]), t)
		c.power = lerpf(ca["p"], cb["p"], t)
		c.facing = int(ca["d"])
		c.energy = float(ca["en"])
		c.weapon_id = ca["w"]
	var dt_ticks := render_tick - ta
	w.projectiles = []
	for pa in a["pr"]:
		var pb = null
		for x in b["pr"]:
			if x["id"] == pa["id"]:
				pb = x
		var p := NetProj.new()
		p.id = int(pa["id"])
		p.kind = pa["k"]
		p.drilling = pa.has("dr")
		if pb != null:
			p.x = lerpf(pa["x"], pb["x"], t)
			p.y = lerpf(pa["y"], pb["y"], t)
			p.vx = float(pb["vx"])
			p.vy = float(pb["vy"])
		else:
			p.x = float(pa["x"]) + float(pa["vx"]) * dt_ticks / _tick_rate
			p.y = float(pa["y"]) + float(pa["vy"]) * dt_ticks / _tick_rate
			p.vx = float(pa["vx"])
			p.vy = float(pa["vy"])
		w.projectiles.append(p)
	w.mines = _props(a["mn"], b["mn"], t, 5.0)
	w.barrels = _props(a["br"], b["br"], t, float(Spec.hazards["barrel"]["bodyRadius"]))


func _props(pa: Array, pb: Array, t: float, radius: float) -> Array:
	var out := []
	for m in pa:
		var n: Dictionary = m
		for x in pb:
			if x["id"] == m["id"]:
				n = x
		var p := NetProp.new()
		p.id = int(m["id"])
		p.x = lerpf(m["x"], n["x"], t)
		p.y = lerpf(m["y"], n["y"], t)
		p.st = int(m["st"])
		p.body_radius = radius
		out.append(p)
	return out


func send(cmd: Dictionary) -> String:
	_seq += 1
	if not Net.send({"t": "cmd", "seq": _seq, "c": cmd}):
		return "offline" if cmd["t"] == "fire" else ""
	return ""


func take_rejections() -> Array:
	var r := _rejected
	_rejected = []
	return r


func result():
	return _result


func status() -> String:
	if Net.state != "online":
		return "Connection lost. Reconnecting…"
	for s in slots:
		if s["kind"] == "remote" and not s["connected"]:
			var left := maxi(0, int(ceil(float(_grace.get(s["slot"], 0.0)) - Time.get_ticks_msec() / 1000.0)))
			return "%s disconnected. Waiting %ds for them to return…" % [s["name"], left]
	return ""
