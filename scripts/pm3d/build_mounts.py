# scripts/pm3d/build_mounts.py — /pm 탈것 15종(lib/pmMounts.MOUNTS) 에셋 빌드(전부 프리미티브, 외부 에셋 없음)
# 실행: blender -b --factory-startup -P scripts/pm3d/build_mounts.py -- public/pm3d
# 산출: public/pm3d/mounts.glb (모듈 mount_<id>, Draco)
#      public/pm/mounts/<id>.png (2D용 3/4 스프라이트 128px 투명)
#      public/pm/mounts/thumb/<id>.webp (상점 썸네일 256px)
# 톤: 소프트 클레이 파스텔(무광). 탑승 기준: 바닥 원점, 앞 = -Y(캐릭터와 동일), 좌석/발판 높이는 SEAT[id] 로 glb extras 에 기록.
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d')
PUB = os.path.abspath(os.path.join(OUT, '..', 'pm', 'mounts'))
os.makedirs(os.path.join(PUB, 'thumb'), exist_ok=True)
R = math.radians

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
_m = {}
def mat(name, hexc, rough=0.9, emit=0.0):
    if name in _m: return _m[name]
    h = hexc.lstrip('#'); c = [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = 0.0
    if emit: b.inputs['Emission Color'].default_value = (*c, 1); b.inputs['Emission Strength'].default_value = emit
    _m[name] = m; return m

PAR = [None]
def fin(o, mname, hexc, smooth=True, emit=0.0):
    o.data.materials.clear(); o.data.materials.append(mat(mname, hexc, emit=emit))
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    if PAR[0] is not None: o.parent = PAR[0]
    return o
def sphere(loc, r, mn, hx, scale=(1, 1, 1), seg=14, ring=10, **k):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=ring); o = bpy.context.object; o.scale = scale; return fin(o, mn, hx, **k)
def cyl(loc, r, d, mn, hx, rot=(0, 0, 0), v=14, r2=None, **k):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, location=loc, rotation=rot, vertices=v)
    else: bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=d, location=loc, rotation=rot, vertices=v)
    o = bpy.context.object; return fin(o, mn, hx, smooth=k.pop('smooth', True), **k)
def box(loc, size, mn, hx, rot=(0, 0, 0), bev=0.02, **k):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); o = bpy.context.object; o.scale = size
    if bev > 0:
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        md = o.modifiers.new('b', 'BEVEL'); md.width = bev; md.segments = 2
    return fin(o, mn, hx, smooth=False, **k)
def torus(loc, R1, r1, mn, hx, rot=(0, 0, 0), **k):
    bpy.ops.mesh.primitive_torus_add(major_radius=R1, minor_radius=r1, location=loc, rotation=rot, major_segments=18, minor_segments=8); o = bpy.context.object; return fin(o, mn, hx, **k)
def module(name):
    e = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(e); PAR[0] = e; return e
def wheel(x, y, z, r=0.1, w=0.05, mn='wheel', hx='#4a3b35'):
    cyl((x, y, z), r, w, mn, hx, rot=(0, R(90), 0), v=16)

INK, CREAM, WOODB = '#4a3b35', '#fffdf5', '#b07a4e'
SEAT = {}  # id → (탑승 높이, 자세)

def m_kickboard():
    box((0, 0, 0.12), (0.18, 0.55, 0.05), 'kb', '#8fd2e8'); wheel(0, -0.26, 0.08); wheel(0, 0.26, 0.08)
    cyl((0, -0.26, 0.5), 0.025, 0.8, 'kb_pole', '#e8eef5'); box((0, -0.26, 0.9), (0.3, 0.04, 0.05), 'kb_pole', '#e8eef5')
    SEAT['kickboard'] = (0.15, 'stand')
