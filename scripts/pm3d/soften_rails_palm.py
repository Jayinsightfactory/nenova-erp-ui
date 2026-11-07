# scripts/pm3d/soften_rails_palm.py — 레일 침목 줄무늬 정리 + 야자수 잎 클레이 덩어리화(2026-11-07 퀄리티 정리).
# 실행: blender -b --factory-startup -P scripts/pm3d/soften_rails_palm.py -- public/pm3d/assets   (원본 애셋 기준)
#   · tile_rail_straight: 침목 8개(0.5m 간격) → 6개(4m/6 간격 = 칸 경계에서도 같은 간격) → 촘촘한 줄무늬 반복 완화.
#     침목 색(진한 갈색 m_6a3a1e)은 glTF baseColor 라 웹 재질 색(lib/pmThemes PM3D.PROP_TONE)에서 밝힌다.
#   · prop_palm: 납작한 잎 판 8장 → 잎마다 둥근 덩어리 4개를 휘어지게 이어 Voxel Remesh 로 녹인 찰흙 잎(이름·재질·색 유지)
#   노드 이름·재질 이름·버텍스 컬러(AO 베이크) 속성은 그대로 → 웹(lib/pm3dAssets·assetKit) 수정 불필요. Draco 압축 유지.
import bpy, bmesh, os, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DIR = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d', 'assets')

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)
def select_only(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
def load(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(DIR, name + '.glb'))
def save(name):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(DIR, name + '.glb'), export_format='GLB', export_apply=False, export_yup=True,
                              export_extras=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
def col_attr(o): return o.data.color_attributes.get('Color') or (o.data.color_attributes[0] if len(o.data.color_attributes) else None)
def mean_color(o):
    a = col_attr(o); n = len(a.data)
    return [sum(d.color[k] for d in a.data) / n for k in range(4)] if n else [1, 1, 1, 1]

# ── 레일 ──
for name in ('tile_rail_straight',):  # 모서리 칸은 침목 간격이 이미 부채꼴로 고르다(색만 웹에서)
    load(name)
    O = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
    ties = sorted([o for n, o in O.items() if n.startswith('tie')], key=lambda o: o.name)
    if name == 'tile_rail_straight' and len(ties) == 8:
        step = 4.0 / 6
        for i, o in enumerate(ties[:6]): o.location.x = -2.0 + step * (i + 0.5)
        for o in ties[6:]: bpy.data.objects.remove(o, do_unlink=True)
        ties = ties[:6]
    print('RAIL', name, len(ties))
    save(name)

# ── 야자수 ──
load('prop_palm')
O = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
crown = O['crown']; cc = crown.matrix_world @ Vector((0, 0, 0))
for n in sorted(k for k in O if k.startswith('leaf')):
    o = O[n]; me = o.data; mw = o.matrix_world
    vs = [mw @ v.co for v in me.vertices]
    tip = max(vs, key=lambda p: (p - cc).length)
    mid = sum(vs, Vector()) / len(vs)
    mat = me.materials[0]; col = mean_color(o); a0 = col_attr(o); dom, dt = a0.domain, a0.data_type
    # 잎 뼈대: 왕관 → (중간점 위로 살짝 부푼) → 끝. 2차 베지어로 5개 덩어리, 끝으로 갈수록 가늘게
    ctrl = mid + Vector((0, 0, 0.25))
    bm = bmesh.new()
    side = (tip - cc).cross(Vector((0, 0, 1))).normalized()
    for i, t in enumerate((0.16, 0.36, 0.56, 0.74, 0.9)):
        p = cc * (1 - t) ** 2 + ctrl * 2 * (1 - t) * t + tip * t * t
        d = (2 * (1 - t) * (ctrl - cc) + 2 * t * (tip - ctrl)).normalized()
        w = 0.44 - 0.06 * i; L = 0.32 - 0.03 * i
        g = bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=8, radius=1.0)
        up = d.cross(side).normalized()
        R = Matrix((side, d, up)).transposed().to_4x4()  # 열 = (옆, 진행, 위)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(p) @ R @ Matrix.Diagonal((w, L, 0.085, 1)), verts=g['verts'])
    bm.transform(mw.inverted())  # 로컬 좌표로
    bm.to_mesh(me); bm.free()
    while len(me.color_attributes): me.color_attributes.remove(me.color_attributes[0])
    select_only(o)
    r = o.modifiers.new('R', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = 0.035; r.adaptivity = 0; bpy.ops.object.modifier_apply(modifier='R')
    s = o.modifiers.new('S', 'CORRECTIVE_SMOOTH'); s.iterations = 6; s.factor = 0.5; s.use_only_smooth = True; bpy.ops.object.modifier_apply(modifier='S')
    t0 = tris(o)
    if t0 > 260:
        d_ = o.modifiers.new('D', 'DECIMATE'); d_.ratio = 260 / t0; bpy.ops.object.modifier_apply(modifier='D')
    me.materials.clear(); me.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    a = me.color_attributes.new('Color', dt, dom)
    for dd in a.data: dd.color = col
    print('LEAF', n, tris(o))
save('prop_palm')

# 파라솔 덮개 색 통일은 애셋이 아니라 웹 재질 색으로 한다(lib/pmThemes PM3D.PROP_TONE — 덮개 색 = glTF baseColor, 버텍스 컬러는 AO 명암만)
print('SOFTEN_DONE')
