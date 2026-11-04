# scripts/pm3d/import_furniture.py — Kenney Furniture Kit(CC0) 가구를 /pm 3D kit.glb 에 통합
# 실행: blender -b --factory-startup -P scripts/pm3d/import_furniture.py -- public/pm3d
# 기존 kit.glb(자작 모듈)를 불러와 Kenney 가구 모듈을 추가하고 파스텔 클레이 재질로 일괄 교체 후 재-export(Draco).
# 추가 모듈: desk_k1~k3(책상), chair_k1~k2(의자), lamp_k, plant_k1~k2, rug_k, laptop_k
import bpy, math, os, sys
argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
SRC = r'C:\Users\USER\nenova-pm\pm3d\assets-raw\kenney-furniture-kit\Models\GLB format'
if not os.path.isdir(SRC):
    # 폴더 구조가 다르면 glb 를 재귀 탐색해 첫 매치 폴더 사용
    for root, dirs, files in os.walk(r'C:\Users\USER\nenova-pm\pm3d\assets-raw\kenney-furniture-kit'):
        if any(f == 'desk.glb' for f in files): SRC = root; break
assert os.path.isfile(os.path.join(SRC, 'desk.glb')), SRC

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# 기존 kit 불러오기(자작 모듈 유지)
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'kit.glb'))

# 파스텔 클레이 팔레트(무광) — 원본 색 밝기 순위로 매핑
PASTEL = ['#fbf3e6', '#f4c6d0', '#ffd6a5', '#bfe3d6', '#bde0fe', '#d9cff5', '#e9c79a', '#c98f5e']
def lin(h):
    h = h.lstrip('#'); return tuple(((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)) + (1,)
_cache = {}
def pastel_mat(idx):
    if idx in _cache: return _cache[idx]
    m = bpy.data.materials.new(f'kfurn_{idx}'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(PASTEL[idx % len(PASTEL)])
    b.inputs['Roughness'].default_value = 0.92; b.inputs['Metallic'].default_value = 0.0
    _cache[idx] = m; return m

MODULES = [  # (새 모듈명, Kenney 파일, 배율, 회전Z도)
    ('desk_k1', 'desk.glb', 1.5, 180),
    ('desk_k2', 'table.glb', 1.5, 180),
    ('desk_k3', 'tableCross.glb', 1.5, 180),
    ('chair_k1', 'chairDesk.glb', 1.5, 0),
    ('chair_k2', 'chairModernCushion.glb', 1.5, 0),
    ('lamp_k', 'lampRoundFloor.glb', 1.4, 0),
    ('plant_k1', 'pottedPlant.glb', 1.6, 0),
    ('plant_k2', 'plantSmall2.glb', 1.6, 0),
    ('rug_k', 'rugRound.glb', 1.6, 0),
    ('laptop_k', 'laptop.glb', 1.5, 180),
]
for name, f, s, rz in MODULES:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, f))
    news = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(name, None); sc.collection.objects.link(root)
    meshes = [o for o in news if o.type == 'MESH']
    # 재질: 원본 재질별 밝기 순위 → 파스텔 팔레트
    mats = []
    for o in meshes:
        for ms in o.material_slots:
            if ms.material and ms.material not in mats: mats.append(ms.material)
    def luma(m):
        try:
            c = m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value
            return 0.3 * c[0] + 0.6 * c[1] + 0.1 * c[2]
        except Exception: return 0.5
    order = sorted(mats, key=luma, reverse=True)
    remap = {m.name: pastel_mat(i) for i, m in enumerate(order)}
    for o in meshes:
        for ms in o.material_slots:
            if ms.material: ms.material = remap[ms.material.name]
        for p in o.data.polygons: p.use_smooth = False
        if o.parent in news or o.parent is None:
            if o.parent is None:
                o.parent = root
    for o in news:
        if o.parent is None and o is not root: o.parent = root
    root.rotation_euler = (0, 0, math.radians(rz)); root.scale = (s, s, s)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'kit.glb'), export_format='GLB', export_apply=True, export_animations=False,
                          export_yup=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
print('PM3D_FURN_DONE')
