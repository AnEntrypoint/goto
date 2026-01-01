static func fixed(_actor, state: Dictionary, _delta: float, channels: Dictionary) -> void:
	if state.get("speed_buff", 1.0) != 1.0:
		if not channels.has("vel_x"): channels["vel_x"] = []
		channels["vel_x"].append({"mode": "MULTIPLY", "value": state.speed_buff})
		state["_buff_applied"] = state.speed_buff
		if not channels.has("_systems"): channels["_systems"] = []
		channels["_systems"].append("buff")
