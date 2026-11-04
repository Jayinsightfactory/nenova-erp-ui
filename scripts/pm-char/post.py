# scripts/pm-char/post.py — 블렌더 원본(raw PNG) → public/pm-char/*.webp + 레이어 메타(public/pm-char/layers.json)
#   + 정합 자동검사(앵커 오차·슬롯 밖 픽셀·레이어 순서) + 콘택트시트.
# 실행: python scripts/pm-char/post.py <raw폴더> <shots폴더>
import json, os, sys
from PIL import Image, ImageChops
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spec import BODIES, SKINS, HAIRS, HAIR_COLORS, KINDS, OUTFITS, HATS, GLASSES, HANDS, BADGES, DESKS, DESKTOP, FLOORS, PETS

RAW = sys.argv[1]; SHOTS = sys.argv[2] if len(sys.argv) > 2 else RAW
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PUB = os.path.join(ROOT, 'public', 'pm-char')
CH, DK = 256, 384
os.makedirs(PUB, exist_ok=True); os.makedirs(SHOTS, exist_ok=True)

# 캐릭터 캔버스 기준점(블렌더 카메라에서 계산: 2.7m/256px, 중심 z=1.15, 고도 12°)
import math
PPM = CH / 2.7
def proj_ch(x, y, z):
    e = math.radians(12)
    v = (z - 1.15) * math.cos(e) + y * math.sin(e)
    return (CH / 2 + x * PPM, CH / 2 - v * PPM)
DPPM = DK / 4.05
def proj_dk(x, y, z):
    e = math.radians(12)
    v = (z - 1.0) * math.cos(e) + (y - 0.5) * math.sin(e)
    return (DK / 2 + x * DPPM, DK / 2 - v * DPPM)
ANCHORS = {'feet': proj_ch(0, 0, 0), 'head': proj_ch(0, 0, 1.55), 'chest': proj_ch(0, -0.27, 0.85), 'hand': proj_ch(0.49, -0.12, 0.55)}
DESK_ANCHOR = proj_dk(0, 0, 0)
# 자리 슬롯(책상 앵커 기준 상대 px, 출력 1x). 캐릭터 캔버스는 발이 seat 에 오도록 놓는다.
SEAT_W = (0, 1.3, 0.46)   # 앉은 엉덩이(의자 좌판 위) — 캐릭터 sit 캔버스의 hip 기준점을 여기에 맞춘다
def rel(p): return [round(p[0] - DESK_ANCHOR[0], 1), round(p[1] - DESK_ANCHOR[1], 1)]
DESK_SLOTS = {
    'rug': {'z': 0, 'at': rel(proj_dk(0, 0.7, 0))},
    'shelf': {'z': 1, 'at': rel(proj_dk(-1.55, 1.6, 0))},
    'chair': {'z': 2, 'at': rel(proj_dk(0, 1.55, 0))},
    'seat': {'z': 3, 'at': rel(proj_dk(*SEAT_W))},
    'desk': {'z': 4, 'at': [0, 0]},
    'deskL': {'z': 5, 'at': rel(proj_dk(-0.65, 0.35, 0.75)), 'dx': round(-0.65 * DPPM, 1)},
    'deskM': {'z': 5, 'at': rel(proj_dk(0, 0.35, 0.75)), 'dx': 0},
    'deskR': {'z': 5, 'at': rel(proj_dk(0.65, 0.35, 0.75)), 'dx': round(0.65 * DPPM, 1)},
    'pet': {'z': 6, 'at': rel(proj_dk(1.35, -0.25, 0))},
}

def load(name, size):
    p = os.path.join(RAW, name + '.png')
    if not os.path.exists(p): return None
    im = Image.open(p).convert('RGBA').resize((size, size), Image.LANCZOS)
    return im if im.getbbox() else None

