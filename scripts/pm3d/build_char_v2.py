# scripts/pm3d/build_char_v2.py — 캐릭터 본체 재제작(소프트 클레이 v2): 기존 rig·애니·액세서리·face 판은 그대로, body 메시만 메타볼로 새로 빚는다.
# 실행: blender -b --factory-startup -P scripts/pm3d/build_char_v2.py -- <char.glb> <out.glb>
# 형태: 콩 모양 몸통 · 두툼한 팔다리 · 벙어리장갑 손 · 둥근 신발 · 볼륨 있는 앞머리. 머리 크기는 웹(BODY_TYPES)이 키우므로 원본 크기 유지.
import bpy, bmesh, sys
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = bpy.data.objects['body']
mats = {m.name: m for m in body.data.materials}
for a in bpy.data.actions: pass
# rest 포즈
rig.data.pose_position = 'REST'
if rig.animation_data: rig.animation_data.action = None

def mball(name, elems, res=0.014, thr=0.1):  # thr 0.1 → 단독 구 표면 ≈ 반지름×0.83 (아래에서 ×1.2 보정)
    mb = bpy.data.metaballs.new(name); mb.resolution = res; mb.render_resolution = res; mb.threshold = thr
    ob = bpy.data.objects.new(name, mb); bpy.context.scene.collection.objects.link(ob)
    for e in elems:
        kind, co, r = e[0], e[1], e[2]
        el = mb.elements.new(type=kind); el.co = Vector(co); el.radius = r * 1.2
        if len(e) > 3: el.size_x, el.size_y, el.size_z = e[3]
        if len(e) > 4: el.stiffness = e[4]
    return ob

def capsule(a, b, r, n=6):
    a, b = Vector(a), Vector(b)
    return [('BALL', tuple(a.lerp(b, i / (n - 1))), r * (1 - 0.12 * i / (n - 1))) for i in range(n)]

# 형태 = Higgsfield 캐릭터 시안(assets-raw/clay-chars/hf/hf_20261105_011157_*): 둥근 머리+귀, 박스형 반팔티, 반바지, 짧은 다리, 둥근 발
S = []
for sx in (1, -1):
    S.append(('top', capsule((0.2 * sx, 0, 1.21), (0.4 * sx, 0.005, 1.2), 0.11, 4)))                          # 짧은 소매
    S.append(('skin', capsule((0.38 * sx, 0.005, 1.2), (0.8 * sx, 0, 1.2), 0.07, 7)
              + [('BALL', (0.86 * sx, -0.01, 1.2), 0.085)]))                                                 # 가는 팔 + 동그란 손
    S.append(('skin', [('BALL', (0.205 * sx, 0.03, 1.55), 0.055)]))                                          # 귀
    S.append(('bottom', capsule((0.15 * sx, 0, 0.6), (0.165 * sx, 0, 0.44), 0.14, 3)))                        # 반바지 다리통
    S.append(('skin', capsule((0.17 * sx, 0, 0.46), (0.17 * sx, 0.0, 0.1), 0.085, 5)))                        # 맨다리
    S.append(('shoe', [('ELLIPSOID', (0.17 * sx, -0.06, 0.05), 0.14, (0.75, 1.25, 0.45))]))                   # 둥근 발
parts = {
    'top': [('CUBE', (0, 0, 1.03), 0.13, (0.14, 0.08, 0.14))],                                                 # 박스형 티셔츠
    'bottom': [('CUBE', (0, 0, 0.62), 0.12, (0.13, 0.07, 0.05))],
    'skin': [('ELLIPSOID', (0, 0.02, 1.56), 0.3, (0.82, 0.78, 0.8)), ('BALL', (0, 0, 1.36), 0.1)],
}
for k, el in S: parts.setdefault(k, []).extend(el)

new = []
for k, el in parts.items():
    mb = mball('mb_' + k, el)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT'); mb.select_set(True); bpy.context.view_layer.objects.active = mb
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.view_layer.objects.active; o.name = 'v2_' + k
    if k == 'hair':  # 얼굴 판 앞쪽 가리지 않게: 앞머리 아래(눈썹선 1.6 아래 & y<-0.12) 삭제
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.1 and v.co.z < 1.62 and abs(v.co.x) < 0.17], context='VERTS')
        bm.to_mesh(o.data); bm.free()
    s = o.modifiers.new('S', 'CORRECTIVE_SMOOTH'); s.iterations = 8; s.use_only_smooth = True
    bpy.ops.object.modifier_apply(modifier='S')
    o.data.materials.clear(); o.data.materials.append(mats[k])
    new.append(o)
# 원본에서 face·cheek 조각만 떼어 유지(웹이 face 재질에 표정 텍스처를 꽂음)
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); bpy.context.view_layer.objects.active = body
for mod in list(body.modifiers): body.modifiers.remove(mod)
keep = {i for i, m in enumerate(body.data.materials) if m.name in ('face', 'cheek', 'hair')}
bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in keep], context='FACES')
bm.to_mesh(body.data); bm.free()
# 얼굴 판을 새 머리 앞면에 붙임(머리 앞 y=-0.215 근처)
fy = min(v.co.y for v in body.data.vertices)
for v in body.data.vertices: v.co.y += (-0.235 - fy) * 0.0  # 원본 위치 유지(머리 앞면 -0.234 와 거의 일치)
# 합치기 + 기존 재질 슬롯 순서 유지
for o in new:
    for m in body.data.materials: pass
bpy.ops.object.select_all(action='DESELECT')
for o in new: o.select_set(True)
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
# 감량
dc = body.modifiers.new('D', 'DECIMATE'); n = sum(len(p.vertices) - 2 for p in body.data.polygons)
dc.ratio = min(1.0, 8500 / max(1, n)); bpy.ops.object.modifier_apply(modifier='D')
for p in body.data.polygons: p.use_smooth = True
# 가중치: 자동(열 확산) 다시 바인딩
for vg in list(body.vertex_groups): body.vertex_groups.remove(vg)
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
body.parent = None
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for vg in list(body.vertex_groups):
    if vg.name.startswith('handslot') or vg.name == 'root': body.vertex_groups.remove(vg)
# 열 확산 실패로 가중치 없는 정점(가시 튐) → 가장 가까운 뼈 하나에 1.0
bones = [(b.name, (b.head_local + b.tail_local) / 2) for b in rig.data.bones if not b.name.startswith('handslot') and b.name != 'root']
vg = {g.index for g in body.vertex_groups}
for v in body.data.vertices:
    if sum(g.weight for g in v.groups) < 1e-3:
        nm = min(bones, key=lambda t: (t[1] - v.co).length)[0]
        (body.vertex_groups.get(nm) or body.vertex_groups.new(name=nm)).add([v.index], 1.0, 'REPLACE')
# 머리는 통째로 head 뼈(웹이 head 뼈 스케일로 치비 비율을 만듦) — 얼굴 판이 목으로 끌려 내려가지 않게
hg = body.vertex_groups.get('head') or body.vertex_groups.new(name='head')
for p in body.data.polygons:
    nm = body.data.materials[p.material_index].name
    for vi in p.vertices:
        v = body.data.vertices[vi]
        if nm in ('face', 'cheek', 'hair') or (nm == 'skin' and v.co.z > 1.4 and abs(v.co.x) < 0.3):
            for g in list(v.groups): body.vertex_groups[g.group].remove([vi])
            hg.add([vi], 1.0, 'REPLACE')
rig.data.pose_position = 'POSE'
print('CHARV2 tris', sum(len(p.vertices) - 2 for p in body.data.polygons), [m.name for m in body.data.materials])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_extras=True, export_animations=True)
