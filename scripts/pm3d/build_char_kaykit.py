# scripts/pm3d/build_char_kaykit.py — /pm 3D(베타) 캐릭터 v2: KayKit Rig_Medium(CC0) 리그로 교체
# 실행: blender -b --factory-startup -P scripts/pm3d/build_char_kaykit.py -- public/pm3d
# 산출: char.glb — 자작 클레이 카와이 바디(재질명 top/bottom/skin/hair 유지)를 KayKit 본(무릎·팔꿈치 포함)에 리지드 바인딩.
#   클립(웹 이름): idle(Idle_A) · sit_type(Sit_Chair_Idle+타이핑 팔 베이크) · walk(Walking_A) · doze(Sit_Chair_Idle+고개 숙임)
#               · dance(Kevin Iglesias Dance01 리타게팅, 실패 시 Cheering 폴백) · cheer(Cheering) · wave(Waving)
#   모자 hat_cap/hat_straw/hat_party = head 본 부착(웹에서 이름으로 보이기/숨기기, lib/pm3dLayout.hatMesh 그대로).
# 라이선스: KayKit Character Animations 1.1 = CC0. Kevin Iglesias Human Dance 2.1 FREE = 재배포 금지 팩 →
#   원본 FBX는 커밋하지 않고(assets-raw 로컬 전용) 리타게팅 "결과 키프레임"만 char.glb 에 들어간다. assets-raw/LICENSES.md 참조.
import bpy, math, os, sys
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d')
RAW = r'C:\Users\USER\nenova-pm\pm3d\assets-raw'
KK = os.path.join(RAW, 'kaykit-character-animations', 'KayKit_Character_Animations_1.1', 'Animations', 'gltf', 'Rig_Medium')
KI = os.path.join(RAW, 'KevinIglesias_HumanDanceFree', 'Animations', 'Male', 'Social', 'Dance', 'Steps')
R = math.radians
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 24

# ── 1) KayKit 리그·클립 로드(Simulation=Sit/Cheering/Waving 기준 리그, General=Idle, MovementBasic=Walking) ──
def imp_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

objs = imp_glb(os.path.join(KK, 'Rig_Medium_Simulation.glb'))
ARM = next(o for o in objs if o.type == 'ARMATURE')
ARM.name = 'rig'
# 마네킹 메시 제거(자작 바디로 교체)
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
for extra in ('Rig_Medium_General.glb', 'Rig_Medium_MovementBasic.glb'):
    for o in imp_glb(os.path.join(KK, extra)):
        bpy.data.objects.remove(o, do_unlink=True)  # 액션 데이터블록만 남긴다

def set_action(arm, act):
    arm.animation_data_create()
    arm.animation_data.action = act
    try: arm.animation_data.action_slot = act.slots[0]
    except Exception: pass

# ── 2) 클레이 카와이 바디(재질·톤 = 기존 build_assets.py 와 동일) ──
_m = {}
def mat(name, hexc, rough=0.9):
    if name in _m: return _m[name]
    h = hexc.lstrip('#'); c = [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = 0.0
    _m[name] = m; return m

PARTS = []
def fin(o, mname, hexc, bone, smooth=True):
    o.data.materials.clear(); o.data.materials.append(mat(mname, hexc))
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    vg = o.vertex_groups.new(name=bone); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    PARTS.append(o); return o

def sphere(loc, r, mname, hexc, bone, scale=(1, 1, 1), seg=16, ring=10):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=ring)
    o = bpy.context.object; o.scale = scale
    return fin(o, mname, hexc, bone)

def tube(p1, p2, r, mname, hexc, bone, r2=None, v=12):
    a, b = Vector(p1), Vector(p2); d = b - a
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=tuple((a + b) / 2), vertices=v)
    else: bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=d.length, location=tuple((a + b) / 2), vertices=v)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    return fin(o, mname, hexc, bone)

