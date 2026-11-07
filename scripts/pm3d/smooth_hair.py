# scripts/pm3d/smooth_hair.py — 머리 모양(hs_*) 단순화 단계(detail_char.py 다음). 블렌더 백그라운드 전용.
# 실행: blender -b --factory-startup -P scripts/pm3d/smooth_hair.py -- public/pm3d
#   문제(2026-11-07 라이브): 곱슬·삐죽·앞머리가 작은 구 수십 개라 털뭉치처럼 보이고 머리를 통째로 덮음.
#   해결: 스타일마다 매끈한 큰 덩어리 3~6개만 → Voxel Remesh 로 녹여 클레이 한 덩이로. 실루엣은 머리 캡의 1.15배 안.
#   앞머리 아랫선은 얼굴 데칼 윗선(z≈1.551) 위로 → 눈이 가려지지 않게.
#   이미 단순화된 glb(hs_ 에 pm_smooth 표시)면 아무것도 안 한다.
import bpy, bmesh, os, sys, math
from mathutils import Vector, Euler, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d')
SRC = os.path.join(OUT, 'char.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
olds = [o for o in bpy.data.objects if o.name.startswith('hs_')]
if any(o.get('pm_smooth') for o in olds): print('SMOOTH_SKIP already'); sys.exit(0)
ARM = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
BODY = bpy.data.objects['body']
MATS = {m.name: m for m in BODY.data.materials if m}
ARM.data.pose_position = 'REST'
before = {}
for o in olds:
    before[o.name] = sum(len(p.vertices) - 2 for p in o.data.polygons) if o.type == 'MESH' else 0
    bpy.data.objects.remove(o, do_unlink=True)

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)
def select_only(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o

def lumps(name, parts, seg=24, ring=14):
    bm = bmesh.new()
    for c, r, rot in parts:
        g = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=1.0)
        M = Matrix.Translation(Vector(c)) @ (Euler([math.radians(a) for a in (rot or (0, 0, 0))]).to_matrix().to_4x4()) @ Matrix.Diagonal((*r, 1.0))
        bmesh.ops.transform(bm, matrix=M, verts=g['verts'])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    return o

def clay(o, voxel, target_tris, smooth=14):
    select_only(o)
    r = o.modifiers.new('R', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = voxel; r.adaptivity = 0
    bpy.ops.object.modifier_apply(modifier='R')
    s = o.modifiers.new('S', 'CORRECTIVE_SMOOTH'); s.iterations = smooth; s.factor = 0.5; s.use_only_smooth = True
    bpy.ops.object.modifier_apply(modifier='S')
    t = tris(o)
    if t > target_tris:
        d = o.modifiers.new('D', 'DECIMATE'); d.ratio = target_tris / t
        bpy.ops.object.modifier_apply(modifier='D')
    for p in o.data.polygons: p.use_smooth = True
    return o

# 머리 캡(기존 hair 조각 실측) 중심·반지름. 앞=-Y, 위=+Z
C = Vector((0, 0.04, 1.585)); R = Vector((0.258, 0.248, 0.172)); LIM = 1.15
FR = [((0, -0.162, 1.655), (0.2, 0.075, 0.068), (20, 0, 0))]                    # 이마를 덮는 한 덩이 앞머리
SIDE = [((0.212 * s, -0.03, 1.545), (0.058, 0.085, 0.095), None) for s in (1, -1)]  # 옆머리
CROWN = [((0, 0.06, 1.70), (0.2, 0.2, 0.072), None)]                             # 정수리 볼륨
STYLES = {
    'bangs': FR + SIDE + CROWN,
    'bob': FR + CROWN + [((0.198 * s, 0.04, 1.52), (0.09, 0.17, 0.125), None) for s in (1, -1)] + [((0, 0.215, 1.5), (0.19, 0.09, 0.12), None)],
    'bun': FR + SIDE + CROWN + [((0, 0.21, 1.685), (0.085, 0.085, 0.075), None)],
    'pony': [((-0.02, -0.16, 1.655), (0.2, 0.075, 0.068), (20, 0, 12))] + CROWN + [((0, 0.25, 1.6), (0.07, 0.07, 0.095), (-15, 0, 0)), ((0, 0.27, 1.49), (0.055, 0.055, 0.075), None)],
    # 삐죽머리: 뒤로 빗어 넘긴 낮은 결 3개 + 짧은 앞머리(머리띠와 겹쳐 귀처럼 솟지 않게 낮게)
    'spiky': [((0, -0.158, 1.66), (0.17, 0.07, 0.06), (25, 0, -12))] + CROWN
             + [((-0.1, 0.0, 1.69), (0.075, 0.12, 0.05), (-35, 0, 15)), ((0.1, 0.02, 1.69), (0.075, 0.12, 0.05), (-35, 0, -15)), ((0, 0.13, 1.685), (0.09, 0.11, 0.05), (-50, 0, 0))],
    # 곱슬: 둥근 큰 퍼프 5개
    'curly': [((0, -0.15, 1.67), (0.17, 0.08, 0.07), (15, 0, 0)), ((0, 0.05, 1.70), (0.17, 0.17, 0.08), None),
              ((0.18, 0.02, 1.6), (0.11, 0.14, 0.11), None), ((-0.18, 0.02, 1.6), (0.11, 0.14, 0.11), None), ((0, 0.2, 1.6), (0.17, 0.1, 0.12), None)],
}
report = {}
for sid, parts in STYLES.items():
    assert 3 <= len(parts) <= 6, sid
    o = lumps('hs_' + sid, parts)
    clay(o, 0.007, 480)
    o.data.materials.clear(); o.data.materials.append(MATS['hair'])
    o.vertex_groups.clear(); g = o.vertex_groups.new(name='head'); g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    o.parent = ARM; am = o.modifiers.new('Armature', 'ARMATURE'); am.object = ARM
    o['pm_smooth'] = 1
    # 실루엣 검사: 머리 캡 중심에서 잰 각 축 최대 거리 / 캡 반지름
    ext = max(max(abs(v.co.x - C.x) / R.x, (v.co.y - C.y) / R.y if sid not in ('pony',) else 0, (v.co.z - C.z) / R.z) for v in o.data.vertices)
    report['hs_' + sid] = (before.get('hs_' + sid), tris(o), len(parts), round(ext, 3))

ARM.data.pose_position = 'POSE'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=SRC, export_format='GLB', export_apply=False, export_yup=True,
                          export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True, export_extras=True)
print('SMOOTH_REPORT', report)
