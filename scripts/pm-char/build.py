# scripts/pm-char/build.py — /pm 캐릭터 v2 레이어 렌더(블렌더 백그라운드)
# 실행: blender -b -P scripts/pm-char/build.py -- <출력폴더> [필터]
# 원칙: 모든 레이어 = 같은 리그(베이스 바디)·같은 직교 카메라·같은 조명 → 합치면 정합. 몸 뒤로 숨는 부분은 holdout 으로 잘라 냄.
# 스타일 = 사장님 확정 톤(소프트 클레이 3D·무광 파스텔·둥근 형태·부드러운 그림자·카와이 얼굴). 외부 에셋 서비스 미사용(전부 프리미티브).
import bpy, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spec import BODIES, HAIRS, KINDS, OUTFITS, HATS, GLASSES, HANDS, BADGES, DESKS, DESKTOP, FLOORS, PETS

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'pmchar-raw')
FILT = argv[1] if len(argv) > 1 else ''
# ISO 모드: 장면 배경(클레이 아이소메트릭, 고도 30°·방위 45°)과 같은 카메라로 책상 스킨·상판 소품·펫만 렌더 → <이름>@iso.png + iso-anchors.json
ISO = len(argv) > 2 and argv[2] == 'iso'
ISO_ELEV, ISO_AZ = math.radians(30), math.radians(45)
ISO_SCALE, ISO_PX = 4.05, 768
ISO_CENTER = (0.0, 0.3, 0.55)
os.makedirs(OUT, exist_ok=True)
ELEV = math.radians(12)
CH_SCALE, CH_PX = 2.7, 512          # 캐릭터 캔버스: 2.7m → 512px(후처리에서 256)
DK_SCALE, DK_PX = 4.05, 768         # 자리 캔버스: 같은 px/m(189.6@렌더, 94.8@출력)
CH_CENTER = (0.0, 0.0, 1.15)
DK_CENTER = (0.0, 0.5, 1.0)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'
try: sc.eevee.taa_render_samples = 32
except Exception: pass
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.82, 0.8, 0.86, 1); world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
def light(name, loc, energy, size, rot):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.size = size
    o = bpy.data.objects.new(name, d); o.location = loc; o.rotation_euler = rot; sc.collection.objects.link(o); o['grp'] = '__light'
light('key', (-3, -5, 6), 900, 6, (math.radians(45), 0, math.radians(-30)))
light('fill', (4, -4, 3), 300, 6, (math.radians(60), 0, math.radians(45)))
cam_d = bpy.data.cameras.new('cam'); cam_d.type = 'ORTHO'
cam = bpy.data.objects.new('cam', cam_d); sc.collection.objects.link(cam); sc.camera = cam

def set_cam_iso(center, scale, px):
    import mathutils
    cam.rotation_euler = (math.radians(90) - ISO_ELEV, 0, ISO_AZ)
    fwd = cam.rotation_euler.to_matrix() @ mathutils.Vector((0, 0, -1))
    cam.location = mathutils.Vector(center) - fwd * 20
    cam_d.ortho_scale = scale; cam_d.clip_end = 100
    sc.render.resolution_x = sc.render.resolution_y = px

def set_cam(center, scale, px):
    cx, cy, cz = center; dist = 20
    cam.location = (cx, cy - dist * math.cos(ELEV), cz + dist * math.sin(ELEV))
    cam.rotation_euler = (math.radians(90) - ELEV, 0, 0)
    cam_d.ortho_scale = scale; cam_d.clip_end = 100
    sc.render.resolution_x = sc.render.resolution_y = px

_mats = {}
def mat(hexc, rough=0.85, emit=0.0):
    key = (hexc, rough, emit)
    if key in _mats: return _mats[key]
    h = hexc.lstrip('#'); c = [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)]
    m = bpy.data.materials.new(hexc); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Roughness'].default_value = rough
    for k in ('Specular IOR Level', 'Specular'):
        if k in b.inputs: b.inputs[k].default_value = 0.15
    if emit:
        b.inputs['Emission Color'].default_value = (*c, 1); b.inputs['Emission Strength'].default_value = emit
    _mats[key] = m; return m

GRP = ['']
def tag(o, color, rough=0.85, emit=0.0, smooth=True):
    o['grp'] = GRP[0]; o.data.materials.append(mat(color, rough, emit))
    if smooth and hasattr(o.data, 'polygons'):
        for p in o.data.polygons: p.use_smooth = True
    return o
def sphere(loc, r, color, scale=(1, 1, 1), **k):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=40, ring_count=20); o = bpy.context.object; o.scale = scale; return tag(o, color, **k)
def cyl(loc, r, depth, color, rot=(0, 0, 0), scale=(1, 1, 1), verts=40, r2=None, **k):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    else: bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object; o.scale = scale; bev(o, 0.02); return tag(o, color, **k)
def box(loc, size, color, rot=(0, 0, 0), b=0.03, **k):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); o = bpy.context.object; o.scale = size; bev(o, b); return tag(o, color, smooth=False, **k)
def torus(loc, R, r, color, rot=(0, 0, 0), scale=(1, 1, 1), **k):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot); o = bpy.context.object; o.scale = scale; return tag(o, color, **k)
def bev(o, w):
    if w <= 0: return
    m = o.modifiers.new('b', 'BEVEL'); m.width = w; m.segments = 3; m.limit_method = 'ANGLE'
