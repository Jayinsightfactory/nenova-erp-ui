import bpy, os
d = os.path.dirname(os.path.abspath(__file__))
a = bpy.data.images.load(os.path.join(d, 'fish_preview_v1.png')); b = bpy.data.images.load(os.path.join(d, 'fish_preview.png'))
w, h = a.size; out = bpy.data.images.new('cmp', w * 2, h)
pa, pb = list(a.pixels), list(b.pixels); px = [0.0] * (w * 2 * h * 4)
for y in range(h):
    r = y * w * 4; o = y * w * 2 * 4
    px[o:o + w * 4] = pa[r:r + w * 4]; px[o + w * 4:o + w * 8] = pb[r:r + w * 4]
out.pixels = px; out.filepath_raw = os.path.join(d, 'fish_compare.png'); out.file_format = 'PNG'; out.save()
