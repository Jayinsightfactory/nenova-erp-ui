// 라움 이미지 주문 초안의 순수 정책.
// 이미지 한 장/여러 장의 OCR 행을 가격·단위별로 합산하되,
// 사용자가 분리한 행은 절대 합산하지 않는다.

const norm = (value) => String(value ?? '')
  .replace(/[\s\u00a0]+/g, ' ')
  .trim()
  .toLowerCase();

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
    return [{
      lineId: `${imageId || 'image'}:${index + 1}:${Date.now()}`,
      sourceImageId: imageId || null,
      sourceImageName: imageName || '',
      sourceRowNo: Number(raw.rowNo || index + 1),
      inputName,
      qty,
      unit: String(raw.unit ?? raw.단위 ?? '').trim(),
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
    const key = `${lineIdentity(line)}|unit:${norm(line.unit)}|${priceIdentity(line.price)}`;
    const groupKey = line.separate ? `${key}|separate:${line.lineId}` : key;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        groupKey,
        lineIds: [],
        lines: [],
        inputName: line.inputName,
        qty: 0,
        unit: line.unit || '',
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
    const unit = String(group.unit || '박스').trim() || '박스';
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
