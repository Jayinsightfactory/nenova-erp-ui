"""/pm 테마·캐릭터·꾸미기 SVG 에셋 생성기 (자체 제작, 투명 배경).

실행: python scripts/pm-themes/gen_assets.py  → public/pm-themes/** + manifest.json
Higgsfield 생성 도구가 연결되면 같은 경로의 파일을 PNG/WebP 로 교체하고 manifest source 를 바꾼다.
"""
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'pm-themes')
STAGES = ['발주', '입고', '분배', '현장출고', '견적', '거래처전달', '입금', '해외송금', '이익']
DEPTS = ['경영지원', '영업지원', '영업부', '수입부']

# bg / surface / ink / accent / plate / plateInk / dept floor 4색 / 단계 아이콘 9 / 흐르는 점
THEMES = [
    dict(id='greenhouse', name='꽃 온실', emoji='🌷', light=True, bg='#eef3e6', surface='#fffdf6', ink='#1f2a1c', muted='#4b5a46', accent='#2f6b3d', line='#b9c9ad', plate='#2f6b3d', plateInk='#ffffff',
         floors=['#e6dcc4', '#dbe8cf', '#f2dde3', '#d8e6e0'], deptNames=['장미 화단', '튤립 화단', '수국 화단', '카네이션 화단'],
         icons=['🌱', '🪴', '💐', '🧺', '🏷️', '🎀', '💰', '✈️', '🌻'], token='🌸', hall='온실 통로'),
    dict(id='harbor', name='물류 항구', emoji='🚢', bg='#0f2236', surface='#17324f', ink='#eef4fb', muted='#a9bdd3', accent='#ff9f2e', line='#2f5272', plate='#ff9f2e', plateInk='#1b1206',
         floors=['#1e4f7a', '#7a2e2e', '#2e6b46', '#7a5a1e'], deptNames=['파랑 컨테이너', '빨강 컨테이너', '초록 컨테이너', '노랑 컨테이너'],
         icons=['📝', '🚢', '🏗️', '🚚', '🧾', '📦', '💳', '🌐', '📈'], token='📦', hall='부두 컨베이어'),
    dict(id='airport', name='항공화물', emoji='✈️', light=True, bg='#e8f0fa', surface='#ffffff', ink='#10213a', muted='#43577a', accent='#1d5fbf', line='#bfd0e8', plate='#1d5fbf', plateInk='#ffffff',
         floors=['#dfe7f3', '#e7e2f3', '#f3e7df', '#dff3ea'], deptNames=['터미널 A', '터미널 B', '터미널 C', '화물 터미널'],
         icons=['🛫', '🛬', '🛄', '🚛', '🎫', '🤝', '🏦', '💱', '🏆'], token='✈️', hall='게이트'),
    dict(id='subway', name='지하철 노선도', emoji='🚇', light=True, bg='#ffffff', surface='#f4f6f8', ink='#111111', muted='#4a4f57', accent='#00843d', line='#cfd5dc', plate='#111111', plateInk='#ffffff',
         floors=['#eef6ff', '#fff3e6', '#f3eefc', '#e9f7ee'], deptNames=['1호선 구역', '3호선 구역', '5호선 구역', '2호선 구역'],
         icons=['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'], token='🚃', hall='노선'),
    dict(id='market', name='꽃시장 디오라마', emoji='🛒', light=True, bg='#efe6d8', surface='#fbf4e8', ink='#2a1d12', muted='#5e4a38', accent='#9c4423', line='#d8c6ac', plate='#9c4423', plateInk='#ffffff',
         floors=['#f1dcc6', '#e3e9d2', '#efd6dc', '#dde3ee'], deptNames=['가동', '나동', '다동', '수입동'],
         icons=['📋', '🚛', '⚖️', '🛒', '🧮', '💌', '🪙', '🏦', '🎉'], token='🛒', hall='시장 골목'),
    dict(id='rpg', name='픽셀 마을', emoji='🗡️', bg='#2d4a27', surface='#3a5f33', ink='#fffbe8', muted='#d9e4c4', accent='#ffd23f', line='#557a4c', plate='#ffd23f', plateInk='#2a1e00',
         floors=['#6b4f2e', '#3d5a7a', '#6b2e4f', '#2e6b5a'], deptNames=['은행 길드', '상인 길드', '모험가 길드', '항해 길드'],
         icons=['📜', '🏰', '⚒️', '🐎', '🔮', '🕊️', '🪙', '⛵', '👑'], token='🪙', hall='마을 길'),
    dict(id='space', name='우주정거장', emoji='🚀', bg='#0b0d1f', surface='#171a36', ink='#eef0ff', muted='#aab0d8', accent='#7cf3ff', line='#2b3060', plate='#7cf3ff', plateInk='#06121a',
         floors=['#1b1f45', '#2a1b45', '#1b3845', '#1f2b1b'], deptNames=['관제 모듈', '보급 모듈', '탐사 모듈', '도킹 모듈'],
         icons=['📡', '🛰️', '🧪', '🚀', '🖥️', '🌍', '💎', '🌌', '⭐'], token='🛰️', hall='도킹 링'),
    dict(id='cyber', name='사이버펑크 관제', emoji='🌃', bg='#0a0a12', surface='#151528', ink='#f2f2ff', muted='#b3b3d6', accent='#f9f871', line='#2c2c55', plate='#ff3fa4', plateInk='#1a0010',
         floors=['#1a0f2e', '#0f1f2e', '#2e0f1f', '#0f2e22'], deptNames=['랙 A', '랙 B', '랙 C', '랙 D'],
         icons=['⌨️', '📥', '🔀', '📤', '🧠', '📨', '💸', '🌐', '📊'], token='◆', hall='네온 버스'),
]

