static func load_level(game, level_path: String) -> void:
	var file = FileAccess.open(level_path, FileAccess.READ)
	if not file: return
	var json = JSON.new()
	var err = json.parse(file.get_as_text())
	if err: return
	var level = json.data
	if not level: return
	if "platforms" in level:
		for p in level.platforms:
			var ptype = "breakable_platform" if p.get("breakable", false) else "platform"
			var platform = game.spawn(ptype, Vector2(p.x, p.y))
			if p.get("breakable", false):
				platform.state["max_hits"] = p.get("max_hits", 3)
	if "enemies" in level:
		for e in level.enemies:
			var enemy = game.spawn("enemy", Vector2(e.x, e.y))
			if "speed" in e:
				enemy.state["speed"] = e.speed
	if "players" in level:
		for p in level.players:
			game.spawn_player(p.id, Vector2(p.x, p.y))
