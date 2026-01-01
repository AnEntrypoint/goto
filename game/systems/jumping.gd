static func input(_actor, state: Dictionary, event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_SPACE or event.keycode == KEY_W or event.keycode == KEY_UP:
			if state.get("on_ground", false):
				state["vel_y"] = -400.0
				state["_jump_triggered"] = true
			else:
				state["_jump_blocked"] = true
