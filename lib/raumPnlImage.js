// 라움 이미지 주문 초안의 순수 정책.
// 이미지 한 장/여러 장의 OCR 행을 가격·단위별로 합산하되,
// 사용자가 분리한 행은 절대 합산하지 않는다.

const norm = (value) => String(value ?? '')
  .replace(/[\s\u00a0]+/g, ' ')
  .trim()
  .toLowerCase();

// 라움 이미지에서 반복적으로 확인된 OCR 표기/현장 약칭을
// 전산 품목명(영문 ProdName)과 비교할 수 있는 검색명으로 바꾼다.
// 화면에는 원문을 유지하고, 이 값은 매칭에만 사용한다.
const RAUM_MATCH_REPLACEMENTS = [
  [/알스트로메리아|알스트로엘|알스트로/gi, 'alstromeria'],
  [/카네이션|카네시안|카네/gi, 'carnation'],
  [/수국/gi, 'hydrangea'],
  [/장미/gi, 'rose'],
  [/튤립/gi, 'tulip'],
  [/호접란|호접/gi, 'orchid'],
  [/피오니|피어니|피오니퐁퐁/gi, 'peony'],
  [/덴파레/gi, 'dendrobium'],
  [/태국/gi, 'thailand'],
  [/네덜란드/gi, 'netherlands'],
  [/베트남/gi, 'vietnam'],
  [/중국/gi, 'china'],
  [/콜롬비아/gi, 'colombia'],
  [/화이트\s*스프레이|화이트스프레이|스노우\s*플레이크|스노우플레이크/gi, 'snow flake'],
  [/코랄\s*핑크/gi, 'coral reef'],
  [/몬디알/gi, 'mondial'],
  [/코랄\s*리프|코랄리프/gi, 'coral reef'],
  [/캔들라이트/gi, 'candlelight'],
  [/문라이트/gi, 'moon light'],
  [/쉬머/gi, 'shimmer'],
  [/프라도\s*민트|프라도민트/gi, 'prado mint'],
  [/로다스/gi, 'rodas'],
  [/도젤|돈셀|돈셀르/gi, 'doncel'],
  [/지오지아|지오지/gi, 'giogia'],
  [/노랑|노란|노란색/gi, 'yellow'],
  [/오렌지\s*퀸|오렌지퀸/gi, 'orange queen'],
  [/헤르메스\s*오렌지|헤메스\s*오렌지/gi, 'hermes orange'],
  [/헤르메스|헤메스/gi, 'hermes'],
  [/두바이/gi, 'dubai'],
  [/휘슬러|쿠읍슨러/gi, 'whistler'],
  [/피피/gi, 'fifi'],
  [/유카리\s*체리|유카리체리/gi, 'yukari cherry'],
  [/다이아나/gi, 'diana'],
  [/연핑크|연분홍/gi, 'pink'],
  [/연그린|연두|그린/gi, 'green'],
  [/연보라|보라|라벤다|라벤더/gi, 'lavender'],
  [/피치핑크/gi, 'peach pink'],
  [/핑지|피치/gi, 'peach'],
  [/화이트|흰색|하얀색/gi, 'white'],
  [/브루나게이드|부리나게이드|부르나게이드/gi, 'burna jade'],
  [/스팀|스템|송이|대/gi, 'stem'],
];

/**
 * 이미지 품목명 전용 매칭 검색명.
 * OCR 오타를 무조건 품목으로 확정하지 않고, 기존 scoreMatch가
 * Product.ProdName/FlowerName과 비교할 수 있도록 공통 영문 토큰만 보강한다.
 */
