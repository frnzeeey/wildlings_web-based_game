extends Node
## Screens and match lifecycle for the native client (mirrors web/src/ui/App.ts).

var ui_layer := CanvasLayer.new()
var ui_root := Control.new()
var modal_layer := CanvasLayer.new()
var modal_root := Control.new()
var battle: Battle = null
var hud: Hud = null
var session = null
var screen := "main"
var room = null
var notice := ""
var queued_players := 0
var paused := false
var _last_local: Callable
var _join_code := ""


func _ready() -> void:
	ui_layer.layer = 10
	add_child(ui_layer)
	ui_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui_root.theme = UI.make_theme()
	ui_layer.add_child(ui_root)
	modal_layer.layer = 20
	add_child(modal_layer)
	modal_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	modal_root.theme = UI.make_theme()
	modal_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	modal_layer.add_child(modal_root)
	Net.message.connect(_on_net)
	Net.state_changed.connect(func(_s: String) -> void:
		if session == null and screen in ["online", "room", "queue"]:
			show_screen(screen))
	get_tree().root.close_requested.connect(Settings.save_all)
	show_screen("main")
	# Automation hooks: --auto=bot runs a bot match, --auto=quick joins quick match.
	var args := Array(OS.get_cmdline_user_args())
	args.sort_custom(func(a: String, b: String) -> bool: return not a.begins_with("--auto") and b.begins_with("--auto"))
	for arg in args:
		if arg == "--auto=bot":
			Settings.setup["mode"] = "bots"
			_start_local()
		elif arg == "--auto=quick":
			show_screen("online")
			_auto_quick = true
		elif arg.begins_with("--join="):
			_join_code = arg.substr(7)
			show_screen("online")
		elif arg.begins_with("--screen="):
			show_screen(arg.substr(9))
		elif arg.begins_with("--map="):
			Settings.setup["mapId"] = arg.substr(6)
		elif arg.begins_with("--shot="):
			_shot_path = arg.substr(7)
		elif arg.begins_with("--shot-delay="):
			_shot_delay = float(arg.substr(13))
		elif arg == "--autoplay":
			autoplay = true
		elif arg.begins_with("--resign-after="):
			resign_after = int(arg.substr(15))
		elif arg.begins_with("--quit-after="):
			get_tree().create_timer(float(arg.substr(13))).timeout.connect(func() -> void: get_tree().quit(0))
	if _shot_path != "":
		get_tree().create_timer(_shot_delay).timeout.connect(_take_shot)


var _auto_quick := false
var _shot_path := ""
var _shot_delay := 3.0
## Automation: the local player fires at the nearest enemy on each turn (cross-client tests).
var autoplay := false
var resign_after := 0
var _resigned := false


func _take_shot() -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.save_png(_shot_path)
	print("screenshot saved: ", _shot_path)
	get_tree().quit(0)


func _process(dt: float) -> void:
	if resign_after > 0 and not _resigned and session != null and session.online and session.world.turn_number >= resign_after:
		_resigned = true
		print("AUTOMATION: resigning at turn %d" % session.world.turn_number)
		Net.send({"t": "resign"})
	for n in get_tree().get_nodes_in_group("critter_previews"):
		if n.has_meta("tick"):
			n.get_meta("tick").call(dt)
	if _auto_quick and Net.state == "online":
		_auto_quick = false
		Net.send({"t": "queue"})
	if _join_code != "" and Net.state == "online":
		Net.send({"t": "joinRoom", "code": _join_code})
		_join_code = ""


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") and session != null:
		_toggle_pause()


func _clear(node: Node) -> void:
	for c in node.get_children():
		c.queue_free()


func _menu_bg() -> void:
	var sky := TextureRect.new()
	var g := GradientTexture2D.new()
	g.gradient = Gradient.new()
	g.gradient.set_color(0, Color("#2f8be6"))
	g.gradient.set_color(1, Color("#c4ecff"))
	g.fill_to = Vector2(0, 1)
	sky.texture = g
	sky.set_anchors_preset(Control.PRESET_FULL_RECT)
	sky.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	ui_root.add_child(sky)
	# Menu scenery: the Grasslands parallax layers drifting slowly (same as the web menus).
	var vp := get_viewport().get_visible_rect().size
	var drops := [0.22, 0.34, 0.48]
	for i in 3:
		var tex := Art.texture("bg_grasslands_%s" % ["far", "mid", "near"][i])
		var layer := TextureRect.new()
		layer.texture = tex
		layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
		layer.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		var w := vp.x * 1.4
		layer.size = Vector2(w, w * 1300.0 / 4600.0)
		layer.position = Vector2(-vp.x * 0.1, vp.y - layer.size.y + vp.y * drops[i])
		ui_root.add_child(layer)
		var tw := layer.create_tween().set_loops()
		tw.tween_property(layer, "position:x", layer.position.x - w * 0.06, 60.0 - i * 10.0).set_trans(Tween.TRANS_SINE)
		tw.tween_property(layer, "position:x", layer.position.x, 60.0 - i * 10.0).set_trans(Tween.TRANS_SINE)


