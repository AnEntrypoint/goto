extends Node

var actors: Dictionary = {}
var frame: int = 0

func _ready() -> void:
	set_process(true)
	print_rich("[cyan]=== GAME BOOT ===[/cyan]")

func _process(_delta: float) -> void:
	frame += 1
	var to_remove = []
	for name in actors:
		if not is_instance_valid(actors[name]):
			to_remove.append(name)
	for name in to_remove:
		actors.erase(name)
	var event_actors = []
	for name in actors:
		var state = actors[name].state
		if state.get("_key_pressed", "") or state.get("_key_released", "") or state.get("_jump_triggered", false) or state.get("_grounded_change", ""):
			event_actors.append(name)
	if event_actors.size() > 0:
		print_rich("[yellow]• %d[/yellow]" % frame)
		for name in event_actors:
			print_rich("[cyan]%s[/cyan]" % actors[name].inspect())

func spawn(type: String, pos: Vector2):
	var a = load("res://core/actor.gd").new()
	a.set_name(type + "_" + str(randi()))
	a.global_position = pos
	a.type = type
	a.is_controlled = (type == "player")
	a.load_systems_by_type(type)
	add_child(a)
	actors[a.name] = a
	return a

func spawn_player(player_id: int, pos: Vector2):
	var a = spawn("player", pos)
	a.state["player_id"] = player_id
	a.is_controlled = (player_id == 1)
	return a

func actor_state(name: String) -> Dictionary:
	if name in actors:
		return actors[name].state
	return {}

func list_actors() -> Array:
	return actors.keys()

func get_frame() -> int:
	return frame

func debug_state(actor_name: String) -> String:
	if actor_name in actors:
		return actors[actor_name].inspect()
	return "Actor not found"

func input_key(key: String) -> void:
	var keycode = KEY_A if key == "A" else KEY_D if key == "D" else KEY_SPACE if key == "SPACE" else KEY_UP if key == "UP" else 0
	if keycode == 0: return
	var event = InputEventKey.new()
	event.keycode = keycode
	event.pressed = true
	get_tree().root.propagate_input(event)

func set_player_move(direction: float) -> String:
	for name in actors:
		if actors[name].type == "player":
			actors[name].state["move_x"] = direction
			actors[name].state["vel_x"] = direction * actors[name].state.get("speed", 200.0)
			return "Player move set to: " + str(direction)
	return "No player found"

func jump_player() -> String:
	for name in actors:
		if actors[name].type == "player" and actors[name].state.get("on_ground", false):
			actors[name].state["vel_y"] = -400.0
			return "Jump triggered"
	return "Cannot jump"