SK, TOP, BOT, HAIR, SHOE, EYE = '#ffe0cc', '#f7b6cf', '#a8e2d0', '#5b4036', '#ffffff', '#3a2a26'
B = {b.name: (Vector(b.head_local), Vector(b.tail_local)) for b in ARM.data.bones}
# ── 비율 교정 상수(사장님 지시: 가분수 → 귀여운-정상 중간, 머리:전신 ≈ 1:3.4) ──
#   머리에 묶인(head 본) 메시 전부를 head 본 피벗 기준으로 HEAD_K 배 축소한다(바인딩 전 정점 변형이라 클립 무손상).
#   lib/pmThemes.PM3D.HEAD(pivotY/shrink)와 같은 값 — 웹의 종족 부속 좌표 재매핑이 이 상수를 그대로 쓴다.
HEAD_K = 0.55
HEAD_PIVOT = Vector(B['head'][0])
# 몸통·골반(몸통/다리 비율 상향: 머리 축소에 맞춰 살짝 두껍게)
sphere((0, 0, 0.48), 0.285, 'bottom', BOT, 'hips', scale=(1.05, 0.85, 0.62))
sphere((0, 0, 0.82), 0.32, 'top', TOP, 'spine', scale=(1, 0.8, 1.05))
sphere((0, 0, 1.1), 0.28, 'top', TOP, 'chest', scale=(1.02, 0.78, 0.8))
for s, sx in (('l', 1), ('r', -1)):
    # 팔(T포즈: X축 방향) — 어깨 윗팔=옷, 아랫팔·손=피부
    tube(B[f'upperarm.{s}'][0], B[f'upperarm.{s}'][1], 0.095, 'top', TOP, f'upperarm.{s}')
    sphere(tuple(B[f'upperarm.{s}'][0]), 0.105, 'top', TOP, f'upperarm.{s}', seg=12, ring=8)
    tube(B[f'lowerarm.{s}'][0], B[f'lowerarm.{s}'][1], 0.078, 'skin', SK, f'lowerarm.{s}')
    sphere((sx * 0.8, 0, 1.107), 0.1, 'skin', SK, f'hand.{s}', seg=12, ring=8)
    # 다리(무릎 분절) — 허벅지=바지, 정강이=피부, 신발
    tube(B[f'upperleg.{s}'][0], B[f'upperleg.{s}'][1], 0.13, 'bottom', BOT, f'upperleg.{s}')
    tube(B[f'lowerleg.{s}'][0], B[f'lowerleg.{s}'][1], 0.105, 'skin', SK, f'lowerleg.{s}')
    sphere((sx * 0.171, -0.1, 0.08), 0.12, 'shoe', SHOE, f'foot.{s}', scale=(1, 1.5, 0.65), seg=12, ring=8)
    # 얼굴 좌우(귀·눈·볼) — head 본
    sphere((sx * 0.46, 0.02, 1.52), 0.1, 'skin', SK, 'head', scale=(0.5, 0.7, 1), seg=10, ring=6)
    sphere((sx * 0.26, -0.385, 1.41), 0.055, 'cheek', '#ff9fb0', 'head', scale=(1.3, 0.3, 0.8), seg=10, ring=6)
# 머리(카와이 큰 머리)·머리카락(이마가 보이게 뒤·위로)
sphere((0, 0.02, 1.5), 0.44, 'skin', SK, 'head', scale=(1.06, 0.96, 0.94), seg=20, ring=12)
sphere((0, 0.1, 1.66), 0.44, 'hair', HAIR, 'head', scale=(1.06, 0.98, 0.7), seg=20, ring=12)
sphere((0, -0.3, 1.8), 0.2, 'hair', HAIR, 'head', scale=(1.5, 0.45, 0.4), seg=12, ring=8)

# 표정 데칼(머리 구면에 밀착한 셸, 재질 'face' = 텍스처 스왑 대상 — scripts/pm3d/build_faces.py)
import bmesh
FACE_W, FACE_H, HEAD_C, HEAD_R = 0.78, 0.48, Vector((0, 0.02, 1.5)), 0.47
bpy.ops.mesh.primitive_grid_add(x_subdivisions=10, y_subdivisions=8, size=1)
fp = bpy.context.object; fp.name = 'face_decal'
bm = bmesh.new(); bm.from_mesh(fp.data)
uvl = bm.loops.layers.uv.new('UVMap')
bm.verts.ensure_lookup_table()
grid_uv = {v.index: (v.co.x + 0.5, v.co.y + 0.5) for v in bm.verts}
RX, RY, RZ = 0.44 * 1.06 + 0.015, 0.44 * 0.96 + 0.015, 0.44 * 0.94 + 0.015  # 머리 타원 + 1.5cm 마진
for v in bm.verts:
    # 격자(x,y∈[-0.5,0.5]) → 얼굴 평면 → 머리 중심 기준 방향으로 타원면에 투영
    p = Vector((v.co.x * FACE_W, -1.0, (1.5 - 0.02) + v.co.y * FACE_H))
    d = p - HEAD_C
    t = 1.0 / math.sqrt((d.x / RX) ** 2 + (d.y / RY) ** 2 + (d.z / RZ) ** 2)
    v.co = HEAD_C + d * t
