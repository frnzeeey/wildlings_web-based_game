class_name Rng
extends RefCounted
## mulberry32, bit-identical to shared/src/rng.ts (state kept as an unsigned 32-bit int).

const M := 0xFFFFFFFF

var state: int


func _init(seed_value: int) -> void:
	state = seed_value & M


static func imul(a: int, b: int) -> int:
	return (a * b) & M


func next() -> float:
	state = (state + 0x6d2b79f5) & M
	var t := imul(state ^ (state >> 15), 1 | state)
	t = ((t + imul(t ^ (t >> 7), 61 | t)) & M) ^ t
	return float((t ^ (t >> 14)) & M) / 4294967296.0


func range_f(a: float = 0.0, b: float = 1.0) -> float:
	return a + (b - a) * next()


func range_i(a: int, b: int) -> int:
	return int(floor(range_f(float(a), float(b + 1))))


## Smooth 1D value noise in [0, 1] (same draws and maths as makeNoise1D).
class Noise1D:
	var v: PackedFloat64Array
	var size: int

	func _init(rng: Rng, n: int = 512) -> void:
		size = n
		v.resize(n)
		for i in n:
			v[i] = rng.next()

	func at(x: float) -> float:
		var i := int(floor(x))
		var f := x - i
		var t := f * f * (3.0 - 2.0 * f)
		var a := v[posmod(i, size)]
		var b := v[posmod(i + 1, size)]
		return a + (b - a) * t


static func gaussian(rng: Rng) -> float:
	return (rng.next() + rng.next() + rng.next() - 1.5) * 2.0
