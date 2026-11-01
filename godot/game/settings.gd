extends Node
## Persistent client settings, roster and setup (user://settings.cfg). Same fields as web/src/settings.ts.

var PATH := "user://settings.cfg"

var match_rules := {"turnTime": 30, "wind": "normal", "startHP": 100, "suddenDeath": true}
var client := {"screenShake": true, "aimGuide": true, "sfxVolume": 0.7, "musicVolume": 0.35, "wheelMode": "weapon", "zoom": 1.0}
var roster: Array = [
	{"name": "Pip", "species": "fox"},
	{"name": "Bramble", "species": "bear"},
	{"name": "Clover", "species": "bunny"},
	{"name": "Ribbit", "species": "frog"},
]
var setup := {"mode": "bots", "count": 2, "difficulty": "normal", "mapId": "random"}
var server_url := "ws://localhost:8787/ws"
var token := ""


func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--settings="):
			PATH = "user://" + arg.substr(11)
	load_all()
	var env := OS.get_environment("WILDLINGS_SERVER")
	if env != "":
		server_url = env
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--server="):
			server_url = arg.substr(9)
		elif arg.begins_with("--name="):
			roster[0]["name"] = arg.substr(7)


func load_all() -> void:
	var cf := ConfigFile.new()
	if cf.load(PATH) != OK:
		return
	match_rules.merge(cf.get_value("match", "rules", {}), true)
	client.merge(cf.get_value("client", "options", {}), true)
	var r = cf.get_value("roster", "players", roster)
	if r is Array and r.size() == 4:
		roster = r
	setup.merge(cf.get_value("setup", "options", {}), true)
	server_url = cf.get_value("net", "server", server_url)
	token = cf.get_value("net", "token", "")


func save_all() -> void:
	var cf := ConfigFile.new()
	cf.set_value("match", "rules", match_rules)
	cf.set_value("client", "options", client)
	cf.set_value("roster", "players", roster)
	cf.set_value("setup", "options", setup)
	cf.set_value("net", "server", server_url)
	cf.set_value("net", "token", token)
	cf.save(PATH)