def cut(o, loc, size, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); c = bpy.context.object; c.scale = size; c['grp'] = '__cutter'; c.display_type = 'WIRE'
    m = o.modifiers.new('cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c; m.solver = 'EXACT'
    return o
def face(loc, s=1.0, dark='#3a2a26'):
    # 카와이 얼굴(소품·펫용): 눈 2·볼터치·입. loc = 얼굴 중심(정면 표면), -Y 방향.
    x, y, z = loc
    for sx in (-1, 1):
        sphere((x + sx * 0.06 * s, y, z), 0.022 * s, dark, scale=(1, 0.5, 1.25), rough=0.4)
        sphere((x + sx * 0.11 * s, y + 0.005, z - 0.035 * s), 0.024 * s, '#ff9fb0', scale=(1.3, 0.3, 0.8))
    torus((x, y, z - 0.03 * s), 0.018 * s, 0.006 * s, dark, rot=(math.radians(90), 0, 0), scale=(1, 1, 0.6))

H = (0.0, 0.0, 1.55); HR = 0.55    # 머리 중심·반지름(전 체형 공통)
# 포즈: stand(정면 서기) / sit(의자에 앉아 타이핑, 3/4 시점으로 30° 돌림 — 반대 방향은 화면에서 좌우 반전)
POSE = ['stand']
SIT_YAW = math.radians(-30)
HIP_Z = 0.42                         # 앉은 엉덩이(의자 좌판) 높이 — 장면 seatAnchor 기준점
def cyl_between(p1, p2, r, color, r2=None):
    import mathutils
    a, b = mathutils.Vector(p1), mathutils.Vector(p2); d = b - a
    o = cyl(tuple((a + b) / 2), r, d.length, color, r2=r2)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    return o
def arm_pts(w, sx):
    sh = (sx * (0.34 * w + 0.04), 0, 0.93)
    hand = (sx * (0.28 * w + 0.03), -0.42, 0.8) if POSE[0] == 'sit' else (sx * (0.40 * w + 0.07), -0.01, 0.52)
    return sh, hand

# ── 베이스 바디(체형별) ──
def body(w):
    sk = '#ffffff'   # 후처리에서 피부색 곱하기
    for sx in (-1, 1):
        if POSE[0] == 'sit':
            x = sx * 0.14 * w
            cyl_between((x, 0.02, HIP_Z), (x, -0.36, HIP_Z), 0.115, sk); cyl_between((x, -0.38, HIP_Z), (x, -0.38, 0.08), 0.105, sk)
            sphere((x, -0.45, 0.06), 0.13, '#ffffff', scale=(1, 1.3, 0.6))
            sh, hd = arm_pts(w, sx); cyl_between(sh, hd, 0.085, sk); sphere(hd, 0.095, sk)
        else:
            cyl((sx * 0.14 * w, 0, 0.27), 0.115, 0.42, sk)
            sphere((sx * 0.14 * w, -0.03, 0.06), 0.13, '#ffffff', scale=(1, 1.3, 0.6))
            o = cyl((sx * (0.34 * w + 0.05), 0, 0.74), 0.085, 0.42, sk, rot=(0, sx * math.radians(18), 0))
            sphere((sx * (0.40 * w + 0.07), -0.01, 0.52), 0.095, sk)
    sphere((0, 0, 0.76), 0.34, sk, scale=(w, 0.78 * w if w > 1 else 0.78, 1.0))
    sphere(H, HR, sk, scale=(1.06, 0.96, 0.94))
    for sx in (-1, 1): sphere((sx * 0.57, 0, 1.52), 0.1, sk, scale=(0.5, 0.7, 1))   # 귀

def face_human():
    for sx in (-1, 1):
        sphere((sx * 0.19, -0.5, 1.5), 0.075, '#2a1f1d', scale=(0.9, 0.45, 1.15), rough=0.3)
        sphere((sx * 0.19 - 0.02, -0.535, 1.53), 0.024, '#ffffff', rough=0.3)
        sphere((sx * 0.31, -0.45, 1.39), 0.07, '#ff9fb0', scale=(1.3, 0.3, 0.75))
    torus((0, -0.52, 1.38), 0.045, 0.012, '#7a3a34', rot=(math.radians(80), 0, 0), scale=(1, 1, 0.55))

# ── 헤어(색은 후처리 틴트용 회색) ──
HAIRC = '#d8d8d8'
def hair(style, part):
    hx, hy, hz = H
    if part == 'front':
        o = sphere((hx, hy + 0.02, hz + 0.05), HR + 0.06, HAIRC, scale=(1.07, 1.0, 0.95))
        cut(o, (0, -0.6, hz - 0.25), (0.78, 0.8, 0.62))               # 앞머리선(이마 노출)
        low = {'short': 1.32, 'bob': 1.12, 'long': 1.2, 'bun': 1.32}[style]
        cut(o, (0, 0, low - 1), (3, 3, 2))
        for i, sx in enumerate((-0.22, 0, 0.22)):                     # 앞머리 뭉치
            sphere((sx, -0.47, hz + 0.24), 0.14, HAIRC, scale=(1.1, 0.55, 0.8))
        if style == 'bun': sphere((0, 0.12, hz + 0.62), 0.2, HAIRC)
    else:
        if style == 'long':
            o = sphere((0, 0.2, 1.25), 0.5, HAIRC, scale=(1.15, 0.6, 1.25))
        elif style == 'bob':
            o = sphere((0, 0.16, 1.4), 0.55, HAIRC, scale=(1.12, 0.7, 0.8))
        else:
            o = sphere((0, 0.12, 1.5), 0.5, HAIRC, scale=(1.05, 0.7, 0.75))

# ── 캐릭터 종류(기존 char id): 앞(귀 등)·뒤(날개) ──
def kind(k, part):
    hz = H[2]
    if part == 'back':
        if k == 'fairy':
            for sx in (-1, 1): sphere((sx * 0.42, 0.25, 0.95), 0.32, '#cfe9ff', scale=(1.2, 0.15, 0.8), rough=0.3, rot=None) if False else sphere((sx * 0.42, 0.25, 0.95), 0.32, '#cfe9ff', scale=(1.2, 0.15, 0.8), rough=0.3)
        if k == 'fox':
            sphere((0.42, 0.3, 0.45), 0.25, '#f08a3c', scale=(1.4, 0.8, 0.7))
        return
    ear = {'cat': ('#f0a34e', 'tri'), 'dog': ('#c98f5a', 'flop'), 'bunny': ('#ffffff', 'long'), 'bear': ('#8a5a3a', 'round'), 'fox': ('#f08a3c', 'tri')}
    if k in ear:
        c, t = ear[k]
        for sx in (-1, 1):
            if t == 'tri': cyl((sx * 0.33, 0, hz + 0.5), 0.17, 0.32, c, r2=0.02, rot=(0, sx * math.radians(-18), 0), scale=(1, 0.55, 1))
            elif t == 'long': sphere((sx * 0.18, 0.02, hz + 0.75), 0.12, c, scale=(0.9, 0.5, 2.6))
            elif t == 'round': sphere((sx * 0.38, 0.02, hz + 0.42), 0.15, c, scale=(1, 0.6, 1))
            else: sphere((sx * 0.55, -0.02, hz + 0.05), 0.15, c, scale=(0.6, 0.6, 1.8))
    elif k == 'penguin':
        o = sphere((0, 0.03, hz + 0.08), HR + 0.07, '#2b2f3a', scale=(1.07, 1.0, 0.98)); cut(o, (0, -0.7, hz - 0.12), (0.8, 0.9, 0.7)); cut(o, (0, 0, hz - 1.2), (3, 3, 2))
        cyl((0, -0.6, hz - 0.08), 0.06, 0.12, '#ffb43a', r2=0.0, rot=(math.radians(90), 0, 0))
    elif k == 'robot':
        cyl((0, 0, hz + 0.62), 0.025, 0.25, '#9aa3ad'); sphere((0, 0, hz + 0.78), 0.07, '#ff4f6a', emit=0.6)
    elif k == 'cactus':
        cyl((0.12, 0, hz + 0.6), 0.1, 0.3, '#7fb36a'); sphere((0.12, 0, hz + 0.77), 0.1, '#7fb36a'); sphere((0.12, -0.02, hz + 0.88), 0.06, '#ff8fb0')
    elif k == 'fairy':
        torus((0, 0, hz + 0.5), 0.3, 0.03, '#ffd86a', scale=(1, 1, 0.3), emit=0.4)

# ── 옷(체형별) ──
def outfit(spec, w, part):
    oid, name, th, top, bot, ts, bs, acc = spec
    if part == 'bottom':
        L = {'pants': (0.05, 0.47), 'shorts': (0.33, 0.47), 'wide': (0.08, 0.47)}[bs]
        for sx in (-1, 1):
            r = 0.15 if bs == 'wide' else 0.13
            if POSE[0] == 'sit':
                x = sx * 0.14 * w
                cyl_between((x, 0.03, HIP_Z), (x, -0.37 if bs != 'shorts' else -0.2, HIP_Z), r, bot)
                if bs != 'shorts': cyl_between((x, -0.38, HIP_Z + 0.02), (x, -0.38, 0.1 if bs == 'pants' else 0.13), r, bot, r2=(0.13 if bs == 'wide' else None))
            else:
                cyl((sx * 0.14 * w, 0, (L[0] + L[1]) / 2), r, L[1] - L[0], bot, r2=(0.13 if bs == 'wide' else None))
        sphere((0, 0, 0.5), 0.3, bot, scale=(w * 1.05, 0.82 * max(1, w), 0.45))
        return
    sw = 1.07
    sphere((0, 0, 0.77), 0.34 * sw, top, scale=(w, 0.78 * w if w > 1 else 0.8, 0.98))
    long_sleeve = ts in ('sweater', 'hoodie', 'jacket', 'jeogori', 'suit', 'puffer', 'smock')
    for sx in (-1, 1):
        if POSE[0] == 'sit':
            sh, hd = arm_pts(w, sx)
            end = tuple(sh[i] + (hd[i] - sh[i]) * (0.82 if long_sleeve else 0.4) for i in range(3))
            cyl_between(sh, end, 0.1 if ts != 'jeogori' else 0.13, top, r2=(0.15 if ts == 'jeogori' else None))
        elif long_sleeve:
            cyl((sx * (0.34 * w + 0.05), 0, 0.74), 0.1 if ts != 'jeogori' else 0.13, 0.4, top, rot=(0, sx * math.radians(18), 0), r2=(0.16 if ts == 'jeogori' else None))
        else:
            cyl((sx * (0.34 * w + 0.02), 0, 0.86), 0.1, 0.2, top, rot=(0, sx * math.radians(18), 0))
    yf = -0.27 * (w if w > 1 else 1) - 0.01
    if ts == 'hoodie':
        torus((0, 0.05, 1.04), 0.26 * w, 0.07, top, scale=(1, 0.9, 0.6)); cyl((-0.06, yf, 0.86), 0.012, 0.18, acc); cyl((0.06, yf, 0.86), 0.012, 0.18, acc)
        box((0, yf, 0.62), (0.36 * w, 0.03, 0.12), acc)
    elif ts in ('jacket', 'suit'):
        box((0, yf - 0.005, 0.8), (0.06, 0.02, 0.38), acc, b=0.01)
        if ts == 'jacket' and oid == 'outfit.neon':
            for sx in (-1, 1): box((sx * 0.2 * w, yf + 0.03, 0.78), (0.025, 0.02, 0.34), acc, b=0.005, emit=2.0)
    elif ts == 'jeogori':
        box((0.06, yf - 0.01, 0.9), (0.05, 0.02, 0.28), acc, b=0.01, rot=(0, math.radians(-20), 0)); box((0, yf, 1.01), (0.26, 0.02, 0.05), '#ffffff', b=0.01)
        sphere((0.12, yf - 0.02, 0.85), 0.05, acc)
    elif ts in ('apron', 'overall'):
        box((0, yf - 0.01, 0.62), (0.42 * w, 0.03, 0.5), acc if ts == 'apron' else bot, b=0.04)
        for sx in (-1, 1): box((sx * 0.14, yf - 0.005, 0.98), (0.05, 0.02, 0.2), acc if ts == 'apron' else bot, b=0.01)
        if ts == 'apron': sphere((0, yf - 0.04, 0.6), 0.06, '#ff8fb0')
    elif ts == 'tee':
        for i in range(3): box(((i - 1) * 0.1, yf - 0.005, 0.82), (0.07, 0.02, 0.07), acc, b=0.0)
    elif ts == 'smock':
        sphere((0.12, yf - 0.01, 0.66), 0.04, acc); sphere((-0.1, yf - 0.01, 0.74), 0.035, '#9ad0f0'); box((0, yf, 1.0), (0.2, 0.02, 0.06), acc, b=0.01)
    elif ts == 'suit' or (ts == 'jacket'):
        pass
    if oid == 'outfit.spacesuit':
        box((0, yf - 0.01, 0.82), (0.22, 0.03, 0.14), '#26314d', b=0.02); sphere((0.06, yf - 0.03, 0.82), 0.025, acc, emit=1.0)
    elif ts == 'aloha':
        for (x, z) in ((-0.15, 0.85), (0.12, 0.7), (0.0, 0.92), (-0.05, 0.62)): sphere((x * w, yf - 0.005, z), 0.045, acc, scale=(1, 0.3, 1))
    elif ts == 'puffer':
        for z in (0.66, 0.84): torus((0, 0, z), 0.335 * w, 0.03, top, scale=(1, 0.8, 1))
        torus((0, 0.02, 1.03), 0.24, 0.07, acc, scale=(1, 0.95, 0.7))
    elif ts == 'vest':
        for z in (0.68, 0.86): box((0, yf - 0.012, z), (0.5 * w, 0.02, 0.05), acc, b=0.01)
    elif ts == 'sweater':
        torus((0, 0.02, 1.03), 0.22, 0.05, acc, scale=(1, 0.95, 0.6)); box((0, yf, 0.55), (0.6 * w, 0.03, 0.06), acc, b=0.02)

def hat(spec):
    hid, name, th, c, shp = spec
    hz = H[2]; top = hz + HR * 0.9
    if shp == 'beret': sphere((0.06, 0.02, top - 0.02), 0.42, c, scale=(1.25, 1.1, 0.35)); sphere((0.06, 0, top + 0.12), 0.04, c)
    elif shp == 'ribbon':
        torus((0, 0.05, hz + 0.25), 0.55, 0.035, c, rot=(math.radians(-10), 0, 0), scale=(1.08, 1, 1)); cut(bpy.context.object, (0, 0, hz - 0.6), (3, 3, 1.5))
        for sx in (-1, 1): sphere((0.25 + sx * 0.1, -0.18, top + 0.05), 0.1, c, scale=(1.2, 0.5, 0.8))
        sphere((0.25, -0.2, top + 0.05), 0.05, c)
    elif shp == 'visor': box((0, -0.38, hz + 0.16), (0.95, 0.12, 0.1), c, b=0.05, emit=1.5); torus((0, 0, hz + 0.16), 0.56, 0.03, '#22233a', scale=(1.05, 1, 1))
    elif shp == 'gat':
        cyl((0, 0, top - 0.03), 0.62, 0.025, c, verts=48, rough=0.5); cyl((0, 0, top + 0.12), 0.24, 0.3, c, r2=0.2, rough=0.5); torus((0, 0, top), 0.24, 0.02, '#5a4a3a')
    elif shp == 'straw':
        cyl((0, 0, top - 0.06), 0.68, 0.035, c, verts=48); sphere((0, 0, top + 0.02), 0.34, c, scale=(1, 1, 0.65)); torus((0, 0, top - 0.02), 0.33, 0.035, '#e85a5a')
    elif shp == 'pixelcrown':
        box((0, 0, top + 0.02), (0.6, 0.6, 0.12), c, b=0.0)
        for x in (-0.24, 0, 0.24): box((x, -0.24, top + 0.15), (0.11, 0.11, 0.14), c, b=0.0)
        box((0, -0.31, top + 0.02), (0.1, 0.02, 0.07), '#e2413b', b=0.0)
    elif shp == 'bubble':
        sphere(H, HR + 0.16, c, scale=(1.08, 1, 1), rough=0.1); cut(bpy.context.object, (0, -0.75, hz - 0.05), (0.85, 0.9, 0.7))
        torus((0, 0, hz - 0.42), 0.48, 0.07, '#ff7a2f', scale=(1.05, 1, 0.8))
    elif shp == 'sunvisor':
        torus((0, 0, hz + 0.3), 0.56, 0.05, c, scale=(1.06, 1, 0.7)); o = cyl((0, -0.66, hz + 0.29), 0.34, 0.03, '#ff9a3c', scale=(1.2, 0.8, 1)); cut(o, (0, 0, hz + 0.29), (3, 1.1, 1))
    elif shp == 'beanie':
        o = sphere((0, 0.02, hz + 0.12), HR + 0.07, c, scale=(1.07, 1.0, 0.95)); cut(o, (0, 0, hz - 0.68), (3, 3, 1.6))
        torus((0, 0.02, hz + 0.13), HR + 0.02, 0.07, '#ffffff', scale=(1.07, 1.0, 0.7)); sphere((0, 0.02, top + 0.2), 0.12, '#ffffff')
    elif shp == 'crown':
        o = cyl((0, 0, top + 0.07), 0.3, 0.2, c, rough=0.35, verts=48)
        for i in range(5):
            a = i / 5 * 2 * math.pi; cyl((0.3 * math.sin(a), -0.3 * math.cos(a), top + 0.23), 0.06, 0.15, c, r2=0.0, rough=0.35)
        sphere((0, -0.31, top + 0.06), 0.045, '#e0405a', rough=0.2)
    elif shp == 'cap':
        o = sphere((0, 0.03, hz + 0.16), HR + 0.06, c, scale=(1.05, 1, 0.9)); cut(o, (0, 0, hz - 0.68), (3, 3, 1.6))
        o = cyl((0, -0.6, hz + 0.18), 0.3, 0.04, c, scale=(1, 0.9, 1)); cut(o, (0, 0, hz + 0.18), (3, 1.12, 1)); sphere((0, 0, top + 0.12), 0.04, c)
    elif shp == 'flowercrown':
        for i in range(9):
            a = math.radians(-100 + i * 25); sphere((0.56 * math.sin(a), -0.56 * math.cos(a) * 0.9, hz + 0.3), 0.075, ['#f58fb0', '#ffd23a', '#ffffff'][i % 3])
        torus((0, 0, hz + 0.28), 0.56, 0.02, '#5aa457', scale=(1, 0.9, 1)); cut(bpy.context.object, (0, 0.8, hz), (3, 1, 2))
    elif shp == 'hardhat':
        o = sphere((0, 0, hz + 0.14), HR + 0.08, c, rough=0.4, scale=(1.05, 1.02, 0.92)); cut(o, (0, 0, hz - 0.66), (3, 3, 1.6)); torus((0, 0, hz + 0.19), 0.64, 0.035, c, scale=(1, 1, 0.5))
    elif shp == 'chef':
        cyl((0, 0, top + 0.02), 0.36, 0.22, c); sphere((0, 0, top + 0.28), 0.4, c, scale=(1, 1, 0.65))
    elif shp == 'pilot':
        cyl((0, 0, top - 0.02), 0.5, 0.18, c, scale=(1.05, 1, 1)); o = cyl((0, -0.45, top - 0.1), 0.3, 0.03, '#151515', scale=(1, 0.7, 1)); cut(o, (0, 0, top), (3, 0.95, 1)); sphere((0, -0.5, top + 0.02), 0.06, '#f2c23a')

def glasses(spec):
    gid, name, c, shp = spec
    y, z = -0.55, 1.5
    if shp in ('round', 'monocle'):
        for sx in ((-1, 1) if shp == 'round' else (1,)): torus((sx * 0.19, y, z), 0.11, 0.016, c, rot=(math.radians(90), 0, 0))
        if shp == 'round': box((0, y, z + 0.02), (0.1, 0.02, 0.02), c, b=0.005)
    elif shp in ('sun', 'heart', 'goggle'):
        for sx in (-1, 1):
            if shp == 'heart':
                for dx in (-0.045, 0.045): sphere((sx * 0.19 + dx, y, z + 0.03), 0.075, c, scale=(1, 0.3, 1), rough=0.3)
                cyl((sx * 0.19, y, z - 0.04), 0.1, 0.03, c, rot=(math.radians(90), 0, 0), verts=3, scale=(1, 1, 1))
            else: sphere((sx * 0.19, y, z), 0.12, c, scale=(1.15, 0.3, 0.85), rough=0.25)
        box((0, y, z + 0.03), (0.12, 0.02, 0.025), c, b=0.005)
        if shp == 'goggle': torus((0, 0, z), 0.58, 0.03, c, scale=(1.05, 1, 0.6))
    elif shp == 'visor': box((0, y + 0.02, z), (0.75, 0.06, 0.16), c, b=0.06, emit=1.2, rough=0.2)

def hand_prop(spec, w):
    pid, name, th, c, shp = spec
    hd = arm_pts(w, 1)[1]
    x, y, z = (hd[0] + 0.02, hd[1] - 0.11, hd[2] + 0.03) if POSE[0] == 'sit' else ((0.40 * w + 0.07) + 0.02, -0.12, 0.55)
    if shp == 'mug':
        cyl((x, y, z + 0.06), 0.09, 0.17, c); torus((x + 0.1, y, z + 0.06), 0.045, 0.015, c, rot=(math.radians(90), 0, 0)); face((x, y - 0.09, z + 0.07), 0.7)
        if pid == 'hand.cocoa': sphere((x, y, z + 0.16), 0.06, '#ffffff')
    elif shp == 'balloon':
        cyl((x, y, z + 0.4), 0.005, 0.7, '#888888'); sphere((x + 0.05, y, z + 0.85), 0.2, c, scale=(1, 1, 1.15), rough=0.35); face((x + 0.05, y - 0.2, z + 0.86), 0.9)
    elif shp == 'stick': cyl((x, y, z + 0.12), 0.03, 0.42, c, emit=2.5, rot=(0, math.radians(-15), 0))
    elif shp == 'fan':
        o = cyl((x + 0.05, y - 0.02, z + 0.25), 0.22, 0.02, c, rot=(math.radians(90), 0, 0)); cut(o, (x + 0.05, y, z + 0.08), (1, 1, 0.34)); cyl((x, y, z + 0.1), 0.015, 0.22, '#7a3b22')
    elif shp == 'can':
        cyl((x + 0.03, y, z), 0.11, 0.16, c); cyl((x + 0.2, y, z + 0.05), 0.02, 0.24, c, rot=(0, math.radians(55), 0)); face((x + 0.03, y - 0.11, z), 0.7)
    elif shp == 'joystick': box((x, y, z - 0.02), (0.2, 0.14, 0.07), c, b=0.03); cyl((x, y, z + 0.08), 0.015, 0.14, '#333333'); sphere((x, y, z + 0.16), 0.045, '#ffd23a')
    elif shp == 'brush': cyl((x, y, z + 0.15), 0.018, 0.4, '#c98a55', rot=(0, math.radians(-20), 0)); sphere((x - 0.07, y, z + 0.35), 0.04, c, scale=(1, 1, 1.6))
    elif shp == 'flag': cyl((x, y, z + 0.3), 0.012, 0.75, '#bbbbbb'); box((x + 0.13, y, z + 0.58), (0.24, 0.02, 0.15), c, b=0.01)
    elif shp == 'icecream': cyl((x, y, z + 0.06), 0.06, 0.18, '#d9a46a', r2=0.0, rot=(math.radians(180), 0, 0)); sphere((x, y, z + 0.19), 0.08, c); face((x, y - 0.08, z + 0.19), 0.6)

def badge(spec, w):
    bid, name, c, shp = spec
    x, y, z = 0.17 * w, -0.27 * (w if w > 1 else 1) - 0.04, 0.88
    if shp == 'star':
        cyl((x, y, z), 0.07, 0.02, c, rot=(math.radians(90), 0, 0), verts=5, rough=0.3); cyl((x, y, z), 0.07, 0.02, c, rot=(math.radians(90), math.radians(36), 0), verts=5, rough=0.3)
    elif shp == 'heart':
        for dx in (-0.025, 0.025): sphere((x + dx, y, z + 0.02), 0.04, c, scale=(1, 0.4, 1))
        cyl((x, y, z - 0.02), 0.055, 0.02, c, rot=(math.radians(90), 0, math.radians(180)), verts=3)
    elif shp == 'medal': cyl((x, y, z - 0.02), 0.06, 0.02, c, rot=(math.radians(90), 0, 0), rough=0.3); box((x, y + 0.005, z + 0.07), (0.05, 0.01, 0.08), '#e0405a', b=0.0)
    elif shp == 'flag3':
        cols = {'badge.flagco': ['#fcd116', '#003893', '#ce1126'], 'badge.flagnl': ['#ae1c28', '#ffffff', '#21468b']}[bid]
        for i, cc in enumerate(cols): box((x, y, z + 0.035 - i * 0.035), (0.13, 0.015, 0.035), cc, b=0.0)
    else: sphere((x, y, z), 0.055, c, scale=(1, 0.35, 1), rough=0.3)

# ── 자리(책상 세트): 책상 앵커 = 책상 앞면 중앙 바닥(0,0,0). 상판 높이 0.75, 깊이 y 0~0.9 ──
TOP_Z = 0.75
def desk(spec):
    did, name, th, c = spec
    t = 0.06
    if did == 'desk.soban':
        cyl((0, 0.45, 0.42), 0.9, 0.06, c, scale=(1.1, 0.55, 1), verts=12)
        for sx in (-1, 1): box((sx * 0.75, 0.45, 0.2), (0.08, 0.5, 0.4), c, b=0.02)
        return
    box((0, 0.45, TOP_Z - t / 2), (2.0, 0.9, t), c, b=0.04)
    if did in ('desk.wood', 'desk.bamboo', 'desk.easel', 'desk.pastel', 'desk.snow'):
        for sx in (-1, 1):
            for sy in (0.08, 0.82): cyl((sx * 0.9, sy, (TOP_Z - t) / 2), 0.05, TOP_Z - t, c, r2=0.04)
        if did == 'desk.snow': box((0, 0.45, TOP_Z + 0.01), (2.05, 0.95, 0.04), '#ffffff', b=0.03)
        if did == 'desk.pastel': box((0, 0.02, TOP_Z - 0.16), (1.9, 0.05, 0.2), '#bfe8d8', b=0.04)
    else:
        box((0, 0.48, (TOP_Z - t) / 2), (1.94, 0.8, TOP_Z - t), c, b=0.05)
        if did == 'desk.neon': box((0, 0.07, TOP_Z - 0.1), (1.9, 0.02, 0.025), '#33f0ff', emit=3.0, b=0.0)
        if did == 'desk.arcade':
            for i, cc in enumerate(('#e2413b', '#ffd23a', '#5aa457', '#33a0ff')): sphere((-0.5 + i * 0.33, 0.06, 0.4), 0.06, cc, scale=(1, 0.4, 1))
        if did == 'desk.console':
            for i in range(6): box((-0.6 + i * 0.24, 0.07, 0.45), (0.12, 0.02, 0.06), ['#ff7a2f', '#33f0ff'][i % 2], emit=1.5, b=0.0)
        if did == 'desk.greenhouse':
            for i in range(3): sphere((-0.6 + i * 0.6, 0.06, 0.25), 0.12, '#5aa457', scale=(1.4, 0.4, 1))
    face((0, -0.002, TOP_Z - 0.22), 1.8) if did in ('desk.pastel', 'desk.snow', 'desk.greenhouse') else None

def desktop(spec):
    # 상판 가운데(0, 0.35, TOP_Z)에 렌더 — 좌/우 칸은 화면에서 x 평행이동(직교 카메라라 정확)
    tid, name, th, c, shp = spec
    x, y, z = 0, 0.35, TOP_Z
    if shp == 'plant':
        cyl((x, y, z + 0.08), 0.1, 0.16, '#e9a77a', r2=0.08); face((x, y - 0.1, z + 0.08), 0.8)
        for (dx, dz, s) in ((0, 0.26, 1), (-0.07, 0.2, 0.8), (0.07, 0.21, 0.8)): sphere((x + dx, y, z + dz), 0.07 * s, c, scale=(1, 1, 1.4))
    elif shp == 'mug': cyl((x, y, z + 0.09), 0.09, 0.18, c); torus((x + 0.1, y, z + 0.09), 0.045, 0.015, c, rot=(math.radians(90), 0, 0)); face((x, y - 0.09, z + 0.1), 0.7)
    elif shp == 'lamp':
        cyl((x, y, z + 0.015), 0.1, 0.03, '#22233a'); cyl((x, y, z + 0.2), 0.012, 0.36, '#22233a'); o = cyl((x + 0.06, y, z + 0.38), 0.12, 0.12, c, r2=0.05, emit=1.2)
    elif shp == 'frame': box((x, y, z + 0.15), (0.28, 0.04, 0.3), c, rot=(math.radians(-10), 0, 0), b=0.02); box((x, y - 0.025, z + 0.15), (0.2, 0.01, 0.22), '#bcd8ee', rot=(math.radians(-10), 0, 0), b=0.0); sphere((x - 0.03, y - 0.04, z + 0.13), 0.04, '#f19bb0', scale=(1, 0.3, 1))
    elif shp == 'keyboard':
        box((x, y - 0.05, z + 0.025), (0.5, 0.17, 0.05), c, b=0.02)
        for i in range(5): box((x - 0.18 + i * 0.09, y - 0.07, z + 0.06), (0.07, 0.11, 0.02), '#ffffff', b=0.01)
    elif shp == 'globe':
        cyl((x, y, z + 0.02), 0.08, 0.04, '#c9a23a'); sphere((x, y, z + 0.2), 0.14, c, rough=0.4); face((x, y - 0.14, z + 0.2), 0.8)
        if tid == 'top.snowglobe': sphere((x, y, z + 0.13), 0.06, '#ffffff')
    elif shp == 'vase': sphere((x, y, z + 0.1), 0.1, c, scale=(1, 1, 1.1)); sphere((x, y, z + 0.27), 0.06, '#ffd23a'); face((x, y - 0.1, z + 0.1), 0.7)
    elif shp == 'calc': box((x, y, z + 0.02), (0.2, 0.26, 0.04), c, b=0.02, rot=(math.radians(-8), 0, 0)); box((x, y - 0.06, z + 0.05), (0.15, 0.06, 0.01), '#bfe8d8', b=0.0)
    elif shp == 'box': box((x, y, z + 0.1), (0.3, 0.24, 0.2), c, b=0.03); face((x, y - 0.125, z + 0.1), 0.9)
    elif shp == 'trophy': cyl((x, y, z + 0.03), 0.09, 0.06, '#8a5a3a'); cyl((x, y, z + 0.2), 0.11, 0.2, c, r2=0.04, rot=(math.radians(180), 0, 0), rough=0.35); face((x, y - 0.1, z + 0.22), 0.7)
    elif shp == 'monitor': box((x, y + 0.05, z + 0.3), (0.55, 0.05, 0.36), c, b=0.03); box((x, y + 0.02, z + 0.3), (0.48, 0.01, 0.29), '#33f0ff', emit=1.0, b=0.0); cyl((x, y + 0.05, z + 0.06), 0.03, 0.12, c); cyl((x, y, z + 0.01), 0.12, 0.02, c)
    elif shp == 'shell': sphere((x, y, z + 0.07), 0.13, c, scale=(1.2, 0.8, 0.6)); face((x, y - 0.1, z + 0.08), 0.7)

def floor_item(spec):
    fid, name, th, c, shp = spec
    if shp == 'rug':
        cyl((0, 0.7, 0.008), 1.6, 0.016, c, scale=(1, 0.65, 1), verts=48)
        if fid == 'rug.wood':
            for i in range(-2, 3): box((i * 0.5, 0.7, 0.018), (0.12, 1.6, 0.004), '#f4e3c1', b=0.0)
        if fid == 'rug.neon': torus((0, 0.7, 0.02), 1.35, 0.02, '#33f0ff', scale=(1, 0.65, 0.3), emit=2.0)
        cut(bpy.context.object, (0, 0.7, -1), (5, 5, 1.9))
    elif shp == 'chair':
        y = 1.55
        box((0, y, 0.42), (0.6, 0.5, 0.08), c, b=0.04); box((0, y + 0.25, 0.8), (0.6, 0.08, 0.7 if fid != 'chair.gaming' else 0.95), c, b=0.06)
        for sx in (-1, 1): cyl((sx * 0.24, y, 0.2), 0.03, 0.4, '#555555' if fid == 'chair.gaming' else c)
        if fid == 'chair.gaming': box((0, y + 0.2, 1.05), (0.4, 0.03, 0.08), '#33f0ff', emit=2.0, b=0.0)
    elif shp == 'cushion': sphere((0, 1.4, 0.05), 0.4, c, scale=(1.1, 0.9, 0.18))
    elif shp in ('shelf', 'arcade'):
        x, y = -1.55, 1.6
        if shp == 'arcade':
            box((x, y, 0.75), (0.6, 0.5, 1.5), c, b=0.06); box((x, y - 0.26, 1.05), (0.46, 0.02, 0.36), '#33f0ff', emit=1.2, b=0.0); face((x, y - 0.27, 1.05), 1.4)
            return
        box((x, y, 0.8), (0.7, 0.35, 1.6), c, b=0.04)
        for i, z in enumerate((0.35, 0.8, 1.25)):
            box((x, y - 0.18, z), (0.6, 0.02, 0.03), '#ffffff', b=0.0)
            for j in range(4):
                if fid == 'shelf.plant': sphere((x - 0.22 + j * 0.15, y - 0.1, z + 0.1), 0.07, '#5aa457')
                else: box((x - 0.22 + j * 0.13, y - 0.1, z + 0.14), (0.08, 0.2, 0.26), ['#e2413b', '#3a6fd8', '#ffd23a', '#5aa457'][(i + j) % 4], b=0.01)
    elif shp == 'bigplant':
        x, y = -1.35, 0.9
        cyl((x, y, 0.2), 0.22, 0.4, '#e9a77a', r2=0.18); face((x, y - 0.21, 0.22), 1.3)
        for (dx, dz, s) in ((0, 0.75, 1.2), (-0.15, 0.6, 1), (0.16, 0.62, 1)): sphere((x + dx, y, dz), 0.18 * s, c, scale=(1, 1, 1.5))

PET_POS = (1.35, -0.25, 0.0)
ISO_PET_POS = (1.45, -0.35, 0.0)   # 아이소: 책상 오른쪽 앞 바닥(사람 쪽 = -y)
def pet(spec, frame):
    pid, name, c, shp = spec
    x, y, z = PET_POS
    b = 0.03 if frame else 0.0     # 2번째 프레임: 살짝 들썩
    t = math.radians(15 if frame else -10)
    dark = '#3a2a26'
    if shp in ('dog', 'cat', 'bunny', 'hamster', 'penguin', 'chick'):
        sphere((x, y + 0.05, z + 0.17), 0.19, c, scale=(1, 0.95, 0.85))
        sphere((x, y - 0.02, z + 0.43 + b), 0.19, c)
        face((x, y - 0.2, z + 0.42 + b), 0.95)
        if shp == 'dog':
            for sx in (-1, 1): sphere((x + sx * 0.17, y, z + 0.45 + b), 0.07, '#a8774a', scale=(0.6, 0.6, 1.5))
            cyl((x + 0.2, y + 0.2, z + 0.22), 0.03, 0.18, c, rot=(0, math.radians(50) + t, 0))
        elif shp == 'cat':
            for sx in (-1, 1): cyl((x + sx * 0.11, y - 0.02, z + 0.62 + b), 0.07, 0.12, c, r2=0.0, scale=(1, 0.6, 1))
            cyl((x + 0.2, y + 0.18, z + 0.3), 0.025, 0.32, c, rot=(0, math.radians(25) + t, 0))
        elif shp == 'bunny':
            for sx in (-1, 1): sphere((x + sx * 0.07, y, z + 0.7 + b), 0.05, c, scale=(0.9, 0.5, 2.4), rotation=None) if False else sphere((x + sx * 0.07, y, z + 0.7 + b), 0.05, c, scale=(0.9, 0.5, 2.4))
            sphere((x, y + 0.22, z + 0.12), 0.06, '#ffffff')
        elif shp == 'hamster':
            for sx in (-1, 1): sphere((x + sx * 0.13, y - 0.02, z + 0.58 + b), 0.05, '#ffbfa8')
        elif shp == 'penguin':
            sphere((x, y - 0.12, z + 0.17), 0.12, '#ffffff', scale=(1, 0.6, 1.1)); cyl((x, y - 0.22, z + 0.38 + b), 0.04, 0.07, '#ffb43a', r2=0.0, rot=(math.radians(90), 0, 0))
        elif shp == 'chick':
            cyl((x, y - 0.22, z + 0.4 + b), 0.035, 0.06, '#ff9a3c', r2=0.0, rot=(math.radians(90), 0, 0)); sphere((x, y, z + 0.63 + b), 0.04, c)
    elif shp in ('bee', 'butterfly'):
        zz = z + 0.75 + b * 2
        sphere((x, y, zz), 0.12, c, scale=(1.2, 1, 1)); face((x, y - 0.12, zz), 0.8)
        if shp == 'bee':
            for dx in (-0.04, 0.05): box((x + dx, y, zz), (0.03, 0.24, 0.24), '#3a2a26', b=0.0)
        for sx in (-1, 1): sphere((x + sx * 0.14, y + 0.03, zz + 0.1), 0.1 if shp == 'bee' else 0.15, '#e8f4ff' if shp == 'bee' else '#f19bb0', scale=(1, 0.2, 1.3 if frame else 0.9), rough=0.3)
    elif shp == 'fish':
        sphere((x, y, z + 0.22), 0.22, '#cfe9ff', rough=0.1, scale=(1, 1, 0.95)); cyl((x, y, z + 0.02), 0.15, 0.04, '#9a7b5a')
        sphere((x + (0.04 if frame else -0.04), y - 0.15, z + 0.24), 0.07, c, scale=(1.3, 0.6, 1)); face((x + (0.04 if frame else -0.04), y - 0.2, z + 0.25), 0.5)
    elif shp == 'turtle':
        sphere((x, y + 0.05, z + 0.12), 0.22, c, scale=(1.1, 1, 0.6)); sphere((x, y - 0.2, z + 0.12 + b), 0.09, '#b8d98a'); face((x, y - 0.28, z + 0.13 + b), 0.6)

# ── 빌드 ──
build = []   # (그룹, 함수)
for bname, w in BODIES.items():
    build.append((f'body@{bname}', lambda w=w: body(w)))
    for o in OUTFITS:
        for part in ('top', 'bottom'): build.append((f'{o[0]}@{bname}.{part}', lambda o=o, w=w, part=part: outfit(o, w, part)))
    for h in HANDS: build.append((f'{h[0]}@{bname}', lambda h=h, w=w: hand_prop(h, w)))
    for b in BADGES: build.append((f'{b[0]}@{bname}', lambda b=b, w=w: badge(b, w)))
build.append(('face', face_human))
for s in HAIRS:
    for part in ('front', 'back'): build.append((f'hair.{s}.{part}', lambda s=s, part=part: hair(s, part)))
for k in KINDS:
    for part in ('front', 'back'): build.append((f'kind.{k}.{part}', lambda k=k, part=part: kind(k, part)))
for h in HATS: build.append((h[0], lambda h=h: hat(h)))
for g in GLASSES: build.append((g[0], lambda g=g: glasses(g)))
for d in DESKS: build.append((d[0], lambda d=d: desk(d)))
for t in DESKTOP: build.append((t[0], lambda t=t: desktop(t)))
for f in FLOORS: build.append((f[0], lambda f=f: floor_item(f)))
for p in PETS:
    for fr in (0, 1): build.append((f'{p[0]}#{fr}', lambda p=p, fr=fr: pet(p, fr)))
import mathutils
ROT = mathutils.Matrix.Rotation(SIT_YAW, 4, 'Z')
CHAR_PREFIX = ('body@', 'outfit.', 'hand.', 'badge.', 'face', 'hair.', 'kind.', 'hat.', 'glasses.')
if ISO:
    build = [(g, fn) for g, fn in build if g.startswith(('desk.', 'top.', 'pet.'))]
    PET_POS = ISO_PET_POS
ISO_GROW = {'top.': (1.7, (0, 0.35, 0.75)), 'pet.': (1.3, (1.45, -0.35, 0.0))}   # 장면에서 작게 보여 디테일이 안 보이던 문제 → 아이소 세트만 키움
for g, fn in build:
    before_iso = set(sc.objects) if ISO else None
    GRP[0] = g; POSE[0] = 'stand'; fn()
    if ISO:
        for pre, (k, (px_, py_, pz_)) in ISO_GROW.items():
            if g.startswith(pre):
                bpy.context.view_layer.update()
                for o in set(sc.objects) - before_iso:
                    o.location = (px_ + (o.location.x - px_) * k, py_ + (o.location.y - py_) * k, pz_ + (o.location.z - pz_) * k); o.scale = tuple(v * k for v in o.scale)
    if g.startswith(CHAR_PREFIX):
        before = set(sc.objects)
        GRP[0] = g + '~sit'; POSE[0] = 'sit'; fn(); bpy.context.view_layer.update()
        for o in set(sc.objects) - before:
            if o.get('grp') == '__cutter' or o.get('grp') == GRP[0]: o.matrix_world = ROT @ o.matrix_world
POSE[0] = 'stand'

def render(target, holdout, cam_kind, name):
    if FILT and FILT not in name: return
    path = os.path.join(OUT, name + '.png')
    if os.path.exists(path): return
    for o in sc.objects:
        g = o.get('grp', '')
        if g in ('__light',) or o.type == 'CAMERA': continue
        if g == '__cutter': o.hide_render = True; continue
        o.hide_render = not (g in target or g in holdout)
        o.is_holdout = g in holdout
    if cam_kind == 'iso': set_cam_iso(ISO_CENTER, ISO_SCALE, ISO_PX)
    elif cam_kind == 'ch': set_cam(CH_CENTER, CH_SCALE, CH_PX)
    else: set_cam(DK_CENTER, DK_SCALE, DK_PX)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)

