"""PredioAI controlled intervention taxonomy.

Activity identifiers describe requested work, not inferred material,
measurements, permits, or structural safety.
"""
ACTIVITIES = {
    "repair": {
        "repair_wall": ("Reparar muro", "wall_surface"),
        "repair_floor": ("Reparar piso", "floor_surface"),
        "repair_roof": ("Reparar techo", "roof_surface"),
        "repair_leak": ("Reparar filtración", "affected_surface"),
    },
    "maintenance": {
        "paint_walls": ("Pintar paredes", "wall_surface"),
        "paint_ceiling": ("Pintar techo", "ceiling_surface"),
        "waterproof": ("Impermeabilizar", "affected_surface"),
        "renew_finishes": ("Renovar acabados", "selected_surface"),
    },
    "remodel": {
        "replace_floor": ("Reemplazar piso", "floor_surface"),
        "remodel_bathroom": ("Remodelar baño", "selected_elements"),
        "remodel_kitchen": ("Remodelar cocina", "selected_elements"),
        "change_layout": ("Cambiar distribución", "selected_elements"),
    },
    "structural": {
        "modify_structural_wall": ("Modificar muro estructural", "engineering_review"),
        "modify_slab": ("Modificar losa", "engineering_review"),
    },
    "expansion": {
        "expand_room": ("Ampliar habitación", "irm_review"),
        "new_space": ("Construir nuevo espacio", "irm_review"),
        "add_floor": ("Añadir piso", "irm_review"),
    },
}


def validate_activities(work_type, activities):
    if not activities:
        raise ValueError("Select at least one activity")
    if len(activities) > 20 or len(activities) != len(set(activities)):
        raise ValueError("Activities must be unique (maximum 20)")
    allowed = ACTIVITIES[work_type]
    if any(activity not in allowed for activity in activities):
        raise ValueError("Activity does not belong to selected work category")
    return [
        {"id": activity, "label": allowed[activity][0],
         "measurement_target": allowed[activity][1],
         "measurement_status": "not_verified"}
        for activity in activities
    ]