def m_flower_cart():
    box((0, 0.05, 0.3), (0.55, 0.7, 0.3), 'cart', '#f4c6d0', bev=0.04)
    for i, c in enumerate(['#ff9fb0', '#ffd166', '#bdb2ff']):
        sphere((-0.15 + i * 0.15, 0.1, 0.52), 0.09, f'fl{i}', c); sphere((-0.15 + i * 0.15 + 0.03, -0.12, 0.5), 0.07, 'leaf', '#8fd19e')
    wheel(-0.3, 0.2, 0.12, 0.12); wheel(0.3, 0.2, 0.12, 0.12); wheel(-0.3, -0.25, 0.12, 0.12); wheel(0.3, -0.25, 0.12, 0.12)
    box((0, -0.45, 0.42), (0.4, 0.04, 0.04), 'cart_h', WOODB)
    SEAT['flower-cart'] = (0.47, 'sit')
def m_roller():
    for sx in (-0.14, 0.14):
        box((sx, 0, 0.1), (0.12, 0.3, 0.09), 'rs', '#ffd6e0', bev=0.03)
        wheel(sx - 0.04, -0.09, 0.05, 0.045, 0.03, 'rs_w', '#ffd166'); wheel(sx + 0.04, -0.09, 0.05, 0.045, 0.03, 'rs_w', '#ffd166')
        wheel(sx - 0.04, 0.09, 0.05, 0.045, 0.03, 'rs_w', '#ffd166'); wheel(sx + 0.04, 0.09, 0.05, 0.045, 0.03, 'rs_w', '#ffd166')
    SEAT['roller'] = (0.12, 'stand')
def m_bike():
    cyl((0, 0, 0.32), 0.03, 0.55, 'bk', '#ffb4a2', rot=(R(90), 0, 0)); wheel(0, -0.3, 0.16, 0.16, 0.05)
    wheel(-0.16, 0.28, 0.11, 0.11, 0.04); wheel(0.16, 0.28, 0.11, 0.11, 0.04)
    box((0, 0.22, 0.42), (0.16, 0.2, 0.05), 'bk_seat', '#fffdf5'); cyl((0, -0.3, 0.52), 0.02, 0.35, 'bk', '#ffb4a2'); box((0, -0.3, 0.68), (0.3, 0.035, 0.04), 'bk', '#ffb4a2')
    SEAT['bike'] = (0.45, 'sit')
def m_forklift():
    box((0, 0.1, 0.3), (0.5, 0.55, 0.35), 'fk', '#ffd166', bev=0.04); box((0, 0.1, 0.52), (0.4, 0.4, 0.14), 'fk_seatb', '#fffdf5')
    for p in [(-0.2, -0.2), (0.2, -0.2), (-0.2, 0.33), (0.2, 0.33)]: wheel(p[0], p[1], 0.11, 0.11, 0.07)
    cyl((-0.12, -0.33, 0.5), 0.02, 0.8, 'fk_mast', '#8a8071'); cyl((0.12, -0.33, 0.5), 0.02, 0.8, 'fk_mast', '#8a8071')
    box((0, -0.42, 0.08), (0.34, 0.22, 0.03), 'fk_fork', '#e0e0e5')
    SEAT['forklift'] = (0.6, 'sit')
def m_balloon():
    sphere((0, 0, 1.55), 0.42, 'bl', '#ff9e8b', scale=(1, 1, 1.15))
    cyl((0, 0, 0.85), 0.012, 0.9, 'bl_str', '#8a8071', v=8)
    box((0, 0, 0.35), (0.34, 0.34, 0.3), 'bl_basket', '#e9c79a', bev=0.03)
    SEAT['balloon'] = (0.5, 'hang')
def m_cloud():
    for (x, y, r) in [(-0.22, 0, 0.2), (0, 0.05, 0.28), (0.24, -0.02, 0.19), (0.05, -0.18, 0.18)]:
        sphere((x, y, 0.3), r, 'cl', '#ffffff')
    SEAT['cloud'] = (0.55, 'sit')
def m_duck():
    torus((0, 0, 0.22), 0.3, 0.12, 'dk', '#fdffb6', rot=(0, 0, 0))
    sphere((0, -0.34, 0.42), 0.14, 'dk_head', '#fdffb6'); box((0, -0.48, 0.4), (0.1, 0.1, 0.05), 'dk_beak', '#f08a3c')
    for sx in (-1, 1): sphere((sx * 0.05, -0.37, 0.46), 0.02, 'dk_eye', INK, seg=8, ring=6)
    SEAT['duck'] = (0.35, 'sit')
