# scripts/pm3d/build_wearables.py — /pm 착용 소품·종족 부속 전용 메시 제작(외부 에셋 없음, 전부 프리미티브 자체 모델링)
# 실행: blender -b --factory-startup -P scripts/pm3d/build_wearables.py -- public/pm3d
# 기존 char.glb(KayKit 리그+클립, scripts/pm3d/build_char_kaykit.py)를 불러와
#   모자 16(hat_*) · 안경 6(gls_*) · 손 소품 10(hnd_*) · 배지 7(bdg_*) · 종족 부속 9(race_*)
# 를 본(head/chest/hand.r) 스키닝 메시로 추가하고 재-export. 옛 모자 3종(hat_cap/straw/party)은 새 모델로 교체.
# 메시 이름 = lib/pm3dLayout.wearMesh / lib/pmThemes.PM3D.RACES.mesh 와 한 글자도 다르면 안 된다(__tests__/pmProps3d.test.js 가 검사).
# 톤: docs/pm-design-standard.md 소프트 클레이(무광 파스텔·둥근 과장 — 꾸미기 가시성).
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d')
R = math.radians

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'char.glb'))
ARM = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
B = {b.name: (Vector(b.head_local), Vector(b.tail_local)) for b in ARM.data.bones}
assert 'head' in B and 'chest' in B and 'hand.r' in B, sorted(B)
assert abs(B['head'][0].z - 1.35) < 0.5, ('head bone z?', B['head'][0])  # z-up 좌표 확인

# 옛 모자 교체(새 16종이 같은 이름 체계로 다시 들어감)
for n in ('hat_cap', 'hat_straw', 'hat_party'):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o, do_unlink=True)

_m = {}
def mat(name, hexc, rough=0.9, emit=0.0, alpha=1.0):
    key = (name, emit, alpha)
    if key in _m: return _m[key]
    h = hexc.lstrip('#'); c = [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = 0.0
    if emit:
        b.inputs['Emission Color'].default_value = (*c, 1); b.inputs['Emission Strength'].default_value = emit
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha; m.blend_method = 'BLEND'
    _m[key] = m; return m

PARTS = []  # (object, bone)
def fin(o, hexc, bone, smooth=True, emit=0.0, alpha=1.0):
    o.data.materials.clear(); o.data.materials.append(mat('w_' + hexc.lstrip('#') + ('e' if emit else '') + ('a' if alpha < 1 else ''), hexc, emit=emit, alpha=alpha))
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    PARTS.append((o, bone)); return o

def ball(loc, r, hexc, bone='head', scale=(1, 1, 1), rot=(0, 0, 0), seg=14, ring=9, **k):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, rotation=rot, segments=seg, ring_count=ring)
    o = bpy.context.object; o.scale = scale
    return fin(o, hexc, bone, **k)
def cyl(loc, r, d, hexc, bone='head', rot=(0, 0, 0), scale=(1, 1, 1), v=14, r2=None, **k):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, location=loc, rotation=rot, vertices=v)
    else: bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=d, location=loc, rotation=rot, vertices=v)
    o = bpy.context.object; o.scale = scale
    return fin(o, hexc, bone, smooth=k.pop('smooth', True), **k)
def box(loc, size, hexc, bone='head', rot=(0, 0, 0), bev=0.012, **k):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.scale = size
    if bev > 0:
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        md = o.modifiers.new('b', 'BEVEL'); md.width = bev; md.segments = 2
        bpy.ops.object.convert(target='MESH')
        o = bpy.context.object
    return fin(o, hexc, bone, smooth=False, **k)
def torus(loc, R1, r1, hexc, bone='head', rot=(0, 0, 0), **k):
    bpy.ops.mesh.primitive_torus_add(major_radius=R1, minor_radius=r1, location=loc, rotation=rot, major_segments=18, minor_segments=8)
    return fin(bpy.context.object, hexc, bone, **k)

NEW = []
def item(name, builder):
    PARTS.clear()
    builder()
    objs = [o for o, _ in PARTS]
    # 본별 버텍스 그룹을 join 전에 부여(파트마다 다른 본 허용 — 요정 날개=chest 등)
    for o, bone in PARTS:
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='OBJECT')
        vg = o.vertex_groups.new(name=bone); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.object; o.name = name
    o.parent = ARM
    md = o.modifiers.new('arm', 'ARMATURE'); md.object = ARM
    NEW.append(name)
    return o

