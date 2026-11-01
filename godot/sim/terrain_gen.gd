class_name TerrainGen
extends RefCounted
## Port of shared/src/sim/terrain-gen.ts. The order of RNG draws is part of the contract: keep in sync.


static func generate(map: Dictionary, seed_value: int, width: int, height: int, water_level: float) -> TerrainMask:
	var t := TerrainMask.new(width, height)
	var rng := Rng.new(seed_value ^ 0x5eed)
	var g: Dictionary = map["gen"]
	var w := width
	var h := height
	var n1 := Rng.Noise1D.new(rng)
	var n2 := Rng.Noise1D.new(rng)
	var n3 := Rng.Noise1D.new(rng)
	var base := float(g["base"])
	var amp := float(g["amp"])
	var rough := float(g["rough"])

	var gaps: Array[float] = []
	for i in int(g["gaps"]):
		gaps.append((float(i + 1) / (int(g["gaps"]) + 1)) * w + rng.range_f(-80, 80))
	var peaks: Array[float] = []
	for i in int(g["peaks"]):
		peaks.append(rng.range_f(w * 0.3, w * 0.7))

	var surf := PackedFloat64Array()
	surf.resize(w)
	for x in w:
		var y := h * base + (n1.at(x / 430.0) - 0.5) * amp + (n2.at(x / 150.0) - 0.5) * amp * 0.35 + (n3.at(x / 40.0) - 0.5) * rough
		if g["mesa"]:
			var q := roundf(y / 80.0) * 80.0
			y += (q - y) * 0.75
		for px in peaks:
			y -= 300.0 * exp(-pow((x - px) / 170.0, 2))
		for gx in gaps:
			y += 560.0 * exp(-pow((x - gx) / 80.0, 2))
		var edge := mini(x, w - 1 - x)
		if edge < 180:
			y += pow(1.0 - edge / 180.0, 2) * 380.0
		surf[x] = clampf(y, 160.0, h - 10.0)
	if g["mesa"]:
		_median_smooth(surf, 6)

	var data := t.data
	for x in w:
		var top := int(floor(surf[x]))
		t.surface[x] = top
		for y in range(top, h):
			data[y * w + x] = TerrainMask.EARTH

	for i in int(g["platforms"]):
		var cx := rng.range_f(w * 0.15, w * 0.85)
		var cy := surf[int(floor(cx))] - rng.range_f(170, 280)
		var rx := rng.range_f(60, 115)
		var ry := rng.range_f(14, 24)
		if cy > 140:
			_fill_blob(data, w, h, cx, cy, rx, ry, TerrainMask.ROCK)

	for i in int(g["pillars"]):
		var cx := rng.range_f(w * 0.25, w * 0.75)
		var base_y := surf[int(floor(cx))]
		var hgt := rng.range_f(110, 190)
		var hw := rng.range_f(18, 28)
		for y in range(maxi(0, int(floor(base_y - hgt))), mini(h, int(ceil(base_y + 20)))):
			var k := 1.0 - (base_y - y) / hgt
			var half := hw * (0.7 + 0.5 * clampf(k, 0.0, 1.0))
			for x in range(int(floor(cx - half)), int(floor(cx + half)) + 1):
				if x >= 0 and x < w and x <= cx + half:
					data[y * w + x] = TerrainMask.ROCK

	for i in mini(int(g["bridges"]), gaps.size()):
		var gx := int(floor(gaps[i]))
		var deck: float = minf(surf[clampi(gx - 150, 0, w - 1)], surf[clampi(gx + 150, 0, w - 1)]) - 4.0
		if deck > water_level - 60:
			continue
		var left := gx
		while left > 0 and surf[left] > deck + 6:
			left -= 1
		var right := gx
		while right < w - 1 and surf[right] > deck + 6:
			right += 1
		var y0 := int(floor(deck))
		for x in range(left - 8, right + 9):
			if x < 0 or x >= w:
				continue
			var sag := int(roundf(10.0 * sin((float(x - left) / maxi(1, right - left)) * PI)))
			for y in range(y0 + sag, y0 + sag + 9):
				if y >= 0 and y < h and data[y * w + x] == TerrainMask.AIR:
					data[y * w + x] = TerrainMask.WOOD

	for i in int(g["caves"]):
		var cx := rng.range_f(w * 0.12, w * 0.88)
		var cy := surf[int(floor(cx))] + rng.range_f(90, 220)
		var rx := rng.range_f(50, 120)
		var ry := rng.range_f(26, 50)
		if cy < water_level - 60:
			_fill_blob(data, w, h, cx, cy, rx, ry, TerrainMask.AIR)

	t.data = data
	t.dirty = null
	return t


static func _median_smooth(surface: PackedFloat64Array, radius: int) -> void:
	var src := surface.duplicate()
	var n := surface.size()
	for x in n:
		var win: Array[float] = []
		for k in range(maxi(0, x - radius), mini(n - 1, x + radius) + 1):
			win.append(src[k])
		win.sort()
		surface[x] = win[win.size() >> 1]


static func _fill_blob(data: PackedByteArray, w: int, h: int, cx: float, cy: float, rx: float, ry: float, value: int) -> void:
	for y in range(maxi(0, int(floor(cy - ry))), int(floor(minf(h - 1, cy + ry))) + 1):
		var dy := (y - cy) / ry
		for x in range(maxi(0, int(floor(cx - rx))), int(floor(minf(w - 1, cx + rx))) + 1):
			var dx := (x - cx) / rx
			if dx * dx * dx * dx + dy * dy <= 1.0:
				data[y * w + x] = value