func show_screen(name: String) -> void:
	if session != null:
		_end_session()
	screen = name
	if name in ["online", "room", "queue"] and Net.state == "offline":
		Net.connect_to_server(Settings.roster[0]["name"], Settings.roster[0]["species"])
	_clear(ui_root)
	ui_layer.visible = true
	_menu_bg()
	match name:
		"main": _main_screen()
		"mode": _mode_screen()
		"bots": _setup_screen("bots")
		"local": _setup_screen("local")
		"characters": _characters_screen()
		"settings": _settings_screen()
		"howto": _howto_screen()
		"online": _online_screen()
		"queue": _queue_screen()
		"room": _room_screen()


func _refresh() -> void:
	show_screen(screen)


# ------------------------------------------------------------------ screens

func _main_screen() -> void:
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_CENTER)
	v.grow_horizontal = Control.GROW_DIRECTION_BOTH
	v.grow_vertical = Control.GROW_DIRECTION_BOTH
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", 14)
	ui_root.add_child(v)
	var logo := TextureRect.new()
	logo.texture = Art.texture_at("logo", 1.0)
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.custom_minimum_size = Vector2(560, 196)
	logo.pivot_offset = Vector2(280, 98)
	var tw := logo.create_tween().set_loops()
	tw.tween_property(logo, "position:y", -6.0, 1.5).set_trans(Tween.TRANS_SINE)
	tw.tween_property(logo, "position:y", 0.0, 1.5).set_trans(Tween.TRANS_SINE)
	var logo_box := CenterContainer.new()
	logo_box.add_child(logo)
	v.add_child(logo_box)
	var parade := HBoxContainer.new()
	parade.alignment = BoxContainer.ALIGNMENT_CENTER
	parade.add_theme_constant_override("separation", 22)
	for i in 4:
		parade.add_child(UI.critter(Settings.roster[i]["species"], i, 2.4, "rocket" if i == 0 else "", 1 if i < 2 else -1))
	v.add_child(parade)
	var play := UI.button("Play", func() -> void: show_screen("mode"), true, 24)
	play.custom_minimum_size = Vector2(260, 56)
	var row0 := UI.actions(v)
	row0.add_child(play)
	var row1 := UI.actions(v)
	row1.add_child(UI.button("VS Bot", func() -> void: show_screen("bots")))
	row1.add_child(UI.button("Online PvP", func() -> void: show_screen("online")))
	var row2 := UI.actions(v)
	row2.add_child(UI.button("Characters", func() -> void: show_screen("characters")))
	row2.add_child(UI.button("Settings", func() -> void: show_screen("settings")))
	row2.add_child(UI.button("How to Play", func() -> void: show_screen("howto")))
	var hint := UI.outlined("A/D walk  ·  W climb  ·  S steady  ·  Space jump  ·  Mouse aim  ·  Click fire  ·  E/Q weapons", 14, Color.WHITE, 5)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(hint)


func _mode_screen() -> void:
	var v := UI.panel(ui_root, "Choose a Mode", 860)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 14)
	v.add_child(h)
	for card in [["bots", "VS Bot", "Battle up to three computer critters.", "icon_rocket"], ["online", "Online PvP", "Quick Match or a private room with friends.", "icon_airstrike"], ["local", "Local Party", "2–4 players take turns on this computer.", "icon_cluster"]]:
		h.add_child(_mode_card(card[1], card[2], card[3], func() -> void: show_screen(card[0])))
	UI.actions(v).add_child(UI.button("Back", func() -> void: show_screen("main")))


func _mode_card(title: String, desc: String, icon: String, cb: Callable) -> Button:
	var b := Button.new()
	b.custom_minimum_size = Vector2(250, 196)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var st := UI.kit("card_light", 18)
	for k in ["normal", "hover", "pressed", "disabled"]:
		b.add_theme_stylebox_override(k, st)
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ic := Art.icon(icon, 56)
	ic.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(ic)
	var t := UI.label(title, 23, UI.INK)
	t.add_theme_font_override("font", UI.display())
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	t.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(t)
	var d := UI.label(desc, 14, UI.CARD_TEXT, false)
	d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	d.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	d.custom_minimum_size = Vector2(220, 0)
	d.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(d)
	b.add_child(v)
	b.pressed.connect(func() -> void:
		Sfx.play("ui")
		cb.call())
	UI.hover_lift(b)
	return b


