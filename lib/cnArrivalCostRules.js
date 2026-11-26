// 중국 도착원가 41순위 결정론적 품목·카테고리 매처 (CLOUD 항공 / HUBFRESH 해상 공통).
// 근거: cn-category-matching-audit.json part3 orderedRules, cn-hubfresh-final-formulas.json 34종 해상 규격표,
// cn-ground-truth-formulas.json 22종 항공 CBM표. 오염된 Product.FlowerName·TariffRate·BoxQuantity는 입력으로 쓰지 않는다.

export const CN_MODES = Object.freeze({ CLOUD: 'CLOUD', HUBFRESH: 'HUBFRESH' });
export const CN_TARIFFS = Object.freeze({ CUT: 0.214, FOLIAGE: 0.032, PRESERVED: 0.25 });

const box = (l, w, h) => [l, w, h];
// air: { bunches, box:[cm] | fixedKg, weightKg(실중량/단, GW=CW 중량배분용) }
// sea: { bunches, box:[cm], boxCbm(m3) } — 박스비(단)는 항상 박스단가 ÷ 박스당단수로 계산한다.
const RULES = [
  { code: 'ASPARAGUS_PRESERVED', label: '아스파라거스 프리저브드', tariff: 0.25,
    test: t => /(아스파라|비짜루|미디오|asparagus)/i.test(t) && /(preserved|프리저브드|\bdry\b|건조)/i.test(t),
    air: { bunches: 25, box: box(100, 30, 20), weightKg: 0.2 }, sea: { bunches: 25, box: box(100, 30, 20), boxCbm: 0.06 } },
  { code: 'AMARANTHUS_PRESERVED', label: '아마란스 프리저브드', tariff: 0.25,
    test: t => /(아마란스|줄맨드라미|amaranthus)/i.test(t) && /(preserved|프리저브드|\bdry\b|건조)/i.test(t),
    air: { bunches: 20, box: box(100, 30, 20), weightKg: 0.5 }, sea: { bunches: 20, box: box(98, 36, 16), boxCbm: 0.056448 } },
  { code: 'AMARANTHUS_FRESH', label: '아마란스 생화', tariff: 0.214, pattern: /아마란스|줄맨드라미|amaranthus/i,
    air: { bunches: 20, box: box(100, 30, 20), weightKg: 0.5 }, sea: { bunches: 20, box: box(98, 36, 16), boxCbm: 0.056448 } },
  { code: 'BLUE_STAR_FERN', label: '블루스타펀', tariff: 0.032, pattern: /블루\s*스타\s*펀|blue\s*star\s*fern|phlebodium/i,
    air: { bunches: 30, box: box(100, 40, 20), weightKg: 0.3 }, sea: { bunches: 30, box: box(100, 40, 20), boxCbm: 0.08 } },
  { code: 'EUCALYPTUS_SEEDS', label: '유칼립 시드·다이브', tariff: 0.032,
    test: t => /\bseeds?\b|시드|다이브|exotica\s*berry|with\s*fruit/i.test(t) && !/populus\s*grain|포퓰러스\s*그레인|포플러스\s*그레인/i.test(t),
    air: { bunches: 15, fixedKg: 15, weightKg: 1 }, sea: { bunches: 15, box: box(119, 39, 30), boxCbm: 0.13923 } },
  { code: 'POPULUS', label: '포퓰러스 그레인(열매유카리)', tariff: 0.032, pattern: /포퓰러스|포플러스|포플러|호랑이눈|열매\s*유카리|populus/i,
    air: { bunches: 15, fixedKg: 15, weightKg: 1 }, sea: { bunches: 15, box: box(110, 42, 30), boxCbm: 0.1386 } },
  { code: 'EUCALYPTUS_CINEREA', label: '유칼립 시네리아', tariff: 0.032, pattern: /시네리아|cinerea/i,
    air: { bunches: 10, fixedKg: 15, weightKg: 1.1 }, sea: { bunches: 10, box: box(130, 38, 20), boxCbm: 0.0988 } },
  { code: 'EUCALYPTUS_BLACKJACK_300G', label: '블랙잭 300g(미니)', tariff: 0.032,
    test: t => /(블랙잭|베이비\s*블루|baby\s*blue)/i.test(t) && /(300\s*g|미니|\bmini\b)/i.test(t),
    air: { bunches: 20, box: box(100, 42, 20), weightKg: 0.3 }, sea: { bunches: 20, box: box(100, 42, 20), boxCbm: 0.084 } },
  { code: 'EUCALYPTUS_BLACKJACK_600G', label: '블랙잭 600g(소)', tariff: 0.032,
    test: t => /(블랙잭|베이비\s*블루|baby\s*blue)/i.test(t) && /(600\s*g|\(소\)|\bsmall\b)/i.test(t),
    air: { bunches: 20, box: box(119, 39, 30), weightKg: 0.6 }, sea: { bunches: 20, box: box(119, 39, 30), boxCbm: 0.13923 } },
  { code: 'EUCALYPTUS_STANDARD_1KG', label: '유칼립·블랙잭 1kg', tariff: 0.032, pattern: /블랙잭|베이비\s*블루|baby\s*blue|유칼립|유칼리|eucalyptu|폴리안|니콜|파블로|은엽/i,
    air: { bunches: 10, fixedKg: 15, weightKg: 1.1 }, sea: { bunches: 10, box: box(119, 39, 30), boxCbm: 0.13923 } },
  { code: 'CHASMANTHIUM', label: '보리사초', tariff: 0.032, pattern: /보리사초|chasmanthium/i,
    air: { bunches: 30, box: box(95, 25, 12), weightKg: 0.3 }, sea: { bunches: 30, box: box(95, 25, 12), boxCbm: 0.0285 } },
  { code: 'PANICUM', label: '패니쿰', tariff: 0.032, pattern: /패니쿰|파니쿰|panicum/i,
    air: { bunches: 30, box: box(95, 25, 12), weightKg: 0.3 }, sea: { bunches: 30, box: box(95, 25, 12), boxCbm: 0.0285 } },
  { code: 'PHYLICA', label: '필리카', tariff: 0.032, pattern: /필리카|phylica/i,
    air: { bunches: 20, box: box(100, 40, 20), weightKg: 0.5 }, sea: { bunches: 20, box: box(100, 40, 20), boxCbm: 0.08 } },
  { code: 'KOCHIA', label: '코치아', tariff: 0.214, seaTariff: 0.032, pattern: /코치아|댑싸리|kochia/i,
    air: { bunches: 10, box: box(100, 40, 20), weightKg: 0.7 }, sea: { bunches: 20, box: box(100, 40, 24), boxCbm: 0.096 } },
  { code: 'ASPARAGUS_FRESH', label: '아스파라거스(비짜루) 생화', tariff: 0.032, pattern: /비짜루|아스파라|asparagus/i,
    air: { bunches: 25, box: box(100, 30, 20), weightKg: 0.2 }, sea: { bunches: 25, box: box(100, 30, 20), boxCbm: 0.06 } },
  { code: 'GOLDEN_WATREE_ACACIA', label: '골든와트리·아카시아(미모사)', tariff: 0.214, pattern: /골든\s*와트리|golden\s*wat(?:ree|tle)|미모사|mimosa|아카시아|aca[cs]ia/i,
    air: { bunches: 10, box: box(100, 30, 20), weightKg: 0.5 }, sea: { bunches: 15, box: box(100, 40, 24), boxCbm: 0.096 } },
  { code: 'SINENSIS', label: '리모늄 시네신스', tariff: 0.214, pattern: /시네신스|시넨시스|sinensis/i,
    air: { bunches: 20, box: box(100, 40, 24), weightKg: 0.5 }, sea: { bunches: 20, box: box(100, 40, 20), boxCbm: 0.08 } },
  { code: 'LIMONIUM_MISTY', label: '리모늄 미스티블루', tariff: 0.214, pattern: /미스티\s*블루|misty\s*blue|limonium\s*blue/i,
    air: { bunches: 20, box: box(100, 40, 20), weightKg: 0.5 }, sea: { bunches: 20, box: box(100, 40, 24), boxCbm: 0.096 } },
  { code: 'STATICE_LIMONIUM', label: '스타티스·리모늄', tariff: 0.214, pattern: /스타티스|statice|리모늄|리모니움|limonium/i,
    air: { bunches: 20, box: box(100, 40, 24), weightKg: 0.5 }, sea: { bunches: 20, box: box(100, 40, 24), boxCbm: 0.096 } },
  { code: 'ROSE_PETAL', label: '장미 꽃잎용(40cm)', tariff: 0.214, pattern: /꽃잎용|petal\s*use/i,
    air: { bunches: 20, box: box(100, 30, 20), weightKg: 0.45 }, sea: { bunches: 20, box: box(100, 30, 20), boxCbm: 0.06 } },
  { code: 'SPRAY_ROSE', label: '스프레이 장미', tariff: 0.214, pattern: /스프레이\s*장미|장미\s*스프레이|spray[\s-]*rose/i,
    air: { bunches: 10, box: box(100, 40, 20), weightKg: 0.8 }, sea: { bunches: 10, box: box(100, 30, 20), boxCbm: 0.06 } },
  { code: 'ROSE', label: '장미', tariff: 0.214, pattern: /장미|\brose\b|^ros\s+china/i,
    air: { bunches: 10, box: box(100, 40, 20), weightKg: 0.8 }, sea: { bunches: 10, box: box(100, 30, 20), boxCbm: 0.06 } },
  { code: 'SPRAY_CARNATION', label: '카네이션 스프레이', tariff: 0.214, pattern: /스프레이\s*카네이션|카네이션\s*스프레이|spray[\s-]*carnation|솔로미오|solomio/i,
    air: { bunches: 15, box: box(98, 38, 16), weightKg: 0.73 }, sea: { bunches: 15, box: box(98, 36, 16), boxCbm: 0.056448 } },
  { code: 'CARNATION', label: '카네이션 스탠다드', tariff: 0.214, pattern: /카네이션|\bcarnation\b/i,
    air: { bunches: 15, box: box(98, 38, 16), weightKg: 0.73 }, sea: { bunches: 15, box: box(98, 36, 16), boxCbm: 0.056448 } },
  { code: 'ORCHID', label: '호접란(허가증 대상)', tariff: 0.214, orchid: true, pattern: /호접|심비디움|온시디움|orchid|phalaenopsis|cymbidium/i,
    air: { bunches: 10, box: box(100, 40, 10), weightKg: 0.1 }, sea: { bunches: 10, box: box(100, 40, 10), boxCbm: 0.04 } },
  { code: 'GYPSOPHILA', label: '안개꽃', tariff: 0.214, pattern: /안개|gypsophila/i,
    air: { bunches: 10, box: box(100, 40, 24), weightKg: 1 }, sea: { bunches: 10, box: box(100, 40, 24), boxCbm: 0.096 } },
  { code: 'WAXFLOWER', label: '왁스플라워', tariff: 0.214, pattern: /왁스|\bwax(?:\s*flower|\s*mix|\s*red|\s*white|\s*pink)?\b/i,
    air: { bunches: 10, box: box(100, 30, 20), weightKg: 0.5 }, sea: { bunches: 20, box: box(100, 40, 20), boxCbm: 0.08 } },
  { code: 'LISIANTHUS', label: '리시안셔스', tariff: 0.214, pattern: /리시안|lisianthus|eustoma|유스토마/i,
    air: { bunches: 10, box: box(100, 30, 20), weightKg: 0.5 }, sea: { bunches: 10, box: box(100, 40, 20), boxCbm: 0.08 } },
  { code: 'DELPHINIUM', label: '델피늄', tariff: 0.214, pattern: /델피늄|델피니움|delphinium/i,
    air: { bunches: 10, box: box(119, 39, 20), weightKg: 0.6 }, sea: { bunches: 10, box: box(110, 38, 20), boxCbm: 0.0836 } },
  { code: 'DAHLIA', label: '다알리아', tariff: 0.214, pattern: /다알리아|달리아|dahlia/i,
    air: { bunches: 10, box: box(100, 30, 20), weightKg: 0.5 }, sea: { bunches: 10, box: box(90, 28, 28), boxCbm: 0.07056 } },
  { code: 'DIDISCUS', label: '디디스커스', tariff: 0.214, pattern: /디디스커스|디디스|didiscus|didsicus/i,
    air: { bunches: 10, box: box(98, 30, 16), weightKg: 0.4 }, sea: { bunches: 10, box: box(98, 30, 16), boxCbm: 0.04704 } },
  { code: 'AMMI', label: '아미초', tariff: 0.214, pattern: /아미초|\bammi\b/i,
    air: { bunches: 10, box: box(98, 30, 16), weightKg: 0.4 }, sea: { bunches: 10, box: box(98, 30, 16), boxCbm: 0.04704 } },
  { code: 'RANUNCULUS', label: '라넌큘러스', tariff: 0.214, pattern: /라넌큘러스|라넌|라난|ranunculus/i,
    air: { bunches: 10, box: box(95, 25, 12), weightKg: 0.3 }, sea: { bunches: 10, box: box(98, 36, 16), boxCbm: 0.056448 } },
  { code: 'SCABIOSA', label: '스카비오사', tariff: 0.214, pattern: /스카비오사|스카비|scabiosa/i,
    air: { bunches: 10, box: box(100, 40, 20), weightKg: 0.5 }, sea: { bunches: 20, box: box(100, 40, 20), boxCbm: 0.08 } },
  { code: 'MARGUERITE', label: '마가렛', tariff: 0.214, pattern: /마가렛|marguerite/i,
    air: { bunches: 10, box: box(98, 30, 16), weightKg: 0.4 }, sea: { bunches: 10, box: box(98, 30, 16), boxCbm: 0.04704 } },
  { code: 'MATRICARIA', label: '마트리카리아(카모마일)', tariff: 0.214, pattern: /마트리카리아|matricaria|chamomilla|카모마일/i,
    air: { bunches: 20, box: box(90, 28, 28), weightKg: 0.5 }, sea: { bunches: 20, box: box(90, 28, 28), boxCbm: 0.07056 } },
  { code: 'PING_PONG', label: '퐁퐁(폼폰)', tariff: 0.214, pattern: /퐁퐁|폼폰|ping\s*pong|pong\s*pong|pompon/i,
    air: { bunches: 10, box: box(100, 40, 20), weightKg: 0.5 }, sea: { bunches: 10, box: box(100, 40, 20), boxCbm: 0.08 } },
  { code: 'VERONICA', label: '베로니카', tariff: 0.214, pattern: /베로니카|veronica/i,
    air: { bunches: 20, box: box(90, 28, 28), weightKg: 0.5 }, sea: { bunches: 20, box: box(90, 28, 28), boxCbm: 0.07056 } },
  { code: 'ORNITHOGALUM', label: '오니소갈룸', tariff: 0.214, pattern: /오니소갈룸|오니소|오니토|ornithogal+um/i,
    air: { bunches: 10, box: box(100, 30, 20), weightKg: 0.5 }, sea: { bunches: 10, box: box(100, 30, 20), boxCbm: 0.06 } },
  { code: 'LEGACY_AIR_FLOWERS', label: '구 항공 품종(수국·스토크·카라·거베라·안스리움) · 규격 확인', tariff: 0.214, needsReview: true,
    pattern: /수국|hydrangea|스토크|비단향꽃무|\bstock\b|matthiola|카라|\bcalla\b|거베라|gerbera|안스리움|anthurium/i,
    air: { bunches: 10, box: box(100, 40, 20), weightKg: 0.5 }, sea: { bunches: 10, box: box(100, 40, 20), boxCbm: 0.08 } },
];

