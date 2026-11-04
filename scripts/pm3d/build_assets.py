# scripts/pm3d/build_assets.py — /pm 3D(베타) 에셋 빌드(블렌더 백그라운드, 외부 에셋 서비스 미사용 — 전부 프리미티브)
# 실행: blender -b -P scripts/pm3d/build_assets.py -- public/pm3d
# 산출: kit.glb(공용 모듈+테마 소품, 모듈마다 루트 Empty 이름으로 꺼내 씀) · char.glb(리그+애니메이션 5종+모자 부착)
# 톤: 소프트 클레이 3D 카와이(무광 파스텔·둥근 형태). 캐릭터 비례는 scripts/pm-char/build.py 베이스 바디(머리 0.55·엉덩이 0.42)와 같다.
import bpy, bmesh, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d')
os.makedirs(OUT, exist_ok=True)
R = math.radians

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

_m = {}
def mat(name, hexc, rough=0.9, emit=0.0):
    if name in _m: return _m[name]
    h = hexc.lstrip('#'); c = [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = 0.0
    if emit:
        b.inputs['Emission Color'].default_value = (*c, 1); b.inputs['Emission Strength'].default_value = emit
    _m[name] = m; return m

PAR = [None]
def fin(o, mname, hexc, smooth=True, emit=0.0):
    o.data.materials.clear(); o.data.materials.append(mat(mname, hexc, emit=emit))
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    if PAR[0] is not None:
        o.parent = PAR[0]
    return o
def sphere(loc, r, mname, hexc, scale=(1, 1, 1), seg=16, ring=10, **k):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=ring); o = bpy.context.object; o.scale = scale; return fin(o, mname, hexc, **k)
def cyl(loc, r, d, mname, hexc, rot=(0, 0, 0), scale=(1, 1, 1), v=16, r2=None, **k):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, location=loc, rotation=rot, vertices=v)
    else: bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=d, location=loc, rotation=rot, vertices=v)
    o = bpy.context.object; o.scale = scale; return fin(o, mname, hexc, smooth=k.pop('smooth', False), **k)
def box(loc, size, mname, hexc, rot=(0, 0, 0), bev=0.03, **k):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); o = bpy.context.object; o.scale = size
    if bev > 0:
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        md = o.modifiers.new('b', 'BEVEL'); md.width = bev; md.segments = 2
    return fin(o, mname, hexc, smooth=False, **k)
def torus(loc, R1, r1, mname, hexc, rot=(0, 0, 0), **k):
    bpy.ops.mesh.primitive_torus_add(major_radius=R1, minor_radius=r1, location=loc, rotation=rot, major_segments=20, minor_segments=8); o = bpy.context.object; return fin(o, mname, hexc, **k)
def between(p1, p2, r, mname, hexc, r2=None, v=12):
    a, b = Vector(p1), Vector(p2); d = b - a
    o = cyl(tuple((a + b) / 2), r, d.length, mname, hexc, v=v, r2=r2, smooth=True)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('Z', 'Y'); return o
def module(name):
    e = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(e); PAR[0] = e; return e