def tint(im, hexc, base=1.0):
    h = hexc.lstrip('#'); c = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    r, g, b, a = im.split()
    rgb = Image.merge('RGB', (r, g, b))
    col = Image.new('RGB', im.size, tuple(min(255, int(v / base)) for v in c))
    out = ImageChops.multiply(rgb, col); out.putalpha(a); return out

def save(im, rel_path):
    p = os.path.join(PUB, rel_path); os.makedirs(os.path.dirname(p), exist_ok=True)
    im.save(p, 'WEBP', quality=90, method=4); return '/pm-char/' + rel_path.replace(os.sep, '/')

layers = {'canvas': CH, 'anchors': {k: [round(v[0], 1), round(v[1], 1)] for k, v in ANCHORS.items()},
          'order': ['kindBack', 'hairBack', 'body', 'bottom', 'top', 'badge', 'face', 'hairFront', 'kindFront', 'glasses', 'hat', 'hand'],
          'bodies': {}, 'skins': SKINS, 'hairColors': HAIR_COLORS, 'hairs': {}, 'kinds': {}, 'items': {},
          'desk': {'canvas': DK, 'anchor': [round(DESK_ANCHOR[0], 1), round(DESK_ANCHOR[1], 1)], 'slots': DESK_SLOTS, 'items': {}}}
raw_cache = {}
def keep(name, size):
    im = load(name, size); raw_cache[name] = im; return im

for b in BODIES:
    im = keep(f'body@{b}', CH); layers['bodies'][b] = [save(tint(im, c), f'body/{b}-{i}.webp') for i, c in enumerate(SKINS)]
_fb = raw_cache['body@std'].split()[3].point(lambda v: 255 if v > 128 else 0).getbbox()
ANCHORS['feet'] = ((_fb[0] + _fb[2]) / 2, _fb[3]); layers['anchors']['feet'] = [round(ANCHORS['feet'][0], 1), ANCHORS['feet'][1]]
face = keep('face', CH); layers['face'] = save(face, 'face.webp')
for s in HAIRS:
    d = {}
    for part in ('front', 'back'):
        im = keep(f'hair.{s}.{part}', CH)
        if im: d[part] = [save(tint(im, c, 0.85), f'hair/{s}-{part}-{i}.webp') for i, c in enumerate(HAIR_COLORS)]
    layers['hairs'][s] = d
for k in KINDS:
    d = {}
    for part in ('front', 'back'):
        im = keep(f'kind.{k}.{part}', CH)
        if im: d[part] = save(im, f'kind/{k}-{part}.webp')
    layers['kinds'][k] = d
def per_body(iid, suffix=''):
    d = {}
    for b in BODIES:
        im = keep(f'{iid}@{b}{suffix}', CH)
        if im: d[b] = save(im, f'items/{iid}/{b}{suffix}.webp'.replace('@', ''))
    return d
for o in OUTFITS: layers['items'][o[0]] = {'slot': 'outfit', 'layers': {'bottom': per_body(o[0], '.bottom'), 'top': per_body(o[0], '.top')}}
for h in HANDS: layers['items'][h[0]] = {'slot': 'hand', 'layers': {'hand': per_body(h[0])}}
for b in BADGES: layers['items'][b[0]] = {'slot': 'badge', 'layers': {'badge': per_body(b[0])}}
for h in HATS:
    im = keep(h[0], CH); layers['items'][h[0]] = {'slot': 'hat', 'layers': {'hat': {'*': save(im, f'items/{h[0]}.webp')}}}
for g in GLASSES:
    im = keep(g[0], CH); layers['items'][g[0]] = {'slot': 'glasses', 'layers': {'glasses': {'*': save(im, f'items/{g[0]}.webp')}}}