CHARACTERS = [
    # id, 이름, 피부/털, 귀 종류, 특징색
    ('human', '사람', '#f2c9a0', 'none', '#3b2a20'),
    ('cat', '고양이', '#f0a85a', 'cat', '#c46b1f'),
    ('dog', '강아지', '#d9b48a', 'dog', '#7a5232'),
    ('bunny', '토끼', '#f4f0f2', 'bunny', '#f2a7c0'),
    ('bear', '곰', '#9a6b45', 'bear', '#5e3d22'),
    ('fox', '여우', '#ef7f3a', 'fox', '#ffffff'),
    ('penguin', '펭귄', '#2a2f3a', 'penguin', '#ffb020'),
    ('fairy', '꽃 요정', '#ffd9e4', 'petal', '#ff6fa1'),
    ('robot', '로봇', '#b8c4d6', 'antenna', '#ff5f5f'),
    ('cactus', '선인장', '#5fae5a', 'flower', '#ff6fa1'),
]

STATES = ['idle', 'working', 'off', 'error', 'handoff']
# 상점 등급·가격(토큰). 기본=무료. docs/pm-theme-brainstorm.md '토큰·상점' 절과 같이 바꿀 것.
RARITY_PRICE = {'basic': 0, 'common': 30, 'rare': 90, 'legendary': 240}
THEME_RARITY = {'greenhouse': 'common', 'subway': 'common', 'airport': 'common', 'market': 'common', 'harbor': 'rare', 'rpg': 'rare', 'space': 'legendary', 'cyber': 'legendary'}
CHAR_RARITY = {'human': 'basic', 'cat': 'common', 'dog': 'common', 'bunny': 'common', 'bear': 'common', 'penguin': 'rare', 'fox': 'rare', 'cactus': 'rare', 'fairy': 'legendary', 'robot': 'legendary'}
LEGENDARY_ITEMS = {'hat.crown', 'glasses.visor', 'outfit.hanbok', 'outfit.spacesuit', 'desk.trophy', 'pet.butterfly', 'badge.mvp'}
RARE_ITEMS = {'hat.flowercrown', 'hat.pilot', 'glasses.heart', 'glasses.monocle', 'outfit.suit', 'desk.globe', 'pet.bee', 'pet.fish', 'badge.star'}


