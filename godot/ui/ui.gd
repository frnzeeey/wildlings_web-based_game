class_name UI
extends RefCounted
## Theme and widget helpers for the Godot menus and HUD: the "Sunlit Isles" theme, built from
## the same nine-slice UI kit SVGs as the web client (shared/assets/art/ui_*.svg), with Lilita One
## for display text and Fredoka for body text.

const INK := Color("#16203f")
const TEXT := Color("#fff6e6")
const INK_SOFT := Color("#bcdcff") # secondary text on dark panels
const CARD_TEXT := Color("#5a6a8f") # secondary text on light cards
const PLUM := Color("#1f4482")
const PLUM_DEEP := Color("#132b58")
const PRIMARY := Color("#ff8a2a")
const ACCENT := Color("#ffc93c")

static var _font: Font
static var _bold: Font
static var _display: Font


static func font(bold := true) -> Font:
	if _font == null:
		var base: FontFile = load("res://assets/fonts/Fredoka.ttf")
		var wght := TextServerManager.get_primary_interface().name_to_tag("wght")
		var reg := FontVariation.new()
		reg.base_font = base
		reg.variation_opentype = {wght: 500}
		_font = reg
		var b := FontVariation.new()
		b.base_font = base
		b.variation_opentype = {wght: 650}
		_bold = b
	return _bold if bold else _font


## Chunky display face for titles, buttons and banners.
static func display() -> Font:
	if _display == null:
		_display = load("res://assets/fonts/LilitaOne-Regular.ttf")
	return _display


## Nine-slice style from a UI kit SVG. corner = on-screen corner size in px (art corners are 24 units).
static func kit(key: String, corner := 16.0, margin := Vector4(10, 6, 10, 8)) -> StyleBoxTexture:
	var s := StyleBoxTexture.new()
	s.texture = Art.texture_at("ui_" + key, corner / 24.0)
	for side in [SIDE_LEFT, SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM]:
		s.set_texture_margin(side, corner)
	s.content_margin_left = margin.x
	s.content_margin_top = margin.y
	s.content_margin_right = margin.z
	s.content_margin_bottom = margin.w
	return s


static func box(bg: Color, border := INK, width := 3, radius := 14, shadow := 4) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(width)
	s.set_corner_radius_all(radius)
	s.content_margin_left = 16
	s.content_margin_right = 16
	s.content_margin_top = 8
	s.content_margin_bottom = 8
	if shadow > 0:
		s.shadow_color = Color(0.04, 0.08, 0.18, 0.85)
		s.shadow_size = 0
		s.shadow_offset = Vector2(0, shadow)
	return s


## Dark translucent HUD card.
static func hud_box() -> StyleBoxFlat:
	var s := box(Color(0.094, 0.188, 0.376, 0.92), INK, 3, 18, 5)
	s.content_margin_left = 14
	s.content_margin_right = 14
	return s


static func make_theme() -> Theme:
	var t := Theme.new()
	t.default_font = font(true)
	t.default_font_size = 17
	t.set_color("font_color", "Label", TEXT)
	t.set_font("font", "Button", display())
	t.set_font_size("font_size", "Button", 19)
	for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		t.set_color(k, "Button", INK)
	t.set_color("font_disabled_color", "Button", Color(INK, 0.45))
	t.set_stylebox("normal", "Button", kit("btn_neutral"))
	t.set_stylebox("hover", "Button", kit("btn_neutral"))
	t.set_stylebox("pressed", "Button", kit("btn_neutral", 16, Vector4(10, 9, 10, 5)))
	t.set_stylebox("disabled", "Button", kit("btn_disabled"))
	var focus := StyleBoxFlat.new()
	focus.draw_center = false
	focus.border_color = Color("#7de0ff")
	focus.set_border_width_all(3)
	focus.set_corner_radius_all(16)
	t.set_stylebox("focus", "Button", focus)
	t.set_stylebox("panel", "PanelContainer", kit("panel", 26, Vector4(14, 10, 14, 16)))
	var le := box(PLUM_DEEP, INK, 3, 12, 0)
	t.set_stylebox("normal", "LineEdit", le)
	t.set_stylebox("focus", "LineEdit", box(PLUM_DEEP, Color("#7de0ff"), 3, 12, 0))
	t.set_color("font_color", "LineEdit", TEXT)
	t.set_color("font_placeholder_color", "LineEdit", Color(INK_SOFT, 0.6))
	t.set_color("caret_color", "LineEdit", TEXT)
	t.set_font_size("font_size", "LineEdit", 18)
	var bg := box(PLUM_DEEP, INK, 2, 6, 0)
	bg.content_margin_top = 0
	bg.content_margin_bottom = 0
	t.set_stylebox("background", "ProgressBar", bg)
	var fill := box(Color("#ff8a3d"), INK, 0, 6, 0)
	fill.content_margin_top = 0
	fill.content_margin_bottom = 0
	t.set_stylebox("fill", "ProgressBar", fill)
	t.set_color("default_color", "RichTextLabel", TEXT)
	return t