# ── 앉은 포즈(sit, 3/4 시점 30°) — 같은 구조로 layers.sit. 반대 방향은 화면에서 좌우 반전 ──
SIT = '~sit'
sit = {'anchors': {'hip': [round(proj_ch(0, 0, 0.42)[0], 1), round(proj_ch(0, 0, 0.42)[1], 1)]}, 'bodies': {}, 'hairs': {}, 'kinds': {}, 'items': {}}
for b in BODIES:
    im = keep(f'body@{b}{SIT}', CH); sit['bodies'][b] = [save(tint(im, c), f'sit/body/{b}-{i}.webp') for i, c in enumerate(SKINS)]
sit['face'] = save(keep('face' + SIT, CH), 'sit/face.webp')
for st_ in HAIRS:
    d = {}
    for part in ('front', 'back'):
        im = keep(f'hair.{st_}.{part}{SIT}', CH)
        if im: d[part] = [save(tint(im, c, 0.85), f'sit/hair/{st_}-{part}-{i}.webp') for i, c in enumerate(HAIR_COLORS)]
    sit['hairs'][st_] = d
for k in KINDS:
    d = {}
    for part in ('front', 'back'):
        im = keep(f'kind.{k}.{part}{SIT}', CH)
        if im: d[part] = save(im, f'sit/kind/{k}-{part}.webp')
    sit['kinds'][k] = d
def per_body_sit(iid, suffix=''):
    d = {}
    for b in BODIES:
        im = keep(f'{iid}@{b}{suffix}{SIT}', CH)
        if im: d[b] = save(im, f'sit/items/{iid}/{b}{suffix}.webp')
    return d
for o in OUTFITS: sit['items'][o[0]] = {'bottom': per_body_sit(o[0], '.bottom'), 'top': per_body_sit(o[0], '.top')}
for h in HANDS: sit['items'][h[0]] = {'hand': per_body_sit(h[0])}
for b in BADGES: sit['items'][b[0]] = {'badge': per_body_sit(b[0])}
for h in HATS: sit['items'][h[0]] = {'hat': {'*': save(keep(h[0] + SIT, CH), f'sit/items/{h[0]}.webp')}}
for g in GLASSES: sit['items'][g[0]] = {'glasses': {'*': save(keep(g[0] + SIT, CH), f'sit/items/{g[0]}.webp')}}
layers['sit'] = sit
for d in DESKS:
    im = keep(d[0], DK); layers['desk']['items'][d[0]] = {'slot': 'desk', 'src': save(im, f'desk/{d[0]}.webp')}
for t in DESKTOP:
    im = keep(t[0], DK); layers['desk']['items'][t[0]] = {'slot': 'deskTop', 'src': save(im, f'desk/{t[0]}.webp')}
for f in FLOORS:
    im = keep(f[0], DK); layers['desk']['items'][f[0]] = {'slot': f[0].split('.')[0], 'src': save(im, f'desk/{f[0]}.webp')}
for p in PETS:
    a, b = keep(f'{p[0]}#0', DK), keep(f'{p[0]}#1', DK)
    strip = Image.new('RGBA', (DK * 2, DK)); strip.paste(a, (0, 0)); strip.paste(b, (DK, 0))
    layers['desk']['items'][p[0]] = {'slot': 'pet', 'src': save(strip, f'desk/{p[0]}.webp'), 'frames': 2}
