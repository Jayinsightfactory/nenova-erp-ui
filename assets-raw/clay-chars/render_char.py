# 사용: blender -b -P render_char.py -- <char.glb> <out.png> <race 이름 또는 none>
import bpy, sys, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a[0])
sc = bpy.context.scene
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
idle = bpy.data.actions.get('idle')
if arm.animation_data:
    for t in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(t)
arm.animation_data_create(); arm.animation_data.action = idle
try: arm.animation_data.action_slot = idle.slots[0]
except Exception: pass
sc.frame_set(6)
for o in bpy.data.objects:
    if o.type == 'MESH':
        hide = o.name.startswith(('hat_', 'gls_', 'hnd_', 'bdg_', 'race_', 'Icosphere')) and o.name != a[2]
        o.hide_render = hide
        for m in o.data.materials:
            if not m or not m.use_nodes: continue
            b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if b: b.inputs['Roughness'].default_value = 0.85; b.inputs['Metallic'].default_value = 0.05
# 조명: 물고기 3차와 동일 계열
def hexc(h): h=h.lstrip('#'); return tuple((int(h[i:i+2],16)/255)**2.2 for i in (0,2,4))
w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs['Color'].default_value = (*hexc('#dfe9f7'), 1); bg.inputs['Strength'].default_value = 0.9
sun = bpy.data.objects.new('K', bpy.data.lights.new('K', 'SUN')); sun.data.energy = 3.5; sun.data.color = hexc('#ffe5d9'); sun.data.angle = math.radians(20)
sun.rotation_euler = (math.radians(40), math.radians(20), math.radians(-30)); sc.collection.objects.link(sun)
cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); cam.location = (1.6, -3.6, 1.6)
cam.rotation_euler = (Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.5; sc.collection.objects.link(cam); sc.camera = cam
for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try: sc.render.engine = e; break
    except TypeError: pass
for vt in ('ACES 1.3', 'AgX'):
    try: sc.view_settings.view_transform = vt; break
    except TypeError: pass
sc.render.resolution_x = 700; sc.render.resolution_y = 800; sc.render.filepath = a[1]
bpy.ops.render.render(write_still=True)
