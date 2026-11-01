class_name Hud
extends CanvasLayer
## In-match overlay: turn card and timer, wind, roster with HP, weapon bar with ammo and cooldowns,
## angle/power/move readouts, banners, toasts and connection status. Mirrors web/src/ui/Hud.ts.

signal pause_pressed

var battle: Battle
var _turn_dot := ColorRect.new()
var _turn_name: Label
var _turn_sub: Label
var _timer: Label
var _wind_bar := Control.new()
var _wind_value: Label
var _wind := 0.0
var _rows: Array = []
var _slots := {}
var _angle: Label
var _power_bar := ProgressBar.new()
var _power_num: Label
var _move_bar := ProgressBar.new()
var _weapon_name: Label
var _weapon_desc: Label
var _banner_title: Label
var _banner_sub: Label
var _banner := VBoxContainer.new()
var _toasts := VBoxContainer.new()
var _status: Label
var _weapons_box: PanelContainer
var _stats_box: PanelContainer


func setup(p_battle: Battle) -> void:
	battle = p_battle
	layer = 5
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = UI.make_theme()
	add_child(root)
	var world = battle.world

	# Turn card (top-left)
	var turn := _card(root, Control.PRESET_TOP_LEFT, Vector2(12, 12))
	var th := HBoxContainer.new()
	th.add_theme_constant_override("separation", 10)
	turn.add_child(th)
	_turn_dot.custom_minimum_size = Vector2(16, 16)
	_turn_dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	th.add_child(_turn_dot)
	var tv := VBoxContainer.new()
	tv.add_theme_constant_override("separation", -4)
	tv.custom_minimum_size = Vector2(130, 0)
	th.add_child(tv)
	_turn_name = UI.label("", 21)
	_turn_name.add_theme_font_override("font", UI.display())
	_turn_sub = UI.label("", 13, UI.INK_SOFT, false)
	tv.add_child(_turn_name)
	tv.add_child(_turn_sub)
	_timer = UI.label("", 22, UI.TEXT)
	_timer.add_theme_font_override("font", UI.display())
	_timer.custom_minimum_size = Vector2(44, 44)
	_timer.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_timer.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	var ring := StyleBoxFlat.new()
	ring.bg_color = UI.PLUM_DEEP
	ring.border_color = UI.ACCENT
	ring.set_border_width_all(4)
	ring.set_corner_radius_all(22)
	_timer.add_theme_stylebox_override("normal", ring)
	th.add_child(_timer)

	# Wind (top-centre)
	var wind := _card(root, Control.PRESET_CENTER_TOP, Vector2(-90, 12))
	var wv := VBoxContainer.new()
	wv.add_theme_constant_override("separation", 2)
	wind.add_child(wv)
	var wl := UI.label("WIND", 12, UI.INK_SOFT)
	wl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	wv.add_child(wl)
	_wind_bar.custom_minimum_size = Vector2(140, 14)
	_wind_bar.draw.connect(_draw_wind)
	wv.add_child(_wind_bar)
	_wind_value = UI.label("", 15)
	_wind_value.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	wv.add_child(_wind_value)

	# Roster (top-right)
	var roster := _card(root, Control.PRESET_TOP_RIGHT, Vector2(-290, 12))
	var rv := VBoxContainer.new()
	rv.custom_minimum_size = Vector2(210, 0)
	roster.add_child(rv)
	for c in world.characters:
		var info: Dictionary = battle.session.slots[c.slot]
		var row := HBoxContainer.new()
		var dot := ColorRect.new()
		dot.color = Spec.team_color(c.team)
		dot.custom_minimum_size = Vector2(12, 12)
		dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(dot)
		var tag := ""
		if info["kind"] == "bot":
			tag = " · bot"
		elif info["kind"] == "remote":
			tag = " · %s" % info["detail"]
		var nl := UI.label(c.name + tag, 14)
		nl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(nl)
		var hp := ProgressBar.new()
		hp.custom_minimum_size = Vector2(70, 10)
		hp.show_percentage = false
		hp.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		hp.max_value = c.max_hp
		row.add_child(hp)
		var num := UI.label("", 12)
		num.custom_minimum_size = Vector2(28, 0)
		num.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(num)
		rv.add_child(row)
		_rows.append({"row": row, "hp": hp, "num": num, "name": nl})
	var pause := UI.button("❚❚", func() -> void: pause_pressed.emit())
	pause.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	pause.position = Vector2(-62, 12)
	pause.custom_minimum_size = Vector2(48, 48)
	root.add_child(pause)

	# Bottom: stats + weapons
	var bottom := HBoxContainer.new()
	bottom.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	bottom.grow_horizontal = Control.GROW_DIRECTION_BOTH
	bottom.grow_vertical = Control.GROW_DIRECTION_BEGIN
	bottom.position.y = -28
	bottom.alignment = BoxContainer.ALIGNMENT_CENTER
	bottom.add_theme_constant_override("separation", 14)
	bottom.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(bottom)
	_stats_box = PanelContainer.new()
	_stats_box.add_theme_stylebox_override("panel", UI.hud_box())
	bottom.add_child(_stats_box)
	var sv := VBoxContainer.new()
	sv.custom_minimum_size = Vector2(170, 0)
	_stats_box.add_child(sv)
	_angle = UI.label("", 16)
	sv.add_child(_stat_row("ANGLE", _angle))
	_power_num = UI.label("", 13)
	var pr := _stat_row("POWER", _power_bar)
	pr.add_child(_power_num)
	sv.add_child(pr)
	sv.add_child(_stat_row("MOVE", _move_bar))
	UI.bar_fill(_move_bar, Color("#5ee05e"))
	for b in [_power_bar, _move_bar]:
		b.show_percentage = false
		b.custom_minimum_size = Vector2(80, 10)
		b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		b.max_value = 100

	var wcol := VBoxContainer.new()
	wcol.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bottom.add_child(wcol)
	var winfo := HBoxContainer.new()
	winfo.alignment = BoxContainer.ALIGNMENT_CENTER
	_weapon_name = UI.outlined("", 15, UI.ACCENT, 5)
	_weapon_desc = UI.outlined("", 14, Color.WHITE, 5)
	winfo.add_child(_weapon_name)
	winfo.add_child(_weapon_desc)
	wcol.add_child(winfo)
	_weapons_box = PanelContainer.new()
	_weapons_box.add_theme_stylebox_override("panel", UI.hud_box())
	wcol.add_child(_weapons_box)
	var wh := HBoxContainer.new()
	wh.add_theme_constant_override("separation", 6)
	_weapons_box.add_child(wh)
	for i in Spec.weapons.size():
		var w: Dictionary = Spec.weapons[i]
		var b := Button.new()
		b.custom_minimum_size = Vector2(50, 50)
		b.tooltip_text = "%s (%d)" % [w["name"], i + 1]
		b.focus_mode = Control.FOCUS_NONE
		var icon := Art.icon("icon_" + w["id"], 30)
		icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		icon.set_anchors_preset(Control.PRESET_CENTER)
		icon.position = Vector2(-15, -15)
		b.add_child(icon)
		var ammo := UI.label("", 11, Color.WHITE)
		var badge := UI.box(UI.INK, UI.INK, 0, 8, 0)
		badge.content_margin_left = 3
		badge.content_margin_right = 3
		badge.content_margin_top = 0
		badge.content_margin_bottom = 0
		ammo.add_theme_stylebox_override("normal", badge)
		ammo.position = Vector2(30, 33)
		ammo.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(ammo)
		var key := UI.label(str(i + 1), 10, UI.CARD_TEXT)
		key.position = Vector2(4, 1)
		key.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(key)
		var cd := UI.outlined("", 18, Color.WHITE, 5)
		cd.set_anchors_preset(Control.PRESET_FULL_RECT)
		cd.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		cd.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		cd.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(cd)
		var id: String = w["id"]
		b.pressed.connect(func() -> void: battle.ui_weapon = id)
		UI.hover_lift(b)
		wh.add_child(b)
		_slots[id] = {"btn": b, "ammo": ammo, "cd": cd, "icon": icon}
	var help := UI.outlined("A/D walk · W climb · S steady aim · Space jump · Mouse aim · Click fire · E/Q or wheel weapons · Right-drag pan · +/- zoom", 12, Color.WHITE, 4)
	help.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	help.offset_top = -22
	help.offset_bottom = -4
	help.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	help.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(help)

	# Banner, toasts, status
	_banner.set_anchors_preset(Control.PRESET_CENTER)
	_banner.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_banner.grow_vertical = Control.GROW_DIRECTION_BOTH
	_banner.position.y = -170
	_banner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_banner.modulate.a = 0.0
	_banner_title = UI.title("", 54)
	_banner_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_banner_sub = UI.outlined("", 20, Color.WHITE, 8)
	_banner_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_banner.add_child(_banner_title)
	_banner.add_child(_banner_sub)
	root.add_child(_banner)
	_toasts.set_anchors_preset(Control.PRESET_CENTER)
	_toasts.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_toasts.position.y = 70
	_toasts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toasts.alignment = BoxContainer.ALIGNMENT_CENTER
	root.add_child(_toasts)
	_status = UI.label("", 15, Color.WHITE)
	_status.add_theme_stylebox_override("normal", UI.box(Color(UI.INK, 0.85), UI.INK, 0, 12, 0))
	_status.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_status.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_status.position.y = 96
	_status.visible = false
	root.add_child(_status)
	battle.banner.connect(show_banner)
	battle.toast.connect(show_toast)


