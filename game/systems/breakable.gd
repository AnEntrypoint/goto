static func fixed(actor, state: Dictionary, _delta: float, _channels: Dictionary) -> void:
	var col_with = state.get("_col_with", [])
	if col_with.size() > 0 and not state.get("_hit_this_frame", false):
		state["hit_count"] = state.get("hit_count", 0) + 1
		state["_hit_this_frame"] = true
		if state.get("hit_count", 0) >= state.get("max_hits", 3):
			actor.queue_free()
	else:
		state["_hit_this_frame"] = false
