static func update(_actor, _state: Dictionary, _delta: float) -> void:
	var camera = _actor.get_tree().get_first_node_in_group("camera")
	if not camera: return
	var target_y = _actor.global_position.y - 200.0
	camera.global_position.y = lerp(camera.global_position.y, target_y, 0.1)
