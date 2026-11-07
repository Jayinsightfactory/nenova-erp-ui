# scripts/pm3d/bake_clay_matcap.py — 클레이 MatCap(흰 공 1장) 굽기: 위 크림 하이라이트 · 아래 연보라/피치 반사광 · 외곽 크림 림
# 실행: blender -b --factory-startup -P scripts/pm3d/bake_clay_matcap.py -- public/pm3d
#   웹(Scene3D)에서 MeshMatcapMaterial.matcap 으로 쓰고 color(재질색)를 곱한다 → 회색/검은 그림자 대신 웜톤 그림자.
import bpy, os, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d')
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
def hexc(h): h = h.lstrip('#'); return tuple((int(h[i:i+2], 16) / 255) ** 2.2 for i in (0, 2, 4))
bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=1); s = bpy.context.object; bpy.ops.object.shade_smooth()
m = bpy.data.materials.new('clay'); m.use_nodes = True; nt = m.node_tree
b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
b.inputs['Roughness'].default_value = 0.85; b.inputs['Metallic'].default_value = 0.05
geo = nt.nodes.new('ShaderNodeNewGeometry'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = -1.2; mr.inputs['From Max'].default_value = 0.4
mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
mx.inputs['A'].default_value = (*hexc('#d9b8ef'), 1); mx.inputs['B'].default_value = (*hexc('#fffaf4'), 1)
lw = nt.nodes.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.2
rr = nt.nodes.new('ShaderNodeMapRange'); rr.inputs['From Min'].default_value = 0.5; rr.inputs['To Max'].default_value = 0.35
nt.links.new(geo.outputs['Normal'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
nt.links.new(mr.outputs['Result'], mx.inputs['Factor']); nt.links.new(mx.outputs['Result'], b.inputs['Base Color'])
nt.links.new(lw.outputs['Facing'], rr.inputs['Value']); nt.links.new(rr.outputs['Result'], b.inputs['Emission Strength'])
b.inputs['Emission Color'].default_value = (*hexc('#fff1dc'), 1)
s.data.materials.append(m)
w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs['Color'].default_value = (*hexc('#ffd9cf'), 1); bg.inputs['Strength'].default_value = 0.6
k = bpy.data.objects.new('K', bpy.data.lights.new('K', 'SUN')); k.data.energy = 2.6; k.data.color = hexc('#ffe5d9'); k.data.angle = math.radians(30)
k.rotation_euler = (math.radians(-35), math.radians(-25), 0); sc.collection.objects.link(k)
f = bpy.data.objects.new('F', bpy.data.lights.new('F', 'SUN')); f.data.energy = 0.8; f.data.color = hexc('#ffb5a7')
f.rotation_euler = (math.radians(200), 0, 0); sc.collection.objects.link(f)
cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); cam.location = (0, -5, 0); cam.rotation_euler = (math.radians(90), 0, 0)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.0; sc.collection.objects.link(cam); sc.camera = cam
for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try: sc.render.engine = e; break
    except TypeError: pass
sc.view_settings.view_transform = 'Standard'  # 웹이 ACES 를 한 번 더 걸므로 여기선 표준
sc.render.resolution_x = sc.render.resolution_y = 256; sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = os.path.join(OUT, 'clay_matcap.png'); bpy.ops.render.render(write_still=True)