for f in bm.faces:
    for l in f.loops:
        g = grid_uv[l.vert.index]
        l[uvl].uv = (g[0], g[1])
bm.to_mesh(fp.data); bm.free()
fm = bpy.data.materials.new('face'); fm.use_nodes = True; fm.blend_method = 'BLEND'
nt = fm.node_tree; bsdf = nt.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 0.9; bsdf.inputs['Metallic'].default_value = 0.0
img = bpy.data.images.load(os.path.abspath(os.path.join(OUT, 'face', 'smile.webp')))
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
fp.data.materials.clear(); fp.data.materials.append(fm)
for pg in fp.data.polygons: pg.use_smooth = True
vg = fp.vertex_groups.new(name='head'); vg.add(list(range(len(fp.data.vertices))), 1.0, 'REPLACE')
PARTS.append(fp)

bpy.ops.object.select_all(action='DESELECT')
for o in PARTS: o.select_set(True)
bpy.context.view_layer.objects.active = PARTS[0]
bpy.ops.object.join(); body = bpy.context.object; body.name = 'body'

# 모자 3종(head 본 부착, 메시명 = lib/pm3dLayout.hatMesh)
hats = []
def hat_join(name, builders):
    objs2 = [b() for b in builders]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs2: o.select_set(True)
    bpy.context.view_layer.objects.active = objs2[0]
    if len(objs2) > 1: bpy.ops.object.join()
    o = bpy.context.object; o.name = name
    vg = o.vertex_groups.new(name='head'); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    hats.append(o); return o

def raw_sphere(loc, r, mname, hexc, scale=(1, 1, 1), seg=16, ring=10):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=ring)
    o = bpy.context.object; o.scale = scale
    o.data.materials.clear(); o.data.materials.append(mat(mname, hexc))
    for p in o.data.polygons: p.use_smooth = True
    return o
def raw_cyl(loc, r, d, mname, hexc, v=16, r2=None):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, location=loc, vertices=v)
    else: bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=d, location=loc, vertices=v)
    o = bpy.context.object
    o.data.materials.clear(); o.data.materials.append(mat(mname, hexc))
    return o
def raw_box(loc, size, mname, hexc):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object; o.scale = size
    o.data.materials.clear(); o.data.materials.append(mat(mname, hexc))
    return o

hat_join('hat_cap', [lambda: raw_sphere((0, 0, 1.86), 0.5, 'hat_cap', '#7ec8e3', scale=(1.12, 1.12, 0.55)),
                     lambda: raw_box((0, -0.5, 1.76), (0.62, 0.42, 0.05), 'hat_cap', '#7ec8e3')])
hat_join('hat_straw', [lambda: raw_cyl((0, 0, 1.82), 0.85, 0.05, 'hat_straw', '#f2d58a', v=20),
                       lambda: raw_cyl((0, 0, 1.94), 0.42, 0.28, 'hat_straw', '#f2d58a', v=20, r2=0.36)])
hat_join('hat_party', [lambda: raw_cyl((0, 0, 2.06), 0.3, 0.6, 'hat_party', '#ffb4e6', v=14, r2=0.02)])

