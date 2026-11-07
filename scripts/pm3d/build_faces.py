# scripts/pm3d/build_faces.py — /pm 3D 캐릭터 표정 텍스처 12종(lib/pmFaces.PM_FACE_IDS)
# 실행: python scripts/pm3d/build_faces.py  → public/pm3d/face/<id>.webp (256x256, 투명 배경)
# 얼굴 데칼(char.glb 재질명 'face')에 스왑해 쓴다. 눈(하이라이트 2개)·눈썹·입만 그리고 볼터치는 바디 메시(cheek)가 담당.
# 2026-11-07: 데칼을 2.1배 키움(scripts/pm3d/detail_char.py FACE_K) — 커진 치비 머리에서 표정이 읽히게.
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'pm3d', 'face')
os.makedirs(OUT, exist_ok=True)
S = 256                      # 2026-11-07 128→256: 얼굴 데칼을 1.45배 키우면서 선이 흐려지지 않게(좌표는 128 기준 × K)
K = S / 128
INK = (62, 40, 36, 255)      # 눈·입 기본(따뜻한 진갈색)
BROW = (110, 72, 58, 200)    # 눈썹(연하게)
MOUTH = (214, 104, 98, 255)  # 입 안
TONGUE = (255, 150, 150, 255)
TEAR = (120, 180, 240, 255)
HI = (255, 255, 255, 240)

# 눈 중심(좌/우)·입 중심 — 데칼 UV 기준(128 좌표). 눈을 조금 벌리고 낮춰 치비 비율(이마 넓게)
EXL, EXR, EY, MX, MY = 38, 90, 56, 64, 90

def canvas():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)
def bx(x0, y0, x1, y1): return (x0 * K, y0 * K, x1 * K, y1 * K)
def W(w): return max(1, int(round(w * K)))

def dot_eye(d, x, y, r=7):
    # 세로로 긴 반짝이는 눈: 큰 하이라이트 + 작은 하이라이트
    d.ellipse(bx(x - r * 0.82, y - r * 1.12, x + r * 0.82, y + r * 1.12), fill=INK)
    d.ellipse(bx(x - r * 0.05, y - r * 0.85, x + r * 0.6, y - r * 0.2), fill=HI)
    d.ellipse(bx(x - r * 0.55, y + r * 0.35, x - r * 0.2, y + r * 0.7), fill=(255, 255, 255, 170))

def brow(d, x, y, tilt=0):
    # 살짝 둥근 눈썹(tilt>0 = 바깥쪽이 내려감)
    d.arc(bx(x - 6.5, y - 17 - tilt, x + 6.5, y - 11 + tilt), 200, 340, fill=BROW, width=W(2.4))

def arc_eye(d, x, y, up=True, w=9):  # 감은 눈(^ 또는 n)
    d.arc(bx(x - w, y - 6, x + w, y + 7), 200 if up else 20, 340 if up else 160, fill=INK, width=W(3.4))

def line_eye(d, x, y, w=8):
    d.line(bx(x - w, y, x + w, y), fill=INK, width=W(3.4))

def half_eye(d, x, y, r=7):  # 반쯤 감김(졸림): 아래 반달 + 윗꺼풀 선
    d.chord(bx(x - r, y - r * 0.7, x + r, y + r * 0.9), 0, 180, fill=INK)
    d.line(bx(x - r - 1, y + 0.2, x + r + 1, y + 0.2), fill=INK, width=W(2.6))

def smile_mouth(d, w=8, y=MY, strong=False):
    d.arc(bx(MX - w, y - w * 0.8, MX + w, y + w * 0.5), 25, 155, fill=INK, width=W(3.6 if strong else 3.0))

def open_mouth(d, rx=8, ry=9, y=MY):
    d.chord(bx(MX - rx, y - ry * 0.6, MX + rx, y + ry), 0, 180, fill=MOUTH, outline=INK, width=W(2.4))
    d.ellipse(bx(MX - rx * 0.5, y + ry * 0.35, MX + rx * 0.5, y + ry * 0.9), fill=TONGUE)

def small_o(d, r=4, y=MY):
    d.ellipse(bx(MX - r, y - r, MX + r, y + r), outline=INK, width=W(3))

