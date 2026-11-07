# scripts/pm3d/detail_char.py — char.glb 디테일 단계(clayify_char.py 다음). 블렌더 백그라운드 전용, 유료 생성기 없음.
# 실행: blender -b --factory-startup -P scripts/pm3d/detail_char.py -- public/pm3d
#   ① 몸통에 녹여 붙이는 디테일(기존 재질 슬롯 재사용 → 웹 그리기 명령 수 그대로)
#      칼라(shoe=흰색) · 소매 끝단·셔츠 밑단(top) · 엄지+둥근 손(skin) · 신발 밑창(bottom)
#   ② 머리 모양 hs_<id>(hair 재질) — 앞머리·옆머리·뒷머리를 찰흙 덩어리(구 여러 개 → Voxel Remesh 로 녹임)로 만든다.
#      웹(components/pm3d/charLook.js)이 직원별로 하나만 골라 몸통 hair 조각에 "합쳐서" 그린다(추가 그리기 명령 0).
#   ③ 머리 소품 acc_<id>(cheek=볼터치 분홍 / shoe=흰색 재질) — 리본·꽃핀·하트핀·머리띠. 웹이 같은 재질 조각에 합친다.
#   모두 head/본 가중치를 받는다(체형별 head 본 스케일을 그대로 따라감). 이미 처리된 glb 면(hs_ 존재) 아무것도 안 한다.
import bpy, bmesh, os, sys, math
from mathutils import Vector, Euler, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d')
SRC = os.path.join(OUT, 'char.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
if any(o.name.startswith('hs_') for o in bpy.data.objects):
    print('DETAIL_SKIP already detailed'); sys.exit(0)
ARM = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
BODY = bpy.data.objects['body']
MATS = {m.name: m for m in BODY.data.materials if m}
ARM.data.pose_position = 'REST'

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)
def select_only(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o

def lumps(name, parts, seg=20, ring=12):
    """parts = [(중심, 반지름xyz, 회전(도) 또는 None)] → 타원구 여러 개를 한 메시로."""
    bm = bmesh.new()
    for c, r, rot in parts:
        g = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=1.0)
        M = Matrix.Translation(Vector(c)) @ (Euler([math.radians(a) for a in (rot or (0, 0, 0))]).to_matrix().to_4x4()) @ Matrix.Diagonal((*r, 1.0))
        bmesh.ops.transform(bm, matrix=M, verts=g['verts'])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    return o

def torus(name, c, major, minor, axis='Z', scale=(1, 1, 1), arc=(0, 360), seg=40, mseg=12):
    bm = bmesh.new()
    a0, a1 = [math.radians(a) for a in arc]; full = abs(arc[1] - arc[0]) >= 360
    n = seg if full else seg + 1
    rings = []
    for i in range(n):
        t = a0 + (a1 - a0) * i / (seg if full else seg)
        ring = []
        for j in range(mseg):
            u = 2 * math.pi * j / mseg
            p = Vector(((major + minor * math.cos(u)) * math.cos(t), (major + minor * math.cos(u)) * math.sin(t), minor * math.sin(u)))
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for i in range(len(rings) - (0 if full else 1)):
        A, B = rings[i], rings[(i + 1) % len(rings)]
        for j in range(mseg): bm.faces.new((A[j], A[(j + 1) % mseg], B[(j + 1) % mseg], B[j]))
    if not full:
        for rg in (rings[0], rings[-1]): bm.faces.new(rg)
    R = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.radians(90), 4, 'Y'), 'Y': Matrix.Rotation(math.radians(90), 4, 'X')}[axis]
    M = Matrix.Translation(Vector(c)) @ Matrix.Diagonal((*scale, 1.0)) @ R
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    return o

def clay(o, voxel, target_tris, smooth=8):
    """구 덩어리를 찰흙처럼 녹여 붙임: Voxel Remesh → Corrective Smooth → Decimate(목표 삼각형 수)."""
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

def set_mat(o, mat_name):
    o.data.materials.clear(); o.data.materials.append(MATS[mat_name])
    for p in o.data.polygons: p.material_index = 0