def ears(kind, fur, feat):
    if kind == 'cat':
        return f'<path d="M14 14 L16 4 L22 11 Z M34 14 L32 4 L26 11 Z" fill="{fur}"/><path d="M16 11 L17 7 L20 10 Z M32 11 L31 7 L28 10 Z" fill="#ffc7c7"/>'
    if kind == 'dog':
        return f'<ellipse cx="13" cy="17" rx="4" ry="8" fill="{feat}"/><ellipse cx="35" cy="17" rx="4" ry="8" fill="{feat}"/>'
    if kind == 'bunny':
        return f'<ellipse cx="19" cy="5" rx="3.5" ry="9" fill="{fur}"/><ellipse cx="29" cy="5" rx="3.5" ry="9" fill="{fur}"/><ellipse cx="19" cy="6" rx="1.6" ry="6" fill="{feat}"/><ellipse cx="29" cy="6" rx="1.6" ry="6" fill="{feat}"/>'
    if kind == 'bear':
        return f'<circle cx="15" cy="10" r="4.5" fill="{fur}"/><circle cx="33" cy="10" r="4.5" fill="{fur}"/><circle cx="15" cy="10" r="2" fill="{feat}"/><circle cx="33" cy="10" r="2" fill="{feat}"/>'
    if kind == 'fox':
        return f'<path d="M13 15 L14 3 L22 11 Z M35 15 L34 3 L26 11 Z" fill="{fur}"/><path d="M15 11 L15.5 6 L19 10 Z M33 11 L32.5 6 L29 10 Z" fill="#3a2414"/>'
    if kind == 'antenna':
        return f'<rect x="23" y="2" width="2" height="7" fill="#8894aa"/><circle cx="24" cy="2.5" r="2.5" fill="{feat}"/>'
    if kind == 'petal':
        return ''.join(f'<ellipse cx="{24 + dx}" cy="{6 + dy}" rx="4" ry="3" fill="{feat}"/>' for dx, dy in [(-8, 4), (-4, 0), (4, 0), (8, 4)])
    if kind == 'flower':
        return f'<circle cx="24" cy="5" r="3" fill="{feat}"/><circle cx="24" cy="5" r="1.2" fill="#ffd23f"/>'
    if kind == 'none':
        return f'<path d="M13 16 Q14 6 24 6 Q34 6 35 16 Q30 11 24 11 Q18 11 13 16 Z" fill="{feat}"/>'
    return ''


