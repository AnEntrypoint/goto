extends Node

var loaded_levels = {}

func load_level(stage: int) -> Dictionary:
	var level_path = "res://levels/stage%d.json" % stage

	if loaded_levels.has(stage) and false:
		return loaded_levels[stage]

	var file = FileAccess.open(level_path, FileAccess.READ)
	if file == null:
		print("ERROR: Could not load level ", level_path)
		return {}

	var content = file.get_as_text()
	var json = JSON.new()
	var parsed = json.parse(content)

	if parsed == null or json.error:
		print("ERROR: Failed to parse ", level_path, ": ", json.get_error_message())
		return {}

	loaded_levels[stage] = parsed
	return parsed

func get_level(stage: int) -> Dictionary:
	return load_level(stage)

func clear_cache():
	loaded_levels.clear()