def weights_from_body(o):
    """몸통 가중치를 가장 가까운 면에서 옮겨 받음(칼라·소매·손·밑창 — 관절 따라 휨)."""
    o.vertex_groups.clear()
    for vg in BODY.vertex_groups: o.vertex_groups.new(name=vg.name)
    dt = o.modifiers.new('DT', 'DATA_TRANSFER'); dt.object = BODY; dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
    select_only(o); bpy.ops.object.modifier_apply(modifier='DT')

def weights_bone(o, bone):
    o.vertex_groups.clear()
    g = o.vertex_groups.new(name=bone); g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')

def rig(o):
    o.parent = ARM
    am = o.modifiers.new('Armature', 'ARMATURE'); am.object = ARM

report = {}
# ── ① 몸통 디테일(기존 재질에 합침) ──────────────────────────────────────────────
add = []
# 칼라: 어깨선(머리 아래, z≈1.33) 흰 테 + 앞쪽 둥근 깃 두 장(피터팬 칼라). 체형별 머리 확대(head 본)에 묻히지 않게 chest 본 고정
c = torus('collar_ring', (0, 0.0, 1.335), 0.235, 0.026, 'Z', scale=(1.0, 0.8, 1.0))
c2 = lumps('collar_flaps', [((0.09, -0.222, 1.235), (0.095, 0.034, 0.06), (18, 0, -20)), ((-0.09, -0.222, 1.235), (0.095, 0.034, 0.06), (18, 0, 20))])
for x in (c, c2): set_mat(x, 'shoe')
collar = [clay(c, 0.008, 400), clay(c2, 0.008, 320)]
# 소매 끝단(접어 올린 커프) — 소매가 끝나는 x≈0.44 둘레
for sx in (1, -1):
    k = torus('cuff', (0.445 * sx, 0, 1.217), 0.112, 0.026, 'X'); set_mat(k, 'top'); add.append(clay(k, 0.008, 260))
# 셔츠 밑단 말림 + 배 위 가로 주름 두 줄
h = torus('hem', (0, 0, 0.565), 0.232, 0.03, 'Z', scale=(1.0, 0.75, 1.0)); set_mat(h, 'top'); add.append(clay(h, 0.009, 380))
w = lumps('wrinkles', [((0.07, -0.2, 0.78), (0.09, 0.022, 0.014), (0, 0, 12)), ((-0.06, -0.205, 0.86), (0.08, 0.02, 0.013), (0, 0, -10))])
set_mat(w, 'top'); add.append(clay(w, 0.006, 200))
# 둥근 장갑 손 + 엄지(앞·위쪽)
for sx in (1, -1):
    hd = lumps('hand', [((0.835 * sx, 0, 1.214), (0.1, 0.098, 0.096), None), ((0.80 * sx, -0.085, 1.262), (0.045, 0.05, 0.04), (0, 0, 25 * sx))])
    set_mat(hd, 'skin'); add.append(clay(hd, 0.007, 340))
# 신발 밑창(바지색)
for sx in (1, -1):
    so = lumps('sole', [((0.17 * sx, -0.1, 0.022), (0.13, 0.19, 0.03), None)]); set_mat(so, 'bottom'); add.append(clay(so, 0.008, 220))
for o in add: weights_from_body(o)
for o in collar: weights_bone(o, 'chest')
add += collar
n0 = tris(BODY)
FACE_K = 2.1
# 얼굴 데칼 키우기(×FACE_K) — 커진 머리에 비해 눈·입이 작아 표정이 안 읽혔다. 늘린 점은 머리 표면에 다시 투영(뜨거나 파묻히지 않게)
from mathutils.bvhtree import BVHTree
me = BODY.data; names = [m.name for m in me.materials]
fi = names.index('face'); si = names.index('skin')
bm = bmesh.new(); bm.from_mesh(me)
skin_faces = [f for f in bm.faces if f.material_index == si]
sk = bmesh.new()
vmap = {}
for f in skin_faces:
    vs = []
    for v in f.verts:
        if v.index not in vmap: vmap[v.index] = sk.verts.new(v.co)
        vs.append(vmap[v.index])
    try: sk.faces.new(vs)
    except ValueError: pass