func _map_grid(current: String, on_pick: Callable, disabled := false) -> GridContainer:
	var g := GridContainer.new()
	g.columns = 6
	g.add_theme_constant_override("h_separation", 8)
	for m in Spec.maps:
		var id: String = m["id"]
		g.add_child(UI.map_card(m, current == id, func() -> void: on_pick.call(id), disabled))
	g.add_child(UI.map_card({"name": "Random"}, current == "random", func() -> void: on_pick.call("random"), disabled))
	return g


func _rules_fields(v: VBoxContainer, rules: Dictionary, on_set: Callable, disabled := false) -> void:
	var times: Array = []
	for t in Spec.turn["timeOptions"]:
		times.append([int(t), "%ds" % int(t) if int(t) > 0 else "∞"])
	v.add_child(UI.field("Turn timer", UI.seg(times, int(rules["turnTime"]), func(x) -> void: on_set.call("turnTime", int(x)), disabled)))
	v.add_child(UI.field("Wind", UI.seg([["off", "Off"], ["low", "Low"], ["normal", "Normal"], ["high", "High"]], rules["wind"], func(x) -> void: on_set.call("wind", x), disabled)))
	var hps: Array = []
	for h in Spec.rules["match"]["startHPOptions"]:
		hps.append([int(h), str(int(h))])
	v.add_child(UI.field("Starting HP", UI.seg(hps, int(rules["startHP"]), func(x) -> void: on_set.call("startHP", int(x)), disabled)))
	v.add_child(UI.field("Sudden death", UI.seg([[true, "On"], [false, "Off"]], rules["suddenDeath"], func(x) -> void: on_set.call("suddenDeath", x), disabled)))


func _set_rule(key: String, value) -> void:
	Settings.match_rules[key] = value
	Settings.save_all()
	_refresh()


