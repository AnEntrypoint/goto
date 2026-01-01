extends Node2D
var actor_ref

func _draw():
	if actor_ref.state.get("_col", "") != "":
		var col = Color.YELLOW if actor_ref.state["_col"] == "Y" else Color.MAGENTA
		draw_rect(Rect2(-16, -16, 32, 32), col, false, 3.0)
