# scripts/pm-char/spec.py — /pm 캐릭터 v2 아이템 사양(블렌더 렌더 build.py 와 후처리 post.py 가 같이 씀)
# 모든 착용 아이템은 같은 리그(베이스 바디)·같은 카메라로 렌더 → 정합 보장. 좌표 단위 = 블렌더 m(발=z0, 정면=-Y).
# 색은 sRGB hex. 테마 A~J = lib/pmThemes 와 같은 id.

BODIES = {'slim': 0.86, 'std': 1.0, 'round': 1.22}          # 몸통 폭 배수(키·머리 위치는 공통 → 머리 아이템은 체형 무관)
SKINS = ['#ffe0c7', '#f3c7a0', '#d9a074', '#9c6b48']          # 후처리 곱하기 틴트
HAIRS = ['short', 'bob', 'long', 'bun']
HAIR_COLORS = ['#2b2220', '#6b4630', '#c98f4a', '#e6c87a', '#9a7bd1']
KINDS = ['human', 'cat', 'dog', 'bunny', 'bear', 'fox', 'penguin', 'fairy', 'robot', 'cactus']  # 기존 char id 유지(구매 호환)

# 옷 = 상의+하의 세트(slot outfit). shape: top(sweater/hoodie/jacket/jeogori/apron/tee/smock/suit/aloha/puffer/vest/overall)
OUTFITS = [
    # id, 이름, 테마, top색, 하의색, 상의형, 하의형, 포인트색
    ('outfit.knit', '원목 니트', 'A', '#b5733f', '#e8d6b8', 'sweater', 'pants', '#f4e3c1'),
    ('outfit.hoodie', '파스텔 후드', 'B', '#f7b6cf', '#a8e2d0', 'hoodie', 'shorts', '#ffffff'),
    ('outfit.neon', '네온 재킷', 'C', '#22233a', '#14141f', 'jacket', 'pants', '#33f0ff'),
    ('outfit.hanbok', '한복', 'D', '#f2f0e6', '#3d5aa8', 'jeogori', 'wide', '#d23b4a'),
    ('outfit.apron', '꽃집 앞치마', 'E', '#ffffff', '#7a5a3a', 'apron', 'pants', '#5aa457'),
    ('outfit.pixel', '8비트 티', 'F', '#e2413b', '#3a5bd6', 'tee', 'pants', '#ffd23a'),
    ('outfit.smock', '화가 스목', 'G', '#bcd8ee', '#fbfbf7', 'smock', 'pants', '#f19bb0'),
    ('outfit.spacesuit', '우주복', 'H', '#f1f3f6', '#e4e8ee', 'suit', 'pants', '#ff7a2f'),
    ('outfit.aloha', '알로하 셔츠', 'I', '#ff9a3c', '#3ab0c8', 'aloha', 'shorts', '#ffe36b'),
    ('outfit.puffer', '패딩', 'J', '#3c7fd8', '#33415c', 'puffer', 'pants', '#ffffff'),
    # 기존 상점 id(구매 호환) — 새 리그로 다시 렌더
    ('outfit.suit', '정장', 'A', '#2d3446', '#2d3446', 'jacket', 'pants', '#ffffff'),
    ('outfit.vest', '형광 조끼', 'E', '#9aa3ad', '#4a5260', 'vest', 'pants', '#d6ff3a'),
    ('outfit.overall', '작업복', 'E', '#f3efe4', '#4a78b8', 'overall', 'pants', '#4a78b8'),
]
HATS = [
    ('hat.beret', '베레모', 'A', '#8a4b2a', 'beret'),
    ('hat.ribbon', '리본 머리띠', 'B', '#f39ac0', 'ribbon'),
    ('hat.visorneon', '네온 바이저', 'C', '#33f0ff', 'visor'),
    ('hat.gat', '갓', 'D', '#1c1c1e', 'gat'),
    ('hat.straw', '밀짚모자', 'E', '#e8c26a', 'straw'),
    ('hat.pixelcrown', '픽셀 왕관', 'F', '#ffd23a', 'pixelcrown'),
    ('hat.painter', '화가 모자', 'G', '#5b7fd1', 'beret'),
    ('hat.spacehelmet', '우주 헬멧', 'H', '#dfe6ef', 'bubble'),
    ('hat.sunvisor', '썬캡', 'I', '#ffffff', 'sunvisor'),
    ('hat.beanie', '비니', 'J', '#d84a4a', 'beanie'),
    ('hat.crown', '왕관', '', '#f2c23a', 'crown'),
    ('hat.cap', '야구모자', '', '#3a6fd8', 'cap'),
    ('hat.flowercrown', '꽃관', 'E', '#f58fb0', 'flowercrown'),
    ('hat.helmet', '안전모', '', '#ffcc2a', 'hardhat'),
    ('hat.chef', '요리사 모자', '', '#ffffff', 'chef'),
    ('hat.pilot', '기장 모자', '', '#26314d', 'pilot'),
]
GLASSES = [
    ('glasses.round', '동그란 안경', '#3a2a20', 'round'),
    ('glasses.sun', '선글라스', '#151515', 'sun'),
    ('glasses.heart', '하트 안경', '#ff4f8b', 'heart'),
    ('glasses.visor', '사이버 바이저', '#33f0ff', 'visor'),
    ('glasses.monocle', '외눈 안경', '#c9a23a', 'monocle'),
    ('glasses.goggle', '물안경', '#3ab0c8', 'goggle'),
]
HANDS = [  # 손에 드는 소품(slot hand)
    ('hand.mug', '원목 머그', 'A', '#c98a55', 'mug'),
    ('hand.balloon', '파스텔 풍선', 'B', '#bfa8f0', 'balloon'),
    ('hand.glowstick', '야광봉', 'C', '#ff4fd8', 'stick'),
    ('hand.fan', '태극 부채', 'D', '#d23b4a', 'fan'),
    ('hand.wateringcan', '물뿌리개', 'E', '#5aa457', 'can'),
    ('hand.joystick', '조이스틱', 'F', '#e2413b', 'joystick'),
    ('hand.brush', '붓', 'G', '#f19bb0', 'brush'),
    ('hand.flag', '우주 깃발', 'H', '#ff7a2f', 'flag'),
    ('hand.icecream', '아이스크림', 'I', '#ffc0d8', 'icecream'),
    ('hand.cocoa', '코코아', 'J', '#ffffff', 'mug'),
]
BADGES = [
    ('badge.star', '별 배지', '#ffd23a', 'star'), ('badge.rose', '장미 배지', '#e0405a', 'dot'), ('badge.mvp', 'MVP 배지', '#f2c23a', 'medal'),
    ('badge.heart', '하트 배지', '#ff4f8b', 'heart'), ('badge.flagco', '콜롬비아', '#fcd116', 'flag3'), ('badge.flagnl', '네덜란드', '#ae1c28', 'flag3'), ('badge.flagcn', '중국', '#de2910', 'dot'),
]
# 자리(책상 세트) — 같은 카메라, 책상 앵커 기준
DESKS = [
    ('desk.wood', '원목 책상', 'A', '#b07a4a'), ('desk.pastel', '파스텔 책상', 'B', '#f6c9dc'), ('desk.neon', '네온 책상', 'C', '#2a2b45'),
    ('desk.soban', '소반 책상', 'D', '#7a3b22'), ('desk.greenhouse', '온실 작업대', 'E', '#7fae6a'), ('desk.arcade', '오락실 책상', 'F', '#3a3fb8'),
    ('desk.easel', '화실 책상', 'G', '#e9dcc6'), ('desk.console', '우주 콘솔', 'H', '#cfd6e0'), ('desk.bamboo', '대나무 책상', 'I', '#d8b46a'),
    ('desk.snow', '눈마을 책상', 'J', '#9fc3e6'),
]
DESKTOP = [  # 상판 소품(slot deskL/deskM/deskR 아무 데나). 기존 desk.* 소품 id 는 desktop 로 이동(마이그레이션)
    ('top.plant', '화분', 'E', '#5aa457', 'plant'), ('top.mug', '머그컵', 'A', '#c98a55', 'mug'), ('top.lamp', '스탠드', 'C', '#33f0ff', 'lamp'),
    ('top.frame', '액자', 'G', '#e8c26a', 'frame'), ('top.keyboard', '키보드', 'F', '#3a3fb8', 'keyboard'), ('top.snowglobe', '스노볼', 'J', '#cfe8ff', 'globe'),
    ('top.vase', '꽃병', 'B', '#f39ac0', 'vase'), ('top.coffee', '커피잔', 'A', '#ffffff', 'mug'), ('top.cactus', '다육이', 'E', '#7fb36a', 'plant'),
    ('top.calc', '계산기', '', '#4a5260', 'calc'), ('top.globe', '지구본', '', '#3ab0c8', 'globe'), ('top.box', '택배상자', '', '#c9965a', 'box'),
    ('top.trophy', '트로피', '', '#f2c23a', 'trophy'), ('top.monitor', '모니터', 'H', '#26314d', 'monitor'), ('top.shell', '조개 장식', 'I', '#ffd9c4', 'shell'),
    ('top.inkstone', '벼루', 'D', '#2b2b2b', 'box'),
]
FLOORS = [  # slot rug / chair / shelf
    ('rug.wood', '체크 러그', 'A', '#d9a46a', 'rug'), ('rug.pastel', '구름 러그', 'B', '#cdb8f0', 'rug'), ('rug.neon', '네온 러그', 'C', '#ff4fd8', 'rug'),
    ('rug.hwamunseok', '화문석', 'D', '#e5cf94', 'rug'), ('rug.beach', '비치 타월', 'I', '#3ab0c8', 'rug'), ('rug.snow', '털 러그', 'J', '#f4f6fa', 'rug'),
    ('chair.wood', '원목 의자', 'A', '#9b6a3f', 'chair'), ('chair.gaming', '게이밍 의자', 'C', '#22233a', 'chair'), ('chair.pastel', '푸딩 의자', 'B', '#f7b6cf', 'chair'),
    ('chair.cushion', '방석', 'D', '#c33a3a', 'cushion'), ('chair.beach', '비치 의자', 'I', '#ff9a3c', 'chair'),
    ('shelf.book', '책장', 'A', '#9b6a3f', 'shelf'), ('shelf.plant', '화분 선반', 'E', '#7fae6a', 'shelf'), ('shelf.arcade', '오락기', 'F', '#3a3fb8', 'arcade'),
    ('shelf.potplant', '큰 화분', 'E', '#5aa457', 'bigplant'),
]
PETS = [  # slot pet(바닥 옆자리) — 2프레임 idle
    ('pet.puppy', '아기 강아지', '#e6b47a', 'dog'), ('pet.kitten', '아기 고양이', '#f0a34e', 'cat'), ('pet.bunny', '아기 토끼', '#ffffff', 'bunny'),
    ('pet.chick', '병아리', '#ffd84a', 'chick'), ('pet.bee', '꿀벌', '#ffd23a', 'bee'), ('pet.butterfly', '나비', '#9a7bd1', 'butterfly'),
    ('pet.fish', '어항 물고기', '#ff8a3a', 'fish'), ('pet.hamster', '햄스터', '#e8b98a', 'hamster'), ('pet.penguin', '아기 펭귄', '#2b2f3a', 'penguin'),
    ('pet.turtle', '거북이', '#6aa457', 'turtle'),
]
