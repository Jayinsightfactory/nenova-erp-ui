# scripts/pm3d/render_shop.py — 상점·꾸미기 미리보기 렌더(3D 장면에 실제로 쓰는 glb 모델 → 상점 그림)
# 실행: blender -b --factory-startup -P scripts/pm3d/render_shop.py -- <public/pm3d> <public/pm/shop>
#   입력: scripts/pm3d/shop_spec.json (node scripts/pm3d/dump_shop_spec.mjs — lib 와 같은 조합 규칙)
#   산출: public/pm/shop/<key>.webp — 3/4 정면, 소프트 조명, 투명 배경 512px(2배), WEBP
#     char.<id>.webp           종족 10종(베이스, 미리보기 레이어 겹침의 바닥)
#     layer.outfit.<id>.webp   옷(몸 메시만, 베이스와 같은 카메라 → 겹치면 장착 모습)
#     layer.hat_<mesh>.webp    모자 리그 메시 3종(같은 카메라)
#     <item key>.webp          책상·의자·러그·상판 소품·펫(상점 카드)
# 톤: docs/pm-design-standard.md 소프트 클레이(무광 파스텔, 부드러운 단일광 그림자, 외곽선 없음)
import bpy, json, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SRC = os.path.abspath(argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d'))
OUT = os.path.abspath(argv[1] if len(argv) > 1 else os.path.join(os.getcwd(), 'public', 'pm', 'shop'))
SPEC = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shop_spec.json'), encoding='utf-8'))
os.makedirs(OUT, exist_ok=True)
R = math.radians

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
eng = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in eng else 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x = sc.render.resolution_y = 512
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'WEBP'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.image_settings.quality = 88
sc.view_settings.view_transform = 'Standard'
for k, v in (('taa_render_samples', 48), ('use_gtao', True), ('use_shadows', True), ('use_raytracing', True)):
    try: setattr(sc.eevee, k, v)
    except Exception: pass
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (1, 0.97, 0.93, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.65

# 부드러운 단일광 + 필 (기준 시안 톤)
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 2.4; sun.angle = R(16)
so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so); so.rotation_euler = (R(52), R(8), R(-32))
fill = bpy.data.lights.new('fill', 'SUN'); fill.energy = 0.9; fill.angle = R(35)
fo = bpy.data.objects.new('fill', fill); sc.collection.objects.link(fo); fo.rotation_euler = (R(62), 0, R(142))

cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.clip_end = 100
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
CAM_DIR = Vector((math.sin(R(35)), -math.cos(R(35)), math.tan(R(28)))).normalized()  # 3/4 정면(캐릭터 정면 = -Y)

def aim(center, scale):
    cd.ortho_scale = scale
    cam.location = Vector(center) + CAM_DIR * 30
    d = (Vector(center) - cam.location).normalized()
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def lin(h):
    h = str(h).lstrip('#'); return tuple(((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)) + (1,)

def imp(f):
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, f))
    return [o for o in bpy.data.objects if o not in before]

def render(name):
    sc.render.filepath = os.path.join(OUT, name + '.webp')
    bpy.ops.render.render(write_still=True)
    print('SHOP_RENDER', name)

def set_hide(o, hide):
    o.hide_render = hide; o.hide_viewport = hide

# ── 1) 캐릭터(char.glb) — idle 1프레임, 종족 10종 + 옷 레이어 + 모자 레이어(같은 카메라) ──
chobjs = imp('char.glb')
rig = next(o for o in chobjs if o.type == 'ARMATURE')
if rig.animation_data:
    for t in list(rig.animation_data.nla_tracks):
        act = t.strips[0].action if t.strips else None
        if act and act.name.split('.')[0] == 'idle':
            rig.animation_data.action = act
            try: rig.animation_data.action_slot = act.slots[0]
            except Exception: pass
        rig.animation_data.nla_tracks.remove(t)
sc.frame_set(1)
meshes = [o for o in chobjs if o.type == 'MESH']
# 몸은 메시 1개 + 재질 슬롯 7개(bottom/top/skin/shoe/cheek/hair/face) → 보이기/색은 재질 단위로 다룬다
MATS = {}
for o in meshes:
    for sl in o.material_slots:
        if sl.material: MATS.setdefault(sl.material.name.split('.')[0], sl.material)
