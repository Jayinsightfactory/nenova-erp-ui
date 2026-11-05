# scripts/pm3d/build_shelves.py — /pm 책장·큰 소품 4종을 kit.glb 에 추가(외부 에셋 없음, 전부 프리미티브)
# 실행: blender -b --factory-startup -P scripts/pm3d/build_shelves.py -- public/pm3d
# 기존 kit.glb(자작 모듈 + Kenney 가구)를 불러와 shelf_book/shelf_plant/shelf_arcade/shelf_potplant 모듈을 추가 후 재-export.
# 모듈 루트 이름 = lib/pm3dLayout.shelfModel 과 일치해야 한다(__tests__/pmProps3d.test.js).
import bpy, math, os, sys
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d')
R = math.radians

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'kit.glb'))
for n in ('shelf_book', 'shelf_plant', 'shelf_arcade', 'shelf_potplant'):
    o = bpy.data.objects.get(n)
    if o:
        for c in list(o.children_recursive): bpy.data.objects.remove(c, do_unlink=True)
        bpy.data.objects.remove(o, do_unlink=True)

_m = {}
def mat(name, hexc, rough=0.92, emit=0.0):
    if name in _m: return _m[name]
    h = hexc.lstrip('#'); c = [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = 0.0
    if emit:
        b.inputs['Emission Color'].default_value = (*c, 1); b.inputs['Emission Strength'].default_value = emit
    _m[name] = m; return m

PAR = [None]
def fin(o, hexc, smooth=True, emit=0.0):
    o.data.materials.clear(); o.data.materials.append(mat('sh_' + hexc.lstrip('#') + ('e' if emit else ''), hexc, emit=emit))
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    o.parent = PAR[0]; return o
def ball(loc, r, hexc, scale=(1, 1, 1), seg=14, ring=9, **k):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=ring)
    o = bpy.context.object; o.scale = scale; return fin(o, hexc, **k)
def cyl(loc, r, d, hexc, rot=(0, 0, 0), v=14, r2=None, **k):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, location=loc, rotation=rot, vertices=v)
    else: bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=d, location=loc, rotation=rot, vertices=v)
    return fin(bpy.context.object, hexc, smooth=k.pop('smooth', True), **k)
def box(loc, size, hexc, rot=(0, 0, 0), bev=0.02, **k):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.scale = size
    if bev > 0:
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        md = o.modifiers.new('b', 'BEVEL'); md.width = bev; md.segments = 2
    return fin(o, hexc, smooth=False, **k)
def module(name):
    e = bpy.data.objects.new(name, None); sc.collection.objects.link(e); PAR[0] = e; return e

WOOD, WOOD2, CREAM = '#e9c79a', '#c98f5e', '#fbf3e6'
BOOKS = ['#ff9e8b', '#a0e0c5', '#ffd166', '#bde0fe', '#d5c2f1', '#f7b6cf']

# 1) 책장 — 2단 선반 + 알록달록 책
module('shelf_book')  # 앞이 뚫린 프레임(옆판 2 + 뒤판 + 천장/바닥) — 통짜 상자로 만들면 책이 안 보인다
for sx in (1, -1): box((sx * 0.43, 0, 0.62), (0.05, 0.3, 1.24), '#f4e3c8', bev=0.02)
box((0, 0.13, 0.62), (0.9, 0.05, 1.24), '#f4e3c8', bev=0.02)
for z in (0.02, 1.22): box((0, 0, z), (0.9, 0.3, 0.06), '#f4e3c8', bev=0.02)
for z in (0.36, 0.78): box((0, -0.02, z), (0.8, 0.26, 0.04), WOOD)
for i in range(5):
    box((-0.3 + i * 0.145, -0.03, 0.55 + (0.015 if i % 2 else 0)), (0.1, 0.2, 0.3 - (0.04 if i % 2 else 0)), BOOKS[i], bev=0.01, rot=(0, R(6) if i == 4 else 0, 0))
for i in range(4):
    box((-0.24 + i * 0.16, -0.03, 0.97), (0.1, 0.2, 0.28), BOOKS[(i + 3) % 6], bev=0.01)
ball((0.3, -0.03, 1.0), 0.08, '#8fd19e', scale=(1, 1, 1.2))
cyl((0.3, -0.03, 0.9), 0.06, 0.08, '#f4a6a0', r2=0.045)

# 2) 화분 선반 — 사다리꼴 선반 + 화분들
module('shelf_plant')
for sx in (1, -1): box((sx * 0.42, 0, 0.55), (0.06, 0.3, 1.1), WOOD2, rot=(0, R(-sx * 8), 0))
for i, z in enumerate((0.3, 0.66, 1.0)):
    box((0, 0, z), (0.86 - i * 0.16, 0.3, 0.05), WOOD)
    for j in range(2 - (i == 2)):
        x = (j - 0.5) * (0.5 - i * 0.1) if i < 2 else 0
        cyl((x, 0, z + 0.1), 0.085, 0.14, ['#f4a6a0', '#bde0fe', '#ffd166'][(i + j) % 3], r2=0.06)
        for a in range(3): ball((x + 0.05 * math.cos(a * 2.1), 0.05 * math.sin(a * 2.1), z + 0.24), 0.07, '#8fd19e', scale=(1, 1, 1.3))

# 3) 오락기 — 아케이드 캐비닛
module('shelf_arcade')
box((0, 0, 0.6), (0.72, 0.6, 1.2), '#8b7dff', bev=0.04)
box((0, -0.26, 0.92), (0.56, 0.12, 0.4), '#2b2f3a', rot=(R(-12), 0, 0), bev=0.02)
box((0, -0.3, 0.92), (0.46, 0.06, 0.3), '#9df0ff', rot=(R(-12), 0, 0), bev=0, emit=0.8)
box((0, -0.36, 0.62), (0.6, 0.2, 0.08), '#6f5fe0', bev=0.02)
cyl((-0.12, -0.4, 0.68), 0.016, 0.08, '#fffdf5', rot=(R(14), 0, 0))
ball((-0.12, -0.42, 0.72), 0.03, '#e2413b')
for i, c in enumerate(('#ffd166', '#a0e0c5')): cyl((0.08 + i * 0.12, -0.42, 0.66), 0.03, 0.03, c, rot=(R(78), 0, 0))
box((0, -0.1, 1.26), (0.76, 0.44, 0.14), '#ff6b9d', bev=0.03)

# 4) 큰 화분 — 바닥 대형 식물
module('shelf_potplant')
cyl((0, 0, 0.22), 0.26, 0.44, '#f4a6a0', r2=0.19)
torus = lambda: None  # (사용 안 함)
cyl((0, 0, 0.46), 0.2, 0.05, '#e58f89', v=16)
cyl((0, 0, 0.7), 0.045, 0.5, '#b07a4e')
for a in range(7):
    ang = a * 2 * math.pi / 7
    o = ball((0.3 * math.cos(ang), 0.3 * math.sin(ang), 1.1 + (a % 2) * 0.12), 0.2, '#8fd19e', scale=(1.5, 0.6, 0.35))
    o.rotation_euler = (0, R(-28), ang)
ball((0, 0, 1.3), 0.17, '#6cc58f')

PAR[0] = None
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'kit.glb'), export_format='GLB', export_apply=True, export_animations=False,
                          export_yup=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
print('PM3D_SHELVES_DONE')
