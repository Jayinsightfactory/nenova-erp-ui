# scripts/pm-char/post_iso.py — 아이소메트릭(장면 배경과 같은 시점) 책상 스킨·상판 소품·펫 → public/pm-char/iso/ + layers.json 'iso'
# 실행: blender -b -P scripts/pm-char/build.py -- <raw-iso> "" iso  →  python scripts/pm-char/post_iso.py <raw-iso> <shots>
# 정합 검사: 앵커(카메라 투영값)가 실제 픽셀 위에 있는지, 슬롯 상자 밖 픽셀 0, 같은 캔버스 크기.
import json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spec import DESKS, DESKTOP, PETS

RAW = sys.argv[1]; SHOTS = sys.argv[2] if len(sys.argv) > 2 else RAW
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PUB = os.path.join(ROOT, 'public', 'pm-char')
N = 384
A = json.load(open(os.path.join(RAW, 'iso-anchors.json')))
os.makedirs(os.path.join(PUB, 'iso'), exist_ok=True); os.makedirs(SHOTS, exist_ok=True)

def load(n):
    return Image.open(os.path.join(RAW, n + '.png')).convert('RGBA').resize((N, N), Image.LANCZOS)
def save(im, rel):
    im.save(os.path.join(PUB, rel), 'WEBP', quality=90, method=4); return '/pm-char/' + rel

iso = {'canvas': N, 'camera': {'elev': A['elev'], 'az': A['az']}, 'anchors': {k: A[k] for k in ('floor', 'top', 'deskL', 'deskM', 'deskR', 'pet')},
       'note': '상판 소품은 deskM 에 렌더 — deskL/deskR 는 (앵커 - deskM) 만큼 평행이동. 반대 방향 책상은 scaleX(-1)', 'items': {}}
report = {'checked': 0, 'anchorOnPixel': 0, 'outOfSlot': 0, 'issues': []}
ims = {}
def box_ok(im, cx, cy, hw, hh, name):
    bb = im.split()[3].point(lambda v: 255 if v > 24 else 0).getbbox()
    report['checked'] += 1
    if not bb: report['issues'].append(f'{name} empty'); report['outOfSlot'] += 1; return
    if bb[0] < cx - hw or bb[2] > cx + hw or bb[1] < cy - hh or bb[3] > cy + hh:
        report['outOfSlot'] += 1; report['issues'].append(f'{name} bbox {bb}')
for d in DESKS:
    im = load(d[0] + '@iso'); ims[d[0]] = im
    iso['items'][d[0]] = {'slot': 'desk', 'src': save(im, f'iso/{d[0]}.webp')}
    tx, ty = A['top']
    if im.getpixel((int(tx), int(ty)))[3] < 128: report['issues'].append(f'{d[0]} top anchor not on desk')
    else: report['anchorOnPixel'] += 1
    box_ok(im, N / 2, N / 2, N / 2, N / 2, d[0])
for t in DESKTOP:
    im = load(t[0] + '@iso'); ims[t[0]] = im
    iso['items'][t[0]] = {'slot': 'deskTop', 'src': save(im, f'iso/{t[0]}.webp')}
    mx, my = A['deskM']
    box_ok(im, mx, my - 40, 75, 75, t[0])       # 상판 칸 상자(가운데 칸 기준)
    # 소품 바닥이 앵커 근처(≤2px 열 안에 픽셀 존재)
    a = im.split()[3]
    near = any(a.getpixel((x, y)) > 128 for x in range(int(mx) - 2, int(mx) + 3) for y in range(int(my) - 2, int(my) + 3))
    if near: report['anchorOnPixel'] += 1
    else: report['issues'].append(f'{t[0]} base not at deskM ±2px')
for p in PETS:
    a0, a1 = load(f'{p[0]}#0@iso'), load(f'{p[0]}#1@iso'); ims[p[0]] = a0
    strip = Image.new('RGBA', (N * 2, N)); strip.paste(a0, (0, 0)); strip.paste(a1, (N, 0))
    iso['items'][p[0]] = {'slot': 'pet', 'src': save(strip, f'iso/{p[0]}.webp'), 'frames': 2}
    px_, py_ = A['pet']
    box_ok(a0, px_, py_ - 60, 70, 85, p[0] + '#0'); box_ok(a1, px_, py_ - 60, 70, 85, p[0] + '#1')   # 나는 펫(나비·벌) 프레임 높이 포함
L = json.load(open(os.path.join(PUB, 'layers.json'), encoding='utf8'))
L['iso'] = iso
json.dump(L, open(os.path.join(PUB, 'layers.json'), 'w', encoding='utf8', newline='\n'), ensure_ascii=False, indent=1)
json.dump(report, open(os.path.join(SHOTS, 'fit-report-iso.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('ISO', json.dumps({k: v for k, v in report.items() if k != 'issues'}), report['issues'][:12])
# 콘택트시트: 테마별 책상+소품 2개+펫
sets = [('desk.wood', 'top.mug', 'top.plant', 'pet.puppy'), ('desk.pastel', 'top.vase', 'top.frame', 'pet.bunny'), ('desk.neon', 'top.lamp', 'top.keyboard', 'pet.kitten'), ('desk.soban', 'top.inkstone', 'top.vase', 'pet.chick'),
        ('desk.greenhouse', 'top.cactus', 'top.plant', 'pet.bee'), ('desk.arcade', 'top.keyboard', 'top.trophy', 'pet.hamster'), ('desk.easel', 'top.frame', 'top.vase', 'pet.butterfly'), ('desk.console', 'top.monitor', 'top.globe', 'pet.fish'),
        ('desk.bamboo', 'top.shell', 'top.coffee', 'pet.turtle'), ('desk.snow', 'top.snowglobe', 'top.mug', 'pet.penguin')]
def shift(im, dx, dy):
    o = Image.new('RGBA', im.size); o.alpha_composite(im, (0, 0)) if False else None
    o.paste(im, (int(round(dx)), int(round(dy))), im); return o
sh = Image.new('RGBA', (N * 5, N * 2), (246, 238, 226, 255))
for i, (d, l, r, p) in enumerate(sets):
    c = Image.new('RGBA', (N, N)); c.alpha_composite(ims[d])
    for name, slot in ((l, 'deskL'), (r, 'deskR')):
        c.alpha_composite(shift(ims[name], A[slot][0] - A['deskM'][0], A[slot][1] - A['deskM'][1]))
    c.alpha_composite(ims[p]); sh.alpha_composite(c, ((i % 5) * N, (i // 5) * N))
sh.save(os.path.join(SHOTS, 'contact-iso-desks.png'))
print('POST_ISO_DONE')