def bsdf(m): return m.node_tree.nodes['Principled BSDF']
def tint(groups):
    for bn, hexc in groups.items():
        if bn in MATS: bsdf(MATS[bn]).inputs['Base Color'].default_value = lin(hexc)
# 얼굴 데칼: 기본 표정 텍스처(smile) — 알파는 텍스처 링크로 제어(레이어 렌더 때 떼었다 붙임)
FACE_TEX = None
face_png = os.path.join(SRC, 'face', 'smile.webp')
if 'face' in MATS and os.path.exists(face_png):
    try:
        m = MATS['face']; img = bpy.data.images.load(face_png)
        nt = m.node_tree; FACE_TEX = nt.nodes.new('ShaderNodeTexImage'); FACE_TEX.image = img
        nt.links.new(FACE_TEX.outputs['Color'], bsdf(m).inputs['Base Color'])
        nt.links.new(FACE_TEX.outputs['Alpha'], bsdf(m).inputs['Alpha'])
    except Exception as e: print('face tex skip', e); FACE_TEX = None
def face_show(show):
    if 'face' not in MATS: return
    m = MATS['face']; b = bsdf(m)
    if show and FACE_TEX is not None:
        if not b.inputs['Alpha'].links: m.node_tree.links.new(FACE_TEX.outputs['Alpha'], b.inputs['Alpha'])
    else:
        for l in list(b.inputs['Alpha'].links): m.node_tree.links.remove(l)
        b.inputs['Alpha'].default_value = 1.0 if (show and FACE_TEX is None) else 0.0

ATTACH = []
def clear_attach():
    global ATTACH
    for o in ATTACH: bpy.data.objects.remove(o, do_unlink=True)
    ATTACH = []

def add_attach(spec, skin, hair):
    # 좌표: three/glTF Y-up [x,y,z] → 블렌더 (x, -z, y). 모양 기본 축은 양쪽 다 '위'라 rot 값 그대로 쓴다.
    for a in spec or []:
        p = (a['p'][0], -a['p'][2], a['p'][1])
        if a['shape'] == 'cone': bpy.ops.mesh.primitive_cone_add(radius1=a['r'], radius2=0, depth=a['h'], location=p, vertices=16)
        elif a['shape'] == 'cyl': bpy.ops.mesh.primitive_cylinder_add(radius=a['r'], depth=a['h'], location=p, vertices=12)
        elif a['shape'] == 'torus': bpy.ops.mesh.primitive_torus_add(major_radius=a['R'], minor_radius=a['r'], location=p, major_segments=18, minor_segments=8)
        else: bpy.ops.mesh.primitive_uv_sphere_add(radius=a['r'], location=p, segments=16, ring_count=10)
        o = bpy.context.object
        if a.get('s'): o.scale = (a['s'][0], a['s'][2], a['s'][1])  # three [sx,sy,sz] → 블렌더 (sx, sz, sy)
        if a.get('rot'): o.rotation_euler = (a['rot'][0], a['rot'][2], a['rot'][1])
        col = hair if a.get('c') == 'hair' else skin if a.get('c') == 'skin' else a.get('c')
        m = bpy.data.materials.new('att'); m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = lin(col); bsdf.inputs['Roughness'].default_value = 0.9
        o.data.materials.append(m)
        for pg in o.data.polygons: pg.use_smooth = (a['shape'] != 'cone')
        ATTACH.append(o)

def char_vis(show_groups, hat=''):
    # show_groups: 재질 베이스명 집합(알파 0/1로 토글 — 몸이 메시 1개라 재질 단위). hat = 보일 hat_* 메시('' = 전부 숨김)
    for o in meshes:
        if o.name.startswith('hat_'): set_hide(o, not (hat and o.name.startswith(hat)))
    for bn, m in MATS.items():
        if bn.startswith('hat_') or bn == 'face': continue
        bsdf(m).inputs['Alpha'].default_value = 1.0 if bn in show_groups else 0.0
    face_show('face' in show_groups)

