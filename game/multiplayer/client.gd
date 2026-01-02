extends Node2D

var ws: WebSocketPeer
var actors: Dictionary = {}
var local_player_id: int = 0
var debug_text: String = "Connecting..."
var held_keys: Dictionary = {"left": false, "right": false}
var camera: Camera2D

func _ready() -> void:
	set_process(true)
	camera = Camera2D.new()
	camera.global_position = Vector2(640, 360)
	add_child(camera)
	make_current()
	ws = WebSocketPeer.new()
	ws.connect_to_url("ws://%s:%d" % [Constants.SERVER_HOST, Constants.SERVER_PORT])

func _process(_delta: float) -> void:
	if ws == null:
		return

	ws.poll()
	var state = ws.get_ready_state()

	if state == WebSocketPeer.STATE_OPEN:
		debug_text = "Connected"
		while ws.get_available_packet_count() > 0:
			var packet = ws.get_packet()
			if packet.size() > 0:
				var msg = packet.get_string_from_utf8()
				handle_msg(msg)
		send_input_state()
	elif state == WebSocketPeer.STATE_CONNECTING:
		debug_text = "Connecting..."
	elif state == WebSocketPeer.STATE_CLOSED:
		debug_text = "Disconnected"

	update_camera()
	queue_redraw()

func handle_msg(text: String) -> void:
	var data = JSON.parse_string(text)
	if data == null:
		return

	var msg_type = data.get("type", "")

	if msg_type == "init":
		local_player_id = data.get("playerId", 0)
		var init_actors = data.get("actors", [])
		actors.clear()
		for actor_data in init_actors:
			var name = "%s_%d" % [actor_data.get("type", ""), actor_data.get("net_id", 0)]
			actors[name] = actor_data

	elif msg_type == "update":
		actors.clear()
		var update_actors = data.get("actors", {})
		for actor_name in update_actors:
			actors[actor_name] = update_actors[actor_name]

func _draw() -> void:
	draw_rect(Rect2(0, 0, 1280, 720), Color.SKY_BLUE)
	draw_string(ThemeDB.fallback_font, Vector2(10, 20), "Actors: %d | %s" % [actors.size(), debug_text], HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color.YELLOW)

	if actors.is_empty():
		return

	for actor_name in actors:
		var actor = actors[actor_name]
		if actor == null:
			continue

		var pos_arr = actor.get("pos")
		if pos_arr == null:
			continue

		var pos = Vector2(float(pos_arr[0]), float(pos_arr[1]))
		var actor_type = actor.get("type", "")
		var size = 32
		var color = Color.GRAY

		match actor_type:
			"player":
				color = Color.WHITE
			"enemy":
				color = Color.RED
			"platform":
				color = Color(0.5, 0.5, 0.5)
			"breakable_platform":
				color = Color(0.8, 0.5, 0.2)
				var state_dict = actor.get("state", {})
				size = state_dict.get("width", 32)

		draw_rect(Rect2(pos - Vector2(size/2.0, size/2.0), Vector2(size, size)), color)
		draw_rect(Rect2(pos - Vector2(size/2.0, size/2.0), Vector2(size, size)), Color.BLACK, false, 2.0)

func _unhandled_input(event: InputEvent) -> void:
	if not event is InputEventKey:
		return

	if ws == null or ws.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return

	match event.keycode:
		KEY_A, KEY_LEFT:
			held_keys["left"] = event.pressed
		KEY_D, KEY_RIGHT:
			held_keys["right"] = event.pressed
		KEY_W, KEY_SPACE, KEY_UP:
			if event.pressed:
				ws.send_text(JSON.stringify({"action": "jump"}))
		KEY_R:
			if Input.is_key_pressed(KEY_CTRL):
				get_tree().reload_current_scene()

func send_input_state() -> void:
	var dir = 0.0
	if held_keys["right"]:
		dir = 1.0
	elif held_keys["left"]:
		dir = -1.0
	ws.send_text(JSON.stringify({"action": "move", "direction": dir}))

func update_camera() -> void:
	var player_key = "player_%d" % local_player_id
	var player = actors.get(player_key)
	if player == null:
		return
	var pos_arr = player.get("pos")
	if pos_arr == null or pos_arr.size() < 2:
		return
	var target_y = float(pos_arr[1]) - 200.0
	camera.global_position.y = lerp(camera.global_position.y, target_y, 0.1)
