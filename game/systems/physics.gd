static func fixed(actor, state: Dictionary, delta: float, _channels: Dictionary) -> void:
	var old_grounded = state.get("on_ground", false)

	if not state.get("on_ground", false):
		state["vel_y"] = state.get("vel_y", 0.0) + state.get("gravity", 800.0) * delta

	actor.global_position.y += state.get("vel_y", 0.0) * delta

	var mx = state.get("min_x", 0.0)
	var mx_max = state.get("max_x", 1280.0)
	if actor.global_position.x < mx:
		actor.global_position.x = mx
	elif actor.global_position.x > mx_max:
		actor.global_position.x = mx_max

	state["_grounded_change"] = "↓" if not old_grounded and state.get("on_ground", false) else ("↑" if old_grounded and not state.get("on_ground", false) else "")