// 드롭다운 전용 추가 규격(자동매칭 대상 아님): 48-1 LIMONIUM 박스, 수동 기본 규격.
const EXTRA = [
  { code: 'LIMONIUM_MISTY_80', label: '리모늄 미스티블루 (100*40*20 박스)', tariff: 0.214,
    air: { bunches: 20, box: box(100, 40, 20), weightKg: 0.5 }, sea: { bunches: 20, box: box(100, 40, 20), boxCbm: 0.08 } },
  { code: 'BLACKJACK_600G_SMALLBOX', label: '블랙잭 600g (300g 소박스 100*42*20)', tariff: 0.032,
    air: { bunches: 20, box: box(100, 42, 20), weightKg: 0.6 }, sea: { bunches: 20, box: box(100, 42, 20), boxCbm: 0.084 } },
  { code: 'MANUAL_STANDARD', label: '직접 규격 입력 (기본 10단 · 100*30*20)', tariff: 0.214, manual: true,
    air: { bunches: 10, box: box(100, 30, 20), weightKg: 0.5 }, sea: { bunches: 10, box: box(100, 30, 20), boxCbm: 0.06 } },
];

const volKg = spec => spec.fixedKg ?? (spec.box[0] * spec.box[1] * spec.box[2]) / 6000;
const freezeCategory = (rule, order) => Object.freeze({
  code: rule.code, label: rule.label, order, orchid: !!rule.orchid, needsReview: !!rule.needsReview, manual: !!rule.manual,
  air: Object.freeze({ bunchesPerBox: rule.air.bunches, boxSize: rule.air.box ? rule.air.box.join('*') : `고정 ${rule.air.fixedKg}kg`,
    volKgPerBox: volKg(rule.air), cbmPerBunch: volKg(rule.air) / rule.air.bunches, weightKgPerBunch: rule.air.weightKg, tariffRate: rule.tariff }),
  sea: Object.freeze({ bunchesPerBox: rule.sea.bunches, boxSize: rule.sea.box.join('*'), boxCbm: rule.sea.boxCbm,
    cbmPerBunch: rule.sea.boxCbm / rule.sea.bunches, tariffRate: rule.seaTariff ?? rule.tariff }),
});