def character_svg(cid, fur, kind, feat):
    face = fur
    belly = ''
    if cid == 'penguin':
        belly = '<ellipse cx="24" cy="38" rx="7" ry="7" fill="#ffffff"/>'
        face_patch = '<ellipse cx="24" cy="20" rx="8" ry="7" fill="#ffffff"/>'
    elif cid == 'fox':
        face_patch = '<path d="M16 22 Q24 30 32 22 Q24 26 16 22 Z" fill="#ffffff"/>'
    elif cid == 'robot':
        face_patch = '<rect x="16" y="14" width="16" height="11" rx="2" fill="#2a3448"/>'
    elif cid == 'cactus':
        face_patch = '<path d="M18 13 v2 M30 13 v2 M24 11 v2" stroke="#2f6b2a" stroke-width="1"/>'
    else:
        face_patch = ''
    head = f'<rect x="13" y="9" width="22" height="20" rx="{4 if cid == "robot" else 10}" fill="{face}"/>'
    eyes_col = '#7cf3ff' if cid == 'robot' else '#1b1b22'
    eyes = f'<g class="eyes"><circle cx="20" cy="19" r="1.8" fill="{eyes_col}"/><circle cx="28" cy="19" r="1.8" fill="{eyes_col}"/></g>'
    mouth = '<path d="M22 24 Q24 25.5 26 24" stroke="#1b1b22" stroke-width="1" fill="none"/>' if cid != 'robot' else '<rect x="21" y="23" width="6" height="1.4" fill="#7cf3ff"/>'
    cheeks = '' if cid in ('robot', 'penguin') else '<circle cx="17.5" cy="23" r="1.6" fill="#ff9aa8" opacity=".6"/><circle cx="30.5" cy="23" r="1.6" fill="#ff9aa8" opacity=".6"/>'
    body = f'<rect class="shirt" x="15" y="29" width="18" height="15" rx="5" fill="var(--shirt,{feat if cid == "fairy" else "#4f8cff"})"/>'
    arms = f'<g class="arms"><rect x="11" y="31" width="5" height="9" rx="2.5" fill="{fur}"/><rect x="32" y="31" width="5" height="9" rx="2.5" fill="{fur}"/></g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">'
            f'{ears(kind, fur, feat)}{body}{belly}{arms}{head}{face_patch}{eyes}{mouth}{cheeks}</svg>')


