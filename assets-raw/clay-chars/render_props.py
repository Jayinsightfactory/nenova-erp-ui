# 사용: blender -b -P render_props.py -- <out.png> <a.glb> [b.glb ...]  (한 줄로 나란히)
import bpy, sys, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]; out, files = a[0], a[1:]
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
x = 0.0
for f in files:
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=f); new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in new if o.type == 'MESH' for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    size = max(hi - lo); k = 3.0 / size
    for r in roots:
        r.scale = r.scale * k; r.location = (r.location - Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))) * k + Vector((x, 0, 0))
    x += 3.6
    for o in new:
        if o.type == 'MESH':
            for m in o.data.materials:
                b = m and m.node_tree and next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                if b: b.inputs['Roughness'].default_value = 0.85; b.inputs['Metallic'].default_value = 0.05
def hexc(h): h=h.lstrip('#'); return tuple((int(h[i:i+2],16)/255)**2.2 for i in (0,2,4))
w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs['Color'].default_value = (*hexc('#dfe9f7'), 1); bg.inputs['Strength'].default_value = 0.9
sun = bpy.data.objects.new('K', bpy.data.lights.new('K', 'SUN')); sun.data.energy = 3.5; sun.data.color = hexc('#ffe5d9'); sun.data.angle = math.radians(20)
sun.rotation_euler = (math.radians(40), math.radians(20), math.radians(-30)); sc.collection.objects.link(sun)
cx = (x - 3.6) / 2
cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); cam.location = (cx + 4, -8, 6)
cam.rotation_euler = (Vector((cx, 0, 1.2)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.type = 'ORTHO'; cam.data.ortho_scale = max(5, x); sc.collection.objects.link(cam); sc.camera = cam
for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try: sc.render.engine = e; break
    except TypeError: pass
try: sc.view_settings.view_transform = 'AgX'
except TypeError: pass
sc.render.resolution_x = int(260 * len(files) + 200); sc.render.resolution_y = 420; sc.render.filepath = out
bpy.ops.render.render(write_still=True)