def frown(d, w=8, y=MY + 4):
    d.arc(bx(MX - w, y, MX + w, y + w * 1.3), 205, 335, fill=INK, width=W(3))

FACES = {}
def face(fid):
    def deco(fn): FACES[fid] = fn; return fn
    return deco

@face('smile')
def _(d): dot_eye(d, EXL, EY); dot_eye(d, EXR, EY); brow(d, EXL, EY); brow(d, EXR, EY); smile_mouth(d)
@face('grin')
def _(d): arc_eye(d, EXL, EY); arc_eye(d, EXR, EY); brow(d, EXL, EY - 1); brow(d, EXR, EY - 1); open_mouth(d)
@face('focus')
def _(d):
    # 집중: 눈은 뜬 채 눈썹을 안쪽으로 살짝 내리고, 입은 꼭 다문 작은 선
    dot_eye(d, EXL, EY + 1, 6.5); dot_eye(d, EXR, EY + 1, 6.5)
    brow(d, EXL, EY + 3, tilt=-0.7); brow(d, EXR, EY + 3, tilt=0.7)
    smile_mouth(d, 5, MY + 1)
@face('wow')
def _(d):
    for x in (EXL, EXR):
        d.ellipse(bx(x - 8, EY - 9, x + 8, EY + 9), outline=INK, width=W(3))
        d.ellipse(bx(x - 4, EY - 4, x + 4, EY + 5), fill=INK)
        brow(d, x, EY - 4)
    small_o(d, 5, MY + 2)
@face('wink')
def _(d): dot_eye(d, EXL, EY); arc_eye(d, EXR, EY); brow(d, EXL, EY); brow(d, EXR, EY); smile_mouth(d, strong=True)
@face('sleepy')
def _(d): half_eye(d, EXL, EY + 2); half_eye(d, EXR, EY + 2); small_o(d, 3.5, MY + 2)
@face('fire')
def _(d):
    for x, s in ((EXL, 1), (EXR, -1)):
        d.line(bx(x - s * 8, EY - 12, x + s * 7, EY - 6), fill=INK, width=W(3.4))  # 치켜뜬 눈썹
        dot_eye(d, x, EY + 1, 6.5)
    open_mouth(d, 9, 7, MY + 1)
@face('proud')
def _(d): arc_eye(d, EXL, EY, up=False); arc_eye(d, EXR, EY, up=False); brow(d, EXL, EY - 2); brow(d, EXR, EY - 2); smile_mouth(d, 7)
@face('shy')
def _(d):
    dot_eye(d, EXL, EY + 1, 6); dot_eye(d, EXR, EY + 1, 6)
    for x0 in (-8, -3, 2):
        d.line(bx(MX + x0, MY + (0 if x0 != -3 else 3), MX + x0 + 5, MY + (3 if x0 != -3 else 0)), fill=INK, width=W(3))
@face('teary')
def _(d):
    dot_eye(d, EXL, EY); dot_eye(d, EXR, EY); brow(d, EXL, EY, tilt=1.6); brow(d, EXR, EY, tilt=-1.6)
    d.ellipse(bx(EXR + 7, EY + 7, EXR + 13, EY + 17), fill=TEAR)
    frown(d)
@face('sing')
def _(d):
    arc_eye(d, EXL, EY); arc_eye(d, EXR, EY); open_mouth(d, 6, 8)
    d.line(bx(104, 76, 104, 94), fill=INK, width=W(3)); d.ellipse(bx(98, 90, 106, 98), fill=INK)  # 음표
@face('thinking')
def _(d):
    dot_eye(d, EXL, EY - 6, 6.5); dot_eye(d, EXR, EY - 6, 6.5); brow(d, EXL, EY - 7, tilt=-1); brow(d, EXR, EY - 8)
    d.line(bx(MX - 2, MY, MX + 7, MY - 2), fill=INK, width=W(3))

for fid, fn in FACES.items():
    im, d = canvas()
    fn(d)
    im.save(os.path.join(OUT, fid + '.webp'), 'WEBP', quality=92, method=6)
    print('face', fid)
print('PM3D_FACES_DONE', len(FACES))