func _setup_screen(mode: String) -> void:
	Settings.setup["mode"] = mode
	var v := UI.panel(ui_root, "VS Bot" if mode == "bots" else "Local Party", 860)
	var count := int(Settings.setup["count"])
	var opts := [[2, "1 bot"], [3, "2 bots"], [4, "3 bots"]] if mode == "bots" else [[2, "2"], [3, "3"], [4, "4"]]
	v.add_child(UI.field("Critters" if mode == "bots" else "Players", UI.seg(opts, count, func(x) -> void:
		Settings.setup["count"] = int(x)
		_refresh())))
	if mode == "bots":
		v.add_child(UI.field("Bot skill", UI.seg([["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]], Settings.setup["difficulty"], func(x) -> void:
			Settings.setup["difficulty"] = x
			_refresh())))
	v.add_child(UI.label("Battlefield", 17))
	v.add_child(_map_grid(Settings.setup["mapId"], func(id: String) -> void:
		Settings.setup["mapId"] = id
		_refresh()))
	_rules_fields(v, Settings.match_rules, _set_rule)
	var lineup := HBoxContainer.new()
	lineup.alignment = BoxContainer.ALIGNMENT_CENTER
	lineup.add_theme_constant_override("separation", 18)
	for i in count:
		var col := VBoxContainer.new()
		col.add_child(UI.critter(Settings.roster[i]["species"], i, 1.5, "", -1 if i > 0 else 1))
		var l := UI.label(Settings.roster[i]["name"], 15)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		col.add_child(l)
		var tag := ("You" if i == 0 else "Bot · %s" % Settings.setup["difficulty"]) if mode == "bots" else "Player %d" % (i + 1)
		var tl := UI.label(tag, 12, UI.INK_SOFT, false)
		tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		col.add_child(tl)
		lineup.add_child(col)
	v.add_child(lineup)
	var a := UI.actions(v)
	a.add_child(UI.button("Back", func() -> void: show_screen("mode")))
	a.add_child(UI.button("Edit Critters", func() -> void: show_screen("characters")))
	a.add_child(UI.button("Start Battle!", _start_local, true))


func _characters_screen() -> void:
	var v := UI.panel(ui_root, "Choose Your Critters", 900)
	var sub := UI.label("Slot 1 is you (online and vs bots). Every critter has the same stats.", 15, UI.INK_SOFT, false)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(sub)
	var grid := HBoxContainer.new()
	grid.add_theme_constant_override("separation", 12)
	v.add_child(grid)
	for i in 4:
		var card := PanelContainer.new()
		card.add_theme_stylebox_override("panel", UI.kit("card_light", 16, Vector4(8, 8, 8, 12)))
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var cv := VBoxContainer.new()
		cv.alignment = BoxContainer.ALIGNMENT_CENTER
		card.add_child(cv)
		var slot_l := UI.label("You" if i == 0 else "Player %d" % (i + 1), 15, Spec.team_color(i).darkened(0.2))
		slot_l.add_theme_font_override("font", UI.display())
		slot_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		cv.add_child(slot_l)
		var stage := CenterContainer.new()
		stage.add_child(UI.critter(Settings.roster[i]["species"], i, 2.6, "rocket"))
		cv.add_child(stage)
		var pick := HBoxContainer.new()
		pick.alignment = BoxContainer.ALIGNMENT_CENTER
		var idx := i
		pick.add_child(UI.button("◀", func() -> void: _cycle_species(idx, -1)))
		var nm := UI.label(Spec.character_def(Settings.roster[i]["species"])["name"], 16, UI.INK)
		nm.custom_minimum_size = Vector2(70, 0)
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		pick.add_child(nm)
		pick.add_child(UI.button("▶", func() -> void: _cycle_species(idx, 1)))
		cv.add_child(pick)
		var le := LineEdit.new()
		le.text = Settings.roster[i]["name"]
		le.max_length = 16
		le.alignment = HORIZONTAL_ALIGNMENT_CENTER
		le.text_changed.connect(func(t: String) -> void:
			Settings.roster[idx]["name"] = t
			Settings.save_all()
			if idx == 0:
				Net.set_profile(t, Settings.roster[0]["species"]))
		cv.add_child(le)
		grid.add_child(card)
	var a := UI.actions(v)
	a.add_child(UI.button("Main Menu", func() -> void: show_screen("main")))
	a.add_child(UI.button("Play", func() -> void: show_screen("mode"), true))


func _cycle_species(slot: int, dir: int) -> void:
	var ids: Array = Spec.characters.map(func(c: Dictionary) -> String: return c["id"])
	var i := ids.find(Settings.roster[slot]["species"])
	Settings.roster[slot]["species"] = ids[posmod(i + dir, ids.size())]
	Settings.save_all()
	if slot == 0:
		Net.set_profile(Settings.roster[0]["name"], Settings.roster[0]["species"])
	_refresh()


func _settings_screen() -> void:
	var v := UI.panel(ui_root, "Settings", 720)
	v.add_child(UI.label("Match rules (offline & rooms you host)", 17, UI.INK_SOFT))
	_rules_fields(v, Settings.match_rules, _set_rule)
	v.add_child(UI.label("Controls & display", 17, UI.INK_SOFT))
	var c: Dictionary = Settings.client
	var set_c := func(key: String, value) -> void:
		Settings.client[key] = value
		Settings.save_all()
		if key == "musicVolume":
			Sfx.set_music_volume(float(value))
		_refresh()
	v.add_child(UI.field("Mouse wheel", UI.seg([["weapon", "Switch weapon"], ["power", "Adjust power"]], c["wheelMode"], func(x) -> void: set_c.call("wheelMode", x))))
	v.add_child(UI.field("Aim guide", UI.seg([[true, "On"], [false, "Off"]], c["aimGuide"], func(x) -> void: set_c.call("aimGuide", x))))
	v.add_child(UI.field("Screen shake", UI.seg([[true, "On"], [false, "Off"]], c["screenShake"], func(x) -> void: set_c.call("screenShake", x))))
	v.add_child(UI.field("Zoom", UI.seg([[0.75, "Far"], [1.0, "Normal"], [1.3, "Close"]], c["zoom"], func(x) -> void: set_c.call("zoom", x))))
	v.add_child(UI.field("Window", UI.seg([["windowed", "Windowed"], ["fullscreen", "Fullscreen"]], "fullscreen" if DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN else "windowed", func(x) -> void:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if x == "fullscreen" else DisplayServer.WINDOW_MODE_WINDOWED)
		_refresh())))
	v.add_child(UI.label("Audio", 17, UI.INK_SOFT))
	v.add_child(UI.field("Sound effects", UI.seg([[0.0, "Off"], [0.35, "Low"], [0.7, "Normal"], [1.0, "Loud"]], c["sfxVolume"], func(x) -> void: set_c.call("sfxVolume", x))))
	v.add_child(UI.field("Music", UI.seg([[0.0, "Off"], [0.2, "Low"], [0.35, "Normal"], [0.6, "Loud"]], c["musicVolume"], func(x) -> void: set_c.call("musicVolume", x))))
	v.add_child(UI.label("Online server", 17, UI.INK_SOFT))
	var le := LineEdit.new()
	le.text = Settings.server_url
	le.custom_minimum_size = Vector2(360, 0)
	le.text_submitted.connect(func(t: String) -> void:
		Settings.server_url = t.strip_edges()
		Settings.save_all()
		Net.disconnect_from_server())
	le.focus_exited.connect(func() -> void:
		if le.text.strip_edges() != Settings.server_url:
			Settings.server_url = le.text.strip_edges()
			Settings.save_all()
			Net.disconnect_from_server())
	v.add_child(UI.field("Server URL", le))
	UI.actions(v).add_child(UI.button("Done", func() -> void: show_screen("main"), true))


func _howto_screen() -> void:
	var v := UI.panel(ui_root, "How to Play", 900)
	var rt := RichTextLabel.new()
	rt.bbcode_enabled = true
	rt.fit_content = true
	rt.custom_minimum_size = Vector2(840, 0)
	rt.add_theme_font_override("normal_font", UI.font(false))
	rt.add_theme_font_override("bold_font", UI.font(true))
	rt.add_theme_font_size_override("normal_font_size", 16)
	rt.add_theme_font_size_override("bold_font_size", 16)
	rt.add_theme_color_override("default_color", UI.TEXT)
	var t := "Take turns with your opponents. On your turn you can [b]walk[/b], [b]climb[/b] and [b]jump[/b] while your [b]Move[/b] energy lasts, then fire [b]one[/b] weapon. Knock everyone else out, or into the water, to win.\n\n"
	t += "[b]Controls[/b]\n• A / D walk (uses energy)   • W hold to climb steep slopes (costs more)\n• S hold to steady your aim: longer guide that accounts for wind, plus an impact marker\n• Space jump   • Mouse aim: distance from your critter sets the power   • Left click fire\n• E / Q, mouse wheel or 1–9 switch weapon   • Right-drag pan   • + / - zoom   • Esc menu\n\n"
	t += "[b]Weapons[/b]\n"
	for w in Spec.weapons:
		var ammo := "∞" if int(w["ammo"]) < 0 else "×%d" % int(w["ammo"])
		var cd := " · %d-turn cooldown" % int(w["cooldown"]) if int(w["cooldown"]) > 0 else ""
		t += "• [b]%s[/b] (%s%s): %s\n" % [w["name"], ammo, cd, w["desc"]]
	t += "\n[b]Tips[/b]\n• Wind changes every turn. Rockets ride it, shotgun pellets ignore it.\n• Falls hurt. Water and lava are an instant knock-out.\n• Red barrels explode when hit. Mines blink red when armed.\n• After turn %d, sudden death raises the water every turn." % int(Spec.rules["suddenDeath"]["startTurn"])
	rt.text = t
	v.add_child(rt)
	UI.actions(v).add_child(UI.button("Got it!", func() -> void: show_screen("main"), true))


func _conn_text() -> String:
	match Net.state:
		"online":
			return "● Connected · %d ms" % int(Net.rtt) if Net.rtt > 0 else "● Connected"
		"connecting":
			return "● Connecting…"
		"reconnecting":
			return "● Reconnecting…"
	return "● Offline"


func _online_screen() -> void:
	var v := UI.panel(ui_root, "Online PvP", 860)
	var head := HBoxContainer.new()
	head.alignment = BoxContainer.ALIGNMENT_CENTER
	head.add_theme_constant_override("separation", 16)
	head.add_child(UI.critter(Settings.roster[0]["species"], 0, 1.6))
	var hv := VBoxContainer.new()
	var le := LineEdit.new()
	le.text = Settings.roster[0]["name"]
	le.max_length = 16
	le.custom_minimum_size = Vector2(220, 0)
	le.text_changed.connect(func(t: String) -> void:
		Settings.roster[0]["name"] = t
		Settings.save_all()
		Net.set_profile(t, Settings.roster[0]["species"]))
	hv.add_child(le)
	hv.add_child(UI.label(_conn_text(), 14, Color("#1d6b17") if Net.state == "online" else Color("#8a6400")))
	head.add_child(hv)
	head.add_child(UI.button("Change critter", func() -> void: show_screen("characters")))
	v.add_child(head)
	if notice != "" or (Net.last_error != "" and Net.state != "online"):
		var n := UI.label(notice if notice != "" else Net.last_error, 15, Color("#b42424"))
		n.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		n.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		v.add_child(n)
	var ok := Net.state == "online"
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 14)
	v.add_child(h)
	var q := _mode_card("Quick Match", "Get paired with the next available player.", "icon_rocket", func() -> void:
		notice = ""
		Net.send({"t": "queue"}))
	q.disabled = not ok
	h.add_child(q)
	var c := _mode_card("Private Room", "Create a room and share its code with a friend.", "icon_grenade", func() -> void:
		notice = ""
		var map_id: String = Settings.setup["mapId"]
		Net.send({"t": "createRoom", "mapId": map_id, "settings": Settings.match_rules}))
	c.disabled = not ok
	h.add_child(c)
	var join := VBoxContainer.new()
	join.alignment = BoxContainer.ALIGNMENT_CENTER
	join.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	join.add_child(Art.icon("icon_teleport", 56))
	var jl := UI.label("Join Room", 21)
	jl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	join.add_child(jl)
	var code := LineEdit.new()
	code.placeholder_text = "CODE"
	code.max_length = 5
	code.alignment = HORIZONTAL_ALIGNMENT_CENTER
	code.add_theme_font_size_override("font_size", 22)
	join.add_child(code)
	var do_join := func() -> void:
		var cv := code.text.strip_edges().to_upper()
		if cv.length() < 4:
			notice = "Enter the 5-letter room code"
			_refresh()
			return
		notice = ""
		Net.send({"t": "joinRoom", "code": cv})
	code.text_submitted.connect(func(_t: String) -> void: do_join.call())
	var jb := UI.button("Join", do_join)
	jb.disabled = not ok
	join.add_child(jb)
	h.add_child(join)
	UI.actions(v).add_child(UI.button("Back", func() -> void: show_screen("main")))


