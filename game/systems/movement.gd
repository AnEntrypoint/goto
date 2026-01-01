static func input(_actor, state: Dictionary, event: InputEvent) -> void:
	if event is InputEventKey:
		var k = state.get("keys_held", {})
		state["keys_held"] = k
		if event.pressed:
			if event.keycode in [KEY_A, KEY_LEFT]: k[0] = true; state["_key_pressed"] = "L"
			elif event.keycode in [KEY_D, KEY_RIGHT]: k[1] = true; state["_key_pressed"] = "R"
		else:
			if event.keycode in [KEY_A, KEY_LEFT]: k[0] = false; state["_key_released"] = "L"
			elif event.keycode in [KEY_D, KEY_RIGHT]: k[1] = false; state["_key_released"] = "R"
		state["move_x"] = 1.0 if k.get(1, false) else (-1.0 if k.get(0, false) else 0.0)
		state["vel_x"] = state["move_x"] * state.get("speed", 200.0)
