# -*- coding: utf-8 -*-
# 수입방 카톡에서 발주 품목 줄만 추출 → 학습 입력 텍스트 + 신규/기존 분류
import re, json, sys, io

KAKAO = r"C:\Users\USER\Documents\카카오톡 받은 파일\수입방카톡.txt"
MAP   = r"C:\Users\USER\Documents\Codex\2026-05-15\codex-nowlink-kr-nenovaweb-com-git\nenova-erp-ui\data\order-mappings.json"
OUT   = r"C:\Users\USER\Documents\Codex\2026-05-15\codex-nowlink-kr-nenovaweb-com-git\nenova-erp-ui\scripts\train-input-suipbang.txt"

raw = io.open(KAKAO, encoding="utf-8").read().split("\n")

msg_re  = re.compile(r'^\[[^\]]+\]\s*\[[^\]]+\]\s?(.*)$')
date_re = re.compile(r'^-{3,}')

# 1) 메시지 재구성(이어지는 줄 합치기)
msgs = []
cur = None
for ln in raw:
    if date_re.match(ln):
        continue
    m = msg_re.match(ln)
    if m:
        if cur is not None: msgs.append(cur)
        cur = m.group(1)
    elif cur is not None:
        cur += "\n" + ln
if cur is not None: msgs.append(cur)

COUNTRY = r'(중국|네덜란드|콜롬비아|콜수국|콜장미|콜|에콰도르|에콰|태국|호주|베트남|스페인|NL)'
hdr_re  = re.compile(r'(발주|변경사항)')
cl_re   = re.compile(r'^\s*cl\s*\d+', re.I)
UNIT    = r'(단|박스|송이|스팀|스템|stems?|st)'
# 품목 줄: <이름> <수량><단위?> <추가/취소?>  (cm 사이즈는 무시)
prod_re = re.compile(r'^\s*(.+?)\s*(-?\d+(?:\.\d+)?)\s*'+UNIT+r'?\s*(추가|취소)?\s*$')

def is_order_msg(text):
    first = text.strip().split("\n")[0] if text.strip() else ""
    if hdr_re.search(first) and (re.search(COUNTRY, first) or re.search(r'\d\s*-?\s*\d*\s*차', first)):
        return True
    # CL 코드로 시작하는 짧은 발주 메시지
    if cl_re.match(text.strip()):
        return True
    return False

# 노이즈 컷: 품목명에 들어오면 제외(국가/일반어/문장)
NOISE = re.compile(r'(발주|변경사항|패킹|원가|이슈|도착|컨펌|취소되|진행|확인|스케줄|박스에|위안|원\b|kg|eta|http|냥|cm$|차$|^주광$|^여분$|^cl\d)', re.I)

def norm(s):
    return re.sub(r'\s+', ' ', s.strip().lower())

prod_lines = []   # 정제된 품목 표시줄
tokens = {}       # norm token -> 원문 예시
for text in msgs:
    if not is_order_msg(text):
        continue
    for line in text.split("\n"):
        line = line.strip()
        if not line or cl_re.match(line) or hdr_re.search(line):
            continue
        m = prod_re.match(line)
        if not m:
            continue
        name = m.group(1).strip()
        # 사이즈 토막 제거: "65~75 cm", "60cm", "15센치", "15cm"
        name = re.sub(r'\s*\d+\s*(~|-)\s*\d+\s*(cm|센치)?', ' ', name)
        name = re.sub(r'\s*\d+\s*(cm|센치|센티)\b', ' ', name)
        name = re.sub(r'\(.*?\)', ' ', name)
        name = re.sub(r'\s+', ' ', name).strip(" -:/")
        if len(name) < 2 or not re.search(r'[가-힣A-Za-z]', name):
            continue
        if NOISE.search(name):
            continue
        if re.match(r'^\d', name):
            continue
        unit = m.group(3) or ''
        qty  = m.group(2)
        disp = f"{name} {qty}{unit}{(' '+m.group(4)) if m.group(4) else ''}".strip()
        prod_lines.append(disp)
        tokens.setdefault(norm(name), name)

# 2) 기존 매핑 대조
mp = json.load(io.open(MAP, encoding="utf-8"))
mapkeys = set(mp.keys())
def is_learned(tok):
    if tok in mapkeys: return True
    c = tok.replace(' ','')
    for k in mapkeys:
        if k.replace(' ','') == c: return True
    return False

learned, new = [], []
for tok, ex in sorted(tokens.items()):
    (learned if is_learned(tok) else new).append(ex)

# 3) 출력
uniq_lines = sorted(set(prod_lines))
io.open(OUT, "w", encoding="utf-8").write("\n".join(uniq_lines) + "\n")

print(f"메시지 {len(msgs)}건 / 발주 메시지에서 추출한 품목줄 {len(prod_lines)}건 (고유 {len(uniq_lines)})")
print(f"고유 품목 토큰 {len(tokens)}개 → 이미학습 {len(learned)} / 신규 {len(new)}")
print(f"\n--- 신규(학습 대상) 품목 토큰 {len(new)}개 ---")
for x in new: print("  ", x)
print(f"\n--- 이미 학습된 토큰 {len(learned)}개 (참고) ---")
for x in learned[:40]: print("  ", x)
print(f"\n정제 입력 저장: {OUT}")
