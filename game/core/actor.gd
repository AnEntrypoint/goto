class_name Actor extends Node2D

var state: Dictionary = {}
var systems: Array = []
var type: String = ""
var net_id: int = 0
var is_controlled: bool = false

const INSPECT_MAP = {"vel_x": "v:(%d,%d)|vel_y", "on_ground": "g:%s|Y|N", "_grounded_change": "%s", "_jump_triggered": "J!", "_col": "c:%s", "patrol_dir": "p:%d", "_patrol_flip": "F!", "_key_pressed": "K:%s"}
const TYPE_SYSTEMS = {"player": ["multiplayer_input", "jumping", "physics", "collision", "death", "camera"], "enemy": ["enemy", "physics", "collision", "death"], "platform": [], "breakable_platform": ["breakable"]}

func _ready() -> void:
	set_process(true)
	set_physics_process(true)
	set_process_unhandled_input(true)
	_init_sprite()

func _process(delta: float) -> void:
	for k in state.keys():
		if k.begins_with("_"):
			state[k] = false if state[k] is bool else ("" if state[k] is String else 0)
	for sys in systems:
		if sys.enabled and sys.callable_update:
			sys.callable_update.call(self, state, delta)
	global_position.x += state.get("vel_x", 0.0) * delta
	queue_redraw()

func _physics_process(delta: float) -> void:
	var channels = {}
	for sys in systems:
		if sys.enabled and sys.callable_fixed:
			sys.callable_fixed.call(self, state, delta, channels)
	for key in channels:
		if key == "_systems": continue
		var val = 0.0
		var mul = 1.0
		for op in channels[key]:
			match op.mode:
				"REPLACE": val = op.value
				"ADD": val += op.value
				"MULTIPLY": mul *= op.value
		state[key] = val * mul

func _unhandled_input(event: InputEvent) -> void:
	if not is_controlled: return
	for sys in systems:
		if sys.enabled and sys.callable_input:
			sys.callable_input.call(self, state, event)

func load_systems_by_type(t: String) -> void:
	type = t
	var sys_list = TYPE_SYSTEMS.get(t, [])
	for sys_name in sys_list:
		var script = load("res://systems/%s.gd" % sys_name)
		if script:
			systems.append({"enabled": true})
			for fn in ["update", "fixed", "input"]:
				systems[-1]["callable_" + fn] = Callable(script, fn) if script.has_method(fn) else null
			print_rich("[green]✓ %s[/green]" % sys_name)
		else:
			print_rich("[red]ERROR: %s[/red]" % sys_name)
	_init_defaults()

func _init_defaults() -> void:
	match type:
		"player":
			state.merge({"vel_x": 0.0, "vel_y": 0.0, "on_ground": false, "gravity": 800.0, "speed": 200.0, "min_x": 0.0, "max_x": 1280.0})
		"enemy":
			state.merge({"vel_x": 0.0, "vel_y": 0.0, "on_ground": false, "gravity": 800.0, "speed": 100.0, "patrol_dir": -1.0, "min_x": 0.0, "max_x": 1280.0})
		"platform":
			state.merge({"breakable": false})

func _init_sprite() -> void:
	var colors = {"player": "#FFFFFF", "enemy": "#FF0000", "platform": "#808080"}
	var col = Color(colors.get(type, "#FFFFFF"))
	var img = Image.create(32, 32, false, Image.FORMAT_RGBA8)
	img.fill(col)
	var sprite = Sprite2D.new()
	sprite.texture = ImageTexture.create_from_image(img)
	add_child(sprite)
	var col_viz = load("res://core/collision_viz.gd").new()
	col_viz.actor_ref = self
	add_child(col_viz)

func inspect() -> String:
	var p = [get_name(), "(%d,%d)" % [int(global_position.x), int(global_position.y)]]
	for k in INSPECT_MAP:
		if k not in state: continue
		var v = state[k]
		var is_empty = (v is bool and not v) or (v is String and v == "") or (v is int and v == 0) or (v is float and v == 0.0)
		if is_empty: continue
		var fmt = INSPECT_MAP[k]
		if "|" in fmt:
			var parts = fmt.split("|")
			if k == "vel_x":
				p.append(parts[0] % [int(v), int(state.get("vel_y", 0))])
			elif k == "on_ground":
				p.append(parts[0] % (parts[1] if v else parts[2]))
		elif "%d" in fmt:
			p.append(fmt % int(v))
		elif "%s" in fmt:
			p.append(fmt % str(v))
		else:
			p.append(fmt)
	return "  ".join(p)

static func ch(channels: Dictionary, key: String, mode: String, value: float) -> void:
	if not channels.has(key): channels[key] = []
	channels[key].append({"mode": mode, "value": value})