# 꾸미기: (카테고리, id, 이름, svg 내용). 캐릭터와 같은 48x48 좌표계.
ITEMS = {
    'hat': [
        ('straw', '밀짚모자', '<ellipse cx="24" cy="10" rx="15" ry="3.5" fill="#e3c26b"/><rect x="17" y="3" width="14" height="7" rx="3" fill="#e9cf80"/><rect x="17" y="7" width="14" height="2" fill="#c0392b"/>'),
        ('crown', '왕관', '<path d="M15 10 L17 2 L21 7 L24 1 L27 7 L31 2 L33 10 Z" fill="#ffd23f" stroke="#b8860b" stroke-width=".8"/><circle cx="24" cy="6" r="1.3" fill="#e0483a"/>'),
        ('cap', '야구모자', '<path d="M14 11 Q14 3 24 3 Q34 3 34 11 Z" fill="#2f6bd8"/><rect x="24" y="9.5" width="14" height="2.5" rx="1.2" fill="#1f4fa8"/>'),
        ('flowercrown', '꽃관', ''.join(f'<circle cx="{x}" cy="9" r="2.6" fill="{c}"/>' for x, c in [(15, '#ff6fa1'), (20, '#ffd23f'), (24, '#ff8a4f'), (28, '#c26bff'), (33, '#ff6fa1')])),
        ('beanie', '비니', '<path d="M14 12 Q14 2 24 2 Q34 2 34 12 Z" fill="#e0483a"/><rect x="13" y="10" width="22" height="3" rx="1.5" fill="#b8302a"/><circle cx="24" cy="2" r="2.5" fill="#ffffff"/>'),
        ('helmet', '안전모', '<path d="M13 12 Q13 2 24 2 Q35 2 35 12 Z" fill="#ffcc3f"/><rect x="11" y="11" width="26" height="2.5" rx="1.2" fill="#e6a800"/>'),
        ('chef', '요리사 모자', '<rect x="17" y="6" width="14" height="6" fill="#ffffff" stroke="#ccc" stroke-width=".6"/><circle cx="19" cy="5" r="4" fill="#fff"/><circle cx="24" cy="3.5" r="4.5" fill="#fff"/><circle cx="29" cy="5" r="4" fill="#fff"/>'),
        ('pilot', '기장 모자', '<rect x="14" y="5" width="20" height="6" rx="2" fill="#1d2b4a"/><rect x="13" y="10" width="22" height="2.5" rx="1" fill="#111"/><circle cx="24" cy="8" r="1.6" fill="#ffd23f"/>'),
    ],
    'glasses': [
        ('round', '동그란 안경', '<circle cx="20" cy="19" r="3.4" fill="none" stroke="#222" stroke-width="1.1"/><circle cx="28" cy="19" r="3.4" fill="none" stroke="#222" stroke-width="1.1"/><path d="M23.4 19 h1.2" stroke="#222"/>'),
        ('sun', '선글라스', '<rect x="15.5" y="16.5" width="7.5" height="5" rx="2" fill="#111"/><rect x="25" y="16.5" width="7.5" height="5" rx="2" fill="#111"/><path d="M23 18 h2" stroke="#111"/>'),
        ('heart', '하트 안경', '<path d="M19.5 22 l-3.5-3.5 a2 2 0 0 1 3.5-2 a2 2 0 0 1 3.5 2 Z" fill="#ff3f7a"/><path d="M28.5 22 l-3.5-3.5 a2 2 0 0 1 3.5-2 a2 2 0 0 1 3.5 2 Z" fill="#ff3f7a"/>'),
        ('visor', '사이버 바이저', '<rect x="14" y="16" width="20" height="5" rx="2.5" fill="#7cf3ff" opacity=".85"/>'),
        ('monocle', '외눈 안경', '<circle cx="28" cy="19" r="3.6" fill="none" stroke="#b8860b" stroke-width="1.2"/><path d="M31 21 L33 30" stroke="#b8860b" stroke-width=".8"/>'),
        ('goggle', '물안경', '<rect x="15" y="16" width="18" height="6" rx="3" fill="#3fc8d8" opacity=".75" stroke="#1f6f7a"/>'),
    ],
    'outfit': [
        ('apron', '꽃집 앞치마', '<path d="M17 30 h14 v14 h-14 Z" fill="#3f7d4e"/><rect x="21" y="35" width="6" height="4" rx="1" fill="#2c5a37"/>'),
        ('suit', '정장', '<path d="M15 30 h18 v14 h-18 Z" fill="#2b3142"/><path d="M24 30 L21 36 L24 44 L27 36 Z" fill="#fff"/><path d="M24 31 l-1 4 l1 3 l1 -3 Z" fill="#c0392b"/>'),
        ('hoodie', '후드티', '<path d="M15 30 h18 v14 h-18 Z" fill="#8e5bd8"/><path d="M19 30 Q24 34 29 30" stroke="#6b3fb0" stroke-width="2" fill="none"/>'),
        ('vest', '형광 조끼', '<path d="M15 30 h18 v14 h-18 Z" fill="#c6ff3f"/><rect x="15" y="37" width="18" height="2" fill="#cfd5dc"/>'),
        ('hanbok', '한복', '<path d="M15 30 h18 v14 h-18 Z" fill="#ff6f91"/><path d="M15 30 L24 37 L33 30" fill="#ffd23f"/><path d="M24 37 L27 43" stroke="#c0392b" stroke-width="1.5"/>'),
        ('spacesuit', '우주복', '<path d="M14 30 h20 v14 h-20 Z" fill="#e8ecf4"/><rect x="20" y="34" width="8" height="5" rx="1" fill="#3f8cff"/>'),
        ('overall', '작업복', '<path d="M15 30 h18 v14 h-18 Z" fill="#3f6fb0"/><rect x="18" y="30" width="2" height="6" fill="#ffd23f"/><rect x="28" y="30" width="2" height="6" fill="#ffd23f"/>'),
    ],
    'desk': [
        ('vase', '꽃병', '<rect x="38" y="38" width="6" height="8" rx="2" fill="#7fb2e0"/><circle cx="39" cy="35" r="2.4" fill="#ff6fa1"/><circle cx="43" cy="34" r="2.4" fill="#ffd23f"/><circle cx="41" cy="31.5" r="2.4" fill="#c26bff"/>'),
        ('coffee', '커피잔', '<rect x="38" y="39" width="6" height="7" rx="1.5" fill="#ffffff" stroke="#aaa" stroke-width=".6"/><path d="M44 41 q2.5 1.5 0 3" stroke="#aaa" fill="none"/><path d="M40 36 q1 -2 0 -3 M42 36 q1 -2 0 -3" stroke="#bbb" stroke-width=".7" fill="none"/>'),
        ('plant', '다육이', '<rect x="38" y="41" width="7" height="5" rx="1" fill="#c46b1f"/><ellipse cx="41.5" cy="39" rx="3" ry="3.5" fill="#5fae5a"/>'),
        ('calc', '계산기', '<rect x="37" y="36" width="8" height="10" rx="1.2" fill="#3a4158"/><rect x="38.2" y="37.2" width="5.6" height="2.4" fill="#b9f5cf"/>'),
        ('globe', '지구본', '<circle cx="41" cy="38" r="4.5" fill="#3f8cff"/><path d="M38 36 q3 1 2 4 q3 0 4 -2" fill="#3fbf7f"/><rect x="40" y="43" width="2" height="3" fill="#777"/>'),
        ('box', '택배상자', '<rect x="37" y="38" width="9" height="8" fill="#c99a5b"/><rect x="37" y="38" width="9" height="2" fill="#a97a3b"/><rect x="40.5" y="38" width="2" height="8" fill="#e8d3a8"/>'),
        ('trophy', '트로피', '<path d="M38 33 h7 v4 a3.5 3.5 0 0 1 -7 0 Z" fill="#ffd23f"/><rect x="40.5" y="40" width="2" height="3" fill="#e6a800"/><rect x="38.5" y="43" width="6" height="2.5" fill="#8d6b00"/>'),
    ],
    'pet': [
        ('kitten', '아기 고양이', '<path d="M3 38 l1.5 -4 l2 3 l2 -3 l1.5 4 Z" fill="#888"/><ellipse cx="6.5" cy="42" rx="4.5" ry="4" fill="#888"/><circle cx="5" cy="40" r=".7" fill="#111"/><circle cx="8" cy="40" r=".7" fill="#111"/>'),
        ('puppy', '아기 강아지', '<ellipse cx="6.5" cy="42" rx="4.5" ry="4" fill="#d9b48a"/><ellipse cx="2.8" cy="40" rx="1.5" ry="3" fill="#7a5232"/><ellipse cx="10.2" cy="40" rx="1.5" ry="3" fill="#7a5232"/><circle cx="6.5" cy="43" r=".9" fill="#111"/>'),
        ('bee', '꿀벌', '<ellipse cx="6" cy="38" rx="4" ry="3" fill="#ffd23f"/><rect x="5" y="35" width="1.4" height="6" fill="#111"/><ellipse cx="5" cy="34.5" rx="2" ry="1.4" fill="#cfefff" opacity=".9"/>'),
        ('butterfly', '나비', '<path d="M6 38 q-5 -5 -4 1 q1 3 4 -1 q5 -5 4 1 q-1 3 -4 -1" fill="#c26bff"/>'),
        ('chick', '병아리', '<circle cx="6.5" cy="42" r="4" fill="#ffe14f"/><path d="M10 42 l2 .8 l-2 .8 Z" fill="#ff8a1f"/><circle cx="7.5" cy="41" r=".7" fill="#111"/>'),
        ('fish', '어항 물고기', '<rect x="1" y="36" width="11" height="10" rx="3" fill="#bfe6ff" opacity=".8"/><path d="M4 41 q3 -3 6 0 q-3 3 -6 0 l-2 -2 v4 Z" fill="#ff8a4f"/>'),
    ],
    'badge': [
        ('star', '별 배지', '<path d="M30 33 l1.2 2.5 l2.7 .4 l-2 1.9 l.5 2.7 l-2.4 -1.3 l-2.4 1.3 l.5 -2.7 l-2 -1.9 l2.7 -.4 Z" fill="#ffd23f" stroke="#b8860b" stroke-width=".4"/>'),
        ('rose', '장미 배지', '<circle cx="30" cy="36" r="3" fill="#e0483a"/><path d="M28.5 36 q1.5 -2 3 0" stroke="#8a1f15" fill="none" stroke-width=".6"/>'),
        ('mvp', 'MVP 배지', '<rect x="26.5" y="33.5" width="7" height="5" rx="1" fill="#8e5bd8"/><text x="30" y="37.4" font-size="3.2" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="bold">MVP</text>'),
        ('heart', '하트 배지', '<path d="M30 39 l-3 -3 a1.8 1.8 0 0 1 3 -2 a1.8 1.8 0 0 1 3 2 Z" fill="#ff3f7a"/>'),
        ('flagco', '콜롬비아', '<rect x="26.5" y="33.5" width="7" height="5" fill="#ffd23f"/><rect x="26.5" y="36" width="7" height="1.25" fill="#2f4fb0"/><rect x="26.5" y="37.25" width="7" height="1.25" fill="#d0312d"/>'),
        ('flagnl', '네덜란드', '<rect x="26.5" y="33.5" width="7" height="1.7" fill="#ae1c28"/><rect x="26.5" y="35.2" width="7" height="1.6" fill="#fff"/><rect x="26.5" y="36.8" width="7" height="1.7" fill="#21468b"/>'),
        ('flagcn', '중국', '<rect x="26.5" y="33.5" width="7" height="5" fill="#de2910"/><circle cx="28" cy="35" r=".9" fill="#ffde00"/>'),
    ],
}
CATEGORY_LABEL = {'hat': '모자', 'glasses': '안경', 'outfit': '옷', 'desk': '책상 소품', 'pet': '펫', 'badge': '배지'}