tree = BVHTree.FromBMesh(sk)
fv = {v for f in bm.faces if f.material_index == fi for v in f.verts}
cx = sum(v.co.x for v in fv) / len(fv); cz = sum(v.co.z for v in fv) / len(fv)
for v in fv:
    x = cx + (v.co.x - cx) * FACE_K; z = cz + (v.co.z - cz) * FACE_K + 0.012
    hit = tree.ray_cast(Vector((x, -0.8, z)), Vector((0, 1, 0)))
    if hit[0] is not None: v.co = Vector((x, hit[0].y - 0.004, z))
bm.to_mesh(me); bm.free(); sk.free()
bpy.ops.object.select_all(action='DESELECT')
for o in add: o.select_set(True)
BODY.select_set(True); bpy.context.view_layer.objects.active = BODY
bpy.ops.object.join()
# 삼각형 예산: 디테일을 붙인 만큼 몸통 전체를 다시 줄여 8,800 안팎으로(원래 8,388)(얼굴 데칼·볼은 보호 — UV·모양 유지)
BODY_BUDGET = 8800
keep = BODY.vertex_groups.new(name='pm_keep')
kmi = {i for i, m in enumerate(BODY.data.materials) if m and m.name in ('face', 'cheek')}
keep.add(sorted({v for p in BODY.data.polygons if p.material_index in kmi for v in p.vertices}), 1.0, 'REPLACE')
if tris(BODY) > BODY_BUDGET:
    d = BODY.modifiers.new('Budget', 'DECIMATE'); d.ratio = BODY_BUDGET / tris(BODY)
    d.vertex_group = 'pm_keep'; d.invert_vertex_group = True; d.vertex_group_factor = 1.0
    select_only(BODY); bpy.ops.object.modifier_move_to_index(modifier='Budget', index=0); bpy.ops.object.modifier_apply(modifier='Budget')
if BODY.vertex_groups.get('pm_keep'): BODY.vertex_groups.remove(BODY.vertex_groups['pm_keep'])
report['body'] = (n0, tris(BODY))

# ── ② 머리 모양(hs_*) ─────────────────────────────────────────────────────────
# 머리 캡 타원체(기존 hair 조각 실측): 중심·반지름. 앞=-Y, 위=+Z. 얼굴 데칼 윗선 z≈1.551 → 앞머리 아랫선은 1.565 위
C = Vector((0, 0.04, 1.585)); R = Vector((0.258, 0.248, 0.172))
def on(d, k=0.93):
    d = Vector(d).normalized(); return tuple(C + Vector((R.x * d.x, R.y * d.y, R.z * d.z)) * k)
