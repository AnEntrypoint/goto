extends Node

func _ready() -> void:
	var client = load("res://multiplayer/client.gd").new()
	add_child(client)
