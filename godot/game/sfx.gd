extends Node
## Sound effects and music from res://assets/sfx (the same WAVs the web client plays).

const NAMES := ["fire", "heavy", "shotgun", "throw", "boom", "bigboom", "smallboom", "bounce", "jump", "land", "hurt",
	"splash", "sizzle", "turn", "click", "tick", "error", "teleport", "airstrike", "mine", "beep", "ko", "win", "lose", "water", "ui"]
const POOL := 12

var _streams := {}
var _players: Array[AudioStreamPlayer] = []
var _next := 0
var _last := {}
var _music: AudioStreamPlayer


func _ready() -> void:
	for n in NAMES:
		var s = load("res://assets/sfx/%s.wav" % n)
		if s:
			_streams[n] = s
	for i in POOL:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)
	_music = AudioStreamPlayer.new()
	var m = load("res://assets/sfx/music.wav")
	if m is AudioStreamWAV:
		m.loop_mode = AudioStreamWAV.LOOP_FORWARD
		m.loop_end = m.data.size() / 2
		_music.stream = m
	add_child(_music)


func play(name: String, volume: float = 1.0) -> void:
	var v := float(Settings.client["sfxVolume"]) * volume
	if v <= 0.0 or not _streams.has(name):
		return
	var now := Time.get_ticks_msec()
	if now - int(_last.get(name, 0)) < 40:
		return
	_last[name] = now
	var p := _players[_next]
	_next = (_next + 1) % POOL
	p.stream = _streams[name]
	p.volume_db = linear_to_db(v)
	p.pitch_scale = randf_range(0.96, 1.04)
	p.play()


func start_music() -> void:
	if _music.stream == null:
		return
	set_music_volume(float(Settings.client["musicVolume"]))
	if not _music.playing:
		_music.play()


func set_music_volume(v: float) -> void:
	_music.volume_db = linear_to_db(maxf(v, 0.0001))
	_music.stream_paused = v <= 0.0
