static func input(_actor, state: Dictionary, event: InputEvent) -> void:
	if not event is InputEventKey: return
	var player_id = state.get("player_id", 1)
	var p1_keys = [KEY_A, KEY_D, KEY_W, KEY_SPACE]
	var p2_keys = [KEY_LEFT, KEY_RIGHT, KEY_UP]
	var is_p1_input = event.keycode in p1_keys
	var is_p2_input = event.keycode in p2_keys
	if (player_id == 1 and not is_p1_input) or (player_id == 2 and not is_p2_input): return

	var k = state.get("keys_held", {})
	state["keys_held"] = k
	if event.pressed:
		if event.keycode in [KEY_A, KEY_LEFT]: k[0] = true; state["_key_pressed"] = "L"
		elif event.keycode in [KEY_D, KEY_RIGHT]: k[1] = true; state["_key_pressed"] = "R"
		elif event.keycode in [KEY_W, KEY_UP]: state["_jump_input"] = true
	else:
		if event.keycode in [KEY_A, KEY_LEFT]: k[0] = false; state["_key_released"] = "L"
		elif event.keycode in [KEY_D, KEY_RIGHT]: k[1] = false; state["_key_released"] = "R"
	state["move_x"] = 1.0 if k.get(1, false) else (-1.0 if k.get(0, false) else 0.0)
	state["vel_x"] = state["move_x"] * state.get("speed", 200.0)