# 좌표계: Z-up 캐릭터 로컬. 머리 중심 HC=(0, 0.02, 1.5), 머리 반지름 ~0.47/0.42/0.41, 정면 = -Y, 머리 꼭대기 z≈1.92
HTOP = 1.84      # 모자 밑단 기준
FACE_Y = -0.44   # 얼굴 표면
EYE_Z = 1.5
HAND = tuple(B['hand.r'][0])  # T포즈 (-0.8, 0, 1.107)
HX, HY, HZ = HAND

# ═══ 모자 16종 ═══
def hat_cap():
    ball((0, 0, 1.86), 0.5, '#7ec8e3', scale=(1.12, 1.12, 0.55))
    box((0, -0.5, 1.76), (0.62, 0.42, 0.05), '#7ec8e3')
    ball((0, 0, 2.13), 0.07, '#fff6ee')
def hat_beret():
    ball((0.06, 0, 1.92), 0.52, '#e2413b', scale=(1.15, 1.1, 0.42), rot=(0, R(-9), 0))
    cyl((0.0, 0, 2.12), 0.035, 0.1, '#b22f25')
def hat_ribbon():
    torus((0, 0, 1.78), 0.46, 0.05, '#f7b6cf', rot=(0, R(8), 0))
    for sx in (1, -1): ball((sx * 0.14, -0.1, 2.0), 0.13, '#f7b6cf', scale=(1.5, 0.6, 1.0), rot=(0, 0, R(sx * 28)))
    ball((0, -0.12, 1.96), 0.07, '#e88aa8')
def hat_visorneon():
    torus((0, 0, 1.82), 0.47, 0.045, '#2b2f3a', rot=(0, 0, 0))
    cyl((0, -0.4, 1.9), 0.3, 0.26, '#6ef2ff', rot=(R(100), 0, 0), v=16, emit=1.2, alpha=0.75, scale=(1.5, 1, 1))
def hat_gat():
    cyl((0, 0, 1.84), 0.78, 0.035, '#2e2a26', v=22)
    cyl((0, 0, 2.0), 0.34, 0.3, '#2e2a26', v=16, r2=0.28)
    cyl((0, 0, 2.17), 0.3, 0.03, '#4a4440', v=16)
def hat_straw():
    cyl((0, 0, 1.82), 0.85, 0.05, '#f2d58a', v=20)
    cyl((0, 0, 1.94), 0.42, 0.28, '#f2d58a', v=20, r2=0.36)
    torus((0, 0, 1.86), 0.43, 0.025, '#e07b63')
def hat_pixelcrown():
    for k in range(8):
        a = k * math.pi / 4 + math.pi / 8
        box((0.36 * math.cos(a), 0.36 * math.sin(a), 1.98 + (0.05 if k % 2 == 0 else 0)), (0.14, 0.14, 0.2 if k % 2 else 0.28), '#ffd166', bev=0, rot=(0, 0, a))
    cyl((0, 0, 1.88), 0.42, 0.12, '#ffd166', v=8, smooth=False)
def hat_painter():
    ball((0, -0.04, 1.9), 0.56, '#fbf3e6', scale=(1.1, 1.15, 0.45), rot=(R(6), 0, 0))
    torus((0, 0, 1.78), 0.44, 0.05, '#fbf3e6')
    for i, c in enumerate(('#e2413b', '#4f8cff', '#ffd166')): ball((0.2 - i * 0.1, -0.4, 1.98), 0.045, c)
def hat_spacehelmet():
    ball((0, 0.02, 1.56), 0.58, '#cfe4ff', scale=(1.05, 1.0, 1.0), alpha=0.32)
    torus((0, 0.02, 1.12), 0.5, 0.07, '#f1f3f6', rot=(0, 0, 0))
    ball((0, 0.02, 2.14), 0.05, '#ff6b6b', emit=0.8)
def hat_sunvisor():
    torus((0, 0, 1.8), 0.46, 0.055, '#ff9e8b')
    cyl((0, -0.52, 1.8), 0.34, 0.03, '#ffd0c4', rot=(R(10), 0, 0), v=18, scale=(1.3, 1, 1))
def hat_beanie():
    ball((0, 0, 1.88), 0.49, '#a0e0c5', scale=(1.05, 1.05, 0.72))
    torus((0, 0, 1.76), 0.44, 0.07, '#8fd7b7')
    ball((0, 0, 2.2), 0.1, '#fffdf5')