# ═══════════════ kit.glb ═══════════════
def build_kit():
    reset()
    WOOD, WOOD2, CREAM, INK = '#e9c79a', '#c98f5e', '#fbf3e6', '#4a3b35'
    # 공용
    module('floor_b'); box((0, 0, -0.05), (1.98, 1.98, 0.1), 'floor_b', '#f6e7d6', bev=0.04)
    module('floor_i'); box((0, 0, -0.05), (2, 2, 0.1), 'sand', '#f3dfb4', bev=0.0)
    module('wall'); box((0, 0, 0.6), (2, 0.16, 1.2), 'wall', '#f7d9de', bev=0.06); box((0, 0, 1.22), (2.04, 0.22, 0.06), 'trim', '#fff6ee', bev=0.03)
    module('partition'); box((0, 0, 0.45), (1.3, 0.08, 0.9), 'partition', '#bfe3d6', bev=0.04)
    module('desk'); box((0, 0, 0.72), (1.2, 0.7, 0.07), 'desk_top', WOOD, bev=0.03)
    for sx in (-1, 1): box((sx * 0.52, 0, 0.36), (0.1, 0.62, 0.7), 'desk_leg', WOOD2, bev=0.03)
    module('desk_b')  # 두꺼운 라운드 상판 + 통다리
    box((0, 0, 0.7), (1.2, 0.72, 0.1), 'desk_b_top', '#f4c6d0', bev=0.05)
    for sx in (-1, 1): box((sx * 0.5, 0, 0.33), (0.14, 0.56, 0.66), 'desk_b_leg', '#fff0f4', bev=0.05)
    module('desk_c')  # 사이드패널 + 서랍
    box((0, 0, 0.72), (1.2, 0.7, 0.07), 'desk_c_top', '#bfe3d6', bev=0.03)
    for sx in (-1, 1): box((sx * 0.54, 0, 0.36), (0.08, 0.66, 0.72), 'desk_c_leg', '#8fc7b5', bev=0.03)
    box((0.36, -0.05, 0.5), (0.32, 0.55, 0.36), 'desk_c_drawer', '#d9f0e8', bev=0.04)
    for z in (0.42, 0.56): box((0.36, -0.33, z), (0.2, 0.02, 0.03), 'desk_c_handle', '#7aa99a', bev=0.01)
    module('chair'); box((0, 0, 0.42), (0.48, 0.46, 0.08), 'chair', '#9fd3c7', bev=0.04); box((0, 0.22, 0.72), (0.46, 0.08, 0.5), 'chair', '#9fd3c7', bev=0.04)
    cyl((0, 0, 0.2), 0.04, 0.4, 'chair_leg', '#7a6a66'); cyl((0, 0, 0.03), 0.22, 0.05, 'chair_leg', '#7a6a66')
    module('monitor'); box((0, 0, 0.28), (0.5, 0.06, 0.34), 'monitor', '#eae4dc', bev=0.04); box((0, -0.033, 0.28), (0.42, 0.01, 0.26), 'screen', '#8fd2ff', bev=0, emit=0.6)
    cyl((0, 0.02, 0.07), 0.04, 0.14, 'monitor', '#eae4dc'); cyl((0, 0.02, 0.01), 0.12, 0.02, 'monitor', '#eae4dc')
    box((0, -0.25, 0.02), (0.4, 0.14, 0.03), 'keyboard', '#fff6ee', bev=0.01)
    # 9 단계 스테이션 — 둥근 받침 + 단계별 고유 모양
    ST = ['#ffb4a2', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#ffadad']
    for i, col in enumerate(ST, 1):
        module(f'station_{i}'); cyl((0, 0, 0.06), 0.8, 0.12, f'pad_{i}', col, v=24); cyl((0, 0, 0.125), 0.66, 0.01, 'pad_glow', '#ffffff', v=24, emit=0.3)
        c = f'st_{i}'
        if i == 1:   # 발주: 클립보드 키오스크
            box((0, 0, 0.55), (0.5, 0.35, 0.9), c, col); box((0, -0.1, 1.15), (0.7, 0.06, 0.8), 'paper', CREAM, rot=(R(-15), 0, 0)); box((0, -0.12, 1.5), (0.25, 0.08, 0.1), 'clip', INK)
        elif i == 2:  # 입고: 상자 더미
            for p in [(-0.25, 0, 0.35), (0.25, 0, 0.35), (0, 0, 0.8)]: box(p, (0.48, 0.5, 0.45), 'crate', WOOD, bev=0.04)
            box((0, -0.5, 0.18), (1.1, 0.3, 0.1), c, col)
        elif i == 3:  # 분배: 칸 선반
            box((0, 0, 0.75), (1.1, 0.4, 1.3), c, col)
            for r_ in range(3):
                for k in range(3): box((-0.35 + k * 0.35, -0.2, 0.32 + r_ * 0.42), (0.28, 0.08, 0.3), 'bin', ['#ffffff', '#ffd6e0', '#c8f0ff'][k], bev=0.03)
        elif i == 4:  # 현장출고: 작은 트럭
            box((-0.15, 0, 0.55), (0.8, 0.6, 0.6), 'truck_box', CREAM, bev=0.06); box((0.45, 0, 0.45), (0.4, 0.56, 0.45), c, col, bev=0.08)
            for x in (-0.35, 0.4):
                for y in (-0.3, 0.3): cyl((x, y, 0.22), 0.13, 0.08, 'tire', INK, rot=(R(90), 0, 0), v=16)
        elif i == 5:  # 견적: 큰 계산기
            box((0, 0, 0.5), (0.8, 0.55, 0.8), c, col, rot=(R(-10), 0, 0)); box((0, -0.25, 0.85), (0.6, 0.04, 0.16), 'screen', '#d9ffd6', emit=0.4)
            for r_ in range(3):
                for k in range(3): box((-0.2 + k * 0.2, -0.3, 0.6 - r_ * 0.17), (0.14, 0.04, 0.12), 'key', '#ffffff', bev=0.02)
        elif i == 6:  # 거래처전달: 우체통
            cyl((0, 0, 0.5), 0.07, 0.8, 'pole', WOOD2); box((0, 0, 1.05), (0.6, 0.4, 0.4), c, col, bev=0.1); sphere((0, 0, 1.25), 0.3, c, col, scale=(1, 0.66, 0.4))
            box((0.33, 0, 1.25), (0.03, 0.06, 0.35), 'flag', '#ff6b6b', bev=0)
        elif i == 7:  # 입금: 돼지 저금통
            sphere((0, 0, 0.6), 0.45, c, col, scale=(1.2, 0.9, 0.9)); cyl((-0.55, 0, 0.6), 0.14, 0.12, c, col, rot=(0, R(90), 0))
            for x in (-0.3, 0.3):
                for y in (-0.2, 0.2): cyl((x, y, 0.2), 0.08, 0.2, c, col)
            for k in range(3): cyl((0.75, 0, 0.18 + k * 0.07), 0.15, 0.06, 'coin', '#ffd166', v=16)
        elif i == 8:  # 해외송금: 지구본
            cyl((0, 0, 0.3), 0.25, 0.35, c, col, r2=0.1); sphere((0, 0, 1.0), 0.45, 'globe', '#8ecae6'); torus((0, 0, 1.0), 0.52, 0.025, c, col, rot=(R(70), 0, R(20)))
            for p in [(0.2, -0.35, 1.15), (-0.25, -0.3, 0.9), (0.1, -0.2, 0.7)]: sphere(p, 0.15, 'land', '#95d5b2', scale=(1, 0.5, 0.8))
        elif i == 9:  # 이익: 막대그래프
            for k, h in enumerate((0.4, 0.7, 1.0, 1.35)): box((-0.45 + k * 0.3, 0, 0.12 + h / 2), (0.24, 0.3, h), c if k < 3 else 'bar_top', col if k < 3 else '#ffd166', bev=0.04)
    # 연구실 로봇
    module('robot'); sphere((0, 0, 0.55), 0.38, 'robot', '#e6ecf5', scale=(1, 0.9, 1.1)); sphere((0, 0, 1.12), 0.32, 'robot', '#e6ecf5', scale=(1.2, 1, 0.9))
    box((0, -0.27, 1.12), (0.5, 0.06, 0.28), 'visor', '#2b3a55', bev=0.04)
    for sx in (-1, 1): sphere((sx * 0.12, -0.31, 1.13), 0.05, 'robot_eye', '#7cf7ff', emit=2.0); between((sx * 0.4, 0, 0.7), (sx * 0.5, -0.1, 0.4), 0.07, 'robot', '#e6ecf5')
    between((0, 0, 1.4), (0, 0, 1.6), 0.02, 'robot', '#e6ecf5'); sphere((0, 0, 1.63), 0.06, 'robot_eye', '#ff8fab', emit=1.5)
    # B 파스텔 사무실 소품
    module('plant'); cyl((0, 0, 0.2), 0.2, 0.4, 'pot', '#f4a6a0', r2=0.15)
    for a in range(5): sphere((0.12 * math.cos(a * 1.26), 0.12 * math.sin(a * 1.26), 0.55 + (a % 2) * 0.1), 0.16, 'leaf', '#8fd19e', scale=(1, 1, 1.4))
    module('mug'); cyl((0, 0, 0.07), 0.065, 0.14, 'mug', '#ffd6e0'); torus((0.08, 0, 0.07), 0.035, 0.012, 'mug', '#ffd6e0', rot=(R(90), 0, 0)); cyl((0, 0, 0.145), 0.052, 0.012, 'coffee', '#8a5a3c', v=14)
    module('parcel'); box((0, 0, 0.18), (0.45, 0.35, 0.36), 'parcel', '#e3b888', bev=0.03); box((0, 0, 0.36), (0.46, 0.08, 0.01), 'tape', '#f6e3c5', bev=0)
    # I 해변 소품
    module('palm')
    for k in range(5): cyl((0.04 * k, 0, 0.2 + k * 0.38), 0.13 - k * 0.012, 0.4, 'trunk', '#b07a4e', v=10)
    for a in range(6):
        ang = a * math.pi / 3; o = sphere((0.6 * math.cos(ang) + 0.16, 0.6 * math.sin(ang), 1.95), 0.32, 'palmleaf', '#6cc58f', scale=(1.6, 0.55, 0.18))
        o.rotation_euler = (0, R(18), ang)
    module('parasol'); cyl((0, 0, 0.9), 0.03, 1.8, 'pole', '#fff6ee'); cyl((0, 0, 1.85), 0.95, 0.35, 'parasol', '#ff9e9e', r2=0.05, v=12)
    module('boardwalk')
    for k in range(5): box((0, -0.8 + k * 0.4, 0.04), (1.6, 0.32, 0.07), 'plank', '#b9a48f', bev=0.03)
    module('hut'); box((0, 0, 0.6), (1.6, 1.4, 1.2), 'hutwall', '#c99567', bev=0.05); cyl((0, 0, 1.55), 1.25, 0.9, 'thatch', '#e8c77d', r2=0.08, v=12)
    box((0, -0.72, 0.5), (0.7, 0.05, 0.8), 'hutdoor', '#8a5a3c', bev=0.02); box((0, -0.85, 1.25), (0.9, 0.06, 0.25), 'sign', CREAM, bev=0.06)
    module('surfboard'); sphere((0, 0, 0.75), 0.25, 'surf', '#9be3de', scale=(1, 0.12, 3)); box((0, -0.03, 0.75), (0.05, 0.01, 1.4), 'surfline', '#ffd166', bev=0)
    module('sea'); box((0, 0, -0.08), (2, 2, 0.04), 'sea', '#7fd8d6', bev=0)
    module('rock'); sphere((0, 0, 0.12), 0.3, 'rock', '#b7aaa0', scale=(1, 0.8, 0.5), seg=8, ring=6)
    PAR[0] = None
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'kit.glb'), export_format='GLB', export_apply=True, export_animations=False,
                              export_yup=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)

