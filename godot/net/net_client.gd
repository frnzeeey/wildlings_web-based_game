extends Node
## WebSocket client for the shared game server (same JSON protocol as the web client:
## see docs/PROTOCOL.md). Reconnects with backoff and re-identifies with the stored token.

signal message(msg: Dictionary)
signal state_changed(state: String)

var state := "offline" # offline | connecting | online | reconnecting
var player_id := ""
var player_name := ""
var last_error := ""
var rtt := 0.0

var _ws: WebSocketPeer = null
var _wanted := false
var _retry := 0
var _retry_at := 0.0
var _ping_at := 0.0
var _ping_id := 0
var _ping_sent := {}
var _profile := {"name": "Critter", "species": "fox"}
var _was_open := false


func connect_to_server(name: String, species: String) -> void:
	_profile = {"name": name, "species": species}
	_wanted = true
	if _ws == null:
		_open()


func disconnect_from_server() -> void:
	_wanted = false
	if _ws:
		_ws.close()
	_ws = null
	_set_state("offline")


## Test hook: drop the connection as if the network failed (reconnects by itself).
func simulate_drop() -> void:
	if _ws:
		_ws.close()


func set_profile(name: String, species: String) -> void:
	_profile = {"name": name, "species": species}
	if state == "online":
		send({"t": "profile", "name": name, "species": species})


func send(msg: Dictionary) -> bool:
	if _ws == null or _ws.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return false
	_ws.send_text(JSON.stringify(msg))
	return true


func _open() -> void:
	_set_state("reconnecting" if _retry > 0 else "connecting")
	_ws = WebSocketPeer.new()
	_ws.inbound_buffer_size = 1 << 20
	_was_open = false
	var err := _ws.connect_to_url(Settings.server_url)
	if err != OK:
		last_error = "Could not connect to %s" % Settings.server_url
		_ws = null
		_schedule_retry()


func _schedule_retry() -> void:
	_set_state("reconnecting")
	_retry_at = Time.get_ticks_msec() / 1000.0 + minf(8.0, 0.5 * pow(2, _retry))
	_retry += 1


func _process(_dt: float) -> void:
	var now := Time.get_ticks_msec() / 1000.0
	if _ws == null:
		if _wanted and state == "reconnecting" and now >= _retry_at:
			_open()
		return
	_ws.poll()
	match _ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not _was_open:
				_was_open = true
				var hello := {"t": "hello", "v": Spec.protocol_version, "spec": Spec.spec_version, "client": "godot", "name": _profile["name"], "species": _profile["species"]}
				if Settings.token != "":
					hello["token"] = Settings.token
				_ws.send_text(JSON.stringify(hello))
			while _ws.get_available_packet_count() > 0:
				var text := _ws.get_packet().get_string_from_utf8()
				var msg = JSON.parse_string(text)
				if typeof(msg) == TYPE_DICTIONARY:
					_handle(msg)
			if state == "online" and now >= _ping_at:
				_ping_at = now + 3.0
				_ping_id += 1
				_ping_sent[_ping_id] = Time.get_ticks_msec()
				send({"t": "ping", "id": _ping_id})
		WebSocketPeer.STATE_CLOSED:
			_ws = null
			if _wanted:
				if not _was_open:
					last_error = "Could not reach the game server at %s" % Settings.server_url
				_schedule_retry()
			else:
				_set_state("offline")


func _handle(msg: Dictionary) -> void:
	match msg.get("t", ""):
		"welcome":
			player_id = msg["playerId"]
			player_name = msg["name"]
			Settings.token = msg["token"]
			Settings.save_all()
			_retry = 0
			last_error = ""
			_set_state("online")
		"pong":
			var id := int(msg["id"])
			if _ping_sent.has(id):
				rtt = Time.get_ticks_msec() - int(_ping_sent[id])
				_ping_sent.erase(id)
		"error":
			if msg["code"] in ["version", "spec"]:
				last_error = msg["msg"]
				_wanted = false
	message.emit(msg)


func _set_state(s: String) -> void:
	if s == state:
		return
	state = s
	state_changed.emit(s)
