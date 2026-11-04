# scripts/pm-themes/scene_bg.py — /pm 배경 장면 이미지 파이프라인(배경 파일만 바꿔 다시 돌림).
#   1) webp: public/pm/scene-bg/{id}.webp (가로 2000px, 600KB 이하) + {id}-lq.webp (48px 블러 플레이스홀더)
#   2) grid: 좌표 찍기용 % 격자 이미지 → OUT/grid-{id}.png  (이걸 보고 lib/pmSceneMaps.json 의 stations/seats/lab/robots 를 찍는다)
#   3) check: 현재 pmSceneMaps.json 좌표를 배경 위에 점으로 찍은 확인 이미지 → OUT/check-{id}.png
# 사용: python scripts/pm-themes/scene_bg.py <배경폴더(A.png..J.png)> <출력폴더> [A,B,...]   (저장소 루트에서 실행)
#   예: python scripts/pm-themes/scene_bg.py C:/Users/USER/nenova-pm/theme-bg-clay C:/tmp/scene-check
#   배경 비율이 바뀌면 pmSceneMaps.json 의 aspect 도 자동 갱신한다(좌표는 사람이 check 이미지로 재확인).
import json, os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

src_dir, out_dir = sys.argv[1], sys.argv[2]
ids = sys.argv[3].split(',') if len(sys.argv) > 3 else list('ABCDEFGHIJ')
os.makedirs(out_dir, exist_ok=True)
MAPS = 'lib/pmSceneMaps.json'
maps = json.load(open(MAPS, encoding='utf8'))
DEPT_COL = {'영업지원': (0, 0, 255), '영업부': (0, 150, 0), '수입부': (200, 0, 200), '경영지원': (255, 140, 0), '현장팀': (0, 0, 0)}

def font(n):
    for f in ('malgun.ttf', 'arial.ttf', 'DejaVuSans.ttf'):
        try: return ImageFont.truetype(f, n)
        except OSError: pass
    return ImageFont.load_default()

for tid in ids:
    path = next((os.path.join(src_dir, tid + e) for e in ('.png', '.jpg', '.webp') if os.path.exists(os.path.join(src_dir, tid + e))), None)
    if not path: print(tid, '배경 없음 — 건너뜀'); continue
    im = Image.open(path).convert('RGB')
    # 1) webp
    big = im.resize((2000, round(2000 * im.height / im.width)), Image.LANCZOS)
    q = 84
    while True:
        big.save(f'public/pm/scene-bg/{tid}.webp', 'WEBP', quality=q, method=6)
        if os.path.getsize(f'public/pm/scene-bg/{tid}.webp') <= 600 * 1024 or q < 40: break
        q -= 6
    im.resize((48, round(48 * im.height / im.width)), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1)).save(f'public/pm/scene-bg/{tid}-lq.webp', 'WEBP', quality=50)
    # 2) grid
    g = im.resize((1600, round(1600 * im.height / im.width))); d = ImageDraw.Draw(g); W, H = g.size; f = font(16)
    for i in range(0, 101, 5):
        c = (255, 0, 0) if i % 10 == 0 else (255, 160, 160)
        d.line([(W * i / 100, 0), (W * i / 100, H)], fill=c); d.line([(0, H * i / 100), (W, H * i / 100)], fill=c)
        if i % 10 == 0: d.text((W * i / 100 + 2, 2), str(i), fill=(255, 0, 0), font=f); d.text((2, H * i / 100 + 2), str(i), fill=(255, 0, 0), font=f)
    g.save(os.path.join(out_dir, f'grid-{tid}.png'))
    # 3) check
    m = maps.get(tid)
    if m:
        m['aspect'] = round(im.width / im.height, 4); m['src'] = tid
        c = im.resize((1600, round(1600 * im.height / im.width))); d = ImageDraw.Draw(c); W, H = c.size; f = font(18)
        for i, (x, y) in enumerate(m['stations']):
            X, Y = W * x / 100, H * y / 100; d.ellipse([X - 12, Y - 12, X + 12, Y + 12], fill=(255, 0, 0)); d.text((X - 5, Y - 11), str(i + 1), fill=(255, 255, 255), font=f)
        for k, pts in m['seats'].items():
            for j, (x, y) in enumerate(pts):
                X, Y = W * x / 100, H * y / 100; d.rectangle([X - 8, Y - 8, X + 8, Y + 8], fill=DEPT_COL[k]); d.text((X + 9, Y - 10), k[:2] + str(j), fill=DEPT_COL[k], font=f)
                ox, oy = m.get('deskOffset', [2.5, -6]); d.line([(X, Y), (W * (x + ox) / 100, H * (y + oy) / 100)], fill=DEPT_COL[k], width=2)
        # 책상 앞판 마스크(%): 엉덩이(자리점+sitOffset) 아래 사각형 — 장면은 이 자리 배경을 다시 잘라 덮어 하반신을 숨긴다
        off = m.get('deskOffset', [2.5, -6]); so = m.get('sitOffset', [off[0], off[1] - 0.8]); fm = m.get('frontMask', {'w': 8, 'h': 6, 'dy': 0.3})
        m['frontMasks'] = {}
        for k2, pts in m['seats'].items():
            rects = []
            for (x, y) in pts:
                hx, hy = x + so[0], y + so[1]
                r = [round(hx - fm['w'] / 2, 2), round(hy + fm['dy'], 2), round(hx + fm['w'] / 2, 2), round(hy + fm['dy'] + fm['h'], 2)]
                rects.append(r); d.rectangle([W * r[0] / 100, H * r[1] / 100, W * r[2] / 100, H * r[3] / 100], outline=DEPT_COL[k2], width=2)
            m['frontMasks'][k2] = rects
        l = m['lab']; d.rectangle([W * l[0] / 100, H * l[1] / 100, W * l[2] / 100, H * l[3] / 100], outline=(0, 200, 255), width=3)
        for x, y in m['robots']: d.ellipse([W * x / 100 - 6, H * y / 100 - 6, W * x / 100 + 6, H * y / 100 + 6], fill=(0, 200, 255))
        c.save(os.path.join(out_dir, f'check-{tid}.png'))
    print(tid, 'webp q', q, os.path.getsize(f'public/pm/scene-bg/{tid}.webp') // 1024, 'KB', '· 지도', '있음' if m else '없음(pmSceneMaps.json 에 추가 필요)')

json.dump(maps, open(MAPS, 'w', encoding='utf8', newline='\n'), ensure_ascii=False, indent=1)