static func bar_fill(bar: ProgressBar, color: Color) -> void:
	var fill := box(color, INK, 0, 6, 0)
	fill.content_margin_top = 0
	fill.content_margin_bottom = 0
	bar.add_theme_stylebox_override("fill", fill)


static func label(text: String, size := 17, color := TEXT, bold := true) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font(bold))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


## Display-font title with an ink outline and drop shadow.
static func title(text: String, size := 36, color := Color.WHITE) -> Label:
	var l := outlined(text, size, color, 10)
	l.add_theme_font_override("font", display())
	l.add_theme_color_override("font_shadow_color", INK)
	l.add_theme_constant_override("shadow_offset_y", 4)
	l.add_theme_constant_override("shadow_offset_x", 0)
	return l


static func outlined(text: String, size: int, color: Color, outline := 8) -> Label:
	var l := label(text, size, color)
	l.add_theme_color_override("font_outline_color", INK)
	l.add_theme_constant_override("outline_size", outline)
	return l


static func button(text: String, cb: Callable, primary := false, size := 19) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", size)
	b.focus_mode = Control.FOCUS_ALL
	b.custom_minimum_size = Vector2(0, 52)
	if primary:
		b.add_theme_stylebox_override("normal", kit("btn_primary"))
		b.add_theme_stylebox_override("hover", kit("btn_primary"))
		b.add_theme_stylebox_override("pressed", kit("btn_primary", 16, Vector4(10, 9, 10, 5)))
		for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
			b.add_theme_color_override(k, Color.WHITE)
		b.add_theme_color_override("font_outline_color", INK)
		b.add_theme_constant_override("outline_size", 6)
	b.pressed.connect(func() -> void:
		Sfx.play("ui")
		cb.call())
	hover_lift(b)
	return b


## Subtle hover feedback: a small lift and scale, matching the web UI.
static func hover_lift(c: Control) -> void:
	c.resized.connect(func() -> void: c.pivot_offset = c.size / 2.0)
	c.mouse_entered.connect(func() -> void:
		if c is BaseButton and c.disabled:
			return
		c.create_tween().tween_property(c, "scale", Vector2.ONE * 1.04, 0.1))
	c.mouse_exited.connect(func() -> void: c.create_tween().tween_property(c, "scale", Vector2.ONE, 0.1))


## Segmented control: options = [[value, label], ...]; on_pick(value).
static func seg(options: Array, current, on_pick: Callable, disabled := false) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 0)
	for i in options.size():
		var o: Array = options[i]
		var b := Button.new()
		b.text = String(o[1])
		b.disabled = disabled
		b.add_theme_font_override("font", font(true))
		b.add_theme_font_size_override("font_size", 15)
		var active := str(o[0]) == str(current)
		var st := box(ACCENT if active else PLUM_DEEP, INK, 3, 0, 0)
		st.content_margin_left = 12
		st.content_margin_right = 12
		st.content_margin_top = 6
		st.content_margin_bottom = 6
		if i == 0:
			st.corner_radius_top_left = 12
			st.corner_radius_bottom_left = 12
		if i == options.size() - 1:
			st.corner_radius_top_right = 12
			st.corner_radius_bottom_right = 12
		if i > 0:
			st.border_width_left = 1
		b.add_theme_stylebox_override("normal", st)
		var hov := st.duplicate()
		hov.bg_color = ACCENT if active else PLUM.lightened(0.1)
		b.add_theme_stylebox_override("hover", hov)
		b.add_theme_stylebox_override("pressed", st)
		b.add_theme_stylebox_override("disabled", st)
		var fc := INK if active else TEXT
		for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_disabled_color"]:
			b.add_theme_color_override(k, fc)
		var v = o[0]
		b.pressed.connect(func() -> void:
			Sfx.play("ui")
			on_pick.call(v))
		h.add_child(b)
	return h