func _queue_screen() -> void:
	var v := UI.panel(ui_root, "Finding an opponent…", 600)
	var c := CenterContainer.new()
	c.add_child(UI.critter(Settings.roster[0]["species"], 0, 2.2))
	v.add_child(c)
	var l := UI.label("%d players searching" % queued_players if queued_players > 1 else "Waiting for another player to join the queue.", 15, UI.INK_SOFT, false)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(l)
	UI.actions(v).add_child(UI.button("Cancel", func() -> void:
		Net.send({"t": "unqueue"})
		show_screen("online")))


func _room_screen() -> void:
	if room == null:
		_online_screen()
		return
	var r: Dictionary = room
	var me: Dictionary = {}
	for m in r["members"]:
		if m["id"] == Net.player_id:
			me = m
	var host: bool = me.get("host", false) and not r["quick"]
	var v := UI.panel(ui_root, "Match Found" if r["quick"] else "Private Room", 900)
	if not r["quick"]:
		var ch := HBoxContainer.new()
		ch.alignment = BoxContainer.ALIGNMENT_CENTER
		ch.add_theme_constant_override("separation", 14)
		ch.add_child(UI.label("Room code", 16))
		var code := UI.label(r["code"], 40)
		code.add_theme_stylebox_override("normal", UI.box(UI.PLUM_DEEP, UI.ACCENT, 3, 14, 0))
		code.add_theme_color_override("font_color", UI.ACCENT)
		code.add_theme_font_override("font", UI.display())
		ch.add_child(code)
		ch.add_child(UI.button("Copy code", func() -> void:
			DisplayServer.clipboard_set(r["code"])
			notice = "Room code copied to the clipboard"
			_refresh()))
		v.add_child(ch)
	if notice != "":
		var n := UI.label(notice, 15, Color("#1d6b17"))
		n.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(n)
	var members := HBoxContainer.new()
	members.add_theme_constant_override("separation", 12)
	v.add_child(members)
	var i := 0
	for m in r["members"]:
		var card := PanelContainer.new()
		card.add_theme_stylebox_override("panel", UI.kit("card", 16, Vector4(10, 8, 10, 12)))
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var mh := HBoxContainer.new()
		mh.add_theme_constant_override("separation", 12)
		card.add_child(mh)
		mh.add_child(UI.critter(m["species"], i, 1.4, "", -1 if i % 2 else 1))
		var mv := VBoxContainer.new()
		mv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		mv.add_child(UI.label(m["name"] + (" (you)" if m["id"] == Net.player_id else ""), 17))
		var info := ("Host · " if m["host"] else "") + ("Desktop" if m["client"] == "godot" else "Browser") + ("" if m["connected"] else " · disconnected")
		mv.add_child(UI.label(info, 13, UI.INK_SOFT, false))
		mh.add_child(mv)
		mh.add_child(UI.label("Ready!" if m["ready"] else "Not ready", 16, Color("#8dff8a") if m["ready"] else UI.INK_SOFT))
		members.add_child(card)
		i += 1
	if r["members"].size() < 2:
		var empty := UI.label("Waiting for a friend… share the code", 16, UI.INK_SOFT)
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		empty.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		members.add_child(empty)
	v.add_child(UI.label("Battlefield" + ("" if host else "  (host picks)"), 17))
	v.add_child(_map_grid(r["mapId"], func(id: String) -> void: Net.send({"t": "roomConfig", "mapId": id}), not host))
	_rules_fields(v, r["settings"], func(key: String, value) -> void: Net.send({"t": "roomConfig", "settings": {key: value}}), not host)
	var a := UI.actions(v)
	a.add_child(UI.button("Leave", func() -> void:
		Net.send({"t": "leaveRoom"})
		room = null
		show_screen("online")))
	a.add_child(UI.button("Not ready" if me.get("ready", false) else "I'm ready!", func() -> void: Net.send({"t": "ready", "ready": not me.get("ready", false)}), true))
	var cl := UI.label(_conn_text(), 14, Color("#1d6b17"))
	cl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(cl)