if ISO:
    from bpy_extras.object_utils import world_to_camera_view
    import json, mathutils
    set_cam_iso(ISO_CENTER, ISO_SCALE, ISO_PX); bpy.context.view_layer.update()
    def px(p):
        v = world_to_camera_view(sc, cam, mathutils.Vector(p)); return [round(v.x * ISO_PX / 2, 1), round((1 - v.y) * ISO_PX / 2, 1)]   # 출력 384 기준
    A = {'canvas': 384, 'floor': px((0, 0, 0)), 'top': px((0, 0.45, TOP_Z)), 'deskL': px((-0.65, 0.35, TOP_Z)), 'deskM': px((0, 0.35, TOP_Z)), 'deskR': px((0.65, 0.35, TOP_Z)), 'pet': px(ISO_PET_POS), 'elev': 30, 'az': 45}
    json.dump(A, open(os.path.join(OUT, 'iso-anchors.json'), 'w'), indent=1)
    for d in DESKS: render({d[0]}, set(), 'iso', d[0] + '@iso')
    for t in DESKTOP: render({t[0]}, set(), 'iso', t[0] + '@iso')
    for p_ in PETS:
        for fr in (0, 1): render({f'{p_[0]}#{fr}'}, set(), 'iso', f'{p_[0]}#{fr}@iso')
    print('PMCHAR_DONE', OUT); sys.exit(0)