def hat_crown():
    cyl((0, 0, 1.9), 0.4, 0.18, '#ffd166', v=18)
    for k in range(6):
        a = k * math.pi / 3
        cyl((0.38 * math.cos(a), 0.38 * math.sin(a), 2.06), 0.07, 0.16, '#ffd166', v=8, r2=0.01)
    ball((0, -0.4, 1.92), 0.05, '#ff6b9d')
def hat_flowercrown():
    torus((0, 0, 1.8), 0.45, 0.035, '#8fd7b7', rot=(0, R(5), 0))
    for k in range(7):
        a = k * 2 * math.pi / 7
        x, y = 0.45 * math.cos(a), 0.45 * math.sin(a)
        c = ['#ff9cf0', '#ffd166', '#ff9e8b'][k % 3]
        for j in range(5):
            b2 = j * 2 * math.pi / 5
            ball((x + 0.05 * math.cos(b2), y + 0.05 * math.sin(b2), 1.84), 0.035, c)
        ball((x, y, 1.86), 0.03, '#fffdf5')
def hat_helmet():
    ball((0, 0, 1.8), 0.52, '#ffd166', scale=(1.08, 1.08, 0.75))
    box((0, 0, 1.82), (0.14, 1.0, 0.1), '#ffc93c', rot=(0, 0, R(90)), bev=0.02)
    cyl((0, -0.5, 1.72), 0.3, 0.03, '#ffd166', rot=(R(8), 0, 0), v=16, scale=(1.4, 1, 1))
def hat_chef():
    cyl((0, 0, 1.86), 0.4, 0.22, '#fffdf5', v=18)
    for k in range(5):
        a = k * 2 * math.pi / 5
        ball((0.28 * math.cos(a), 0.28 * math.sin(a), 2.08), 0.17, '#fffdf5')
    ball((0, 0, 2.16), 0.2, '#fffdf5')
def hat_pilot():
    ball((0, 0, 1.84), 0.5, '#33415c', scale=(1.1, 1.1, 0.5))
    box((0, -0.48, 1.74), (0.6, 0.38, 0.05), '#2b3446')
    torus((0, 0, 1.76), 0.45, 0.035, '#ffd166')
    ball((0, -0.44, 1.9), 0.06, '#ffd166')

# ═══ 안경 6종(얼굴 앞, 눈 z≈1.5·x±0.17) ═══
GY = FACE_Y - 0.015
def gls_round():
    for sx in (1, -1): torus((sx * 0.17, GY, EYE_Z), 0.1, 0.022, '#4a3b35', rot=(R(90), 0, 0))
    cyl((0, GY, EYE_Z + 0.02), 0.018, 0.14, '#4a3b35', rot=(0, R(90), 0))
    for sx in (1, -1): cyl((sx * 0.36, -0.2, EYE_Z + 0.02), 0.016, 0.44, '#4a3b35', rot=(R(90), 0, 0))
def gls_sun():
    for sx in (1, -1): ball((sx * 0.17, GY, EYE_Z), 0.105, '#2b2f3a', scale=(1, 0.35, 0.9))
    cyl((0, GY, EYE_Z + 0.03), 0.018, 0.14, '#2b2f3a', rot=(0, R(90), 0))
    for sx in (1, -1): cyl((sx * 0.36, -0.2, EYE_Z + 0.03), 0.016, 0.44, '#2b2f3a', rot=(R(90), 0, 0))
def gls_heart():
    for sx in (1, -1):
        x = sx * 0.17
        ball((x - 0.045, GY, EYE_Z + 0.03), 0.06, '#ff6b9d', scale=(1, 0.4, 1))
        ball((x + 0.045, GY, EYE_Z + 0.03), 0.06, '#ff6b9d', scale=(1, 0.4, 1))
        cyl((x, GY, EYE_Z - 0.05), 0.075, 0.06, '#ff6b9d', rot=(R(90), 0, R(45)), v=4, smooth=False)
    cyl((0, GY, EYE_Z + 0.02), 0.016, 0.1, '#ff6b9d', rot=(0, R(90), 0))
def gls_visor():
    cyl((0, -0.35, EYE_Z), 0.33, 0.17, '#9df0ff', rot=(R(100), 0, 0), v=18, emit=0.9, alpha=0.7, scale=(1.35, 1, 1))
    torus((0, 0, 1.56), 0.46, 0.028, '#8b7dff', rot=(0, R(4), 0))
