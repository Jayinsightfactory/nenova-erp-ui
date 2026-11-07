import bpy, sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[-1])
tot=0
for o in bpy.data.objects:
    if o.type=='MESH':
        t=sum(len(p.vertices)-2 for p in o.data.polygons); tot+=t
        if not o.name.startswith(('hat_','gls_','hnd_','bdg_')): print('OBJ',o.name,t,[m.name for m in o.data.materials],o.parent and o.parent.name,[m.type for m in o.modifiers])
print('TOTAL',tot,'ACT',[a.name for a in bpy.data.actions][:12])