# 상점 썸네일(아이템 단독, 잘라서 96px) — 그리드 아이콘용
def thumb(im, rel_path):
    bb = im.getbbox(); c = im.crop(bb); s = max(c.size); sq = Image.new('RGBA', (s + 8, s + 8)); sq.paste(c, ((s + 8 - c.size[0]) // 2, (s + 8 - c.size[1]) // 2))
    return save(sq.resize((96, 96), Image.LANCZOS), rel_path)
for iid, meta in layers['items'].items():
    srcs = []
    for L in meta['layers'].values(): srcs.append(L.get('std') or L.get('*'))
    ims = [Image.open(os.path.join(PUB, s.replace('/pm-char/', ''))) for s in srcs if s]
    comp = Image.new('RGBA', (CH, CH))
    for im in ims: comp.alpha_composite(im.convert('RGBA'))
    meta['thumb'] = thumb(comp, f'thumb/{iid}.webp')
for iid, meta in layers['desk']['items'].items():
    im = Image.open(os.path.join(PUB, meta['src'].replace('/pm-char/', ''))).convert('RGBA')
    if meta.get('frames'): im = im.crop((0, 0, DK, DK))
    meta['thumb'] = thumb(im, f'thumb/{iid}.webp')

# ── 합성(검사·콘택트시트용 — 프런트 Avatar 와 같은 순서) ──
def compose(body='std', skin=0, hair='short', hc=0, kind='human', items=None, pose=''):
    items = items or {}
    P = pose
    out = Image.new('RGBA', (CH, CH))
    def put(im):
        if im is not None: out.alpha_composite(im)
    put(raw_cache.get(f'kind.{kind}.back' + P)); put(tint(raw_cache[f'hair.{hair}.back' + P], HAIR_COLORS[hc], 0.85) if raw_cache.get(f'hair.{hair}.back' + P) else None)
    put(tint(raw_cache[f'body@{body}' + P], SKINS[skin]))
    o = items.get('outfit')
    if o: put(raw_cache.get(f'{o}@{body}.bottom' + P)); put(raw_cache.get(f'{o}@{body}.top' + P))
    if items.get('badge'): put(raw_cache.get(f"{items['badge']}@{body}" + P))
    put(raw_cache['face' + P])
    if raw_cache.get(f'hair.{hair}.front' + P): put(tint(raw_cache[f'hair.{hair}.front' + P], HAIR_COLORS[hc], 0.85))
    put(raw_cache.get(f'kind.{kind}.front' + P))
    if items.get('glasses'): put(raw_cache.get(items['glasses'] + P))
    if items.get('hat'): put(raw_cache.get(items['hat'] + P))
    if items.get('hand'): put(raw_cache.get(f"{items['hand']}@{body}" + P))
    return out

layers['kindThumbs'] = {k: thumb(compose('std', 0, 'short', 1, k, {}), f'thumb/char.{k}.webp') for k in KINDS}
with open(os.path.join(PUB, 'layers.json'), 'w', encoding='utf8') as f: json.dump(layers, f, ensure_ascii=False, indent=1)

# ── 상점 manifest 갱신(가격은 서버 manifest 기준: 기존 품목 가격 유지, 새 품목은 등급가) ──
MF = os.path.join(ROOT, 'public', 'pm-themes', 'manifest.json')
mf = json.load(open(MF, encoding='utf8'))
RP = mf.get('rarityPrice', {'basic': 0, 'common': 30, 'rare': 90, 'legendary': 240})
old = {x['id']: x for x in mf['items']}
SLOT_LABEL = {'outfit': '옷', 'hat': '모자', 'glasses': '안경', 'hand': '손 소품', 'badge': '배지', 'desk': '책상', 'deskTop': '책상 소품', 'rug': '러그', 'chair': '의자', 'shelf': '책장·큰 소품', 'pet': '펫'}
def entry(iid, name, slot, theme, rarity, src, extra=None):
    o = old.get(iid)
    e = {'id': iid, 'category': slot, 'categoryLabel': SLOT_LABEL[slot], 'name': name, 'theme': theme or '', 'rarity': o['rarity'] if o else rarity, 'price': o['price'] if o else RP[rarity], 'src': src, 'v': 2}
    if extra: e.update(extra)
    return e
items = []
for o in OUTFITS: items.append(entry(o[0], o[1], 'outfit', o[2], 'rare', layers['items'][o[0]]['thumb']))
for h in HATS: items.append(entry(h[0], h[1], 'hat', h[2], 'common', layers['items'][h[0]]['thumb']))
for g in GLASSES: items.append(entry(g[0], g[1], 'glasses', '', 'common', layers['items'][g[0]]['thumb']))
for h in HANDS: items.append(entry(h[0], h[1], 'hand', h[2], 'common', layers['items'][h[0]]['thumb']))
for b in BADGES: items.append(entry(b[0], b[1], 'badge', '', 'common', layers['items'][b[0]]['thumb']))
for d in DESKS: items.append(entry(d[0], d[1], 'desk', d[2], 'rare' if d[2] not in ('A', 'B') else 'common', layers['desk']['items'][d[0]]['thumb']))
REUSE = {'top.vase': 'vase', 'top.coffee': 'coffee', 'top.cactus': 'plant', 'top.calc': 'calc', 'top.globe': 'globe', 'top.box': 'box', 'top.trophy': 'trophy'}
for t in DESKTOP:
    prev = old.get('desk.' + REUSE[t[0]]) if t[0] in REUSE else None
    e = entry(t[0], t[1], 'deskTop', t[2], 'common', layers['desk']['items'][t[0]]['thumb'])
    if prev: e.update({'price': prev['price'], 'rarity': prev['rarity'], 'icon': prev['src'], 'aliasOf': prev['id']})
    items.append(e)
for f in FLOORS: items.append(entry(f[0], f[1], f[0].split('.')[0], f[2], 'rare' if f[0].startswith('shelf') else 'common', layers['desk']['items'][f[0]]['thumb']))
for p_ in PETS: items.append(entry(p_[0], p_[1], 'pet', '', 'rare' if p_[0] in ('pet.bee', 'pet.fish', 'pet.penguin') else 'common', layers['desk']['items'][p_[0]]['thumb'], {'frames': 2}))
seen = {x['id'] for x in items}
for x in mf['items']:   # 옛 책상 소품 등 새 목록에 없는 품목: 구매 기록 호환 위해 남기되 상점엔 숨김
    if x['id'] not in seen: items.append({**x, 'hidden': True})
mf['items'] = items
for c in mf['characters']: c['src'] = layers['kindThumbs'].get(c['id'], c['src'])
mf['layers'] = '/pm-char/layers.json'
mf['source'] = 'Blender 5.2 프리미티브 리그 렌더(scripts/pm-char/build.py, 같은 카메라·조명) + 기존 Higgsfield 클레이 책상 소품 아이콘 재사용'
json.dump(mf, open(MF, 'w', encoding='utf8', newline=chr(10)), ensure_ascii=False, indent=1)
print('MANIFEST items', len(items), 'visible', sum(1 for x in items if not x.get('hidden')))

# ── 정합 검사 ──
# 슬롯 영역(캐릭터 캔버스 px): 각 레이어 픽셀이 이 상자 밖에 있으면 위반
SLOT_BOX = {'hat': (20, 0, 236, 165), 'glasses': (60, 60, 196, 120), 'top': (50, 110, 206, 215), 'bottom': (60, 150, 196, 250), 'badge': (110, 120, 170, 175),
            'hand': (130, 50, 230, 215), 'hairFront': (40, 10, 216, 150), 'hairBack': (30, 10, 226, 220), 'kindFront': (20, 0, 236, 140), 'kindBack': (20, 60, 236, 230)}
report = {'checked': 0, 'anchorMaxErr': 0.0, 'outOfSlot': 0, 'orderViolations': 0, 'issues': []}
# 앵커 실측: 발 = 몸 레이어 최저 불투명 행(신발 바닥), 머리 = 최상단. 기준 = std 몸 실측값, 전 체형이 2px 안에 있어야 한다(옷·모자 정합의 전제).
def body_bb(b):
    a = raw_cache[f'body@{b}'].split()[3]; return a.point(lambda v: 255 if v > 128 else 0).getbbox()
ref = body_bb('std')
layers_feet = ((ref[0] + ref[2]) / 2, ref[3])
for b in BODIES:
    bb = body_bb(b)
    err = max(abs(bb[3] - ref[3]), abs(bb[1] - ref[1]), abs((bb[0] + bb[2]) / 2 - (ref[0] + ref[2]) / 2))
    report['anchorMaxErr'] = max(report['anchorMaxErr'], err)
    if err > 2: report['issues'].append(f'anchor {b} err{err:.1f}')
report['feetMeasured'] = layers_feet
# 얼굴 가림 = 레이어 순서 위반: 눈 영역에 옷·모자·손소품·배지·종류 레이어 픽셀이 있으면 위반(안경·앞머리는 허용)
EYES = [proj_ch(sx * 0.19, -0.5, 1.5) for sx in (-1, 1)]
def eye_hits(im):
    if im is None: return 0
    a = im.split()[3]; n = 0
    for (ex, ey) in EYES:
        for x in range(int(ex) - 4, int(ex) + 5):
            for y in range(int(ey) - 5, int(ey) + 6):
                if a.getpixel((x, y)) > 24: n += 1
    return n
def check_layer(name, im, slot):
    report['checked'] += 1
    if im is None: return
    x0, y0, x1, y1 = SLOT_BOX[slot]; a = im.split()[3].point(lambda v: 255 if v > 24 else 0)
    bb = a.getbbox()
    if bb and (bb[0] < x0 or bb[1] < y0 or bb[2] > x1 or bb[3] > y1):
        report['outOfSlot'] += 1; report['issues'].append(f'{name} bbox {bb} > {slot}{SLOT_BOX[slot]}')
for b in BODIES:
    for o in OUTFITS:
        check_layer(f'{o[0]}@{b}.top', raw_cache.get(f'{o[0]}@{b}.top'), 'top'); check_layer(f'{o[0]}@{b}.bottom', raw_cache.get(f'{o[0]}@{b}.bottom'), 'bottom')
    for h in HANDS: check_layer(f'{h[0]}@{b}', raw_cache.get(f'{h[0]}@{b}'), 'hand')
    for x in BADGES: check_layer(f'{x[0]}@{b}', raw_cache.get(f'{x[0]}@{b}'), 'badge')
for h in HATS: check_layer(h[0], raw_cache.get(h[0]), 'hat')
for g in GLASSES: check_layer(g[0], raw_cache.get(g[0]), 'glasses')
for s in HAIRS: check_layer(f'hair.{s}.front', raw_cache.get(f'hair.{s}.front'), 'hairFront'); check_layer(f'hair.{s}.back', raw_cache.get(f'hair.{s}.back'), 'hairBack')
for k in KINDS: check_layer(f'kind.{k}.front', raw_cache.get(f'kind.{k}.front'), 'kindFront'); check_layer(f'kind.{k}.back', raw_cache.get(f'kind.{k}.back'), 'kindBack')
# 레이어 순서 위반: 옷(top) 이 holdout 덕에 몸 뒤쪽 픽셀을 갖지 않아야 함 → 몸 실루엣 안쪽에서 옷이 몸보다 "뒤"인 픽셀 = 몸 뒤로 숨어야 할 옷이 앞에 그려진 경우.
#   판정: 몸만 렌더한 알파 안쪽인데 옷 알파가 있고, 옷 + 몸 합성에서 몸 색이 보여야 할 곳(=뒤판). 근사: 옷 레이어 픽셀 중 몸 레이어 '뒤판' 마스크와 겹침 수.
#   뒤판 마스크는 렌더 시 holdout 으로 이미 제거되므로 여기서는 순서 배열 자체가 정의(order)와 일치하는지 + 머리 아이템이 face 위에 오는지 확인.
for name, im in raw_cache.items():
    if im is None or name.endswith('~sit') or im.size[0] != CH or name in ('face',) or name.startswith('glasses.') or name.startswith('body@') or name.startswith('hair.') or name == 'kind.penguin.front': continue  # 펭귄 부리는 얼굴 장식(의도)
    h = eye_hits(im)
    if h: report['orderViolations'] += 1; report['issues'].append(f'face-cover {name} {h}px')
# 앉은 포즈: 체형 간 머리 위치 일치(≤2px) + 눈 가림 0
import math as _m
def rot(x, y, z, a=_m.radians(-30)): return (x * _m.cos(a) - y * _m.sin(a), x * _m.sin(a) + y * _m.cos(a), z)
EYES_SIT = [proj_ch(*rot(sx * 0.19, -0.5, 1.5)) for sx in (-1, 1)]
def top_y(name):
    a = raw_cache[name].split()[3].point(lambda v: 255 if v > 128 else 0); return a.getbbox()
r0 = top_y('body@std~sit')
for b in BODIES:
    r = top_y(f'body@{b}~sit'); err = abs(r[1] - r0[1])
    report['anchorMaxErr'] = max(report['anchorMaxErr'], err)
    if err > 2: report['issues'].append(f'sit head {b} {err}')
for name, im in raw_cache.items():
    if not name.endswith('~sit') or im is None or im.size[0] != CH: continue
    report['checked'] += 1
    if name.startswith(('face', 'glasses.', 'body@', 'hair.', 'outfit.', 'hand.', 'badge.')) or name.startswith('kind.penguin.front'): continue
    a = im.split()[3]; n = 0
    for (ex, ey) in EYES_SIT:
        for x in range(int(ex) - 3, int(ex) + 4):
            for y in range(int(ey) - 4, int(ey) + 5):
                if a.getpixel((x, y)) > 24: n += 1
    if n: report['orderViolations'] += 1; report['issues'].append(f'sit face-cover {name} {n}px')
ORDER = layers['order']
must = [('body', 'bottom'), ('bottom', 'top'), ('top', 'badge'), ('face', 'hairFront'), ('hairFront', 'hat'), ('hairBack', 'body'), ('kindBack', 'body'), ('top', 'hand')]
for a_, b_ in must:
    if ORDER.index(a_) > ORDER.index(b_): report['orderViolations'] += 1; report['issues'].append(f'order {a_}>{b_}')
# 조합 수(체형×옷×모자×손소품… 전수 합성은 생략, 레이어 단위 검사가 조합 정합을 보장: 같은 캔버스·같은 리그라 이동 없음)
report['combos'] = len(BODIES) * len(SKINS) * len(HAIRS) * len(KINDS) * (len(OUTFITS) + 1) * (len(HATS) + 1) * (len(HANDS) + 1)
json.dump(report, open(os.path.join(SHOTS, 'fit-report.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('FIT', json.dumps({k: v for k, v in report.items() if k != 'issues'}), 'issues', report['issues'][:20])

# ── 콘택트시트: 테마 10종 × 대표 캐릭터(체형 3) ──
TH = 'ABCDEFGHIJ'
def theme_items(t):
    pick = lambda arr: next((x[0] for x in arr if x[2] == t), None)
    return {'outfit': pick(OUTFITS), 'hat': pick(HATS), 'hand': pick(HANDS)}
sheet = Image.new('RGBA', (CH * 10, CH * 3), (250, 246, 240, 255))
for i, t in enumerate(TH):
    for j, b in enumerate(BODIES):
        sheet.alpha_composite(compose(b, (i + j) % 4, HAIRS[(i + j) % 4], (i * 3 + j) % 5, 'human', theme_items(t)), (i * CH, j * CH))
sheet.save(os.path.join(SHOTS, 'contact-themes.png'))
sheetS = Image.new('RGBA', (CH * 10, CH * 3), (250, 246, 240, 255))
for i, t in enumerate(TH):
    for j, b in enumerate(BODIES):
        sheetS.alpha_composite(compose(b, (i + j) % 4, HAIRS[(i + j) % 4], (i * 3 + j) % 5, 'human', theme_items(t), '~sit'), (i * CH, j * CH))
sheetS.save(os.path.join(SHOTS, 'contact-themes-sit.png'))
sheet2 = Image.new('RGBA', (CH * 10, CH), (250, 246, 240, 255))
for i, k in enumerate(KINDS): sheet2.alpha_composite(compose('std', i % 4, HAIRS[i % 4], i % 5, k, {}), (i * CH, 0))
sheet2.save(os.path.join(SHOTS, 'contact-kinds.png'))
# 자리 세트 테마별
dsheet = Image.new('RGBA', (DK * 5, DK * 2), (250, 246, 240, 255))
def dk(name):
    p = os.path.join(PUB, layers['desk']['items'][name]['src'].replace('/pm-char/', '')); im = Image.open(p).convert('RGBA')
    return im.crop((0, 0, DK, DK)) if layers['desk']['items'][name].get('frames') else im
def shift(im, dx):
    o = Image.new('RGBA', im.size); o.alpha_composite(im, (int(round(dx)), 0)) if dx >= 0 else o.alpha_composite(im.crop((int(round(-dx)), 0, im.size[0], im.size[1])), (0, 0)); return o
sets = [('rug.wood', 'shelf.book', 'chair.wood', 'desk.wood', 'top.mug', 'top.plant', 'pet.puppy', 'A'), ('rug.pastel', None, 'chair.pastel', 'desk.pastel', 'top.vase', 'top.frame', 'pet.bunny', 'B'),
        ('rug.neon', 'shelf.arcade', 'chair.gaming', 'desk.neon', 'top.lamp', 'top.keyboard', 'pet.kitten', 'C'), ('rug.hwamunseok', None, 'chair.cushion', 'desk.soban', 'top.inkstone', 'top.vase', 'pet.chick', 'D'),
        ('rug.wood', 'shelf.plant', 'chair.wood', 'desk.greenhouse', 'top.cactus', 'top.plant', 'pet.bee', 'E'), ('rug.neon', 'shelf.arcade', 'chair.gaming', 'desk.arcade', 'top.keyboard', 'top.trophy', 'pet.hamster', 'F'),
        ('rug.pastel', 'shelf.book', 'chair.wood', 'desk.easel', 'top.frame', 'top.vase', 'pet.butterfly', 'G'), (None, None, 'chair.gaming', 'desk.console', 'top.monitor', 'top.globe', 'pet.fish', 'H'),
        ('rug.beach', 'shelf.potplant', 'chair.beach', 'desk.bamboo', 'top.shell', 'top.coffee', 'pet.turtle', 'I'), ('rug.snow', 'shelf.book', 'chair.wood', 'desk.snow', 'top.snowglobe', 'top.mug', 'pet.penguin', 'J')]
sx = DESK_SLOTS['seat']['at']
for i, (rug, shelf, chair, desk, tl, tr, pet, t) in enumerate(sets):
    c = Image.new('RGBA', (DK, DK))
    for n in (rug, shelf, chair):
        if n: c.alpha_composite(dk(n))
    ch = compose('std', i % 4, HAIRS[i % 4], i % 5, 'human', theme_items(t), '~sit')
    fx, fy = sit['anchors']['hip']; ax, ay = DESK_ANCHOR
    c.alpha_composite(ch, (int(round(ax + sx[0] - fx)), int(round(ay + sx[1] - fy))))
    c.alpha_composite(dk(desk)); c.alpha_composite(shift(dk(tl), DESK_SLOTS['deskL']['dx'])); c.alpha_composite(shift(dk(tr), DESK_SLOTS['deskR']['dx'])); c.alpha_composite(dk(pet))
    dsheet.alpha_composite(c, ((i % 5) * DK, (i // 5) * DK))
dsheet.save(os.path.join(SHOTS, 'contact-desks.png'))
print('POST_DONE', PUB)
