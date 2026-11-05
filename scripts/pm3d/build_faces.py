# scripts/pm3d/build_faces.py — /pm 3D 캐릭터 표정 텍스처 12종(lib/pmFaces.PM_FACE_IDS)
# 실행: python scripts/pm3d/build_faces.py  → public/pm3d/face/<id>.webp (128x128, 투명 배경)
# 얼굴 데칼(char.glb 재질명 'face')에 스왑해 쓴다. 눈·입만 그리고 볼터치는 바디 메시(cheek)가 담당.
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'pm3d', 'face')
os.makedirs(OUT, exist_ok=True)
S = 128
INK = (58, 42, 38, 255)      # 눈·입 기본(#3a2a26)
MOUTH = (196, 98, 90, 255)   # 입 안
TEAR = (120, 180, 240, 255)

# 눈 중심(좌/우)·입 중심 — 데칼 UV 기준(가로 0.56m·세로 0.34m 평면)
EXL, EXR, EY, MX, MY = 40, 88, 52, 64, 92

def canvas():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)

def dot_eye(d, x, y, r=7):
    d.ellipse((x - r, y - r, x + r, y + r), fill=INK)
    d.ellipse((x + r * 0.25, y - r * 0.55, x + r * 0.7, y - r * 0.1), fill=(255, 255, 255, 230))

def arc_eye(d, x, y, up=True, w=11):  # 감은 눈(^ 또는 n)
    box = (x - w, y - 7, x + w, y + 7)
    d.arc(box, 200 if up else 20, 340 if up else 160, fill=INK, width=4)

def line_eye(d, x, y, w=9):
    d.line((x - w, y, x + w, y), fill=INK, width=4)

def half_eye(d, x, y, r=8):  # 반쯤 감김
    d.chord((x - r, y - r, x + r, y + r), 0, 180, fill=INK)
    d.line((x - r, y, x + r, y), fill=INK, width=3)

def smile_mouth(d, w=12, y=MY, strong=False):
    d.arc((MX - w, y - w, MX + w, y + w * 0.6), 20, 160, fill=INK, width=5 if strong else 4)

def open_mouth(d, rx=10, ry=12, y=MY):
    d.ellipse((MX - rx, y - ry, MX + rx, y + ry), fill=MOUTH, outline=INK, width=3)

def small_o(d, r=5, y=MY):
    d.ellipse((MX - r, y - r, MX + r, y + r), outline=INK, width=4)

def frown(d, w=11, y=MY + 6):
    d.arc((MX - w, y, MX + w, y + w * 1.4), 200, 340, fill=INK, width=4)

FACES = {}
def face(fid):
    def deco(fn): FACES[fid] = fn; return fn
    return deco

@face('smile')
def _(d): dot_eye(d, EXL, EY); dot_eye(d, EXR, EY); smile_mouth(d)
@face('grin')
def _(d): arc_eye(d, EXL, EY); arc_eye(d, EXR, EY); open_mouth(d)
@face('focus')
def _(d): line_eye(d, EXL, EY); line_eye(d, EXR, EY); d.line((MX - 7, MY, MX + 7, MY), fill=INK, width=4)
@face('wow')
def _(d):
    for x in (EXL, EXR):
        d.ellipse((x - 10, EY - 10, x + 10, EY + 10), outline=INK, width=4)
        d.ellipse((x - 4, EY - 4, x + 4, EY + 4), fill=INK)
    open_mouth(d, 8, 10)
@face('wink')
def _(d): dot_eye(d, EXL, EY); arc_eye(d, EXR, EY); smile_mouth(d, strong=True)
@face('sleepy')
def _(d): half_eye(d, EXL, EY); half_eye(d, EXR, EY); small_o(d)
@face('fire')
def _(d):
    for x, s in ((EXL, 1), (EXR, -1)):
        d.line((x - s * 9, EY - 8, x + s * 9, EY - 3), fill=INK, width=4)  # 치켜뜬 눈썹
        d.ellipse((x - 6, EY - 2, x + 6, EY + 10), fill=INK)
    open_mouth(d, 11, 8, MY + 2)
@face('proud')
def _(d): arc_eye(d, EXL, EY, up=False); arc_eye(d, EXR, EY, up=False); smile_mouth(d, 10)
@face('shy')
def _(d):
    dot_eye(d, EXL, EY, 6); dot_eye(d, EXR, EY, 6)
    d.line((MX - 9, MY, MX - 3, MY + 4), fill=INK, width=4); d.line((MX - 3, MY + 4, MX + 3, MY), fill=INK, width=4); d.line((MX + 3, MY, MX + 9, MY + 4), fill=INK, width=4)
@face('teary')
def _(d):
    dot_eye(d, EXL, EY); dot_eye(d, EXR, EY)
    d.ellipse((EXR + 10, EY + 8, EXR + 18, EY + 20), fill=TEAR)
    frown(d)
@face('sing')
def _(d):
    arc_eye(d, EXL, EY); arc_eye(d, EXR, EY); open_mouth(d, 7, 9)
    d.line((100, 78, 100, 96), fill=INK, width=3); d.ellipse((94, 92, 102, 100), fill=INK)  # 음표
@face('thinking')
def _(d):
    dot_eye(d, EXL, EY - 8); dot_eye(d, EXR, EY - 8)
    d.line((MX - 2, MY, MX + 8, MY - 3), fill=INK, width=4)

for fid, fn in FACES.items():
    im, d = canvas()
    fn(d)
    im.save(os.path.join(OUT, fid + '.webp'), 'WEBP', quality=92, method=6)
    print('face', fid)
print('PM3D_FACES_DONE', len(FACES))