def gls_monocle():
    torus((0.17, GY, EYE_Z), 0.105, 0.022, '#c9a227', rot=(R(90), 0, 0))
    cyl((0.26, GY + 0.02, EYE_Z - 0.16), 0.008, 0.18, '#c9a227', rot=(R(12), R(8), 0))
    ball((0.28, GY + 0.03, EYE_Z - 0.26), 0.02, '#c9a227')
def gls_goggle():
    for sx in (1, -1): torus((sx * 0.17, GY, EYE_Z), 0.11, 0.035, '#f08a3c', rot=(R(90), 0, 0))
    for sx in (1, -1): cyl((sx * 0.17, GY + 0.01, EYE_Z), 0.095, 0.03, '#bfeff0', rot=(R(90), 0, 0), alpha=0.6)
    torus((0, 0.02, EYE_Z), 0.47, 0.03, '#f08a3c', rot=(0, R(3), 0))

# ═══ 손 소품 10종(hand.r 본, T포즈 손 위치 기준) ═══
def hnd_mug():
    cyl((HX, HY - 0.02, HZ + 0.06), 0.075, 0.15, '#e9c79a')
    torus((HX - 0.095, HY - 0.02, HZ + 0.06), 0.045, 0.015, '#e9c79a', rot=(R(90), 0, R(90)))
    cyl((HX, HY - 0.02, HZ + 0.135), 0.06, 0.012, '#8a5a3c', v=12)
def hnd_balloon():
    cyl((HX, HY, HZ + 0.3), 0.004, 0.55, '#fffdf5')
    ball((HX, HY, HZ + 0.72), 0.19, '#ff9e8b', scale=(1, 1, 1.15))
    cyl((HX, HY, HZ + 0.52), 0.02, 0.04, '#f58a76', r2=0.008)
def hnd_glowstick():
    cyl((HX, HY, HZ + 0.12), 0.028, 0.3, '#caffbf', emit=2.2)
    cyl((HX, HY, HZ - 0.05), 0.034, 0.1, '#4a5260')
def hnd_fan():
    cyl((HX, HY - 0.01, HZ + 0.22), 0.2, 0.02, '#fbf3e6', rot=(R(90), 0, 0), v=18, scale=(1.2, 1, 1))
    ball((HX + 0.045, HY - 0.025, HZ + 0.24), 0.07, '#e2413b', scale=(1, 0.4, 1))
    ball((HX - 0.045, HY - 0.025, HZ + 0.2), 0.07, '#3d5aa8', scale=(1, 0.4, 1))
    cyl((HX, HY, HZ + 0.02), 0.016, 0.12, '#8a5a3c')
def hnd_wateringcan():
    cyl((HX, HY, HZ + 0.03), 0.11, 0.16, '#bde0fe', v=16)
    cyl((HX - 0.14, HY, HZ + 0.07), 0.025, 0.2, '#bde0fe', rot=(0, R(-50), 0), r2=0.045)
    torus((HX + 0.1, HY, HZ + 0.1), 0.06, 0.014, '#8fb8e8', rot=(R(90), 0, R(90)))
def hnd_joystick():
    box((HX, HY, HZ + 0.02), (0.16, 0.16, 0.08), '#33415c', bev=0.02)
    cyl((HX, HY, HZ + 0.1), 0.02, 0.12, '#9aa3ad')
    ball((HX, HY, HZ + 0.18), 0.05, '#e2413b')
    ball((HX + 0.05, HY - 0.05, HZ + 0.065), 0.02, '#ffd166')
def hnd_brush():
    cyl((HX, HY, HZ + 0.08), 0.02, 0.26, '#e9c79a')
    cyl((HX, HY, HZ + 0.23), 0.026, 0.05, '#9aa3ad')
    cyl((HX, HY, HZ + 0.3), 0.03, 0.1, '#ff9cf0', r2=0.008)
def hnd_flag():
    cyl((HX, HY, HZ + 0.22), 0.012, 0.56, '#9aa3ad')
    box((HX + 0.12, HY, HZ + 0.4), (0.24, 0.015, 0.16), '#3d5aa8', bev=0)
    ball((HX + 0.12, HY - 0.012, HZ + 0.4), 0.035, '#ffd166', scale=(1, 0.4, 1))
    ball((HX, HY, HZ + 0.51), 0.025, '#ffd166')