export function buildRaumMatchName(value) {
  const original = String(value ?? '')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[/:,_+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let text = original;
  // 이미지 샘플의 "알스트로엘 핑지"는 품목표의 "알스트로 피피"를
  // OCR이 잘못 읽은 케이스다. 수국의 핑지는 아래 일반 peach 규칙을 유지한다.
  if (/알스트로메리아|알스트로엘|알스트로/i.test(text) && /핑지|피지/i.test(text)) {
    text = text.replace(/핑지|피지/gi, '피피');
  }
  for (const [pattern, replacement] of RAUM_MATCH_REPLACEMENTS) text = text.replace(pattern, ` ${replacement} `);
  return `${original} ${text.replace(/\s+/g, ' ').trim()}`.replace(/\s+/g, ' ').trim();
}

/** 라움 이미지의 단위 3종을 전산 canonical 단위로 정규화한다. */
export function normalizeRaumUnit(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (/(박스|box|boxes|박)/i.test(raw)) return '박스';
  if (/(단|bunch|bun)/i.test(raw)) return '단';
  // 현장 표기: 스팀/스템/대. Nenova DB의 canonical 값은 '송이'다.
  if (/(스팀|스템|steam|stem|stems|송이|대|ea|개|^e$)/i.test(raw)) return '송이';
  return '';
}

export function formatRaumUnit(value) {
  const unit = normalizeRaumUnit(value);
  if (unit === '송이') return '스팀(대)';
  return unit || String(value ?? '').trim();
}

export function parseImageNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[₩￦원,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** ClipboardEvent에서 이미지 항목만 골라낸다. 텍스트/HTML 붙여넣기는 건드리지 않는다. */
export function getClipboardImage(items) {
  for (const item of Array.from(items || [])) {
    if (item?.kind !== 'file') continue;
    const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
    const type = String(item.type || file?.type || '').toLowerCase();
    if (file && type.startsWith('image/')) return file;
  }
  return null;
}

function normalizePrice(value) {
  const n = parseImageNumber(value);
  return n == null || n < 0 ? null : Math.round(n * 100) / 100;
}

/** Vision 응답을 UI/주문 정책에서 사용하는 형태로 정규화한다. */
export function normalizeRaumVisionItems(items, { imageId = '', imageName = '' } = {}) {
  return (items || []).flatMap((raw, index) => {
    const inputName = String(
      raw.inputName ?? raw.name ?? raw.품목 ?? raw.product ?? raw.productName ?? ''
    ).replace(/[\s\u00a0]+/g, ' ').trim();
    const qty = parseImageNumber(raw.qty ?? raw.quantity ?? raw.orderQty ?? raw.수량);
    if (!inputName || qty == null || qty <= 0) return [];
    const price = normalizePrice(raw.price ?? raw.unitPrice ?? raw.purchasePrice ?? raw.단가 ?? raw.매입단가);
    const remark = String(raw.remark ?? raw.memo ?? raw.적요 ?? raw.비고 ?? '').trim();
    const rawUnit = String(raw.unit ?? raw.단위 ?? raw.unitName ?? '').trim();
    const unit = normalizeRaumUnit(rawUnit) || rawUnit;
    return [{
      lineId: `${imageId || 'image'}:${index + 1}:${Date.now()}`,
      sourceImageId: imageId || null,
      sourceImageName: imageName || '',
      sourceRowNo: Number(raw.rowNo || index + 1),
      inputName,
      qty,
      unit,
      rawUnit,
      matchName: buildRaumMatchName(inputName),
      price,
      remark,
      prodKey: raw.prodKey != null ? Number(raw.prodKey) : null,
      prodName: raw.prodName || null,
      displayName: raw.displayName || null,
      suggestedProducts: Array.isArray(raw.suggestedProducts) ? raw.suggestedProducts : [],
      confidence: Number(raw.confidence || 0),
      confidenceLabel: raw.confidenceLabel || 'none',
      needsReview: Boolean(raw.needsReview || raw.ambiguousCountry || raw.confidenceLabel === 'low'),
      separate: false,
    }];
  });
}

function lineIdentity(line) {
  if (line.prodKey != null && Number.isFinite(Number(line.prodKey))) return `prod:${Number(line.prodKey)}`;
  return `name:${norm(line.inputName)}`;
}

function priceIdentity(price) {
  return price == null || price === '' ? 'price:null' : `price:${normalizePrice(price)}`;
}

/**
 * OCR 원행을 화면 표시행으로 만든다.
 * - 같은 품목 + 같은 단위 + 같은 가격은 이미지가 달라도 합산
 * - 가격이 다르면 반드시 별도 행
 * - separate=true 행은 같은 키라도 별도 행
 */
export function groupRaumImageRows(lines) {
  const groups = new Map();
  const out = [];
  for (const line of lines || []) {
    const canonicalUnit = normalizeRaumUnit(line.unit) || String(line.unit || '').trim();
    const key = `${lineIdentity(line)}|unit:${norm(canonicalUnit)}|${priceIdentity(line.price)}`;
    const groupKey = line.separate ? `${key}|separate:${line.lineId}` : key;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        groupKey,
        lineIds: [],
        lines: [],
        inputName: line.inputName,
        qty: 0,
        unit: canonicalUnit,
        price: normalizePrice(line.price),
        remark: line.remark || '',
        prodKey: line.prodKey != null ? Number(line.prodKey) : null,
        prodName: line.prodName || null,
        displayName: line.displayName || null,
        suggestedProducts: line.suggestedProducts || [],
        needsReview: Boolean(line.needsReview || !line.prodKey),
      };
      groups.set(groupKey, group);
      out.push(group);
    }
    group.lineIds.push(line.lineId);
    group.lines.push(line);
    group.qty += Number(line.qty || 0);
    if (!group.remark && line.remark) group.remark = line.remark;
    if (!group.prodKey && line.prodKey) {
      group.prodKey = Number(line.prodKey);
      group.prodName = line.prodName || group.prodName;
      group.displayName = line.displayName || group.displayName;
    }
    group.needsReview = group.needsReview || Boolean(line.needsReview || !line.prodKey);
  }
  return out;
}

