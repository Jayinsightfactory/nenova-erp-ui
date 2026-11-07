# 소프트 클레이 물고기 생성 (Metaball 경로)
# 실행: blender --background --python make_fish.py
import bpy, os, math, json
from mathutils import Vector

OUT = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene

def hexc(h, a=1.0):
    h = h.lstrip('#')
    c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x ** 2.2 for x in c) + (a,)  # sRGB -> linear

def clay_mat(name, base, shadow):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.85
    bsdf.inputs['Metallic'].default_value = 0.05
    # 그림자 쪽 웜톤: 아래(-Z) 법선일수록 shadow 색으로 섞음
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -1.0
    mr.inputs['From Max'].default_value = 0.6
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = hexc(shadow)
    mix.inputs['B'].default_value = hexc(base)
    nt.links.new(geo.outputs['Normal'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    # 서브서피스 살짝 → 클레이 느낌
    try:
        bsdf.inputs['Subsurface Weight'].default_value = 0.15
    except KeyError:
        pass
    return m

# ---- 몸통/지느러미/꼬리/볼: 메타볼 융합 ----
mb_data = bpy.data.metaballs.new('FishMB')
mb_data.resolution = 0.06
mb_data.render_resolution = 0.06
mb_data.threshold = 0.6
mb = bpy.data.objects.new('FishMB', mb_data)
scn.collection.objects.link(mb)

def el(co, r, kind='BALL', size=(1, 1, 1), rot=None, stiff=2.0):
    e = mb_data.elements.new(type=kind)
    e.co = co; e.radius = r; e.stiffness = stiff
    if kind == 'ELLIPSOID':
        e.size_x, e.size_y, e.size_z = size
    if rot:
        from mathutils import Euler
        e.rotation = Euler(rot).to_quaternion()
    return e

# 통통한 몸통 (머리 쪽 크게, 꼬리 쪽 좁게) — X+ 가 앞
el((0.15, 0, 0), 1.0, 'ELLIPSOID', (1.15, 0.85, 0.95))
el((-0.55, 0, 0.02), 0.7, 'ELLIPSOID', (1.0, 0.7, 0.8))
# 볼 (통통)
el((0.55, 0.42, -0.18), 0.42)
el((0.55, -0.42, -0.18), 0.42)
# 꼬리자루 + 꼬리 두 갈래(둥근 끝)
el((-1.05, 0, 0.02), 0.42, stiff=2.5)
el((-1.35, 0, 0.28), 0.45, 'ELLIPSOID', (0.9, 0.35, 1.0), rot=(0, math.radians(-30), 0))
el((-1.35, 0, -0.22), 0.45, 'ELLIPSOID', (0.9, 0.35, 1.0), rot=(0, math.radians(30), 0))
# 등지느러미
el((-0.15, 0, 0.7), 0.5, 'ELLIPSOID', (1.0, 0.3, 0.7), rot=(0, math.radians(15), 0))
# 옆지느러미 (도망가는 느낌으로 뒤로 젖힘)
el((0.0, 0.5, -0.25), 0.4, 'ELLIPSOID', (0.9, 0.3, 0.55), rot=(math.radians(-30), 0, math.radians(-25)))
el((0.0, -0.5, -0.25), 0.4, 'ELLIPSOID', (0.9, 0.3, 0.55), rot=(math.radians(30), 0, math.radians(25)))

bpy.context.view_layer.objects.active = mb
mb.select_set(True)
bpy.ops.object.convert(target='MESH')
fish = bpy.context.view_layer.objects.active
fish.name = 'Fish'
# 메타볼 변환 직후 남은 MB 데이터 정리
for o in list(scn.objects):
    if o.type == 'META':
        bpy.data.objects.remove(o)

# 가벼운 감량(웹용) 후 스무스
dec = fish.modifiers.new('Dec', 'DECIMATE'); dec.ratio = 0.3
bpy.ops.object.modifier_apply(modifier='Dec')
bpy.ops.object.shade_smooth()
fish.data.materials.append(clay_mat('ClayPeach', '#ffc9b9', '#d8bbff'))

# ---- 눈/코/볼터치: 표면에 살짝 파묻힌 납작 타원 ----
def flat_dot(name, loc, r, color, normal_rot, zscale=0.35):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=r, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (1, 1, zscale)
    o.rotation_euler = normal_rot
    bpy.ops.object.shade_smooth()
    m = bpy.data.materials.new(name + 'Mat'); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = hexc(color)
    b.inputs['Roughness'].default_value = 0.85
    b.inputs['Metallic'].default_value = 0.05
    o.data.materials.append(m)
    return o

# 표면 위치를 레이캐스트로 찾아 살짝 파묻음
depsg = bpy.context.evaluated_depsgraph_get()
def surf(origin, direction, sink=0.02):
    ok, loc, nrm, _ = fish.ray_cast(Vector(origin), Vector(direction).normalized())
    rot = Vector((0, 0, 1)).rotation_difference(nrm).to_euler()
    return loc - nrm * sink, rot

parts = []
for s in (1, -1):
    loc, rot = surf((0.75, s * 3, 0.22), (0, -s, 0))
    parts.append(flat_dot('Eye' + ('L' if s > 0 else 'R'), loc, 0.13, '#3b3550', rot))
    hl, hrot = surf((0.8, s * 3, 0.3), (0, -s, 0), sink=-0.03)
    parts.append(flat_dot('EyeHi' + ('L' if s > 0 else 'R'), hl, 0.04, '#fff8ee', hrot, 0.3))
    bl, brot = surf((1.0, s * 3, -0.12), (0, -s, 0))
    parts.append(flat_dot('Blush' + ('L' if s > 0 else 'R'), bl, 0.14, '#ffb5a7', brot, 0.25))
nl, nrot = surf((3, 0, 0.05), (-1, 0, 0))
parts.append(flat_dot('Nose', nl, 0.07, '#ff9e8f', nrot, 0.4))

# 하나로 합치기
bpy.ops.object.select_all(action='DESELECT')
for p in parts: p.select_set(True)
fish.select_set(True)
bpy.context.view_layer.objects.active = fish
bpy.ops.object.join()
fish.rotation_euler = (0, 0, math.radians(-20))  # 살짝 몸을 튼 도망 포즈

tris = sum(len(p.vertices) - 2 for p in fish.data.polygons)

# ---- 조명/배경/카메라 ----
world = bpy.data.worlds.new('W'); scn.world = world; world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = hexc('#fff1ea'); bg.inputs['Strength'].default_value = 1.6
sun = bpy.data.objects.new('Key', bpy.data.lights.new('Key', 'SUN'))
sun.data.energy = 2.5; sun.data.color = hexc('#ffe5d9')[:3]; sun.data.angle = math.radians(25)
sun.rotation_euler = (math.radians(40), math.radians(-20), math.radians(30))
scn.collection.objects.link(sun)
fill = bpy.data.objects.new('Fill', bpy.data.lights.new('Fill', 'AREA'))
fill.data.energy = 300; fill.data.color = hexc('#a2d2ff')[:3]; fill.data.size = 5
fill.location = (-3, -4, -1); fill.rotation_euler = (math.radians(110), 0, math.radians(-35))
scn.collection.objects.link(fill)
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
cam.location = (2.2, -4.6, 1.3)
cam.rotation_euler = (Vector((-0.1, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 65
scn.collection.objects.link(cam); scn.camera = cam

for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try:
        scn.render.engine = eng; break
    except TypeError:
        pass
scn.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
scn.render.resolution_x = 1200; scn.render.resolution_y = 900
scn.render.filepath = os.path.join(OUT, 'fish_preview.png')
bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'fish.blend'))
bpy.ops.object.select_all(action='DESELECT'); fish.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'fish.glb'), use_selection=True, export_apply=True)

info = {'path': 'metaball', 'triangles': tris, 'vertices': len(fish.data.vertices)}
open(os.path.join(OUT, 'polycount.json'), 'w').write(json.dumps(info, indent=2))
print('RESULT', info)