def hnd_icecream():
    cyl((HX, HY, HZ + 0.06), 0.055, 0.16, '#e9b36a', r2=0.012, rot=(R(180), 0, 0))
    ball((HX, HY, HZ + 0.17), 0.07, '#ffd6e0')
    ball((HX, HY, HZ + 0.26), 0.055, '#fdffb6')
    ball((HX, HY, HZ + 0.32), 0.02, '#e2413b')
def hnd_cocoa():
    cyl((HX, HY, HZ + 0.06), 0.08, 0.14, '#b56c4a')
    torus((HX - 0.1, HY, HZ + 0.06), 0.045, 0.015, '#b56c4a', rot=(R(90), 0, R(90)))
    cyl((HX, HY, HZ + 0.13), 0.065, 0.012, '#6b4630', v=12)
    for dx, dy in ((0.02, 0.02), (-0.03, -0.01), (0.0, -0.03)): ball((HX + dx, HY + dy, HZ + 0.14), 0.016, '#fffdf5')

# ═══ 배지 7종(chest 본, 가슴 왼쪽 앞) ═══
BP = (0.17, -0.265, 1.18)
def _disc(hexc): cyl(BP, 0.065, 0.02, hexc, bone='chest', rot=(R(96), 0, 0), v=16)
def bdg_star():
    _disc('#ffd166')
    for k in range(5):
        a = k * 2 * math.pi / 5 + math.pi / 2
        ball((BP[0] + 0.045 * math.cos(a), BP[1] - 0.012, BP[2] + 0.045 * math.sin(a)), 0.022, '#ffc93c', bone='chest')
def bdg_rose():
    ball(BP, 0.05, '#ff6b9d', bone='chest', scale=(1, 0.5, 1))
    torus((BP[0], BP[1] - 0.005, BP[2]), 0.045, 0.016, '#e85a8a', bone='chest', rot=(R(96), 0, 0))
    ball((BP[0] + 0.045, BP[1], BP[2] - 0.05), 0.028, '#8fd19e', bone='chest', scale=(1.4, 0.4, 0.8))
def bdg_mvp():
    _disc('#ffd166')
    torus(BP, 0.06, 0.012, '#c9a227', bone='chest', rot=(R(96), 0, 0))
    for sx in (1, -1): box((BP[0] + sx * 0.03, BP[1] + 0.005, BP[2] - 0.085), (0.035, 0.012, 0.07), '#e2413b', bone='chest', rot=(0, R(sx * 14), 0), bev=0)
def bdg_heart():
    for sx in (1, -1): ball((BP[0] + sx * 0.028, BP[1], BP[2] + 0.02), 0.038, '#ff6b9d', bone='chest', scale=(1, 0.5, 1))
    cyl((BP[0], BP[1], BP[2] - 0.028), 0.048, 0.035, '#ff6b9d', bone='chest', rot=(R(96), 0, R(45)), v=4, smooth=False)
def _flag3(cols, horizontal=False):
    for i, c in enumerate(cols):
        if horizontal: box((BP[0], BP[1], BP[2] + (1 - i) * 0.03), (0.11, 0.016, 0.03), c, bone='chest', bev=0)
        else: box((BP[0] + (i - 1) * 0.036, BP[1], BP[2]), (0.036, 0.016, 0.08), c, bone='chest', bev=0)
def bdg_flagco(): _flag3(['#ffd166', '#3d5aa8', '#e2413b'], horizontal=True)
def bdg_flagnl(): _flag3(['#e2413b', '#fffdf5', '#3d5aa8'], horizontal=True)
def bdg_flagcn():
    box(BP, (0.11, 0.016, 0.085), '#e2413b', bone='chest', bev=0)
    ball((BP[0] - 0.03, BP[1] - 0.012, BP[2] + 0.02), 0.014, '#ffd166', bone='chest')

# ═══ 종족 부속 9종(race_*) — 귀·꼬리·부리·더듬이·화관·로봇 머리·선인장 가시 ═══
def race_cat():
    for sx in (1, -1):
        cyl((sx * 0.26, 0, 1.92), 0.13, 0.26, '#e8a85c', rot=(0, R(sx * 14), 0), r2=0.01, v=10, smooth=False)
        cyl((sx * 0.25, -0.035, 1.9), 0.07, 0.14, '#ffd9e8', rot=(0, R(sx * 14), 0), r2=0.008, v=8, smooth=False)
    ball((0, -0.47, 1.46), 0.045, '#ff9fb0', scale=(1.2, 0.7, 0.9))