def m_turtle():
    sphere((0, 0, 0.22), 0.34, 'tt_shell', '#8fc7b5', scale=(1, 1.15, 0.6))
    sphere((0, 0, 0.3), 0.26, 'tt_shell2', '#6aa892', scale=(1, 1.1, 0.5))
    sphere((0, -0.42, 0.18), 0.12, 'tt_head', '#bfe3d6')
    for sx in (-1, 1): sphere((sx * 0.04, -0.5, 0.21), 0.018, 'tt_eye', INK, seg=8, ring=6)
    for (sx, sy) in [(-1, -1), (1, -1), (-1, 1), (1, 1)]: sphere((sx * 0.3, sy * 0.25, 0.08), 0.09, 'tt_fin', '#bfe3d6', scale=(1.4, 0.8, 0.5))
    SEAT['turtle'] = (0.45, 'sit')
def m_magic_carpet():
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=10, y_subdivisions=14, size=1)
    o = bpy.context.object; o.scale = (0.55, 0.85, 1)
    import bmesh
    bm = bmesh.new(); bm.from_mesh(o.data)
    for v in bm.verts: v.co.z = 0.26 + 0.05 * math.sin(v.co.y * 5.2)
    bm.to_mesh(o.data); bm.free()
    md = o.modifiers.new('s', 'SOLIDIFY'); md.thickness = 0.035
    fin(o, 'mc', '#bdb2ff')
    for (sx, sy) in [(-1, -1), (1, -1), (-1, 1), (1, 1)]: sphere((sx * 0.26, sy * 0.42, 0.26), 0.035, 'mc_tassel', '#ffd166', seg=8, ring=6)
    SEAT['magic-carpet'] = (0.32, 'sit')
def m_unicorn():
    sphere((0, 0.02, 0.62), 0.24, 'un', '#ffffff', scale=(0.9, 1.5, 0.9))
    sphere((0, -0.4, 0.88), 0.15, 'un_head', '#ffffff', scale=(0.9, 1.2, 1))
    cyl((0, -0.47, 1.1), 0.045, 0.22, 'un_horn', '#ffd166', r2=0.004)
    for i in range(4): sphere((0.02 * (i % 2), -0.27 + i * 0.07, 0.95 - i * 0.03), 0.05, 'un_mane', ['#ff9fb0', '#ffd166', '#8fd2e8', '#bdb2ff'][i], seg=8, ring=6)
    for (sx, sy) in [(-1, -1), (1, -1), (-1, 1), (1, 1)]: cyl((sx * 0.12, sy * 0.22, 0.25), 0.05, 0.5, 'un_leg', '#f3eee1')
    sphere((0, 0.42, 0.72), 0.08, 'un_tail', '#ff9fb0', scale=(0.7, 1.3, 0.7))
    for sx in (-1, 1): sphere((sx * 0.06, -0.52, 0.92), 0.018, 'un_eye', INK, seg=8, ring=6)
    SEAT['unicorn'] = (0.82, 'ride')
def m_gama():
    box((0, 0, 0.52), (0.6, 0.6, 0.5), 'gm', '#b23a2e', bev=0.04)
    cyl((0, 0, 0.87), 0.42, 0.22, 'gm_roof', '#3b2a1c', r2=0.06, v=12)
    box((0, 0, 0.3), (0.64, 1.6, 0.05), 'gm_pole', WOODB)
    box((0, -0.28, 0.5), (0.3, 0.03, 0.3), 'gm_door', '#e9c79a', bev=0.01)
    SEAT['gama'] = (0.42, 'sit')
def m_surfboard():
    sphere((0, 0, 0.1), 0.26, 'sf', '#9be3de', scale=(1, 3.1, 0.12))
    box((0, 0.05, 0.11), (0.05, 1.3, 0.012), 'sf_line', '#ffd166', bev=0)
    SEAT['surfboard'] = (0.14, 'stand')
