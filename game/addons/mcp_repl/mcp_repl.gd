extends Node

var server: TCPServer
var clients: Array = []
var buffers: Dictionary = {}
var game

func _ready() -> void:
	if Engine.is_editor_hint(): return
	await get_tree().process_frame
	await get_tree().process_frame
	var root = get_tree().root.get_child(0)
	if root and root.get_child_count() > 0:
		game = root.get_child(0)
	if not game or not game.has_method("spawn"):
		game = null
		if root:
			for child in root.get_children():
				if child.has_method("spawn"):
					game = child
					break
	server = TCPServer.new()
	if server.listen(9999) != OK: return
	print("REPL: 0.0.0.0:9999")

func _process(_delta: float) -> void:
	if not server: return
	if server.is_connection_available():
		var c = server.take_connection()
		clients.append(c)
		buffers[c.get_instance_id()] = ""

	for i in range(clients.size() - 1, -1, -1):
		var c = clients[i]
		if c.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			clients.remove_at(i)
			buffers.erase(c.get_instance_id())
			continue

		if c.get_available_bytes() > 0:
			var chunk = c.get_utf8_string(c.get_available_bytes())
			var id = c.get_instance_id()
			buffers[id] += chunk

			while "\n" in buffers[id]:
				var line_end = buffers[id].find("\n")
				var line = buffers[id].substr(0, line_end).strip_edges()
				buffers[id] = buffers[id].substr(line_end + 1)

				if line.is_empty(): continue
				var data = JSON.parse_string(line)
				if data and data.has("method") and game:
					var result = _call_hook(data.method, data.get("args", []))
					c.put_utf8_string(JSON.stringify(result) + "\n")

func _call_hook(method: String, args: Array):
	if not game.has_method(method):
		return {"error": "Unknown method: " + method}
	var result = game.callv(method, args)
	return {"result": result}