for bname in BODIES:
    B = f'body@{bname}'
    render({B}, set(), 'ch', f'body@{bname}')
    for o in OUTFITS:
        render({f'{o[0]}@{bname}.bottom'}, {B}, 'ch', f'{o[0]}@{bname}.bottom')
        render({f'{o[0]}@{bname}.top'}, {B}, 'ch', f'{o[0]}@{bname}.top')
    for h in HANDS: render({f'{h[0]}@{bname}'}, {B}, 'ch', f'{h[0]}@{bname}')
    for b in BADGES: render({f'{b[0]}@{bname}'}, set(), 'ch', f'{b[0]}@{bname}')
HEAD = {'body@std'}   # 머리는 전 체형 공통 → std 의 머리로 holdout
render({'face'}, set(), 'ch', 'face')
for s in HAIRS:
    render({f'hair.{s}.back'}, HEAD, 'ch', f'hair.{s}.back')
    render({f'hair.{s}.front'}, HEAD, 'ch', f'hair.{s}.front')
for k in KINDS:
    render({f'kind.{k}.back'}, HEAD, 'ch', f'kind.{k}.back')
    render({f'kind.{k}.front'}, HEAD, 'ch', f'kind.{k}.front')
for h in HATS: render({h[0]}, HEAD, 'ch', h[0])
for g in GLASSES: render({g[0]}, set(), 'ch', g[0])
for sfx in ('~sit',):
    for bname in BODIES:
        B = f'body@{bname}' + sfx
        render({B}, set(), 'ch', B)
        for o in OUTFITS:
            render({f'{o[0]}@{bname}.bottom' + sfx}, {B}, 'ch', f'{o[0]}@{bname}.bottom' + sfx)
            render({f'{o[0]}@{bname}.top' + sfx}, {B}, 'ch', f'{o[0]}@{bname}.top' + sfx)
        for h in HANDS: render({f'{h[0]}@{bname}' + sfx}, {B}, 'ch', f'{h[0]}@{bname}' + sfx)
        for b in BADGES: render({f'{b[0]}@{bname}' + sfx}, set(), 'ch', f'{b[0]}@{bname}' + sfx)
    HS = {'body@std' + sfx}
    render({'face' + sfx}, set(), 'ch', 'face' + sfx)
    for st_ in HAIRS:
        render({f'hair.{st_}.back' + sfx}, HS, 'ch', f'hair.{st_}.back' + sfx)
        render({f'hair.{st_}.front' + sfx}, HS, 'ch', f'hair.{st_}.front' + sfx)
    for k in KINDS:
        render({f'kind.{k}.back' + sfx}, HS, 'ch', f'kind.{k}.back' + sfx)
        render({f'kind.{k}.front' + sfx}, HS, 'ch', f'kind.{k}.front' + sfx)
    for h in HATS: render({h[0] + sfx}, HS, 'ch', h[0] + sfx)
    for g in GLASSES: render({g[0] + sfx}, set(), 'ch', g[0] + sfx)
for d in DESKS: render({d[0]}, set(), 'dk', d[0])
for t in DESKTOP: render({t[0]}, set(), 'dk', t[0])
for f in FLOORS: render({f[0]}, set(), 'dk', f[0])
for p in PETS:
    for fr in (0, 1): render({f'{p[0]}#{fr}'}, set(), 'dk', f'{p[0]}#{fr}')
print('PMCHAR_DONE', OUT)