# ── 비율 교정: head 본에 묶인 정점(머리·머리카락·귀·볼·표정 데칼·모자) 전부 HEAD_K 배 축소 ──
#   transform_apply 로 오브젝트 변환을 정점에 구운 뒤 head 피벗 기준으로 줄인다.
#   머리에 붙는 모든 지오메트리가 같은 피벗·배율로 줄어 상대 맞춤(모자 눌러쓰기, 표정 밀착)이 그대로 유지된다.
for o in [body] + hats:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    gi = o.vertex_groups.find('head')
    if gi < 0: continue
    for v in o.data.vertices:
        if any(g.group == gi and g.weight > 0 for g in v.groups):
            v.co = HEAD_PIVOT + (v.co - HEAD_PIVOT) * HEAD_K

for m in [body] + hats:
    m.parent = ARM
    md = m.modifiers.new('arm', 'ARMATURE'); md.object = ARM

# ── 3) 클립 베이크(소스 클립 평가 → 새 액션에 쿼터니언/위치 키 기록) ──
PB_ORDER = [b.name for b in ARM.data.bones]  # 부모 먼저(생성 순서 보장)
for pb in ARM.pose.bones: pb.rotation_mode = 'QUATERNION'

def write_action(out_name, samples, loc_bones):
    a = bpy.data.actions.new(out_name); a.use_fake_user = True
    new_fc = action_fcurve_factory(a, ARM)
    for bn in PB_ORDER:
        gq = f'pose.bones["{bn}"].rotation_quaternion'
        for i in range(4):
            fc = new_fc(gq, i, bn)
            fc.keyframe_points.add(len(samples))
            for k, (fr, pose) in enumerate(samples):
                fc.keyframe_points[k].co = (fr, pose[bn][1][i])
                fc.keyframe_points[k].interpolation = 'LINEAR'
        if bn in loc_bones:
            gl = f'pose.bones["{bn}"].location'
            for i in range(3):
                fc = new_fc(gl, i, bn)
                fc.keyframe_points.add(len(samples))
                for k, (fr, pose) in enumerate(samples):
                    fc.keyframe_points[k].co = (fr, pose[bn][0][i])
                    fc.keyframe_points[k].interpolation = 'LINEAR'
    return a

def bake(src_name, out_name, mod=None, frame_step=2, loc_bones=('root', 'hips')):
    src = bpy.data.actions.get(src_name)
    if not src: raise RuntimeError('no action ' + src_name)
    set_action(ARM, src)
    f0, f1 = int(src.frame_range[0]), int(src.frame_range[1])
    frames = list(range(f0, f1 + 1, frame_step))
    if frames[-1] != f1: frames.append(f1)
    samples = []  # [(frame, {bone: (loc, quat)})]
    for f in frames:
        sc.frame_set(f)
        if mod: mod(f - f0, f1 - f0 or 1)
        bpy.context.view_layer.update()
        pose = {}
        for pb in ARM.pose.bones:
            loc, q, _ = pb.matrix_basis.decompose()
            pose[pb.name] = (loc.copy(), q.copy())
        samples.append((f - f0 + 1, pose))
    a = write_action(out_name, samples, loc_bones)
    return a


# Blender 4.4+ 슬롯 액션: 레거시 action.fcurves 대체
def action_fcurve_factory(a, id_obj):
    try:
        a.fcurves  # 레거시 경로가 살아있으면 그대로
        return lambda path, index, group: a.fcurves.new(path, index=index, action_group=group)
    except AttributeError:
        slot = a.slots.new(id_type='OBJECT', name=id_obj.name)
        layer = a.layers.new('base')
        strip = layer.strips.new(type='KEYFRAME')
        bag = strip.channelbag(slot, ensure=True)
        return lambda path, index, group: bag.fcurves.new(path, index=index)

# 포즈 수정 도우미 — 현재 평가된 포즈 위에 armature 공간 행렬로 덮어쓴다
def set_bone_world(bn, loc=None, rot_extra=None):
    pb = ARM.pose.bones[bn]
    m = pb.matrix.copy()
    if rot_extra is not None:
        m = m @ rot_extra.to_matrix().to_4x4()
    if loc is not None:
        m.translation = Vector(loc)
    pb.matrix = m