def stage_icon_svg(t, i, glyph):
    color = t['accent']
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="8" fill="{t["surface"]}" stroke="{color}" stroke-width="2"/>'
            f'<text x="16" y="22" font-size="16" text-anchor="middle" font-family="Segoe UI Emoji,Apple Color Emoji,Noto Color Emoji,sans-serif" fill="{t["ink"]}">{glyph}</text></svg>')


def floor_svg(t, i):
    c = t['floors'][i]
    tid = t['id']
    if tid in ('greenhouse', 'market'):
        deco = ''.join(f'<circle cx="{x}" cy="{y}" r="1.6" fill="{t["accent"]}" opacity=".18"/>' for x, y in [(6, 6), (18, 14), (10, 22)])
    elif tid == 'harbor':
        deco = '<path d="M0 4 H24 M0 12 H24 M0 20 H24" stroke="#000" stroke-opacity=".18" stroke-width="2"/>'
    elif tid in ('space', 'cyber'):
        deco = '<circle cx="5" cy="7" r=".7" fill="#fff" opacity=".6"/><circle cx="17" cy="19" r=".5" fill="#fff" opacity=".5"/><path d="M0 23.5 H24" stroke="' + t['accent'] + '" stroke-opacity=".25"/>'
    elif tid == 'rpg':
        deco = '<rect x="0" y="0" width="12" height="12" fill="#000" opacity=".08"/><rect x="12" y="12" width="12" height="12" fill="#000" opacity=".08"/>'
    else:
        deco = '<path d="M0 0 H24 V24" fill="none" stroke="#000" stroke-opacity=".06"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="{c}"/>{deco}</svg>'


