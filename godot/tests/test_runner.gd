extends Node
## Headless test suite for the GDScript simulation. Exits non-zero on failure.
## Runs as a scene so autoloads (Spec, ...) load exactly as in the game:
##   godot --headless --path godot res://tests/test_runner.tscn

var passed := 0
var failed := 0
var fixtures: Dictionary


func _ready() -> void:
	await get_tree().process_frame
	fixtures = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures.json"))
	var tests := [
		"test_rng_matches_ts", "test_damage_and_launch_match_ts", "test_terrain_matches_ts", "test_payload_decode",
		"test_turn_flow", "test_movement_allowance", "test_fire_and_damage", "test_ammo_and_cooldown",
		"test_weapons", "test_water_death_and_result", "test_bots_take_turns", "test_bot_match_finishes",
	]
	for t in tests:
		var t0 := Time.get_ticks_msec()
		var ok = await call(t)
		if ok != true:
			failed += 1
			push_error("FAIL %s: did not finish (runtime error?)" % t)
		print("  %s (%d ms)" % [t, Time.get_ticks_msec() - t0])
	print("Results: %d passed, %d failed" % [passed, failed])
	get_tree().quit(1 if failed > 0 else 0)


func check(cond: bool, label: String) -> void:
	if cond:
		passed += 1
	else:
		failed += 1
		push_error("FAIL " + label)
		print("    FAIL " + label)


func eq(a, b, label: String) -> void:
	check(a == b, "%s: expected %s, got %s" % [label, b, a])


func near(a: float, b: float, tol: float, label: String) -> void:
	check(absf(a - b) <= tol, "%s: expected %s, got %s" % [label, b, a])


func make(map_id := "grasslands", seed_value := 1234, settings := {}) -> SimMatch:
	return SimMatch.new(map_id, seed_value, [{"name": "A", "species": "fox", "team": 0}, {"name": "B", "species": "bear", "team": 1}], settings)


func run_until(m: SimMatch, pred: Callable, max_seconds := 30.0) -> bool:
	var ticks := int(max_seconds * 60)
	for i in ticks:
		if pred.call():
			return true
		m.step()
	return pred.call()


func to_aim(m: SimMatch) -> void:
	m.start()
	run_until(m, func() -> bool: return m.phase == "aim")


func flat_arena(m: SimMatch, gap := 200.0, ground_y := 900) -> void:
	var t := m.terrain
	t.data.fill(0)
	for y in range(ground_y, t.height):
		for x in t.width:
			t.data[y * t.width + x] = 1
	m.barrels.clear()
	m.mines.clear()
	var r := float(Spec.character["radius"])
	for c in m.characters:
		c.x = t.width / 2.0 + (-gap / 2.0 if c.slot == 0 else gap / 2.0)
		c.y = ground_y - r - 1
		c.vx = 0
		c.vy = 0
		c.on_ground = true


# ------------------------------------------------------------------ cross-engine fidelity

func test_rng_matches_ts() -> bool:
	for seed_str in fixtures["rng"]:
		var r := Rng.new(int(seed_str))
		var expected: Array = fixtures["rng"][seed_str]
		for i in expected.size():
			near(r.next(), float(expected[i]), 1e-12, "rng seed %s #%d" % [seed_str, i])
	return true


func test_damage_and_launch_match_ts() -> bool:
	for d in fixtures["damage"]:
		eq(SimPhysics.damage_at(float(d["dist"]), Spec.weapon("rocket")), int(d["rocket"]), "rocket damage at %s" % d["dist"])
		eq(SimPhysics.damage_at(float(d["dist"]), Spec.weapon("heavy")), int(d["heavy"]), "heavy damage at %s" % d["dist"])
	for l in fixtures["launch"]:
		var got := SimPhysics.launch(500, 600, float(l["angle"]), float(l["power"]), Spec.weapon("rocket"))
		for k in ["x", "y", "vx", "vy"]:
			near(got[k], float(l[k]), 1e-9, "launch %s" % k)
	return true


func test_terrain_matches_ts() -> bool:
	var matched := 0
	for f in fixtures["terrain"]:
		var t := TerrainGen.generate(Spec.map_def(f["map"]), int(f["seed"]), int(Spec.world["width"]), int(Spec.world["height"]), float(Spec.world["waterLevel"]))
		var sum := t.checksum()
		if sum == f["sum"]:
			matched += 1
		else:
			print("    terrain %s/%s differs from TS (%s vs %s)" % [f["map"], f["seed"], sum, f["sum"]])
		var s: Array = f["surface"]
		for i in s.size():
			near(t.surface[i * 260], float(s[i]), 1.0, "surface %s/%s @%d" % [f["map"], f["seed"], i * 260])
	print("    %d/%d terrains bit-identical to the TS generator" % [matched, fixtures["terrain"].size()])
	check(matched == fixtures["terrain"].size(), "all generated terrains identical to TS")
	return true


