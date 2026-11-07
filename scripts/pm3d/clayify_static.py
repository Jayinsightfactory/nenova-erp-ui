# scripts/pm3d/clayify_static.py — 정적 소품 glb 소프트 클레이화(방식 A: Remesh → Smooth Corrective → Decimate)
# 실행: blender -b --factory-startup -P scripts/pm3d/clayify_static.py -- <입력.glb> <출력.glb> [draco]
#   대상: 탈것(mounts.glb)·책상 소품(kit.glb)·해변 소품/파라솔/수영장/카트/비행장(public/pm3d/assets/*). 칸 타일은 맵 단계.
#   유지: 노드 이름·계층·변환·재질명(웹이 이름으로 찾고 색을 바꾼다) — 형상만 둥글게 녹인다.
#   건너뜀(원형 유지): baked_shadow 판 · 이미지 텍스처 재질 · 반투명 · 발광(화면 등) · 복셀 3개보다 얇은 판.
import bpy, bmesh, json, os, sys

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
DRACO = len(argv) > 2 and argv[2] == 'draco'
MAX_TRIS = 10000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)

def select_only(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o

def skip_mat(m):
    if m is None: return True
    if 'shadow' in m.name.lower(): return True
    if not m.node_tree: return False
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes): return True
    if b is None: return True
    if b.inputs['Alpha'].default_value < 0.99 or b.inputs['Alpha'].is_linked: return True
    es = b.inputs.get('Emission Strength'); ec = b.inputs.get('Emission Color')
    if es and ec and es.default_value > 0 and max(ec.default_value[:3]) > 0.01: return True
    return False

def clay_piece(o):
    d = [x for x in o.dimensions if x > 1e-6]
    if len(d) < 3: return False
    big, small = max(d), min(d)
    voxel = max(big / 150, min(big / 45, small / 4))
    if small < voxel * 3: return False
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=big * 1e-4)  # glTF 는 UV 이음매마다 정점이 갈라져 들어옴 → 합친 뒤 열린 모서리 판정
    open_edges = sum(1 for e in bm.edges if len(e.link_faces) != 2); bm.free()
    if open_edges > 0.02 * max(1, len(o.data.edges)): return False  # 열린 껍질(파라솔 덮개 등)은 리메시하면 두께·크기가 변함 → 원형 유지  # 얇은 판(깃발·간판 면 등)은 리메시하면 구멍·보풀 → 원형 유지
    n0 = tris(o)
    has_col = len(o.data.color_attributes) > 0
    src = None
    if has_col:  # 줄무늬 파라솔 등 버텍스 컬러 — 리메시 후 원본에서 최근접 보간으로 옮긴다(안 하면 검게 나옴)
        src = o.copy(); src.data = o.data.copy(); bpy.context.scene.collection.objects.link(src)
    select_only(o)
    r = o.modifiers.new('Remesh', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = voxel; r.adaptivity = 0
    bpy.ops.object.modifier_apply(modifier='Remesh')
    if not o.data.polygons:
        if src: bpy.data.objects.remove(src, do_unlink=True)
        return False
    s = o.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'); s.iterations = 15; s.factor = 0.5
    s.smooth_type = 'LENGTH_WEIGHTED'; s.use_only_smooth = True
    bpy.ops.object.modifier_apply(modifier='Smooth')
    # 감량: 기본 0.25(방식 A 0.2~0.3), 그래도 원본 수준(최소 80)보다 무거우면 거기까지 — 모바일 예산 유지
    target = max(n0 * 1.0, 80)
    ratio = min(0.25, target / max(1, tris(o)))
    dc = o.modifiers.new('Dec', 'DECIMATE'); dc.ratio = max(0.02, ratio)
    bpy.ops.object.modifier_apply(modifier='Dec')
    for p in o.data.polygons: p.use_smooth = True
    if src:
        for ca in src.data.color_attributes:
            if ca.name not in o.data.color_attributes:
                o.data.color_attributes.new(ca.name, ca.data_type, ca.domain)
        dt = o.modifiers.new('DT', 'DATA_TRANSFER'); dt.object = src
        dt.use_loop_data = True; dt.data_types_loops = {'COLOR_CORNER'}; dt.loop_mapping = 'POLYINTERP_NEAREST'
        dt.use_vert_data = True; dt.data_types_verts = {'COLOR_VERTEX'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
        dt.layers_vcol_vert_select_src = 'ALL'; dt.layers_vcol_vert_select_dst = 'NAME'
        dt.layers_vcol_loop_select_src = 'ALL'; dt.layers_vcol_loop_select_dst = 'NAME'
        select_only(o); bpy.ops.object.modifier_apply(modifier='DT')
        bpy.data.objects.remove(src, do_unlink=True)
    return True

stats = {'objects': 0, 'clayed': 0, 'kept': 0}
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
names_before = sorted(o.name for o in bpy.data.objects)
total0 = sum(tris(o) for o in {id(x.data): x for x in meshes}.values())
done_data = {}
clayed_objs = []
for o in meshes:
    stats['objects'] += 1
    if o.data.name in done_data:  # 같은 메시를 공유하는 노드(인스턴스)는 한 번만 처리
        o.data = done_data[o.data.name]; continue
    key = o.data.name
    o.data = o.data.copy()
    mats = list(o.data.materials)
    used = sorted({p.material_index for p in o.data.polygons})
    pieces = []
    for mi in used:
        m = mats[mi] if mi < len(mats) else None
        if len(used) == 1:
            pc = o
        else:
            select_only(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT'); bpy.ops.object.mode_set(mode='OBJECT')
            for p in o.data.polygons: p.select = p.material_index == mi
            bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
            pc = next(x for x in bpy.context.selected_objects if x != o)
        ok = (not skip_mat(m)) and clay_piece(pc)
        if ok:
            for p in pc.data.polygons: p.material_index = mi
        stats['clayed' if ok else 'kept'] += 1
        if ok and o not in clayed_objs: clayed_objs.append(o)
        if pc is not o: pieces.append(pc)
    if pieces:
        bpy.ops.object.select_all(action='DESELECT')
        for pc in pieces: pc.select_set(True)
        o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.join()
    done_data[key] = o.data

def total_tris(): return sum(tris(o) for o in {id(x.data): x for x in bpy.data.objects if x.type == 'MESH'}.values())
total = total_tris()
# 파일 단일 애셋 예산(1만) 초과분은 클레이화한 덩어리만 비례 감량. 여러 탈것이 든 묶음(mounts/kit)은 원본 대비 +20% 를 상한으로.
cap = MAX_TRIS if total0 <= MAX_TRIS else int(total0 * 1.2)
if total > cap and clayed_objs:
    ct = sum(tris(o) for o in clayed_objs)
    k = max(0.2, (cap * 0.97 - (total - ct)) / ct)
    for o in clayed_objs:
        select_only(o); dc = o.modifiers.new('Cap', 'DECIMATE'); dc.ratio = k; bpy.ops.object.modifier_apply(modifier='Cap')
    total = total_tris()
names_after = sorted(o.name for o in bpy.data.objects)
assert names_before == names_after, ('노드 이름 변경됨', set(names_before) ^ set(names_after))
bpy.ops.object.select_all(action='SELECT')
kw = dict(filepath=DST, export_format='GLB', export_apply=False, export_yup=True, export_extras=True)  # extras(seatZ 등 탑승 높이) 보존
if DRACO: kw.update(export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
bpy.ops.export_scene.gltf(**kw)
print('CLAYSTATIC', json.dumps({'file': os.path.basename(DST), 'tris_before': total0, 'tris': total, **stats}, ensure_ascii=False))