static func field(text: String, control: Control) -> HBoxContainer:
	var h := HBoxContainer.new()
	var l := label(text, 17)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(l)
	h.add_child(control)
	return h


## A centred plum panel with a display title, returning the content VBox.
static func panel(parent: Control, title_text: String, width := 720.0) -> VBoxContainer:
	var scroll := ScrollContainer.new()
	scroll.set_anchors_preset(Control.PRESET_FULL_RECT)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	parent.add_child(scroll)
	var center := CenterContainer.new()
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.add_child(center)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_top", 24)
	margin.add_theme_constant_override("margin_bottom", 24)
	center.add_child(margin)
	var pc := PanelContainer.new()
	pc.custom_minimum_size = Vector2(width, 0)
	margin.add_child(pc)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	pc.add_child(v)
	var t := title(title_text, 38)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	pc.modulate.a = 0.0
	pc.create_tween().tween_property(pc, "modulate:a", 1.0, 0.2)
	return v


static func actions(parent: Control) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_theme_constant_override("separation", 12)
	parent.add_child(h)
	return h


## Light card (character select, map picker) or dark card (lobby members).
static func card(light := true) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", kit("card_light" if light else "card", 16, Vector4(8, 8, 8, 12)))
	return p


## An animated critter preview for menus.
static func critter(species: String, team: int, size := 2.0, weapon := "", facing := 1) -> Control:
	var holder := Control.new()
	holder.custom_minimum_size = Vector2(46, 74) * size
	var dummy := SimCharacter.new(0, "", species, team, 100)
	dummy.facing = facing
	dummy.on_ground = true
	dummy.weapon_id = weapon if weapon != "" else "rocket"
	dummy.aim = -0.3 if facing > 0 else PI + 0.3
	var c := Critter.new()
	holder.add_child(c)
	c.setup(dummy)
	c.position = Vector2(23 * size, 70 * size)
	c.scale = Vector2(size, size)
	c.set_preview()
	var show_weapon := weapon != ""
	var proc := func(dt: float) -> void:
		if is_instance_valid(c):
			c.sync(dt, dummy, show_weapon, false)
			c.position = Vector2(23 * size, 70 * size)
	holder.set_meta("tick", proc)
	holder.add_to_group("critter_previews")
	return holder


static func map_card(m: Dictionary, active: bool, cb: Callable, disabled := false) -> Button:
	var b := Button.new()
	b.custom_minimum_size = Vector2(122, 100)
	b.disabled = disabled
	var st := kit("slot_active" if active else "card_light", 14, Vector4(6, 6, 6, 10))
	b.add_theme_stylebox_override("normal", st)
	b.add_theme_stylebox_override("hover", st)
	b.add_theme_stylebox_override("pressed", st)
	b.add_theme_stylebox_override("disabled", st)
	var v := VBoxContainer.new()
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.offset_left = 10
	v.offset_right = -10
	v.offset_top = 9
	v.offset_bottom = -12
	var thumb := TextureRect.new()
	thumb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	thumb.custom_minimum_size = Vector2(100, 52)
	thumb.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	if m.has("palette"):
		var p: Dictionary = m["palette"]
		var g := Gradient.new()
		g.offsets = PackedFloat32Array([0.0, 0.58, 0.6, 0.72, 0.74, 0.86, 0.88, 1.0])
		g.colors = PackedColorArray([Color(p["sky"][0]), Color(p["sky"][1]), Color(p["top"]), Color(p["top"]), Color(p["dirt"]), Color(p["dirt"]), Color(p["liquid"]), Color(p["liquid"])])
		var gt := GradientTexture2D.new()
		gt.gradient = g
		gt.fill_to = Vector2(0, 1)
		thumb.texture = gt
	else:
		thumb.texture = Art.texture("icon_teleport")
		thumb.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	v.add_child(thumb)
	var l := label(m.get("name", "Random"), 13, INK)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(l)
	b.add_child(v)
	b.pressed.connect(func() -> void:
		Sfx.play("ui")
		cb.call())
	hover_lift(b)
	return b
