static func fixed(actor, state: Dictionary, _delta: float, _channels: Dictionary) -> void:
	if not is_instance_valid(actor): return
	var colliding = []
	var game = actor.get_parent()
	var bounds = get_bounds(actor)
	var landed = false
	for other_name in game.actors:
		if other_name == actor.name: continue
		var other = game.actors[other_name]
		if not is_instance_valid(other): continue
		var obounds = get_bounds(other)
		if bounds.intersects(obounds):
			colliding.append(other_name)
			if other.type == "platform" and state.get("vel_y", 0.0) >= 0.0:
				var actor_bottom = bounds.position.y + bounds.size.y
				var platform_top = obounds.position.y
				if actor_bottom <= platform_top + 8.0:
					state["on_ground"] = true
					state["vel_y"] = 0.0
					actor.global_position.y = platform_top - 16.0
					state["_col"] = "Y"
					state["_col_action"] = "land"
					landed = true
	state["_col_with"] = colliding
	if not landed and state.get("on_ground", false):
		state["on_ground"] = false
	state["_landed_prev"] = landed

static func get_bounds(actor) -> Rect2:
	var size = 32.0
	return Rect2(actor.global_position - Vector2(size/2, size/2), Vector2(size, size))