export function isRaumImageDraftComplete(lines) {
  const groups = groupRaumImageRows(lines);
  return groups.length > 0 && groups.every(g => g.prodKey != null && !g.needsReview);
}

/** 주문등록에는 가격별 행을 합쳐 품목별 수량만 전달한다. */
export function buildRaumOrderItems(lines) {
  const map = new Map();
  for (const group of groupRaumImageRows(lines)) {
    if (group.prodKey == null) continue;
    const unit = normalizeRaumUnit(group.unit) || String(group.unit || '박스').trim() || '박스';
    const key = `${Number(group.prodKey)}|${norm(unit)}`;
    const prev = map.get(key);
    if (prev) prev.qty += Number(group.qty || 0);
    else map.set(key, {
      prodKey: Number(group.prodKey),
      prodName: group.prodName || group.displayName || group.inputName,
      qty: Number(group.qty || 0),
      unit,
      descr: group.remark || '',
    });
  }
  return [...map.values()].filter(it => it.qty > 0);
}

export function buildRaumPnlItems(lines, { branch = '이미지' } = {}) {
  return groupRaumImageRows(lines).map((group, index) => {
    const price = group.price == null ? null : Number(group.price);
    const qty = Number(group.qty || 0);
    return {
      seq: index + 1,
      _uid: `image-${group.groupKey}-${index}`,
      name: group.inputName,
      unit: group.unit || '',
      qty,
      price,
      supply: price == null ? 0 : qty * price,
      byBranch: { [branch]: qty },
      costPrice: null,
      costSource: null,
      refPrice: null,
      refSource: null,
      prodKey: group.prodKey != null ? Number(group.prodKey) : null,
      prodName: group.prodName || group.displayName || null,
      remark: group.remark || '',
      isCustom: false,
      isImageRow: true,
      consigned: false,
      erpSalePrice: null,
      erpQty: null,
    };
  });
}
