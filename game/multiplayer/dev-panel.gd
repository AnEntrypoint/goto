extends Control

var visible_dev = false
var client_ref = null
var font_size = 12

func _ready():
	set_process_input(true)

func _input(event: InputEvent):
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_F12:
			visible_dev = !visible_dev
			queue_redraw()
			get_tree().root.set_input_as_handled()

func _draw():
	if not visible_dev or client_ref == null:
		return

	var pos = Vector2(10, 10)
	var bg_rect = Rect2(pos, Vector2(400, 300))

	draw_rect(bg_rect, Color.BLACK.with_alpha(0.8))
	draw_rect(bg_rect, Color.WHITE, false, 2.0)

	var text_pos = pos + Vector2(15, 15)
	var line_height = font_size + 4

	var debug_lines = [
		"[DEV PANEL - Press F12 to toggle]",
		"",
		"Player: ID=%d, Stage=%d" % [client_ref.local_player_id, client_ref.stage],
		"Frame: %d" % client_ref.frame if "frame" in client_ref else "Frame: N/A",
		"Actors: %d" % client_ref.actors.size(),
		"",
		"Controls:",
		"  WASD/Arrows - Move",
		"  Space/W - Jump",
		"  F12 - Toggle DevPanel",
		"",
		"Server: %s:%d" % [Constants.SERVER_HOST, Constants.SERVER_PORT],
		"Connection: %s" % ("OPEN" if client_ref.ws and client_ref.ws.get_ready_state() == WebSocketPeer.STATE_OPEN else "CLOSED")
	]

	for line in debug_lines:
		draw_string(ThemeDB.fallback_font, text_pos, line)
		text_pos.y += line_height

func set_client(client):
	client_ref = client