FRINGE = [((x, -0.19 + abs(x) * 0.3, 1.64 - abs(x) * 0.14), (0.05, 0.042, 0.05), (18, 0, -x * 160)) for x in (-0.16, -0.08, 0.0, 0.08, 0.16)]
SIDE = [((0.236 * s, -0.07, 1.515), (0.052, 0.07, 0.1), (0, 8 * s, 0)) for s in (1, -1)]
CROWN = [(on((0, 0.1, 1)), (0.15, 0.16, 0.06), None)]
STYLES = {
    # 기본 앞머리: 이마를 덮는 둥근 덩어리 5개 + 옆머리 두 가닥
    'bangs': FRINGE + SIDE + CROWN,
    # 단발: 앞머리 + 귀를 덮는 볼륨 + 뒤통수 둥근 끝
    'bob': FRINGE + CROWN + [((0.25 * s, 0.03, 1.5), (0.085, 0.16, 0.13), (0, 6 * s, 0)) for s in (1, -1)] + [((0, 0.24, 1.49), (0.2, 0.09, 0.12), None)],
    # 똥머리: 앞머리 + 정수리 뒤 둥근 번
    'bun': FRINGE + SIDE + CROWN + [((0, 0.13, 1.79), (0.105, 0.1, 0.095), None), ((0, 0.1, 1.735), (0.07, 0.07, 0.04), None)],
    # 포니테일: 옆으로 넘긴 앞머리 + 뒤로 묶은 꼬리(위→아래 굵기 줄임)
    'pony': [((x, -0.2 + abs(x + 0.04) * 0.3, 1.64 - (x + 0.2) * 0.12), (0.075, 0.05, 0.058), (16, 0, 30)) for x in (-0.15, -0.05, 0.05, 0.14)] + SIDE + CROWN
            + [((0, 0.27, 1.66), (0.06, 0.06, 0.06), None), ((0, 0.33, 1.58), (0.075, 0.07, 0.09), (-20, 0, 0)), ((0, 0.37, 1.47), (0.06, 0.06, 0.08), (-10, 0, 0)), ((0, 0.385, 1.39), (0.04, 0.045, 0.05), None)],
    # 삐죽머리: 정수리 둘레로 뿔처럼 솟은 덩어리
    'spiky': [((0.15 * math.cos(a), 0.06 + 0.15 * math.sin(a), 1.75), (0.042, 0.042, 0.12), (-math.sin(a) * 38, math.cos(a) * 38, 0)) for a in [i * math.pi * 2 / 9 + 0.3 for i in range(9)]]
            + [((0, 0.06, 1.8), (0.05, 0.05, 0.1), None)] + FRINGE[1:4] + SIDE,
    # 곱슬: 머리 캡 위를 작은 공으로 덮음
    'curly': [(on((math.cos(a) * math.sin(b), math.sin(a) * math.sin(b) + 0.15, math.cos(b)), 0.97), (0.06, 0.06, 0.055), None)
              for b, cnt in ((0.25, 1), (0.75, 7), (1.2, 10)) for a in [i * math.pi * 2 / cnt + b for i in range(cnt)]
              if not (math.sin(a) * math.sin(b) < -0.55 and math.cos(b) < 0.5)] + FRINGE[::2],
}
for sid, parts in STYLES.items():
    # 덩어리를 머리 중심 쪽으로 3% 당기고 0.82배로(커진 머리에서 뭉치가 공처럼 떠 보이지 않게)
    parts = [(tuple(C + (Vector(c) - C) * 0.97), tuple(r_ * 0.82 for r_ in r), rot) for c, r, rot in parts]
    o = lumps('hs_' + sid, parts)
    clay(o, 0.008, 500)
    set_mat(o, 'hair'); weights_bone(o, 'head'); rig(o)
    report['hs_' + sid] = tris(o)

# ── ③ 머리 소품(acc_*) ────────────────────────────────────────────────────────
ACCS = {
    # 리본(볼터치 분홍): 매듭 + 날개 둘, 오른쪽 위
    'ribbon': ('cheek', [((0.17, -0.06, 1.745), (0.025, 0.025, 0.025), None), ((0.225, -0.05, 1.76), (0.055, 0.022, 0.035), (0, 0, -25)), ((0.115, -0.07, 1.735), (0.055, 0.022, 0.035), (0, 0, 25))]),
    # 꽃핀: 꽃잎 5 + 가운데, 왼쪽 옆
    'flower': ('cheek', [((-0.215 + 0.035 * math.cos(a), -0.1, 1.68 + 0.035 * math.sin(a)), (0.026, 0.016, 0.026), None) for a in [i * math.pi * 2 / 5 for i in range(5)]] + [((-0.215, -0.115, 1.68), (0.017, 0.012, 0.017), None)]),
    # 하트핀: 둥근 두 덩이 + 아래 뾰족
    'heart': ('cheek', [((0.19, -0.11, 1.70), (0.026, 0.016, 0.026), None), ((0.225, -0.105, 1.70), (0.026, 0.016, 0.026), None), ((0.207, -0.11, 1.675), (0.022, 0.014, 0.03), (0, -40, 0))]),
}
for aid, (mat, parts) in ACCS.items():
    o = lumps('acc_' + aid, parts, seg=14, ring=8); clay(o, 0.005, 500, smooth=4)
    set_mat(o, mat); weights_bone(o, 'head'); rig(o); report['acc_' + aid] = tris(o)
# 머리띠(흰색): 머리 위를 가로지르는 호
b = torus('acc_band', (0, 0.0, 1.555), 0.262, 0.02, 'Y', scale=(1.0, 1.0, 0.86), arc=(-20, 200))
clay(b, 0.006, 600, smooth=4); set_mat(b, 'shoe'); weights_bone(b, 'head'); rig(b); report['acc_band'] = tris(b)

ARM.data.pose_position = 'POSE'
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name.startswith('Icosphere'): bpy.data.objects.remove(o, do_unlink=True)  # 예전 단계 잔여물
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=SRC, export_format='GLB', export_apply=False, export_yup=True,
                          export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True)
print('DETAIL_REPORT', report)