# ------------------------------------------------------------------ matches

func _start_local() -> void:
	var mode: String = Settings.setup["mode"]
	var count := int(Settings.setup["count"])
	var difficulty: String = Settings.setup["difficulty"]
	var map_id: String = Settings.setup["mapId"]
	_last_local = func() -> LocalSession:
		var m := map_id if map_id != "random" else String(Spec.maps[randi() % Spec.maps.size()]["id"])
		var players := []
		for i in count:
			var r: Dictionary = Settings.roster[i]
			players.append({"name": r["name"] if r["name"] != "" else "Player %d" % (i + 1), "species": r["species"], "team": i, "bot": difficulty if mode == "bots" and i > 0 else ""})
		return LocalSession.new(m, randi() & 0x7fffffff, players, Settings.match_rules.duplicate())
	_run_session(_last_local.call())


func _run_session(s) -> void:
	if session != null:
		_end_session()
	_close_modal()
	_clear(ui_root)
	ui_layer.visible = false
	session = s
	paused = false
	battle = Battle.new()
	battle.autoplay = autoplay
	add_child(battle)
	battle.setup(s)
	battle.game_over.connect(_show_results)
	hud = Hud.new()
	add_child(hud)
	hud.setup(battle)
	hud.pause_pressed.connect(_toggle_pause)
	Sfx.start_music()


