# Higgsfield 시트 → 개별 투명 webp. python slice.py <out_root>
import os, sys, json
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]


def bg_mask(a, tol=28):
    """테두리와 연결된 배경(코너색 근처) = True"""
    rgb = a[..., :3].astype(int)
    corners = np.array([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]])
    ref = np.median(corners, axis=0)
    near = np.abs(rgb - ref).max(axis=2) < tol
    lab, _ = ndimage.label(near)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return np.isin(lab, list(edge))


def blobs(fg, min_area):
    lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=6))
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        area = (lab[sl] == i).sum()
        if area >= min_area:
            out.append(sl)
    # 읽는 순서: 행(중심 y 를 행 높이로 묶음) → x
    h = fg.shape[0]
    rows = sorted(out, key=lambda s: (s[0].start + s[0].stop) / 2)
    grouped, cur, last = [], [], None
    for s in rows:
        cy = (s[0].start + s[0].stop) / 2
        if last is not None and cy - last > h * 0.08:
            grouped.append(cur); cur = []
        cur.append(s); last = cy
    if cur: grouped.append(cur)
    return [s for g in grouped for s in sorted(g, key=lambda s: s[1].start)]


def cut(name, ids, size=128, transparent=True, skip=(), min_frac=0.004, keep_bg=False):
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')
    a = np.array(im)
    bgm = bg_mask(a)
    fg = ~bgm
    bl = [b for i, b in enumerate(blobs(fg, a.shape[0] * a.shape[1] * min_frac)) if i not in skip]
    res = []
    for iid, sl in zip(ids, bl):
        if iid is None:
            continue
        sub = a[sl].copy()
        if transparent and not keep_bg:
            m = bgm[sl]
            sub[..., 3] = np.where(m, 0, 255).astype(np.uint8)
            # 가장자리 1px 부드럽게
            alpha = ndimage.uniform_filter(sub[..., 3].astype(float), 3)
            sub[..., 3] = np.minimum(sub[..., 3], alpha * 1.6).clip(0, 255).astype(np.uint8)
        t = Image.fromarray(sub)
        w, hh = t.size
        side = max(w, hh)
        canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        canvas.paste(t, ((side - w) // 2, (side - hh) // 2))
        canvas = canvas.resize((size, size), Image.LANCZOS)
        res.append((iid, canvas))
    return res, len(bl)


def save(rel, img, q=82):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p, 'WEBP', quality=q, method=6)
    return '/pm-themes/' + rel.replace(os.sep, '/')


report = {}
THEMES = ['greenhouse', 'harbor', 'airport', 'subway', 'market', 'rpg', 'space', 'cyber']
for t in THEMES:
    r, n = cut(f'{t}-icons', [f'stage-{i}' for i in range(1, 10)], size=96, skip=(6,) if t == 'space' else ())
    report[t + '-icons'] = (n, [save(f'{t}/{k}.webp', im) for k, im in r])
    fpath = os.path.join(SRC, f'{t}-floors.png')
    if os.path.exists(fpath):
        im = Image.open(fpath).convert('RGB')
        a = np.array(im.convert('RGBA'))
        fg = ~bg_mask(a, tol=18)
        bl = sorted(blobs(fg, a.shape[0] * a.shape[1] * 0.08), key=lambda s: -(s[0].stop - s[0].start) * (s[1].stop - s[1].start))[:4]
        bl = sorted(bl, key=lambda s: (round(s[0].start / (a.shape[0] / 3)), s[1].start))
        out = []
        for i, sl in enumerate(bl, 1):
            y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
            pad = 10  # 가장자리 그림자 제거
            tile = im.crop((x0 + pad, y0 + pad, x1 - pad, y1 - pad)).resize((160, 160), Image.LANCZOS)
            out.append(save(f'{t}/dept-{i}.webp', tile, q=70))
        report[t + '-floors'] = (len(bl), out)

CH_A = ['human', 'cat', 'dog', 'bunny', 'bear']
CH_B = ['fox', 'penguin', 'fairy', None, 'robot', 'cactus']
for name, ids in (('chars-a', CH_A), ('chars-b', CH_B)):
    r, n = cut(name, ids, size=192)
    report[name] = (n, [save(f'characters/{k}.webp', im) for k, im in r])
ITEMS = {
    'hat': ['straw', 'crown', 'cap', 'flowercrown', 'beanie', 'helmet', 'chef', 'pilot'],
    'glasses': ['round', 'sun', 'heart', 'visor', 'monocle', 'goggle'],
    'outfit': ['apron', 'suit', 'hoodie', None, 'vest', 'hanbok', 'spacesuit', 'overall'],
    'desk': ['vase', 'coffee', 'plant', 'calc', 'globe', 'box', 'trophy'],
    'pet': ['kitten', 'puppy', 'bee', 'butterfly', 'chick', 'fish'],
    'badge': ['star', 'rose', 'mvp', 'heart', None, None, 'flagco', 'flagnl', 'flagcn'],
}
for cat, ids in ITEMS.items():
    r, n = cut(f'items-{cat}', ids, size=96, skip=(4,) if cat == 'pet' else ())
    report['items-' + cat] = (n, [save(f'items/{cat}/{k}.webp', im) for k, im in r])
for k, (n, files) in report.items():
    print(f'{k:20s} blobs={n:2d} saved={len(files)}')
json.dump({k: v[1] for k, v in report.items()}, open(os.path.join(SRC, 'sliced.json'), 'w'), indent=1)
