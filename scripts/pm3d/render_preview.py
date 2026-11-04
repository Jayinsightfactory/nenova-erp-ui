# scripts/pm3d/render_preview.py — 3D 사무실 시안 스틸 렌더(블렌더 백그라운드, Eevee)
# 실행: blender -b -P scripts/pm3d/render_preview.py -- <public/pm3d> <출력.png> <B|I>
# kit.glb·char.glb 를 불러와 웹(lib/pm3dLayout.js)과 같은 배치로 조립 → 아이소메트릭 직교 카메라 1920x1080.
import bpy, math, os, sys, random
argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, TH = argv[0], argv[1], (argv[2] if len(argv) > 2 else 'B')
R = math.radians
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
eng = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in eng else 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.view_settings.view_transform = 'Standard'
try: sc.view_settings.look = 'AgX - Base Contrast'
except Exception: pass
for k, v in (('taa_render_samples', 48), ('use_gtao', True), ('use_shadows', True), ('use_raytracing', True)):
    try: setattr(sc.eevee, k, v)
    except Exception: pass
BG = {'B': (0.98, 0.9, 0.87), 'I': (0.72, 0.93, 0.94)}[TH]
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (*BG, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.6

def imp(f):
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, f)); return [o for o in bpy.data.objects if o not in before]
kit = imp('kit.glb'); KIT = {o.name: o for o in kit if o.parent is None}
for o in kit: o.hide_render = True; o.hide_viewport = True
def put(name, x, z, ry=0.0, s=1.0, parent=None):
    src = KIT.get(name)
    if not src: return None
    root = bpy.data.objects.new(name + '_i', None); sc.collection.objects.link(root)
    for ch in src.children_recursive:
        if ch.type != 'MESH': continue
        c = ch.copy(); c.hide_render = False; c.hide_viewport = False; sc.collection.objects.link(c)
        c.parent = root; c.matrix_parent_inverse = src.matrix_world.inverted()
    # glTF(Y-up) → 블렌더(Z-up): 웹 (x, z) = 블렌더 (x, -y)
    root.location = (x, -z, 0); root.rotation_euler = (0, 0, ry); root.scale = (s, s, s)
    if parent: root.parent = parent
    return root

# ── 배치(lib/pm3dLayout.js 와 같은 규칙) ──
STATION_GAP, DESK_DX, DESK_DZ, DEPT_GAP = 2.6, 1.6, 2.2, 1.4
ROOMS = [('영업지원', 3), ('수입부', 2), ('영업부', 3), ('경영지원', 1)]
desks, plates = [], []
sides = [[], []]
for i, r in enumerate(ROOMS): sides[i % 2].append(r)
for side, rs in enumerate(sides):
    sign = -1 if side == 0 else 1
    widths = [max(1, math.ceil(n / 2)) * DESK_DX for _, n in rs]
    x0 = -(sum(widths) + DEPT_GAP * max(0, len(rs) - 1)) / 2
    for k, (dept, n) in enumerate(rs):
        cols = max(1, math.ceil(n / 2))
        for j in range(n):
            col, row = j % cols, j // cols
            desks.append((x0 + DESK_DX / 2 + col * DESK_DX, sign * (3.6 + row * DESK_DZ), -sign if row == 0 else sign, j))
        plates.append((x0 + widths[k] / 2, sign * (3.6 + DESK_DZ * 1.5 + 0.6)))
        x0 += widths[k] + DEPT_GAP
hx = math.ceil(max(STATION_GAP * 5, *[abs(d[0]) + 2 for d in desks]) / 2) * 2
hz = math.ceil(max(6, *[abs(d[1]) + 2.5 for d in desks]) / 2) * 2

floor = 'floor_b' if TH == 'B' else 'floor_i'
x = -hx + 1
while x < hx:
    z = -hz + 1
    while z < hz: put(floor, x, z); z += 2
    x += 2
if TH == 'B':
    x = -hx + 1
    while x < hx: put('wall', x, -hz); x += 2
    z = -hz + 1
    while z < hz: put('wall', -hx, z, R(90)); z += 2
    for (px, pz) in [(-hx + 1, -hz + 1.2), (hx - 1, -hz + 1.2), (hx - 1, hz - 1), (-hx + 1.2, hz - 1)]: put('plant', px, pz)
    put('parcel', hx - 2.4, -hz + 1.3); put('parcel', hx - 2.9, -hz + 1.6, 0.5, 0.8)
    for (px, pz) in plates: put('partition', px, pz - math.copysign(0.1, pz))
