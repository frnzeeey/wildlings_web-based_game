class_name TerrainMask
extends RefCounted
## Destructible terrain: one material byte per pixel (0 air, 1 earth, 2 rock, 3 wood).
## Same layout and carve maths as shared/src/sim/terrain.ts.

const AIR := 0
const EARTH := 1
const ROCK := 2
const WOOD := 3
const ROCK_RESIST := 0.6

var width: int
var height: int
var data: PackedByteArray
var surface: PackedInt32Array
## Union of changed areas since take_dirty(): Rect2i or null.
var dirty = null


func _init(w: int, h: int) -> void:
	width = w
	height = h
	data.resize(w * h)
	surface.resize(w)


func is_solid(x: float, y: float) -> bool:
	var ix := int(floor(x))
	var iy := int(floor(y))
	if ix < 0 or ix >= width or iy < 0:
		return false
	if iy >= height:
		return true
	return data[iy * width + ix] != AIR


func material(x: float, y: float) -> int:
	var ix := int(floor(x))
	var iy := int(floor(y))
	if ix < 0 or ix >= width or iy < 0 or iy >= height:
		return AIR
	return data[iy * width + ix]


## First solid y at column x scanning down from from_y; -1 if none above limit.
func surface_at(x: float, from_y: int = 0, limit: int = -1) -> int:
	if limit < 0:
		limit = height
	var ix := int(floor(x))
	if ix < 0 or ix >= width:
		return -1
	for y in range(maxi(0, from_y), limit):
		if data[y * width + ix] != AIR:
			return y
	return -1


func carve(cx: float, cy: float, r: float) -> void:
	if r <= 0.0:
		return
	var r2 := r * r
	var rr2 := r2 * ROCK_RESIST * ROCK_RESIST
	var x0 := maxi(0, int(floor(cx - r)))
	var x1 := mini(width - 1, int(ceil(cx + r)))
	var y0 := maxi(0, int(floor(cy - r)))
	var y1 := mini(height - 1, int(ceil(cy + r)))
	if x0 > x1 or y0 > y1:
		return
	for y in range(y0, y1 + 1):
		var dy := y - cy
		var row := y * width
		for x in range(x0, x1 + 1):
			var dx := x - cx
			var d2 := dx * dx + dy * dy
			if d2 > r2:
				continue
			var i := row + x
			if data[i] == ROCK and d2 > rr2:
				continue
			data[i] = AIR
	mark_dirty(Rect2i(x0, y0, x1 - x0 + 1, y1 - y0 + 1))


func mark_dirty(r: Rect2i) -> void:
	dirty = r if dirty == null else (dirty as Rect2i).merge(r)


func take_dirty():
	var d = dirty
	dirty = null
	return d


## Decode the server's terrain payload {w, h, rle, surface} (see encodeTerrain in terrain.ts).
static func from_payload(p: Dictionary) -> TerrainMask:
	var w := int(p["w"])
	var h := int(p["h"])
	var t := TerrainMask.new(w, h)
	var rle := Marshalls.base64_to_raw(p["rle"])
	var out := PackedByteArray()
	var i := 0
	var n := rle.size()
	while i < n:
		var v := rle[i]
		i += 1
		var length := 0
		var shift := 0
		while true:
			var b := rle[i]
			i += 1
			length |= (b & 0x7f) << shift
			shift += 7
			if (b & 0x80) == 0:
				break
		var run := PackedByteArray()
		run.resize(length)
		if v != 0:
			run.fill(v)
		out.append_array(run)
	out.resize(w * h)
	t.data = out
	var sb := Marshalls.base64_to_raw(p["surface"])
	for x in w:
		var s := sb[x * 2] | (sb[x * 2 + 1] << 8)
		if s >= 32768:
			s -= 65536
		t.surface[x] = s
	return t


## Same digest the server sends with every turn (first 16 hex chars of SHA-256).
func checksum() -> String:
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(data)
	return ctx.finish().hex_encode().substr(0, 16)