func test_payload_decode() -> bool:
	var p: Dictionary = fixtures["payload"]
	var t := TerrainMask.from_payload(p)
	eq(t.checksum(), p["sum"], "decoded server terrain checksum")
	return true


# ------------------------------------------------------------------ rules

func test_turn_flow() -> bool:
	var m := make()
	m.start()
	eq(m.phase, "start", "starts in start phase")
	var s := m.active_slot
	eq(m.command(s, {"t": "fire", "weapon": "rocket", "angle": 0, "power": 1})["error"], "wrong-phase", "no fire before aim")
	run_until(m, func() -> bool: return m.phase == "aim", 2)
	eq(m.command(1 - s, {"t": "fire", "weapon": "rocket", "angle": 0, "power": 1})["error"], "not-your-turn", "other player rejected")
	check(m.command(s, {"t": "fire", "weapon": "rocket", "angle": -PI / 2, "power": 0.3})["ok"], "active can fire")
	eq(m.command(s, {"t": "fire", "weapon": "rocket", "angle": -1, "power": 0.3})["ok"], false, "second fire rejected")
	check(run_until(m, func() -> bool: return m.turn_number == 2, 30), "turn passes")
	eq(m.active_slot, 1 - s, "other player's turn")
	var m2 := make("grasslands", 5, {"turnTime": 15})
	to_aim(m2)
	var timed_out := run_until(m2, func() -> bool:
		for e in m2.take_events():
			if e["e"] == "timeUp":
				return true
		return false, 16)
	check(timed_out, "turn timer expires")
	return true


func test_movement_allowance() -> bool:
	var m := make()
	to_aim(m)
	flat_arena(m, 1200)
	var p := m.active()
	var x0 := p.x
	m.command(p.slot, {"t": "input", "move": 1, "up": false, "down": false})
	run_until(m, func() -> bool: return p.energy <= 0, 10)
	var walked := p.x - x0
	check(walked > 150 and walked < 225, "walked %s px on one bar of energy" % walked)
	check(m.command(p.slot, {"t": "jump"})["ok"] == false, "no jump without energy")
	return true


func test_fire_and_damage() -> bool:
	var m := make("grasslands", 1234, {"wind": "off"})
	to_aim(m)
	flat_arena(m, 150)
	var s := m.active_slot
	var a := m.characters[s]
	var b := m.characters[1 - s]
	m.command(s, {"t": "fire", "weapon": "rocket", "angle": atan2(b.y - a.y, b.x - a.x), "power": 1.0})
	var seen := {} # lambdas capture locals by value; mutate a dictionary instead
	run_until(m, func() -> bool:
		for e in m.take_events():
			if e["e"] == "carve":
				seen["carve"] = true
		return m.phase == "settle")
	var carved := seen.has("carve")
	check(b.hp <= 100 - 45, "direct rocket damages (hp %d)" % b.hp)
	check(carved, "explosion carves terrain")
	eq(a.stats["hits"], 1, "hit counted")
	return true


func test_ammo_and_cooldown() -> bool:
	var m := make()
	to_aim(m)
	var s := m.active_slot
	var p := m.characters[s]
	m.command(s, {"t": "fire", "weapon": "heavy", "angle": -PI / 2, "power": 0.2})
	eq(p.inventory["heavy"], int(Spec.weapon("heavy")["ammo"]) - 1, "ammo consumed")
	run_until(m, func() -> bool: return m.turn_number == 3 and m.phase == "aim", 60)
	eq(m.command(s, {"t": "fire", "weapon": "heavy", "angle": -1.5, "power": 0.2})["error"], "cooldown", "cooldown enforced")
	return true