export const CN_CATEGORIES = Object.freeze([...RULES.map((r, i) => freezeCategory(r, i + 2)), ...EXTRA.map((r, i) => freezeCategory(r, 100 + i))]);
const BY_CODE = new Map(CN_CATEGORIES.map(c => [c.code, c]));
export const cnCategory = code => BY_CODE.get(String(code || '')) || null;

// 1순위: 비상품 메타 행(운송료·중량·HUB2 총액)은 품목에서 제외한다.
export const CN_META_PATTERN = /^(?:운송료|항공운임|해상운임|운임|gross\s*weig[h]?t[h]?|chargeable\s*weig[h]?t[h]?|중국\s*total)$/i;
export const isCnMetaName = name => CN_META_PATTERN.test(String(name || '').normalize('NFKC').trim());

// '[MEL] ... CHINA'처럼 원산지가 콜롬비아로 잘못 등록된 중국 품목을 이름으로 중국 후보에 상속한다.
export const isChinaProductName = name => /\bCHINA\b|^\[MEL\]|^\[오경\]/i.test(String(name || ''));

export function matchCnCategory(...names) {
  const text = names.filter(Boolean).map(String).join(' ').normalize('NFKC');
  if (!text.trim() || isCnMetaName(text)) return null;
  for (const rule of RULES) {
    if (rule.test ? rule.test(text) : rule.pattern.test(text)) return BY_CODE.get(rule.code);
  }
  return null;
}

export function cnCategorySpec(code, mode) {
  const category = cnCategory(code);
  if (!category) return null;
  return mode === CN_MODES.HUBFRESH ? category.sea : category.air;
}
