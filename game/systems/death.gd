static func fixed(actor, _state: Dictionary, _delta: float, _channels: Dictionary) -> void:
	if actor.global_position.y > 600:
		actor.queue_free()