# ═══════════════ char.glb ═══════════════
BONES = {  # name: (head, tail, parent)
    'root': ((0, 0, 0), (0, 0, 0.2), None),
    'hips': ((0, 0, 0.42), (0, 0, 0.62), 'root'),
    'spine': ((0, 0, 0.62), (0, 0, 1.0), 'hips'),
    'head': ((0, 0, 1.0), (0, 0, 1.7), 'spine'),
    'arm.L': ((0.3, 0, 0.93), (0.36, 0, 0.55), 'spine'), 'arm.R': ((-0.3, 0, 0.93), (-0.36, 0, 0.55), 'spine'),
    'thigh.L': ((0.14, 0, 0.42), (0.14, 0, 0.24), 'hips'), 'thigh.R': ((-0.14, 0, 0.42), (-0.14, 0, 0.24), 'hips'),
    'shin.L': ((0.14, 0, 0.24), (0.14, 0, 0.04), 'thigh.L'), 'shin.R': ((-0.14, 0, 0.24), (-0.14, 0, 0.04), 'thigh.R'),
}
def bind(o, bone):
    vg = o.vertex_groups.new(name=bone); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
def build_char():
    reset(); PAR[0] = None
    SK, TOP, BOT, HAIR, SHOE, EYE = '#ffe0cc', '#f7b6cf', '#a8e2d0', '#5b4036', '#ffffff', '#3a2a26'
    parts = []
    def P(o, bone): bind(o, bone); parts.append(o); return o
    for sx, s in ((1, 'L'), (-1, 'R')):
        x = sx * 0.14
        P(cyl((x, 0, 0.33), 0.12, 0.2, 'bottom', BOT, v=12), f'thigh.{s}')
        P(cyl((x, 0, 0.15), 0.1, 0.2, 'skin', SK, v=12), f'shin.{s}')
        P(sphere((x, -0.04, 0.06), 0.12, 'shoe', SHOE, scale=(1, 1.3, 0.6), seg=12, ring=8), f'shin.{s}')
        P(between((sx * 0.3, 0, 0.93), (sx * 0.36, 0, 0.6), 0.085, 'top', TOP), f'arm.{s}')
        P(sphere((sx * 0.37, 0, 0.54), 0.09, 'skin', SK, seg=12, ring=8), f'arm.{s}')
        P(sphere((sx * 0.57, 0, 1.52), 0.1, 'skin', SK, scale=(0.5, 0.7, 1), seg=10, ring=6), 'head')
        P(sphere((sx * 0.18, -0.5, 1.5), 0.05, 'eye', EYE, scale=(1, 0.5, 1.3), seg=10, ring=6), 'head')
        P(sphere((sx * 0.3, -0.47, 1.4), 0.06, 'cheek', '#ff9fb0', scale=(1.3, 0.3, 0.8), seg=10, ring=6), 'head')
    P(sphere((0, 0, 0.5), 0.3, 'bottom', BOT, scale=(1, 0.8, 0.5)), 'hips')
    P(sphere((0, 0, 0.78), 0.33, 'top', TOP, scale=(1, 0.78, 0.95)), 'spine')
    P(sphere((0, 0, 1.55), 0.55, 'skin', SK, scale=(1.06, 0.96, 0.94), seg=20, ring=12), 'head')
    P(sphere((0, 0.06, 1.72), 0.56, 'hair', HAIR, scale=(1.08, 1.0, 0.72), seg=20, ring=12), 'head')
    P(sphere((0, -0.38, 1.82), 0.3, 'hair', HAIR, scale=(1.4, 0.5, 0.45), seg=12, ring=8), 'head')
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]; bpy.ops.object.join(); body = bpy.context.object; body.name = 'body'
    # 모자(부착 본=head, 웹에서 이름으로 보이기/숨기기)
    hats = []
    # 모자 = 카와이 과장(꾸미기 가시성, 다음 재빌드에 반영)
    o = sphere((0, 0, 2.02), 0.62, 'hat_cap', '#7ec8e3', scale=(1.12, 1.12, 0.55)); o2 = box((0, -0.62, 1.9), (0.75, 0.5, 0.06), 'hat_cap', '#7ec8e3', bev=0.03)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); o2.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH'); bpy.ops.object.join(); o = bpy.context.object; o.name = 'hat_cap'; hats.append(o)
    o = cyl((0, 0, 1.98), 1.05, 0.06, 'hat_straw', '#f2d58a', v=20); o2 = cyl((0, 0, 2.12), 0.52, 0.34, 'hat_straw', '#f2d58a', v=20, r2=0.44)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); o2.select_set(True); bpy.context.view_layer.objects.active = o; bpy.ops.object.join(); o = bpy.context.object; o.name = 'hat_straw'; hats.append(o)
    o = cyl((0, 0, 2.28), 0.38, 0.72, 'hat_party', '#ffb4e6', v=14, r2=0.02); o.name = 'hat_party'; hats.append(o)
    for h in hats: bind(h, 'head')
    # 아마추어
    ad = bpy.data.armatures.new('rig'); arm = bpy.data.objects.new('rig', ad); bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n, (h, t, p) in BONES.items():
        b = ad.edit_bones.new(n); b.head = h; b.tail = t; b.roll = 0
        if p: b.parent = eb[p]
        eb[n] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    for m in [body] + hats:
        m.parent = arm; md = m.modifiers.new('arm', 'ARMATURE'); md.object = arm
    # 애니메이션: 뼈 로컬 X 회전(아래 향 뼈는 +X = 앞(−Y)으로 차기)
    pbs = arm.pose.bones
    for pb in pbs: pb.rotation_mode = 'XYZ'
    def key(f, poses, loc=None):
        for pb in pbs: pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
        for n, r in poses.items(): pbs[n].rotation_euler = tuple(R(a) for a in r)
        if loc: pbs['root'].location = loc
        for pb in pbs:
            pb.keyframe_insert('rotation_euler', frame=f); pb.keyframe_insert('location', frame=f)
    SIT = {'thigh.L': (90, 0, 0), 'thigh.R': (90, 0, 0), 'shin.L': (-90, 0, 0), 'shin.R': (-90, 0, 0)}
    def act(name, frames):
        a = bpy.data.actions.new(name); a.use_fake_user = True
        arm.animation_data_create(); arm.animation_data.action = a
        for f, poses, loc in frames: key(f, poses, loc)
        tr = arm.animation_data.nla_tracks.new(); tr.name = name; tr.strips.new(name, 1, a); arm.animation_data.action = None
    def M(*ds):
        o = {}
        for d in ds: o.update(d)
        return o
    act('idle', [(1, {'spine': (0, 0, 0), 'head': (0, 4, 0)}, None), (25, {'spine': (2, 0, 3), 'head': (-3, -4, 0)}, None), (49, {'spine': (0, 0, 0), 'head': (0, 4, 0)}, None)])
    TYPE_A = {'arm.L': (62, 0, -12), 'arm.R': (62, 0, 12)}; TYPE_B = {'arm.L': (55, 0, -12), 'arm.R': (68, 0, 12)}
    act('sit_type', [(1, M(SIT, TYPE_A, {'head': (8, 0, 0)}), (0, 0, 0)), (5, M(SIT, TYPE_B, {'head': (8, 0, 2)}), None), (9, M(SIT, TYPE_A, {'head': (8, 0, 0)}), None), (13, M(SIT, {'arm.L': (68, 0, -12), 'arm.R': (55, 0, 12)}, {'head': (8, 0, -2)}), None), (17, M(SIT, TYPE_A, {'head': (8, 0, 0)}), None)])
    act('walk', [(1, {'thigh.L': (30, 0, 0), 'thigh.R': (-30, 0, 0), 'arm.L': (-25, 0, 0), 'arm.R': (25, 0, 0)}, (0, 0, 0)),
                 (7, {'shin.L': (-20, 0, 0), 'shin.R': (-20, 0, 0)}, (0, 0, 0.05)),
                 (13, {'thigh.L': (-30, 0, 0), 'thigh.R': (30, 0, 0), 'arm.L': (25, 0, 0), 'arm.R': (-25, 0, 0)}, (0, 0, 0)),
                 (19, {'shin.L': (-20, 0, 0), 'shin.R': (-20, 0, 0)}, (0, 0, 0.05)),
                 (25, {'thigh.L': (30, 0, 0), 'thigh.R': (-30, 0, 0), 'arm.L': (-25, 0, 0), 'arm.R': (25, 0, 0)}, (0, 0, 0))])
    DZ = {'arm.L': (20, 0, -8), 'arm.R': (20, 0, 8)}
    act('doze', [(1, M(SIT, DZ, {'spine': (14, 0, 0), 'head': (22, 0, 6)}), None), (37, M(SIT, DZ, {'spine': (18, 0, 0), 'head': (28, 0, 8)}), None), (73, M(SIT, DZ, {'spine': (14, 0, 0), 'head': (22, 0, 6)}), None)])
    act('dance', [(1, {'arm.L': (0, 0, -150), 'arm.R': (0, 0, 150)}, (0, 0, 0)), (7, {'arm.L': (0, 0, -120), 'arm.R': (0, 0, 120), 'spine': (0, 10, 0)}, (0, 0, 0.18)),
                  (13, {'arm.L': (0, 0, -150), 'arm.R': (0, 0, 150)}, (0, 0, 0)), (19, {'arm.L': (0, 0, -120), 'arm.R': (0, 0, 120), 'spine': (0, -10, 0)}, (0, 0, 0.18)), (25, {'arm.L': (0, 0, -150), 'arm.R': (0, 0, 150)}, (0, 0, 0))])
    bpy.context.scene.render.fps = 24
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'char.glb'), export_format='GLB', export_apply=False, export_yup=True,
                              export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True)

build_kit()
build_char()
print('PM3D_DONE', OUT)