CHAR_GROUPS = {'top', 'bottom', 'skin', 'hair', 'shoe', 'cheek', 'face'}
aim((0, 0, 1.05), 2.6)  # 전신 + 귀 여유, 모든 캐릭터/레이어 렌더 공통(레이어 겹침 전제)
for c in SPEC['characters']:
    clear_attach()
    show = set(CHAR_GROUPS)
    if c.get('hideHair'): show.discard('hair')
    char_vis(show)
    tint({'top': c['top'], 'bottom': c['bottom'], 'skin': c['skin'], 'hair': c['hair']})
    add_attach(c.get('attach'), c['skin'], c['hair'])
    render(c['key'])
clear_attach()
# 옷 레이어(몸 메시만) — 베이스와 같은 카메라
for it in [x for x in SPEC['items'] if x['kind'] == 'outfit']:
    char_vis({'top', 'bottom'})
    tint({'top': it['top'], 'bottom': it['bottom']})
    render('layer.' + it['key'])
# 모자 레이어 3종(같은 카메라) — hat.* 카드와 미리보기 겹침이 같은 그림을 쓴다
for mesh in SPEC['hatLayers']:
    char_vis(set(), hat=mesh)
    render('layer.' + mesh)
for o in chobjs: set_hide(o, True)
clear_attach()

# ── 2) 아이템(kit.glb + 펫 구체) — 카드별 3/4 구도, 바운딩 자동 맞춤 ──
kit = imp('kit.glb'); KIT = {o.name: o for o in kit if o.parent is None}
for o in kit: set_hide(o, True)

def show_tree(root, show):
    for o in [root] + list(root.children_recursive):
        if o.type == 'MESH' or o is root: set_hide(o, not show)

def bbox(root):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in [root] + list(root.children_recursive):
        if o.type != 'MESH': continue
        for v in o.bound_box:
            p = o.matrix_world @ Vector(v)
            lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
    return lo, hi

def render_item(key, model, tint_hex=None):
    src = KIT.get(model)
    if not src: print('SHOP_SKIP', key, model); return False
    show_tree(src, True)
    mats = []
    if tint_hex:
        for o in [src] + list(src.children_recursive):
            if o.type != 'MESH': continue
            for sl in o.material_slots:
                if not sl.material: continue
                mm = sl.material.copy(); mats.append((sl, sl.material));
                b = mm.node_tree.nodes.get('Principled BSDF')
                if b:
                    c0 = b.inputs['Base Color'].default_value; c1 = lin(tint_hex)
                    b.inputs['Base Color'].default_value = tuple(c0[i] * 0.35 + c1[i] * 0.65 for i in range(3)) + (1,)
                sl.material = mm
    lo, hi = bbox(src)
    center = (lo + hi) / 2; size = max((hi - lo).length * 1.1, 0.6)
    aim(tuple(center), size)
    render(key)
    for sl, old in mats: sl.material = old
    show_tree(src, False)
    return True

for it in SPEC['items']:
    if it['kind'] == 'kit':
        render_item(it['key'], it['model'], it.get('tint'))
    elif it['kind'] == 'pet':
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.26, location=(0, 0, 0.22), segments=20, ring_count=12)
        o = bpy.context.object; o.scale = (1.2, 1, 0.85)
        m = bpy.data.materials.new('pet'); m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = lin(it['tint']); b.inputs['Roughness'].default_value = 1.0
        o.data.materials.append(m)
        for pg in o.data.polygons: pg.use_smooth = True
        # 눈 두 점(클레이 펫 느낌)
        eyes = []
        for sx in (0.12, -0.12):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.03, location=(sx, -0.27, 0.3), segments=10, ring_count=6)
            e = bpy.context.object
            em = bpy.data.materials.new('pe'); em.use_nodes = True
            em.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.04, 0.04, 1)
            e.data.materials.append(em); eyes.append(e)
        aim((0, 0, 0.24), 0.95)
        render(it['key'])
        for x in [o] + eyes: bpy.data.objects.remove(x, do_unlink=True)
print('SHOP_RENDER_DONE')