# 앉기 공통: 클립이 뒤로 밀어 둔 hips 를 원점 위로 — 자리 그룹 기준 좌표를 웹에서 그대로 쓰게
def center_hips(flip=False):
    # 수평 드리프트 제거(원점 위로). flip=True 면 180° 돌림(클립이 돌아 앉을 때용, 기본 꺼짐)
    pb = ARM.pose.bones['hips']
    m = pb.matrix.copy()
    if flip:
        m = Matrix.Rotation(math.pi, 4, 'Z') @ m
    m.translation = Vector((0, 0, pb.matrix.translation.z))
    pb.matrix = m
    bpy.context.view_layer.update()

def mod_sit_type(f, n):
    center_hips()
    t = f / n * 2 * math.pi
    # 타이핑 팔: 윗팔 아래+앞, 아랫팔 앞으로 — 손이 책상 높이(~0.7m) 근처
    for s, sx in (('l', 1), ('r', -1)):
        ph = 0 if s == 'l' else math.pi
        up = ARM.pose.bones[f'upperarm.{s}']
        m = up.matrix.copy()
        q = (Quaternion((0, 0, 1), R(-sx * 62)) @ Quaternion((1, 0, 0), R(-18)))
        m = Matrix.Translation(m.translation) @ q.to_matrix().to_4x4() @ Matrix.Translation(-m.translation) @ m
        up.matrix = m; bpy.context.view_layer.update()
        lo = ARM.pose.bones[f'lowerarm.{s}']
        m2 = lo.matrix.copy()
        q2 = Quaternion((0, 0, 1), R(-sx * 38)) @ Quaternion((1, 0, 0), R(6 * math.sin(t * 3 + ph)))
        m2 = Matrix.Translation(m2.translation) @ q2.to_matrix().to_4x4() @ Matrix.Translation(-m2.translation) @ m2
        lo.matrix = m2; bpy.context.view_layer.update()
    set_bone_world('head', rot_extra=Quaternion((1, 0, 0), R(8)))
    bpy.context.view_layer.update()

def mod_doze(f, n):
    center_hips()
    t = f / n * 2 * math.pi
    set_bone_world('chest', rot_extra=Quaternion((1, 0, 0), R(6 + 2 * math.sin(t))))
    bpy.context.view_layer.update()
    set_bone_world('head', rot_extra=Quaternion((1, 0, 0), R(14 + 3 * math.sin(t))) @ Quaternion((0, 0, 1), R(6)))
    bpy.context.view_layer.update()

def mod_ground(f, n):
    # 서기 클립: 클립 자체 전후 흔들림은 유지하되 수평 드리프트 제거
    pb = ARM.pose.bones['hips']
    w = pb.matrix.translation
    m = pb.matrix.copy(); m.translation = Vector((0, 0, w.z)); pb.matrix = m
    bpy.context.view_layer.update()

CLIPS = []
CLIPS.append(bake('Idle_A', 'idle'))
CLIPS.append(bake('Sit_Chair_Idle', 'sit_type', mod=mod_sit_type))
CLIPS.append(bake('Walking_A', 'walk', frame_step=1))
CLIPS.append(bake('Sit_Chair_Idle', 'doze', mod=mod_doze, frame_step=3))
CLIPS.append(bake('Cheering', 'cheer', mod=mod_ground))
CLIPS.append(bake('Waving', 'wave', mod=mod_ground))

# ── 4) Kevin Iglesias 춤 리타게팅(재배포 금지 팩 — 결과 키만 수록, 실패 시 Cheering 폴백) ──
KI_MAP = {  # KI 리그(B-* 명명) → KayKit
    'hips': 'hips', 'spine': 'spine', 'chest': 'chest', 'head': 'head',
    'upperArm.L': 'upperarm.l', 'forearm.L': 'lowerarm.l', 'hand.L': 'hand.l',
    'upperArm.R': 'upperarm.r', 'forearm.R': 'lowerarm.r', 'hand.R': 'hand.r',
    'thigh.L': 'upperleg.l', 'shin.L': 'lowerleg.l', 'foot.L': 'foot.l',
    'thigh.R': 'upperleg.r', 'shin.R': 'lowerleg.r', 'foot.R': 'foot.r',
}
def norm(n):
    n = n.split(':')[-1].split('|')[-1]
    return n[2:] if n.startswith('B-') else n