def race_dog():
    for sx in (1, -1): ball((sx * 0.45, 0.02, 1.62), 0.13, '#b07a4e', scale=(0.5, 0.85, 1.6), rot=(0, R(sx * 18), 0))
    ball((0, -0.46, 1.4), 0.09, '#8a5a36', scale=(1.1, 0.7, 0.8))
def race_bunny():
    for sx in (1, -1):
        ball((sx * 0.17, 0.0, 2.12), 0.1, '#f7b6cf', scale=(0.75, 0.55, 2.4), rot=(0, R(sx * 8), 0))
        ball((sx * 0.17, -0.04, 2.12), 0.06, '#ffe9ef', scale=(0.7, 0.5, 2.1), rot=(0, R(sx * 8), 0))
def race_bear():
    for sx in (1, -1):
        ball((sx * 0.32, 0, 1.88), 0.14, '#8a5a36')
        ball((sx * 0.3, -0.05, 1.87), 0.08, '#c89064')
    ball((0, -0.44, 1.42), 0.1, '#e8c9a8', scale=(1.2, 0.7, 0.9))
def race_fox():
    for sx in (1, -1):
        cyl((sx * 0.29, 0, 1.96), 0.15, 0.34, '#e07b39', rot=(0, R(sx * 16), 0), r2=0.012, v=10, smooth=False)
        cyl((sx * 0.28, -0.04, 1.92), 0.08, 0.18, '#fffdf5', rot=(0, R(sx * 16), 0), r2=0.01, v=8, smooth=False)
def race_penguin():
    cyl((0, -0.52, 1.45), 0.07, 0.2, '#ff9a3c', rot=(R(90), 0, 0), r2=0.012, v=10, smooth=False)
    for sx in (1, -1): ball((sx * 0.42, 0.1, 1.1), 0.12, '#2b3a4a', bone='chest', scale=(0.45, 0.9, 1.5), rot=(0, R(sx * 10), 0))  # 날개
def race_fairy():
    torus((0, 0, 1.86), 0.4, 0.03, '#8fd7b7', rot=(0, R(5), 0))
    for k in range(6):
        a = k * math.pi / 3
        ball((0.4 * math.cos(a), 0.4 * math.sin(a), 1.89), 0.05, ['#ff9cf0', '#ffd166'][k % 2])
    for sx in (1, -1):
        ball((sx * 0.3, 0.3, 1.2), 0.22, '#d8f1ff', bone='chest', scale=(1.1, 0.18, 1.7), rot=(0, R(sx * 22), R(sx * -18)), alpha=0.65)
def race_robot():
    cyl((0, 0, 2.0), 0.025, 0.22, '#9aa6b5')
    ball((0, 0, 2.14), 0.06, '#ffd166', emit=1.2)
    box((0, -0.43, 1.52), (0.62, 0.1, 0.16), '#2b3a55', bev=0.02)
    for sx in (1, -1): ball((sx * 0.14, -0.49, 1.52), 0.035, '#7cf7ff', emit=1.8)
    for sx in (1, -1): cyl((sx * 0.46, 0.02, 1.5), 0.05, 0.08, '#9aa6b5', rot=(0, R(90), 0), v=10)
def race_cactus():
    for k in range(9):
        a = k * 2 * math.pi / 9
        x, y = 0.34 * math.cos(a), 0.34 * math.sin(a)
        if y < -0.15: continue  # 얼굴 쪽은 비움
        cyl((x, y, 1.86), 0.025, 0.1, '#5e9e50', rot=(R(-y * 90), R(x * 90), 0), r2=0.004, v=6, smooth=False)
    for j in range(5):
        b2 = j * 2 * math.pi / 5
        ball((0.055 * math.cos(b2), 0.055 * math.sin(b2), 1.95), 0.04, '#ff9cf0')
    ball((0, 0, 1.97), 0.035, '#ffd166')

W = {}
for n, f in list(globals().items()):
    if n.startswith(('hat_', 'gls_', 'hnd_', 'bdg_', 'race_')) and callable(f): W[n] = f
EXPECT = 16 + 6 + 10 + 7 + 9
assert len(W) == EXPECT, (len(W), sorted(W))
for n in sorted(W): item(n, W[n])

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'char.glb'), export_format='GLB', export_apply=False, export_yup=True,
                          export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True)
print('PM3D_WEARABLES_DONE', len(NEW), 'meshes')
