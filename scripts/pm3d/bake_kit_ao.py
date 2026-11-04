# scripts/pm3d/bake_kit_ao.py — /pm 3D kit.glb 전 모듈 AO 베이크(QUALITY_RECIPE ②-2)
# 실행: blender -b --factory-startup -P scripts/pm3d/bake_kit_ao.py -- public/pm3d
# 산출: kit_ao.jpg(1024 흑백 공용 아틀라스, JPG 85) + kit.glb 재-export(두 번째 UV 'LightMap' = TEXCOORD_1)
# 웹(Scene3D)에서는 material.aoMap = kit_ao.jpg, texture.channel = 1, flipY = false 로 주입한다.
# 주의: 모듈들이 전부 원점에 겹쳐 있으므로 베이크 동안 격자로 벌려 서로를 가리지 않게 한 뒤 원위치로 되돌린다.
import bpy, os, sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'kit.glb'))
sc = bpy.context.scene
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.polygons)]

# ── 1) 모듈 루트를 격자로 벌림(모듈 간 상호 차폐 방지) ──
tops = [o for o in sc.objects if o.parent is None]
orig = {o.name: o.location.copy() for o in tops}
for i, t in enumerate(tops):
    t.location.x += (i % 10) * 25.0
    t.location.y += (i // 10) * 25.0
bpy.context.view_layer.update()

# ── 2) 두 번째 UV 'LightMap' 생성 + 전 오브젝트 공동 Smart UV(한 아틀라스로 패킹) ──
for o in meshes:
    while len(o.data.uv_layers) > 1:
        o.data.uv_layers.remove(o.data.uv_layers[-1])
    if not o.data.uv_layers:
        o.data.uv_layers.new(name='UVMap')
    lm = o.data.uv_layers.new(name='LightMap')
    o.data.uv_layers.active = lm
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(island_margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')

# ── 3) 전 재질에 베이크 대상 이미지 노드(active) + LightMap UV 연결 ──
img = bpy.data.images.new('kit_ao', 1024, 1024)
added = []
mats = {sl.material for o in meshes for sl in o.material_slots if sl.material}
for m in mats:
    m.use_nodes = True
    nt = m.node_tree
    node = nt.nodes.new('ShaderNodeTexImage'); node.image = img
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'LightMap'
    nt.links.new(uvn.outputs['UV'], node.inputs['Vector'])
    nt.nodes.active = node
    added.append((nt, node, uvn))

# ── 4) Cycles AO 베이크(1024, 샘플 64, margin 8px) ──
sc.render.engine = 'CYCLES'
sc.cycles.samples = 64
sc.render.bake.margin = 8
bpy.ops.object.bake(type='AO')

# ── 5) JPG 85 저장 + 베이크용 노드 제거 + 모듈 원위치 ──
sc.render.image_settings.file_format = 'JPEG'
sc.render.image_settings.quality = 85
img.save_render(os.path.join(OUT, 'kit_ao.jpg'), scene=sc)
for nt, node, uvn in added:
    nt.nodes.remove(node); nt.nodes.remove(uvn)
for o in tops:
    o.location = orig[o.name]
for o in meshes:
    o.data.uv_layers[0].active = True
    o.data.uv_layers[0].active_render = True

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'kit.glb'), export_format='GLB', export_apply=True, export_animations=False,
                          export_yup=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
print('PM3D_KIT_AO_DONE', OUT)