func _end_session() -> void:
	get_tree().paused = false
	if battle:
		battle.queue_free()
		battle = null
	if hud:
		hud.queue_free()
		hud = null
	if session:
		session.dispose()
		session = null
	_close_modal()


func _close_modal() -> void:
	_clear(modal_root)
	modal_root.mouse_filter = Control.MOUSE_FILTER_IGNORE


func _modal_panel(title: String, width := 560.0) -> VBoxContainer:
	_clear(modal_root)
	modal_root.mouse_filter = Control.MOUSE_FILTER_STOP
	var shade := ColorRect.new()
	shade.color = Color(0.1, 0.07, 0.15, 0.55)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	modal_root.add_child(shade)
	return UI.panel(modal_root, title, width)


func _toggle_pause() -> void:
	if session == null:
		return
	paused = not paused
	if not session.online:
		battle.process_mode = Node.PROCESS_MODE_DISABLED if paused else Node.PROCESS_MODE_INHERIT
	if not paused:
		_close_modal()
		return
	var v := _modal_panel("Menu" if session.online else "Paused")
	if session.online:
		var s := UI.label("The match keeps running while this menu is open.", 14, UI.INK_SOFT, false)
		s.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(s)
	for pair in [["Sound", "sfxVolume"], ["Music", "musicVolume"]]:
		var sl := HSlider.new()
		sl.custom_minimum_size = Vector2(240, 24)
		sl.max_value = 1.0
		sl.step = 0.05
		sl.value = float(Settings.client[pair[1]])
		var key: String = pair[1]
		sl.value_changed.connect(func(x: float) -> void:
			Settings.client[key] = x
			if key == "musicVolume":
				Sfx.set_music_volume(x)
			Settings.save_all())
		v.add_child(UI.field(pair[0], sl))
	var a := UI.actions(v)
	a.add_child(UI.button("Resume", _toggle_pause, true))
	if session.online:
		a.add_child(UI.button("Resign", func() -> void:
			Net.send({"t": "resign"})
			paused = false
			_close_modal()))
	a.add_child(UI.button("Leave match" if session.online else "Quit to menu", _quit))


func _quit() -> void:
	var was_online: bool = session != null and session.online
	_end_session()
	if was_online or room != null:
		Net.send({"t": "leaveRoom"})
		room = null
		show_screen("online")
	else:
		show_screen("main")


