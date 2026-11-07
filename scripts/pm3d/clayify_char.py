# scripts/pm3d/clayify_char.py — char.glb 소프트 클레이화(방식 A: Remesh → Smooth Corrective → Decimate)
# 실행: blender -b --factory-startup -P scripts/pm3d/clayify_char.py -- public/pm3d
#   build_char_kaykit.py → build_wearables.py 다음 단계(다음은 detail_char.py: 칼라·손·머리 모양·소품·얼굴 확대). 도형을 겹친 body·race_* 메시를 한 덩어리로 녹여 붙인다.
#   유지: 리그·클립·메시명(race_*)·재질명(top/bottom/skin/hair/face/cheek …) — 웹 갈아입히기·표정 스왑이 그대로 동작.
#   방법: ①표정 데칼(face)·볼(cheek)은 떼어 두고 ②나머지를 Voxel Remesh(덩어리 융합) → Corrective Smooth → Decimate
#         ③면마다 원본 최근접 면의 재질 복원 ④원본 본 가중치를 Data Transfer 로 옮김(관절은 부드럽게 휨) ⑤데칼·볼 재결합.
#   voxel 은 캐릭터 키(≈1.6m)가 물고기(≈3m)의 절반이라 0.02 로 비례 축소(얇은 귀·손가락 소실 방지).
import bpy, bmesh, os, sys
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'pm3d')
KEEP = ('face', 'cheek')  # 리메시하지 않고 표면에 그대로 붙여 둘 재질(텍스처 UV·납작 볼)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'char.glb'))
ARM = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)

def select_only(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o

def _unused_split_keep(o):
    """KEEP 재질 면을 별도 오브젝트로 분리해 돌려준다(없으면 None)."""
    idx = [i for i, m in enumerate(o.data.materials) if m and m.name in KEEP]
    if not idx: return None
    select_only(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    hit = False
    for p in o.data.polygons:
        p.select = p.material_index in idx; hit |= p.select
    if not hit: return None
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
    return next(x for x in bpy.context.selected_objects if x != o)

def smooth_weights(o, rep):
    """이웃 정점 평균으로 본 가중치를 rep 회 부드럽게 + 정규화(연산자 문맥 의존 없이 직접 계산)."""
    me = o.data; n = len(me.vertices); G = len(o.vertex_groups)
    nb = [[] for _ in range(n)]
    for e in me.edges:
        a, b = e.vertices; nb[a].append(b); nb[b].append(a)
    W = [[0.0] * G for _ in range(n)]
    for v in me.vertices:
        for g in v.groups: W[v.index][g.group] = g.weight
    for _ in range(rep):
        W = [[0.5 * W[i][k] + 0.5 * (sum(W[j][k] for j in nb[i]) / len(nb[i]) if nb[i] else W[i][k]) for k in range(G)] for i in range(n)]
    for i in range(n):
        t = sum(W[i]) or 1.0
        for k in range(G):
            w = W[i][k] / t
            if w > 0.002: o.vertex_groups[k].add([i], w, 'REPLACE')
            else: o.vertex_groups[k].remove([i])

def clay_geom(o, voxel, dec_ratio, smooth_rep):
    select_only(o)
    r = o.modifiers.new('Remesh', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = voxel; r.adaptivity = 0
    bpy.ops.object.modifier_apply(modifier='Remesh')
    s = o.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'); s.iterations = smooth_rep; s.factor = 0.5
    s.smooth_type = 'LENGTH_WEIGHTED'; s.use_only_smooth = True
    bpy.ops.object.modifier_apply(modifier='Smooth')
    d = o.modifiers.new('Decimate', 'DECIMATE'); d.ratio = dec_ratio
    bpy.ops.object.modifier_apply(modifier='Decimate')
    for p in o.data.polygons: p.use_smooth = True

def clayify(o, voxel, dec_ratio, smooth_rep=15):
    """재질별로 떼어 각각 클레이 덩어리로 녹인 뒤(색 경계가 깔끔한 '찰흙 조각 붙이기'), 원본 가중치를 옮겨 다시 합친다."""
    n0 = tris(o)
    for m in list(o.modifiers): o.modifiers.remove(m)
    src = o.copy(); src.data = o.data.copy(); bpy.context.scene.collection.objects.link(src)
    pieces = []
    for mi, m in enumerate(list(o.data.materials)):
        if not m or not any(p.material_index == mi for p in o.data.polygons): continue
        select_only(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT'); bpy.ops.object.mode_set(mode='OBJECT')
        for p in o.data.polygons: p.select = p.material_index == mi
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
        pc = next(x for x in bpy.context.selected_objects if x != o)
        bs = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
        clear = bs is not None and (bs.inputs['Alpha'].default_value < 0.99 or bs.inputs['Alpha'].is_linked)
        thin = clear or min(x for x in pc.dimensions if x > 0) < 0.03  # 날개·렌즈 같은 얇은 판은 리메시하면 보풀이 생김 → 원형 유지
        if m.name not in KEEP and not thin:
            # 작은 부속(선인장 가시·꽃잎 등)이 복셀보다 얇으면 사라지므로 조각 크기에 맞춰 복셀을 줄인다
            v = min(voxel, max(0.004, min(x for x in pc.dimensions if x > 0) / 6))
            clay_geom(pc, v, dec_ratio if v == voxel else min(1.0, dec_ratio * 2), smooth_rep if v == voxel else 5)
            for p in pc.data.polygons: p.material_index = mi  # 리메시가 재질 번호를 0으로 되돌림 → 원래 슬롯 복원
            pc.vertex_groups.clear()
            for vg in src.vertex_groups: pc.vertex_groups.new(name=vg.name)
            dt = pc.modifiers.new('DT', 'DATA_TRANSFER'); dt.object = src; dt.use_vert_data = True
            dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
            dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
            select_only(pc); bpy.ops.object.modifier_apply(modifier='DT')
            # 관절 주름 방지: 단단한(0/1) 가중치를 이웃 정점과 부드럽게 섞고 정규화
            smooth_weights(pc, 8)
        pieces.append(pc)
    bpy.data.objects.remove(src, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for pc in pieces: pc.select_set(True)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.join()
    am = o.modifiers.new('Armature', 'ARMATURE'); am.object = ARM
    print('CLAY', o.name, n0, '->', tris(o))
    return tris(o)

ARM.data.pose_position = 'REST'  # 가중치 이전은 바인드(레스트) 자세 기준
report = {}
body = bpy.data.objects['body']
report['body'] = clayify(body, 0.02, 0.2)
for o in [x for x in bpy.data.objects if x.type == 'MESH' and x.name.startswith('race_')]:
    report[o.name] = clayify(o, 0.015, 0.3)

ARM.data.pose_position = 'POSE'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'char.glb'), export_format='GLB', export_apply=False, export_yup=True,
                          export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True)
print('REPORT', report)