def m_hoverboard():
    box((0, 0, 0.16), (0.3, 0.75, 0.07), 'hv', '#2b3a55', bev=0.05)
    cyl((0, 0, 0.11), 0.1, 0.03, 'hv_glow', '#7cf7ff', emit=2.0, v=12)
    cyl((0, 0.3, 0.11), 0.07, 0.03, 'hv_glow', '#7cf7ff', emit=2.0, v=12); cyl((0, -0.3, 0.11), 0.07, 0.03, 'hv_glow', '#7cf7ff', emit=2.0, v=12)
    SEAT['hoverboard'] = (0.2, 'stand')
def m_sled():
    for sx in (-0.18, 0.18): box((sx, 0, 0.08), (0.05, 0.85, 0.04), 'sl_run', '#c98f5e', bev=0.01)
    for i in range(4): box((0, -0.3 + i * 0.2, 0.15), (0.44, 0.12, 0.03), 'sl', '#e9c79a', bev=0.01)
    box((0, -0.42, 0.22), (0.44, 0.04, 0.12), 'sl', '#e9c79a', rot=(R(-30), 0, 0))
    SEAT['sled'] = (0.2, 'sit')

BUILD = {
    'kickboard': m_kickboard, 'flower-cart': m_flower_cart, 'roller': m_roller, 'bike': m_bike,
    'forklift': m_forklift, 'balloon': m_balloon, 'cloud': m_cloud, 'duck': m_duck,
    'turtle': m_turtle, 'magic-carpet': m_magic_carpet, 'unicorn': m_unicorn,
    'gama': m_gama, 'surfboard': m_surfboard, 'hoverboard': m_hoverboard, 'sled': m_sled,
}
ROOTS = {}
for mid, fn in BUILD.items():
    root = module('mount_' + mid.replace('-', '_'))
    fn()
    root['seatZ'] = SEAT[mid][0]; root['pose'] = SEAT[mid][1]
    ROOTS[mid] = root
PAR[0] = None

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'mounts.glb'), export_format='GLB', export_apply=True, export_animations=False,
                          export_yup=True, export_extras=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
print('PM3D_MOUNTS_GLB', os.path.join(OUT, 'mounts.glb'))

# ── 스프라이트(128, 3/4 시점)·썸네일(256) 렌더 ──
eng = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in eng else 'BLENDER_EEVEE_NEXT'
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
sun = bpy.data.lights.new('s', 'SUN'); so = bpy.data.objects.new('s', sun); sc.collection.objects.link(so)
so.rotation_euler = (R(55), 0, R(-35)); sun.energy = 3; sun.angle = R(20)
cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'
cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
# 3/4 시점(방위 -35°, 고도 30°) — 2D 장면과 비슷한 느낌
cam.rotation_euler = (R(60), 0, R(-35))
import mathutils
fwd = cam.rotation_euler.to_matrix() @ mathutils.Vector((0, 0, -1))

def render_one(mid, root, px, out_path):
    for r in ROOTS.values():
        hide = r is not root
        r.hide_render = hide
        for ch in r.children_recursive: ch.hide_render = hide
    # 모듈 바운드 중심·크기
    pts = []
    for ch in root.children_recursive:
        if ch.type != 'MESH': continue
        for c in ch.bound_box: pts.append(ch.matrix_world @ mathutils.Vector(c))
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr = (lo + hi) / 2; size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    cd.ortho_scale = size * 1.35
    cam.location = ctr - fwd * 10
    sc.render.resolution_x = sc.render.resolution_y = px
    sc.render.filepath = out_path
    bpy.ops.render.render(write_still=True)

for mid, root in ROOTS.items():
    render_one(mid, root, 128, os.path.join(PUB, mid + '.png'))
    render_one(mid, root, 256, os.path.join(PUB, 'thumb', mid + '.png'))
print('PM3D_MOUNTS_DONE', len(ROOTS))
