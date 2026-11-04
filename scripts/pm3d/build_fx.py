# scripts/pm3d/build_fx.py — /pm 스킬 발사체 기본 9종(단계 기본 이펙트, docs/pm-skills-mounts.md 5절)
# 실행: blender -b --factory-startup -P scripts/pm3d/build_fx.py -- public/pm3d
# 산출: public/pm3d/fx.glb (모듈 fx_<shape>) + public/pm/fx/<shape>.png (2D 스프라이트 96px 투명)
# 모양: paperPlane(발주) box(입고) petal(분배) truck(현장출고) bolt(견적) envelope(거래처전달) coin(입금) globe(해외송금) arrowUp(이익)
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d')
PUB = os.path.abspath(os.path.join(OUT, '..', 'pm', 'fx'))
os.makedirs(PUB, exist_ok=True)
R = math.radians
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
_m = {}
def mat(name, hexc, rough=0.85, emit=0.0):
    if name in _m: return _m[name]
    h = hexc.lstrip('#'); c = [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = 0.0
    if emit: b.inputs['Emission Color'].default_value = (*c, 1); b.inputs['Emission Strength'].default_value = emit
    _m[name] = m; return m
PAR = [None]
def fin(o, mn, hx, smooth=True, emit=0.0):
    o.data.materials.clear(); o.data.materials.append(mat(mn, hx, emit=emit))
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    if PAR[0] is not None: o.parent = PAR[0]
    return o
def sphere(loc, r, mn, hx, scale=(1, 1, 1), seg=14, ring=10, **k):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=ring); o = bpy.context.object; o.scale = scale; return fin(o, mn, hx, **k)
def cone(loc, r1, r2, d, mn, hx, rot=(0, 0, 0), v=12, **k):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=d, location=loc, rotation=rot, vertices=v); o = bpy.context.object; return fin(o, mn, hx, **k)
def box(loc, size, mn, hx, rot=(0, 0, 0), bev=0.015, **k):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); o = bpy.context.object; o.scale = size
    if bev > 0:
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        md = o.modifiers.new('b', 'BEVEL'); md.width = bev; md.segments = 2
    return fin(o, mn, hx, smooth=False, **k)
def cyl(loc, r, d, mn, hx, rot=(0, 0, 0), v=14, **k):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, location=loc, rotation=rot, vertices=v); o = bpy.context.object; return fin(o, mn, hx, **k)
def module(name):
    e = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(e); PAR[0] = e; return e

ROOTS = {}
def M(name):
    ROOTS[name] = module('fx_' + name); return ROOTS[name]

M('paperPlane')
cone((0, 0, 0.1), 0.09, 0.0, 0.4, 'pp', '#fffdf5', rot=(R(-90), 0, 0), v=3)
box((0, 0.1, 0.13), (0.26, 0.2, 0.012), 'pp_w', '#e8f4fa', bev=0)
M('box')
box((0, 0, 0.12), (0.24, 0.24, 0.22), 'bx', '#e3b888')
box((0, 0, 0.23), (0.25, 0.07, 0.012), 'bx_tape', '#f6e3c5', bev=0)
M('petal')
for a in range(5):
    sphere((0.08 * math.cos(a * 1.257), 0.08 * math.sin(a * 1.257), 0.1), 0.055, 'pt', '#ffb7c9', scale=(1.5, 0.8, 0.3))
sphere((0, 0, 0.11), 0.045, 'pt_c', '#ffd166')
M('truck')
box((-0.04, 0, 0.14), (0.2, 0.14, 0.12), 'tr', '#fffdf5'); box((0.11, 0, 0.11), (0.1, 0.13, 0.08), 'tr_cab', '#9fd3c7')
for x in (-0.07, 0.09):
    for y in (-0.07, 0.07): cyl((x, y, 0.05), 0.035, 0.02, 'tr_w', '#4a3b35', rot=(R(90), 0, 0), v=10)
M('bolt')
box((0, 0, 0.22), (0.1, 0.03, 0.18), 'bo', '#ffd23f', rot=(0, R(20), 0), bev=0, emit=0.8)
box((0.045, 0, 0.1), (0.1, 0.03, 0.18), 'bo', '#ffd23f', rot=(0, R(20), 0), bev=0, emit=0.8)
M('envelope')
box((0, 0, 0.1), (0.3, 0.012, 0.2), 'ev', '#fffdf5', bev=0)
cone((0, -0.012, 0.14), 0.14, 0, 0.1, 'ev_f', '#f4c6d0', rot=(R(180), 0, R(45)), v=4)
M('coin')
cyl((0, 0, 0.12), 0.13, 0.04, 'co', '#ffd166', rot=(R(90), 0, 0), v=18)
cyl((0, -0.021, 0.12), 0.08, 0.004, 'co_i', '#f0a84a', rot=(R(90), 0, 0), v=14)
M('globe')
sphere((0, 0, 0.14), 0.13, 'gl', '#8ecae6')
for p in [(0.05, -0.1, 0.18), (-0.06, -0.08, 0.1)]: sphere(p, 0.045, 'gl_l', '#95d5b2', scale=(1, 0.5, 0.8))
M('arrowUp')
cyl((0, 0, 0.1), 0.035, 0.2, 'au', '#3fbf7f')
cone((0, 0, 0.26), 0.09, 0, 0.14, 'au', '#3fbf7f')
PAR[0] = None

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'fx.glb'), export_format='GLB', export_apply=True, export_animations=False,
                          export_yup=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
print('PM3D_FX_GLB')

# 스프라이트 렌더
eng = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in eng else 'BLENDER_EEVEE_NEXT'
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
sun = bpy.data.lights.new('s', 'SUN'); so = bpy.data.objects.new('s', sun); sc.collection.objects.link(so)
so.rotation_euler = (R(55), 0, R(-35)); sun.energy = 3
cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'
cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
cam.rotation_euler = (R(60), 0, R(-35))
import mathutils
fwd = cam.rotation_euler.to_matrix() @ mathutils.Vector((0, 0, -1))
sc.render.resolution_x = sc.render.resolution_y = 96
for name, root in ROOTS.items():
    for r in ROOTS.values():
        hide = r is not root
        r.hide_render = hide
        for ch in r.children_recursive: ch.hide_render = hide
    pts = []
    for ch in root.children_recursive:
        if ch.type != 'MESH': continue
        for c in ch.bound_box: pts.append(ch.matrix_world @ mathutils.Vector(c))
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr = (lo + hi) / 2
    cd.ortho_scale = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z) * 1.4
    cam.location = ctr - fwd * 8
    sc.render.filepath = os.path.join(PUB, name + '.png')
    bpy.ops.render.render(write_still=True)
print('PM3D_FX_DONE', len(ROOTS))