def bg_svg(t):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="{t["bg"]}"/>'
            f'<text x="16" y="24" font-size="12" opacity=".10" font-family="Segoe UI Emoji,Apple Color Emoji,Noto Color Emoji,sans-serif">{t["emoji"]}</text>'
            f'<text x="44" y="56" font-size="10" opacity=".07" font-family="Segoe UI Emoji,Apple Color Emoji,Noto Color Emoji,sans-serif">{t["token"]}</text></svg>')


HF_USED = []
HF_SOURCE = {'tool': 'Higgsfield 웹(사장님 계정) · Nano Banana 2 1K · 2026-11-03', 'prompts': 'docs/pm-theme-brainstorm.md Higgsfield 생성 절', 'postprocess': '배경 제거·자르기 = ~/nenova-pm/hf-raw/slice.py'}


def write(rel, text):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    # Higgsfield 생성본(webp, scripts/pm-themes/README 참고)이 같은 이름으로 있으면 그것을 쓴다. SVG 는 폴백으로 남긴다.
    webp = os.path.splitext(rel)[0] + '.webp'
    if os.path.exists(os.path.join(ROOT, webp)):
        HF_USED.append(webp)
        rel = webp
    return '/pm-themes/' + rel.replace(os.sep, '/')


def main():
    manifest = {'version': 1, 'generatedBy': 'scripts/pm-themes/gen_assets.py', 'license': '자체 제작(네노바 내부 사용) · 이모지 글리프는 OS 시스템 폰트로 렌더',
                'source': 'code-generated SVG (Higgsfield MCP 생성 도구 미노출로 대체)', 'states': STATES, 'themes': [], 'characters': [], 'items': []}
    manifest['rarityPrice'] = RARITY_PRICE
    manifest['themes'].append({'id': 'office', 'name': '사무실(기본)', 'emoji': '🏢', 'default': True, 'rarity': 'basic', 'price': 0})
    for t in THEMES:
        entry = {k: t[k] for k in ('id', 'name', 'emoji', 'bg', 'surface', 'ink', 'muted', 'accent', 'line', 'plate', 'plateInk', 'token', 'hall')}
        entry['light'] = bool(t.get('light'))
        entry['rarity'] = THEME_RARITY[t['id']]; entry['price'] = RARITY_PRICE[entry['rarity']]
        entry['background'] = write(f'{t["id"]}/bg.svg', bg_svg(t))
        entry['stageIcons'] = [write(f'{t["id"]}/stage-{i + 1}.svg', stage_icon_svg(t, i, g)) for i, g in enumerate(t['icons'])]
        entry['stageNames'] = STAGES
        entry['depts'] = {d: {'floor': write(f'{t["id"]}/dept-{i + 1}.svg', floor_svg(t, i)), 'label': t['deptNames'][i]} for i, d in enumerate(DEPTS)}
        entry['prompt'] = f'{t["name"]} 콘셉트 — 9단계 {t["hall"]}, 부서={",".join(t["deptNames"])}, 흐름 토큰 {t["token"]}'
        manifest['themes'].append(entry)
    for cid, name, fur, kind, feat in CHARACTERS:
        manifest['characters'].append({'id': cid, 'name': name, 'src': write(f'characters/{cid}.svg', character_svg(cid, fur, kind, feat)),
                                       'animations': {s: f'css:pmc-{s}' for s in STATES},
                                       'rarity': CHAR_RARITY[cid], 'price': RARITY_PRICE[CHAR_RARITY[cid]]})
    for cat, lst in ITEMS.items():
        for iid, name, body in lst:
            rid = f'{cat}.{iid}'
            rar = 'legendary' if rid in LEGENDARY_ITEMS else 'rare' if rid in RARE_ITEMS else 'common'
            manifest['items'].append({'rarity': rar, 'price': RARITY_PRICE[rar], 'id': f'{cat}.{iid}', 'category': cat, 'categoryLabel': CATEGORY_LABEL[cat], 'name': name,
                                      'src': write(f'items/{cat}/{iid}.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">{body}</svg>')})
    manifest['higgsfield'] = {**HF_SOURCE, 'files': len(HF_USED)}
    manifest['source'] = f'Higgsfield 생성 webp {len(HF_USED)}개 + 나머지 code-generated SVG'
    write('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
    print(len(manifest['themes']), 'themes', len(manifest['characters']), 'chars', len(manifest['items']), 'items')


if __name__ == '__main__':
    main()
