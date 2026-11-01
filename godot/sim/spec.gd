extends Node
## Shared game specification (res://data/*.json, synced byte-for-byte from shared/spec).
## The single source of gameplay numbers for the GDScript simulation.

var rules: Dictionary
var weapons: Array = []
var hazards: Dictionary
var maps: Array = []
var characters: Array = []
var team_colors: Array = []
var spec_version: String
var protocol_version: int

var world: Dictionary
var character: Dictionary
var turn: Dictionary


func _init() -> void:
	rules = _load("res://data/rules.json")
	var w: Dictionary = _load("res://data/weapons.json")
	weapons = w["weapons"]
	hazards = w["hazards"]
	maps = _load("res://data/maps.json")["maps"]
	var c: Dictionary = _load("res://data/characters.json")
	characters = c["characters"]
	team_colors = c["teamColors"]
	spec_version = rules["specVersion"]
	protocol_version = int(rules["protocolVersion"])
	world = rules["world"]
	character = rules["character"]
	turn = rules["turn"]


func _load(path: String) -> Dictionary:
	var text := FileAccess.get_file_as_string(path)
	var data = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		push_error("Spec: could not parse %s" % path)
		return {}
	return data


func weapon(id: String) -> Dictionary:
	for w in weapons:
		if w["id"] == id:
			return w
	return {}


func weapon_index(id: String) -> int:
	for i in weapons.size():
		if weapons[i]["id"] == id:
			return i
	return -1


func map_def(id: String) -> Dictionary:
	for m in maps:
		if m["id"] == id:
			return m
	return maps[0]


func character_def(id: String) -> Dictionary:
	for c in characters:
		if c["id"] == id:
			return c
	return characters[0]


func team_color(team: int) -> Color:
	return Color(team_colors[team % team_colors.size()])


## Number field with default (JSON numbers arrive as floats).
static func num(d: Dictionary, key: String, default: float = 0.0) -> float:
	return float(d[key]) if d.has(key) and d[key] != null else default
