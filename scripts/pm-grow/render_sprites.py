# Blender 5.2 headless: 단계 이미지 → 2.5D 판(메시 변형 리그) → 동작별 스프라이트 프레임 렌더
import bpy, os, math, sys, json
SRC = r"C:\Users\USER\nenova-pm\grow-src"
OUT = os.path.join(SRC, "frames"); os.makedirs(OUT, exist_ok=True)
LINE = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'flower'
PREFIX = 'stage' if LINE == 'flower' else LINE + '-stage'

sc = bpy.context.scene
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH'):
    try: sc.render.engine = e; break
    except TypeError: pass
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x = 160; sc.render.resolution_y = 160
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.3
cam.location = (0, -10, 0.6); cam.rotation_euler = (math.radians(90), 0, 0)

# 동작 정의: (프레임 수, 프레임 i → (bend, sx, sz, tilt, lift, sat))
def idle(i, n):  t = math.sin(2*math.pi*i/n); return (0.03*t, 1+0.015*t, 1-0.02*t, 0, 0, 1)
def work(i, n):
    t = math.sin(2*math.pi*i/n); up = max(0, t)
    return (0.10*math.sin(4*math.pi*i/n), 1+0.05*(1-up)*(t < 0.2), 1+0.05*up-0.04*(t < -0.5), 0, 0.06*up, 1)
def sleep(i, n): t = math.sin(2*math.pi*i/n); return (-0.25, 1+0.01*t, 0.96+0.01*t, 6, 0, 0.9)
def wilt(i, n):  return (-0.55, 1.0, 0.9, 10, 0, 0.45)
ACTIONS = {'idle': (4, idle), 'work': (6, work), 'sleep': (4, sleep), 'wilt': (1, wilt)}

meta = {}
for s in range(1, 6):
    path = os.path.join(SRC, f'{PREFIX}{s}.png')
    if not os.path.exists(path): continue
    img = bpy.data.images.load(path); W, H = img.size
    h = 1.2; w = h * W / H
    if w > 1.25: w = 1.25; h = w * H / W
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=8, y_subdivisions=24, size=1)
    ob = bpy.context.active_object; ob.name = f's{s}'
    ob.rotation_euler = (math.radians(90), 0, 0); ob.scale = (w, h, 1)
    bpy.ops.object.transform_apply(rotation=True, scale=True)
    for v in ob.data.vertices: v.co.z += h/2            # 원점=바닥(화분 밑)
    # UV 는 grid 기본 UV 사용
    mat = bpy.data.materials.new(f'm{s}'); mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    hsv = nt.nodes.new('ShaderNodeHueSaturation')
    emi = nt.nodes.new('ShaderNodeEmission'); tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader'); outn = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tex.outputs['Color'], hsv.inputs['Color'])
    nt.links.new(hsv.outputs['Color'], emi.inputs['Color'])
    nt.links.new(tex.outputs['Alpha'], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(emi.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], outn.inputs['Surface'])
    try: mat.surface_render_method = 'BLENDED'
    except Exception: pass
    ob.data.materials.append(mat)
    # 리그: 아래 25%(화분)는 고정, 위쪽만 휘게 — 정점 그룹 + SimpleDeform(BEND)
    vg = ob.vertex_groups.new(name='plant')
    for v in ob.data.vertices:
        wgt = max(0.0, min(1.0, (v.co.z/h - 0.28) / 0.25))
        if wgt > 0: vg.add([v.index], wgt, 'REPLACE')
    sd = ob.modifiers.new('bend', 'SIMPLE_DEFORM'); sd.deform_method = 'BEND'; sd.deform_axis = 'Y'
    sd.vertex_group = 'plant'
    meta[s] = {}
    for name, (n, fn) in ACTIONS.items():
        for i in range(n):
            bend, sx, sz, tilt, lift, sat = fn(i, n)
            sd.angle = bend
            ob.scale = (sx, 1, sz); ob.rotation_euler = (0, math.radians(tilt), 0); ob.location = (0, 0, lift)
            hsv.inputs['Saturation'].default_value = sat
            hsv.inputs['Value'].default_value = 0.85 + 0.15*sat
            sc.render.filepath = os.path.join(OUT, f'{LINE}-s{s}-{name}-{i}.png')
            bpy.ops.render.render(write_still=True)
        meta[s][name] = n
    ob.hide_render = True
json.dump(meta, open(os.path.join(OUT, f'{LINE}-meta.json'), 'w'))
print('DONE', meta)