func _card(root: Control, preset: int, pos: Vector2) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UI.hud_box())
	p.set_anchors_preset(preset)
	p.position = pos
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(p)
	return p


func _stat_row(text: String, value: Control) -> HBoxContainer:
	var h := HBoxContainer.new()
	var l := UI.label(text, 12, UI.INK_SOFT)
	l.custom_minimum_size = Vector2(56, 0)
	h.add_child(l)
	value.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(value)
	return h


func _draw_wind() -> void:
	var s := _wind_bar.size
	_wind_bar.draw_rect(Rect2(Vector2.ZERO, s), UI.PLUM_DEEP)
	var pct := minf(0.5, absf(_wind) / 2.0 * 0.5)
	var w := s.x * pct
	var x := s.x / 2.0 - w if _wind < 0 else s.x / 2.0
	_wind_bar.draw_rect(Rect2(x, 0, w, s.y), Color("#5ab8ff"))
	_wind_bar.draw_line(Vector2(s.x / 2.0, -2), Vector2(s.x / 2.0, s.y + 2), UI.TEXT, 2.0)
	_wind_bar.draw_rect(Rect2(Vector2.ZERO, s), UI.INK, false, 2.0)


func _process(_dt: float) -> void:
	if battle == null:
		return
	var session = battle.session
	var world = battle.world
	if world.active_slot < 0:
		return
	var p = world.characters[world.active_slot]
	var mine: bool = session.controlled_slot() == p.slot
	var local = battle.local_aim if mine else null
	var info: Dictionary = session.slots[p.slot]
	_turn_dot.color = Spec.team_color(p.team)
	_turn_name.text = p.name
	var sub := "Your move!" if mine else ("Bot (%s) is thinking…" % info["detail"] if info["kind"] == "bot" else ("Opponent is playing…" if info["kind"] == "remote" else "Get ready!"))
	if world.phase == "over":
		sub = "Match over"
	elif world.phase == "action" or world.phase == "settle":
		sub = "Resolving…"
	_turn_sub.text = sub
	var total := float(world.settings["turnTime"])
	_timer.text = "∞" if is_inf(world.time_left) or total <= 0 else str(int(ceil(world.time_left)))
	_timer.add_theme_color_override("font_color", Color("#ff4d4d") if world.phase == "aim" and world.time_left <= 5 else UI.TEXT)
	if _wind != world.wind:
		_wind = world.wind
		_wind_bar.queue_redraw()
		var n := int(roundf(absf(_wind) * 10))
		_wind_value.text = "Calm" if n == 0 else ("◀ %d" % n if _wind < 0 else "%d ▶" % n)
	var aim: float = local["angle"] if local != null else p.aim
	var wid: String = local["weapon"] if local != null else p.weapon_id
	var w := Spec.weapon(wid)
	_angle.text = "%d°" % int(roundf(rad_to_deg(atan2(-sin(aim), absf(cos(aim))))))
	var power: float = 1.0 if w.get("fixedPower", false) else (local["power"] if local != null else p.power)
	_power_bar.value = power * 100.0
	_power_num.text = str(int(roundf(power * 100.0)))
	_move_bar.value = p.energy / float(Spec.character["maxEnergy"]) * 100.0
	_weapon_name.text = String(w.get("name", "")) + "  "
	_weapon_desc.text = String(w.get("desc", ""))
	var locked: bool = not mine or world.phase != "aim"
	_weapons_box.modulate.a = 0.6 if locked else 1.0
	_stats_box.modulate.a = 0.6 if locked else 1.0
	for id in _slots:
		var s: Dictionary = _slots[id]
		var ammo := int(p.inventory.get(id, 0))
		var cd := int(p.cooldowns.get(id, 0))
		s["ammo"].text = " ∞ " if ammo < 0 else " %d " % ammo
		s["cd"].text = str(cd) if cd > 0 else ""
		s["icon"].modulate.a = 0.35 if ammo == 0 or cd > 0 else 1.0
		var sel: bool = id == wid
		if s.get("sel", null) != sel:
			s["sel"] = sel
			var st := UI.kit("slot_active" if sel else "slot", 12, Vector4(4, 4, 4, 6))
			for k in ["normal", "hover", "pressed"]:
				s["btn"].add_theme_stylebox_override(k, st)
	for c in world.characters:
		var r: Dictionary = _rows[c.slot]
		var hp: int = c.hp if c.alive else 0
		r["hp"].value = hp
		var k: float = float(hp) / c.max_hp
		if r.get("k", -1.0) != k:
			r["k"] = k
			UI.bar_fill(r["hp"], Color("#5ee05e") if k > 0.5 else (Color("#ffd23f") if k > 0.25 else Color("#ff4d4d")))
		r["num"].text = str(hp)
		r["row"].modulate.a = 0.45 if not c.alive else 1.0
		r["name"].add_theme_color_override("font_color", Color("#ff8a9a") if not session.slots[c.slot]["connected"] else UI.TEXT)
	var st: String = session.status()
	_status.visible = st != ""
	_status.text = st


func show_banner(title: String, color: Color, sub: String) -> void:
	_banner_title.text = title
	_banner_title.add_theme_color_override("font_color", color)
	_banner_sub.text = sub
	_banner.modulate.a = 0.0
	_banner.scale = Vector2(0.8, 0.8)
	var tw := create_tween()
	tw.tween_property(_banner, "modulate:a", 1.0, 0.2)
	tw.parallel().tween_property(_banner, "scale", Vector2.ONE, 0.25).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_interval(1.1)
	tw.tween_property(_banner, "modulate:a", 0.0, 0.4)


func show_toast(msg: String) -> void:
	var l := UI.label(msg, 16, Color.WHITE)
	l.add_theme_font_override("font", UI.display())
	l.add_theme_stylebox_override("normal", UI.box(UI.PLUM, UI.ACCENT, 3, 14, 0))
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toasts.add_child(l)
	var tw := l.create_tween()
	tw.tween_interval(2.0)
	tw.tween_property(l, "modulate:a", 0.0, 0.4)
	tw.tween_callback(l.queue_free)