else:
    x = -hx + 1
    while x < hx: put('sea', x, -hz - 1); put('sea', x, -hz - 3); put('boardwalk', x, 0, R(90)); x += 2
    for i, (px, pz) in enumerate([(-hx + 0.8, -hz + 1), (hx - 0.8, -hz + 1.4), (-hx + 0.9, hz - 1), (hx - 1, hz - 1.2), (0, -hz + 0.9)]): put('palm', px, pz, i)
    put('hut', -hx + 1.6, -2.4); put('hut', hx - 1.6, 2.4); put('rock', -hx + 2, -hz + 1.5); put('rock', hx - 3, hz - 0.8)
    for (px, pz) in plates: put('parasol', px, pz, 0, 1.1); put('surfboard', px + 2.6, pz, 0.3)
for no in range(1, 10): put(f'station_{no}', (no - 5) * STATION_GAP, 0)
for i in range(3): put('robot', -hx + 2 + i * 1.6, hz - 1.6, 0, 0.8)

# ── 직원(캐릭터 앉힘) ──
LOOKS = [('#f7b6cf', '#a8e2d0', '#2b2220', 'hat_cap'), ('#ff9a3c', '#3ab0c8', '#6b4630', 'hat_straw'), ('#bcd8ee', '#fbfbf7', '#c98f4a', ''),
         ('#3c7fd8', '#33415c', '#2b2220', ''), ('#b5733f', '#e8d6b8', '#9a7bd1', 'hat_party'), ('#caffbf', '#bdb2ff', '#6b4630', '')]
def lin(h): h = h.lstrip('#'); return tuple(((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)) + (1,)
random.seed(3)
for n, (dx, dz, face, j) in enumerate(desks):
    ry = 0 if face > 0 else R(180)
    g = bpy.data.objects.new('seat', None); sc.collection.objects.link(g); g.location = (dx, -dz, 0); g.rotation_euler = (0, 0, ry)
    put('desk', 0, 0, parent=g); m = put('monitor', 0, -0.12, parent=g); m.location.z = 0.76
    put('chair', 0, 0.62, R(180), parent=g)
    if TH == 'B' and n % 2 == 0: p = put('mug', -0.42, 0.05, parent=g); p.location.z = 0.76
    if n % 3 == 1: p = put('plant', 0.42, 0.05, 0, 0.35, parent=g); p.location.z = 0.76
    objs = imp('char.glb')
    rig = next(o for o in objs if o.type == 'ARMATURE')
    for top in [o for o in objs if o.parent is None]:
        top.parent = g; top.location = (0, -0.64, 0.42 - 0.42 * 0.62 + 0.04); top.rotation_euler = (0, 0, R(180)); top.scale = (0.62, 0.62, 0.62)
    L = LOOKS[n % len(LOOKS)]
    clip = 'doze' if n % 4 == 3 else 'sit_type'
    if rig.animation_data:
        for t in list(rig.animation_data.nla_tracks): rig.animation_data.nla_tracks.remove(t)
        rig.animation_data.action = None
    POSE = {'thigh.L': (90, 0, 0), 'thigh.R': (90, 0, 0), 'shin.L': (-90, 0, 0), 'shin.R': (-90, 0, 0)}
    POSE.update({'arm.L': (20, 0, -8), 'arm.R': (20, 0, 8), 'spine': (16, 0, 0), 'head': (25, 0, 7)} if clip == 'doze' else {'arm.L': (62, 0, -12), 'arm.R': (66, 0, 12), 'head': (8, 0, 0)})
    for bn, rr in POSE.items():
        pb = rig.pose.bones[bn]; pb.rotation_mode = 'XYZ'; pb.rotation_euler = tuple(R(a) for a in rr)
    for o in objs:
        if o.type != 'MESH': continue
        if o.name.startswith('hat_'): o.hide_render = not (L[3] and o.name.startswith(L[3])); continue
        for i, ms in enumerate(o.material_slots):
            if not ms.material: continue
            base = ms.material.name.split('.')[0]
            col = {'top': L[0], 'bottom': L[1], 'hair': L[2]}.get(base)
            if col:
                mm = ms.material.copy(); mm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = lin(col); ms.material = mm
sc.frame_set(5)

# ── 조명·카메라 ──
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 2.6; sun.angle = R(12)
so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so); so.rotation_euler = (R(50), R(10), R(-35))
fill = bpy.data.lights.new('fill', 'SUN'); fill.energy = 0.8; fill.angle = R(30)
fo = bpy.data.objects.new('fill', fill); sc.collection.objects.link(fo); fo.rotation_euler = (R(60), 0, R(140))
cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.ortho_scale = max(hx * 1.55, hz * 2.0); cd.clip_end = 300
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
import mathutils
cam.rotation_euler = (R(90 - 35.264), 0, R(45))
fwd = cam.rotation_euler.to_matrix() @ mathutils.Vector((0, 0, -1))
cam.location = mathutils.Vector((0, 0, 0)) - fwd * 60
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('PM3D_RENDER', OUT)