def retarget_dance(fbx, out_name, max_frames=96):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=fbx, automatic_bone_orientation=False, ignore_leaf_bones=True)
    news = [o for o in bpy.data.objects if o not in before]
    src = next((o for o in news if o.type == 'ARMATURE'), None)
    if src is None: raise RuntimeError('no src rig')
    src_bones = {norm(b.name): b.name for b in src.data.bones}
    pairs = [(src_bones[k], v) for k, v in KI_MAP.items() if k in src_bones and v in ARM.pose.bones]
    if len(pairs) < 10: raise RuntimeError('bone map too small: ' + str(len(pairs)))
    act = src.animation_data.action if src.animation_data else None
    if act is None:
        acts = [a for a in bpy.data.actions if a.name not in {c.name for c in CLIPS}]
        act = acts[-1]
    set_action(src, act)
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    if f1 - f0 > max_frames: f1 = f0 + max_frames
    # 레스트 월드 회전(한 번)
    sc.frame_set(f0)
    rest_src = {sb: (src.matrix_world @ src.pose.bones[sb].bone.matrix_local).to_quaternion() for sb, _ in pairs}
    rest_tgt = {tb: ARM.pose.bones[tb].bone.matrix_local.to_quaternion() for _, tb in pairs}
    hip_src_z = (src.matrix_world @ Vector(src.pose.bones[src_bones['hips']].bone.matrix_local.translation)).z or 1.0
    hip_tgt_z = 0.406
    samples = []
    for f in range(f0, f1 + 1, 2):
        sc.frame_set(f)
        # 소스 월드 회전 → 타깃: q_tgt_world = q_src_world @ q_src_rest^-1 @ q_tgt_rest
        for sb, tb in pairs:
            qs = (src.matrix_world @ src.pose.bones[sb].matrix).to_quaternion()
            qt = qs @ rest_src[sb].inverted() @ rest_tgt[tb]
            pb = ARM.pose.bones[tb]
            m = qt.to_matrix().to_4x4()
            m.translation = pb.matrix.translation
            pb.matrix = m
            bpy.context.view_layer.update()
        # hips 위치(높이 비율 보정, 수평은 제자리 춤으로 고정)
        sw = (src.matrix_world @ src.pose.bones[src_bones['hips']].matrix).translation
        k = hip_tgt_z / hip_src_z
        hb = ARM.pose.bones['hips']
        m = hb.matrix.copy(); m.translation = Vector((0, 0, max(0.15, sw.z * k))); hb.matrix = m
        bpy.context.view_layer.update()
        pose = {}
        for pb in ARM.pose.bones:
            loc, q, _ = pb.matrix_basis.decompose()
            pose[pb.name] = (loc.copy(), q.copy())
        samples.append((f - f0 + 1, pose))
    a = write_action(out_name, samples, ('root', 'hips'))
    for o in news: bpy.data.objects.remove(o, do_unlink=True)
    return a

dance = None
try:
    dance = retarget_dance(os.path.join(KI, 'HumanM@Dance01.fbx'), 'dance')
    print('PM3D_KI_RETARGET ok')
except Exception as e:
    print('PM3D_KI_RETARGET fail:', e)
    dance = bake('Cheering', 'dance', mod=mod_ground)
CLIPS.append(dance)
# 여분 춤(용량 봐서 2종만 추가)
for i, nm in ((2, 'dance2'), (3, 'dance3')):
    try: CLIPS.append(retarget_dance(os.path.join(KI, f'HumanM@Dance0{i}.fbx'), nm))
    except Exception as e: print('PM3D_KI_RETARGET', nm, 'fail:', e)

# ── 5) NLA 정리 후 export ──
set_action(ARM, None) if False else None
ARM.animation_data_create(); ARM.animation_data.action = None
for tr in list(ARM.animation_data.nla_tracks): ARM.animation_data.nla_tracks.remove(tr)
keep = {a.name for a in CLIPS}
for a in list(bpy.data.actions):
    if a.name not in keep: bpy.data.actions.remove(a)
for a in CLIPS:
    tr = ARM.animation_data.nla_tracks.new(); tr.name = a.name; tr.strips.new(a.name, 1, a)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'char.glb'), export_format='GLB', export_apply=False, export_yup=True,
                          export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True)
print('PM3D_CHAR_KAYKIT_DONE', OUT)