func test_weapons() -> bool:
	# Grenade fuse, cluster bomblets, shotgun pellets, air strike, mine, teleport.
	var m := make("grasslands", 1, {"wind": "off"})
	to_aim(m)
	flat_arena(m, 600)
	var s := m.active_slot
	m.command(s, {"t": "fire", "weapon": "cluster", "angle": -PI / 2.5, "power": 0.5})
	var ids := {}
	run_until(m, func() -> bool:
		for e in m.take_events():
			if e["e"] == "explode":
				ids[e["id"]] = true
		return m.phase == "settle")
	check(ids.has("cluster") and ids.has("bomblet"), "cluster splits into bomblets")

	var m2 := make("grasslands", 2)
	to_aim(m2)
	flat_arena(m2, 120)
	m2.command(m2.active_slot, {"t": "fire", "weapon": "shotgun", "angle": -0.3, "power": 0.1})
	eq(m2.projectiles.size(), int(Spec.weapon("shotgun")["pellets"]), "shotgun pellets")

	var m3 := make("grasslands", 3)
	to_aim(m3)
	flat_arena(m3, 400)
	var t := m3.characters[1 - m3.active_slot]
	check(m3.command(m3.active_slot, {"t": "fire", "weapon": "airstrike", "angle": 0, "power": 1, "tx": t.x, "ty": t.y})["ok"], "air strike accepted")
	eq(m3.projectiles.size(), int(Spec.weapon("airstrike")["count"]), "air strike bombs")
	var hp := t.hp
	run_until(m3, func() -> bool: return m3.phase == "settle")
	check(t.hp < hp, "air strike damages target")

	var m4 := make("grasslands", 4, {"wind": "off"})
	to_aim(m4)
	flat_arena(m4, 700)
	var s4 := m4.active_slot
	m4.command(s4, {"t": "fire", "weapon": "mine", "angle": -PI / 2 + (0.4 if s4 == 0 else -0.4), "power": 0.35})
	check(run_until(m4, func() -> bool: return m4.mines.size() == 1, 8), "thrown mine settles")
	var mine: SimProp = m4.mines[0]
	check(run_until(m4, func() -> bool: return mine.armed(), 3), "mine arms")

	var m5 := make("grasslands", 5)
	to_aim(m5)
	flat_arena(m5)
	eq(m5.command(m5.active_slot, {"t": "fire", "weapon": "teleport", "angle": 0, "power": 1, "tx": 1300, "ty": 1290})["error"], "blocked-target", "teleport into ground rejected")
	check(m5.command(m5.active_slot, {"t": "fire", "weapon": "teleport", "angle": 0, "power": 1, "tx": 500, "ty": 600})["ok"], "teleport to open air")
	return true


func test_water_death_and_result() -> bool:
	var m := make()
	to_aim(m)
	var loser := m.characters[1]
	loser.x = 5
	loser.y = float(Spec.world["waterLevel"]) + 20
	loser.on_ground = false
	check(run_until(m, func() -> bool: return m.phase == "over", 30), "match ends")
	eq(m.result["winnerTeam"], 0, "team 0 wins")
	var m2 := make()
	to_aim(m2)
	m2.forfeit(0)
	eq(m2.result["winnerTeam"], 1, "forfeit gives win to other team")
	return true


func test_bots_take_turns() -> bool:
	for level in ["easy", "normal", "hard"]:
		for map in Spec.maps:
			var m := make(map["id"], 3, {"turnTime": 30})
			to_aim(m)
			var s := m.active_slot
			var bot := SimBot.new(level, 3)
			var shot := {}
			var t0 := Time.get_ticks_msec()
			run_until(m, func() -> bool:
				for c in bot.update(1.0 / 60.0, m, s, 1000000):
					var r := m.command(s, c)
					if c["t"] == "fire":
						shot["ok"] = r["ok"]
				return m.phase != "aim", 31)
			check(shot.get("ok", false), "%s bot fires on %s" % [level, map["id"]])
			if level == "hard" and map["id"] == "grasslands":
				print("    hard bot planned + fired in %d ms of CPU" % (Time.get_ticks_msec() - t0))
	return true


func test_bot_match_finishes() -> bool:
	var m := SimMatch.new("jungle", 77, [{"name": "B0", "species": "fox", "team": 0}, {"name": "B1", "species": "cat", "team": 1}], {"turnTime": 30})
	var bots := [SimBot.new("normal", 1), SimBot.new("hard", 2)]
	m.start()
	var i := 0
	while m.phase != "over" and i < 60 * 1500:
		var s := m.active_slot
		for c in bots[s].update(1.0 / 60.0, m, s, 1000000):
			m.command(s, c)
		m.step()
		i += 1
	eq(m.phase, "over", "bot vs bot match finishes")
	eq(m.projectiles.size(), 0, "no leaked projectiles")
	print("    finished in %d turns" % m.turn_number)
	return true
