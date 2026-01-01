static func fixed(actor, state: Dictionary, _delta: float, channels: Dictionary) -> void:
	if not "patrol_dir" in state: state["patrol_dir"] = -1.0
	if actor.global_position.x <= state.get("min_x", 0.0) or actor.global_position.x >= state.get("max_x", 1280.0):
		state["patrol_dir"] *= -1.0
		state["_patrol_flip"] = true
	var vx = state.patrol_dir * state.get("speed", 100.0)
	Actor.ch(channels, "vel_x", "ADD", vx)