func _show_results(r: Dictionary) -> void:
	paused = false
	if session == null:
		return
	if autoplay:
		var me_slot: int = session.you if session.online else 0
		print("RESULT ", JSON.stringify({"won": r["winners"].has(float(me_slot)) or r["winners"].has(me_slot), "turns": r["turns"], "winners": r["winners"], "you": me_slot, "sum": session.world.terrain.checksum()}))
	var winners: Array = r["winners"]
	var names: Array = []
	for w in winners:
		for p in r["players"]:
			if int(p["slot"]) == int(w):
				names.append(p["name"])
	var title := "%s wins!" % " & ".join(names) if not names.is_empty() else "It's a draw!"
	if session.online:
		title = "Victory!" if winners.has(float(session.you)) or winners.has(session.you) else "Defeat"
	var v := _modal_panel(title, 680)
	if not winners.is_empty():
		var wc = session.world.characters[int(winners[0])]
		var c := CenterContainer.new()
		c.add_child(UI.critter(wc.species, wc.team, 2.4))
		v.move_child(c, 0)
		v.add_child(c)
		v.move_child(c, 0)
	var dur := int(r["duration"])
	var sub := UI.label("%s · %d turns · %d:%02d" % [Spec.map_def(r["map"])["name"], int(r["turns"]), dur / 60, dur % 60], 15, UI.INK_SOFT, false)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(sub)
	var grid := GridContainer.new()
	grid.columns = 6
	grid.add_theme_constant_override("h_separation", 22)
	for h in ["Critter", "Damage", "KOs", "Shots", "Accuracy", "Status"]:
		grid.add_child(UI.label(h, 14, UI.INK_SOFT))
	var players: Array = r["players"].duplicate()
	players.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var wa := winners.has(a["slot"])
		var wb := winners.has(b["slot"])
		return wa if wa != wb else int(a["stats"]["damageDealt"]) > int(b["stats"]["damageDealt"]))
	for p in players:
		var st: Dictionary = p["stats"]
		var shots := int(st["shots"])
		var acc := int(roundf(float(st["hits"]) / shots * 100.0)) if shots > 0 else 0
		var ch = session.world.characters[int(p["slot"])]
		grid.add_child(UI.label(p["name"] + (" 👑" if winners.has(p["slot"]) else ""), 16, Spec.team_color(int(p["team"])).darkened(0.25)))
		for val in [int(st["damageDealt"]), int(st["kills"]), shots, "%d%%" % acc, "%d HP" % ch.hp if p["alive"] else "KO"]:
			grid.add_child(UI.label(str(val), 16))
	var gc := CenterContainer.new()
	gc.add_child(grid)
	v.add_child(gc)
	var a := UI.actions(v)
	var rematch := UI.button("Rematch", func() -> void: pass, true)
	rematch.pressed.connect(func() -> void:
		if session != null and session.online:
			Net.send({"t": "rematch"})
			rematch.text = "Waiting for opponent…"
			rematch.disabled = true
		elif _last_local.is_valid():
			_run_session(_last_local.call()))
	a.add_child(rematch)
	a.add_child(UI.button("Leave room" if session.online else "Main menu", _quit if session.online else func() -> void:
		_end_session()
		show_screen("main")))


# ------------------------------------------------------------------ network

func _on_net(m: Dictionary) -> void:
	match m.get("t", ""):
		"queued":
			queued_players = int(m["players"])
			if session == null:
				show_screen("queue")
		"room":
			var same: bool = room != null and room["code"] == m["code"]
			room = m
			if session != null and same and m["state"] == "results":
				pass
			elif m["state"] != "playing" and (session == null or not same or m["state"] == "lobby"):
				show_screen("room")
		"left":
			room = null
			if session != null and session.online and session.result() != null:
				notice = "Your opponent left the room."
				show_screen("online")
			elif session == null:
				show_screen("online")
		"matchStart":
			if session != null and session.online and session.match_id == m["matchId"]:
				return
			_run_session(NetSession.new(m))
			if autoplay:
				print("MATCH_START ", JSON.stringify({"matchId": m["matchId"], "you": m["you"], "map": m["mapId"], "players": m["players"].map(func(p) -> String: return "%s/%s" % [p["name"], p["client"]])}))
			if m.get("resumed", false):
				hud.show_toast("Reconnected to your match")
		"error":
			notice = m["msg"]
			if session != null and hud != null:
				hud.show_toast(m["msg"])
			elif screen in ["online", "room"]:
				_refresh()
