import bpy, sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[-1])
for o in bpy.data.objects:
    extra=''
    if o.type=='MESH':
        extra=f"tris={sum(len(p.vertices)-2 for p in o.data.polygons)} mats={[m.name for m in o.data.materials]} vg={len(o.vertex_groups)} parent={o.parent.name if o.parent else None} dims={tuple(round(x,2) for x in o.dimensions)}"
    if o.type=='ARMATURE': extra=f"bones={[b.name for b in o.data.bones]}"
    print('OBJ',o.name,o.type,extra)
print('ACT',[a.name for a in bpy.data.actions])
