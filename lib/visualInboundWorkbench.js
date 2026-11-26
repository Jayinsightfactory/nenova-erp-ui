// PDF·AWB 바로 입고 작업대 — 순수 함수(브라우저·서버·테스트 공용, I/O 없음).
// 추출 결과를 사람이 눈으로 확인·수정할 수 있는 송장 초안으로 바꾸고,
// 검산·역산·상태·입고 요청 본문·패킹 엑셀 격자를 만든다.
// ERP 쓰기는 하지 않는다. 실제 저장은 기존 POST /api/warehouse 한 경로만 사용한다.

export const WORKBENCH_COUNTRIES = Object.freeze([
  ['CO', '콜롬비아'], ['EC', '에콰도르'], ['NL', '네덜란드'], ['CN', '중국'],
  ['TH', '태국'], ['AU', '호주'], ['US', '미국'], ['VN', '베트남'],
]);
export const AWB_COUNTRIES = new Set(['EC', 'AU', 'TH']);
export const AWB_FIELDS = new Set(['awb', 'gw', 'cw', 'freight']);
export const FREIGHT_PRODUCT = '운송료';
export const GROSS_WEIGHT_PRODUCT = 'Gross weight';
export const CHARGEABLE_WEIGHT_PRODUCT = 'Chargeable weight';
export const STATUS = Object.freeze({
  PENDING: '미검증', WARN: '주의', VERIFIED: '검증완료', UPLOADED: '입고완료', ERROR: '오류', DUPLICATE: '기입고',
});
export const HEADER_FIELDS = Object.freeze([
  ['country', '국가'], ['round', '연도·차수'], ['inputDate', '입고일'], ['farm', '농장'],
  ['invoiceNo', '송장번호'], ['awb', 'AWB 번호'], ['gw', 'GW (kg)'], ['cw', 'CW (kg)'],
  ['freight', '운임·부대비'], ['invoiceTotal', '송장 총액'],
]);
export const ROW_FIELDS = Object.freeze([
  ['description', '품명'], ['boxQty', '박스'], ['steamOf1Box', '박스당 송이'], ['steamQty', '총 송이'],
  ['unitPrice', '단가'], ['totalPrice', '금액'],
]);
const ROW_EVIDENCE_KEYS = Object.freeze({
  description: ['description'], boxQty: ['pcs', 'boxes', 'bx'], steamOf1Box: ['steam_box', 'stems_box', 'bunch_st'],
  steamQty: ['total_stems', 'stems', 'total_bunch'], unitPrice: ['u_price', 'price'], totalPrice: ['t_price', 'total'],
});

const text = value => String(value ?? '').normalize('NFKC').trim();
const finite = value => {
  if (value === '' || value == null) return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round4 = n => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
const round6 = n => Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6;

/** '48-1' → '48-01', '48-01A' → '48-01A'. 형식이 아니면 원문을 돌려준다. */
export function normalizeRoundInput(value) {
  const raw = text(value).toUpperCase();
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})(?:\s*\.?\s*([AB]))?$/.exec(raw);
  if (!m) return raw;
  return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}${m[3] ? m[3] : ''}`;
}

/** 파일명 힌트(차수·국가). 내용 증거가 아니므로 화면에서 '파일명 추정'으로만 표시한다. */
export function hintsFromFileName(name) {
  const s = text(name);
  const round = /(?:^|[^\d])(\d{1,2})\s*-\s*(\d{1,2})(?:\s*([AB]))?(?:\s*차)?/i.exec(s);
  const rules = [[/콜|colomb|hortens|카장|수국/i, 'CO'], [/에콰|ecuad|rosaleda/i, 'EC'], [/네덜|홀렉스|holex|holland/i, 'NL'],
    [/중국|china|hubfresh/i, 'CN'], [/태국|thai/i, 'TH'], [/호주|austral/i, 'AU'], [/미국|후드|hood canal|usa/i, 'US'], [/베트남|vietnam/i, 'VN']];
  const country = rules.find(([re]) => re.test(s))?.[1] || '';
  return {
    round: round ? normalizeRoundInput(`${round[1]}-${round[2]}${round[3] || ''}`) : '',
    country,
    isAwb: /\bAWB\b|운송장|waybill/i.test(s) && !/\bCI\b|invoice|인보이스/i.test(s),
  };
}

export function seoulToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
}

function evidenceOf(entry, doc = 'invoice') {
  if (!entry || typeof entry !== 'object') return null;
  const page = Number(entry.page);
  const quote = text(entry.quote);
  const bbox = Array.isArray(entry.bbox) && entry.bbox.length === 4 && entry.bbox.every(Number.isFinite) ? entry.bbox.slice() : null;
  if (!quote && !bbox && !(Number.isInteger(page) && page > 0)) return null;
  return { doc, page: Number.isInteger(page) && page > 0 ? page : null, quote, bbox };
}

function rowEvidence(product) {
  const source = product?.review_evidence && typeof product.review_evidence === 'object' ? product.review_evidence : {};
  const out = {};
  for (const [field, keys] of Object.entries(ROW_EVIDENCE_KEYS)) {
    for (const key of keys) {
      const found = evidenceOf(source[key]);
      if (found) { out[field] = found; break; }
    }
  }
  return out;
}

let rowSeq = 0;
export function newRowId(prefix = 'r') {
  rowSeq += 1;
  return `${prefix}${Date.now().toString(36)}${rowSeq.toString(36)}`;
}

export function blankRow(kind = 'goods', patch = {}) {
  const base = { id: newRowId(kind === 'goods' ? 'g' : kind === 'freight' ? 'f' : 'w'), kind, description: '', prodName: '', prodKey: null,
    boxQty: null, steamOf1Box: null, steamOf1Bunch: null, steamQty: null, unitPrice: null, totalPrice: null, evidence: {}, aliasSaved: false };
  if (kind === 'freight') Object.assign(base, { description: '운송료·PHYTO', prodName: FREIGHT_PRODUCT, boxQty: 1, steamOf1Box: 1, steamOf1Bunch: 1, steamQty: 1, unitPrice: 0, totalPrice: 0 });
  if (kind === 'gw') Object.assign(base, { description: 'Gross weight', prodName: GROSS_WEIGHT_PRODUCT, boxQty: 1, steamOf1Box: 1, steamOf1Bunch: 1, steamQty: 0, unitPrice: 0, totalPrice: 0 });
  if (kind === 'cw') Object.assign(base, { description: 'Chargeable weight', prodName: CHARGEABLE_WEIGHT_PRODUCT, boxQty: 1, steamOf1Box: 1, steamOf1Bunch: 1, steamQty: 0, unitPrice: 0, totalPrice: 0 });
  return { ...base, ...patch };
}

function goodsRowFromProduct(product) {
  const box = finite(product.pcs);
  const perBox = finite(product.steam_box);
  const perBunch = finite(product.bunch_st);
  const totalBunch = finite(product.total_bunch);
  let stems = finite(product.total_stems) ?? finite(product.stems);
  if (stems == null && box != null && perBox != null) stems = box * perBox;
  if (stems == null && totalBunch != null && perBunch != null) stems = totalBunch * perBunch;
  const unit = finite(product.u_price) ?? finite(product.price);
  let total = finite(product.t_price);
  if (total == null && unit != null && stems != null) total = round2(unit * stems);
  return blankRow('goods', {
    description: text(product.description), boxQty: box, steamOf1Box: perBox ?? (box && stems ? round4(stems / box) : null),
    steamOf1Bunch: perBunch, steamQty: stems, unitPrice: unit, totalPrice: total, evidence: rowEvidence(product),
  });
}

/** AWB 서류(로컬 파싱 또는 AI awb_document) → 공통 형태. */
export function normalizeAwbDocument(doc) {
  if (!doc || typeof doc !== 'object' || doc._error) return null;
  const ev = doc.evidence && typeof doc.evidence === 'object' ? doc.evidence : {};
  const quoteOf = (key, fallback) => evidenceOf(ev[key], 'awb') || (fallback ? { doc: 'awb', page: 1, quote: '', bbox: null, values: fallback } : null);
  const awb = text(doc.awb);
  const gw = finite(doc.gross_weight_kg ?? doc.gw);
  const cw = finite(doc.chargeable_weight_kg ?? doc.cw);
  const rate = finite(doc.freight_rate ?? doc.uPrice1);
  const total = finite(doc.total_prepaid ?? doc.total);
  const other = finite(doc.other_charges);
  return {
    awb, gw, cw, rate, totalPrepaid: total, otherCharges: other, packages: finite(doc.packages), currency: text(doc.currency) || 'USD',
    evidence: { awb: quoteOf('awb'), gw: quoteOf('gross_weight_kg'), cw: quoteOf('chargeable_weight_kg'), freight: quoteOf('total_prepaid') },
  };
}

/**
 * parsePackingResponse 결과(또는 공용 업로드 이력의 lastExtraction.result) → 송장 초안 목록.
 * 값은 모두 초안이며 사람이 확인하기 전에는 '미검증' 상태다.
 */
export function buildWorkbenchInvoices(result, { country = '', fileHints = {}, awbDocument = null, today = seoulToday() } = {}) {
  const invoices = Array.isArray(result?.invoices) ? result.invoices : [];
  const awb = normalizeAwbDocument(awbDocument || result?.awb_document);
  const round = normalizeRoundInput(fileHints.round || '');
  return invoices.map((invoice, index) => {
    const rows = (Array.isArray(invoice.products) ? invoice.products : Array.isArray(invoice.lines) ? invoice.lines : [])
      .filter(product => product && text(product.description))
      .map(goodsRowFromProduct);
    const freight = finite(invoice.freight_total ?? invoice.freight);
    const handling = finite(invoice.handling);
    const extras = round2((freight ?? 0) + (handling ?? 0));
    if (extras > 0) {
      rows.push(blankRow('freight', { description: handling ? '운송료·부대비' : '운송료', unitPrice: extras, totalPrice: extras,
        evidence: { totalPrice: evidenceOf(invoice.review_evidence?.freight_total || invoice.review_evidence?.freight) || undefined } }));
    }
    const review = invoice.review_evidence && typeof invoice.review_evidence === 'object' ? invoice.review_evidence : {};
    const meta = invoice.metadata_evidence && typeof invoice.metadata_evidence === 'object' ? invoice.metadata_evidence : {};
    const gwInvoice = finite(invoice.gross_weight ?? review.gross_weight?.value);
    const cwInvoice = finite(invoice.vol_weight ?? review.vol_weight?.value);
    const useAwbWeights = awb && (awb.gw != null || awb.cw != null);
    const date = text(invoice.date).replace(/\//g, '-');
    const header = {
      country: text(country).toUpperCase(),
      orderYear: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 4) : today.slice(0, 4),
      orderWeek: round,
      inputDate: today,
      invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
      supplier: text(invoice.supplier || invoice.farm || invoice.farm_name),
      farmName: '', farmKey: null, farmSourceWarehouseKey: null, isNewFarm: false,
      invoiceNo: text(invoice.invoice),
      awb: text(invoice.awb) || (awb?.awb ?? ''),
      gw: useAwbWeights ? awb.gw : gwInvoice,
      cw: useAwbWeights ? awb.cw : cwInvoice,
      rate: awb?.rate ?? null,
      docFee: awb?.otherCharges ?? null,
      freight: extras > 0 ? extras : null,
      invoiceTotal: finite(invoice.invoice_total ?? invoice.total_value),
      currency: text(invoice.currency) || (awb?.currency ?? ''),
    };
    const evidence = {
      farm: evidenceOf(meta.supplier) || null,
      invoiceNo: evidenceOf(meta.invoice) || null,
      inputDate: evidenceOf(meta.date) || null,
      awb: awb?.evidence.awb || evidenceOf(meta.awb) || null,
      gw: useAwbWeights ? awb.evidence.gw : evidenceOf(review.gross_weight),
      cw: useAwbWeights ? awb.evidence.cw : evidenceOf(review.vol_weight),
      freight: evidenceOf(review.freight_total || review.freight),
      invoiceTotal: evidenceOf(meta.invoice_total),
    };
    const warnings = [];
    if (invoice.metadata_review?.issues?.some?.(issue => /PO_SUSPECT/.test(issue?.code || ''))
      || (Array.isArray(invoice.extractionIssues) && invoice.extractionIssues.some(issue => /PO_SUSPECT/.test(issue?.code || '')))) {
      warnings.push({ field: 'invoiceNo', code: 'INVOICE_NUMBER_PO_SUSPECT', message: '송장번호가 PO 번호와 혼동되었을 수 있습니다. 원문 INVOICE No를 확인하세요.' });
    }
    return {
      key: `inv-${index}-${text(invoice.invoice) || index}`,
      index,
      header,
      rows,
      evidence,
      checked: {},
      warnings,
      duplicate: null,
      selected: true,
      upload: { state: 'idle', warehouseKey: null, error: '' },
      operationId: null,
    };
  });
}

/** 송장번호 PO 혼동 경고(원문 접두어가 PO인 경우 포함). */
export function invoiceNumberWarning(header, evidence) {
  const quote = text(evidence?.invoiceNo?.quote);
  if (/\bP\.?\s*O\.?\s*[:#]/i.test(quote) && !/INVOICE|FACTURA/i.test(quote)) {
    return '원문 근거가 PO 번호를 가리킵니다. INVOICE No 값을 다시 확인하세요.';
  }
  if (!text(header?.invoiceNo)) return '송장번호가 비어 있습니다. 기입고 중복 확인이 되지 않습니다.';
  return '';
}

/** 행 하나의 자체 검산. */
export function rowIssues(row) {
  const issues = [];
  if (row.kind !== 'goods') {
    if (row.kind === 'freight' && !(finite(row.totalPrice) >= 0)) issues.push({ field: 'totalPrice', level: 'block', message: '부대비 금액을 입력하세요.' });
    if ((row.kind === 'gw' || row.kind === 'cw') && !(finite(row.steamQty) > 0)) issues.push({ field: 'steamQty', level: 'block', message: '중량(kg)을 입력하세요.' });
    return issues;
  }
  if (!text(row.prodName)) issues.push({ field: 'description', level: 'block', message: '전산 품목을 연결하세요.' });
  const box = finite(row.boxQty);
  const stems = finite(row.steamQty);
  const unit = finite(row.unitPrice);
  const total = finite(row.totalPrice);
  const perBox = finite(row.steamOf1Box);
  if (box === 0 && row.zeroBoxConfirmed === true) {
    issues.push({ field: 'boxQty', level: 'warn', message: '합포장 행으로 확인되어 박스 0으로 입고합니다.' });
  } else if (box == null || box <= 0) {
    issues.push({ field: 'boxQty', level: 'block', message: '박스 수가 0이면 박스 단위 재고가 0으로 입고됩니다. 박스 수를 입력하거나 합포장 확인을 누르세요.' });
  }
  if (stems == null || stems <= 0) issues.push({ field: 'steamQty', level: 'block', message: '총 송이를 입력하세요.' });
  if (unit == null || unit < 0) issues.push({ field: 'unitPrice', level: 'block', message: '단가를 입력하세요.' });
  if (total == null || total < 0) issues.push({ field: 'totalPrice', level: 'block', message: '금액을 입력하세요.' });
  if (box > 0 && perBox > 0 && stems > 0 && Math.abs(box * perBox - stems) > 0.5) {
    issues.push({ field: 'steamQty', level: 'warn', message: `박스 × 박스당 송이(${round4(box * perBox)})와 총 송이가 다릅니다.` });
  }
  if (stems > 0 && unit != null && total != null && Math.abs(round2(stems * unit) - total) > Math.max(0.02, total * 0.001)) {
    issues.push({ field: 'totalPrice', level: 'warn', message: `총 송이 × 단가(${round2(stems * unit)})와 금액이 다릅니다.` });
  }
  return issues;
}

/** 상품합 + 부대비 == 송장총액 검산. */
export function reconcileInvoice(draft) {
  const rows = Array.isArray(draft?.rows) ? draft.rows : [];
  const goods = round2(rows.filter(r => r.kind === 'goods').reduce((s, r) => s + (finite(r.totalPrice) ?? 0), 0));
  const extras = round2(rows.filter(r => r.kind === 'freight').reduce((s, r) => s + (finite(r.totalPrice) ?? 0), 0));
  const stems = rows.filter(r => r.kind === 'goods').reduce((s, r) => s + (finite(r.steamQty) ?? 0), 0);
  const boxes = rows.filter(r => r.kind === 'goods').reduce((s, r) => s + (finite(r.boxQty) ?? 0), 0);
  const total = finite(draft?.header?.invoiceTotal);
  const sum = round2(goods + extras);
  const diff = total == null ? null : round2(sum - total);
  return { goods, extras, sum, total, diff, stems, boxes, ok: diff != null && Math.abs(diff) <= 0.01, hasTotal: total != null };
}

/** 헤더 필수값·경고. */
export function headerIssues(draft) {
  const h = draft?.header || {};
  const issues = [];
  if (!/^\d{4}$/.test(text(h.orderYear))) issues.push({ field: 'round', level: 'block', message: '주문연도(4자리)를 입력하세요.' });
  if (!/^\d{2}-\d{2}(?:\.?[AB])?$/.test(normalizeRoundInput(h.orderWeek))) issues.push({ field: 'round', level: 'block', message: '차수를 48-01 형식으로 입력하세요.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(h.inputDate))) issues.push({ field: 'inputDate', level: 'block', message: '입고일을 입력하세요.' });
  if (!text(h.farmName)) issues.push({ field: 'farm', level: 'block', message: '입고 농장을 선택하세요.' });
  if (!text(h.country)) issues.push({ field: 'country', level: 'block', message: '국가를 선택하세요.' });
  const invoiceWarn = invoiceNumberWarning(h, draft?.evidence);
  if (invoiceWarn) issues.push({ field: 'invoiceNo', level: 'warn', message: invoiceWarn });
  for (const w of draft?.warnings || []) issues.push({ field: w.field, level: 'warn', message: w.message });
  return issues;
}

/** 송장 단위 전체 검토 결과. */
export function reviewInvoice(draft) {
  const header = headerIssues(draft);
  const rows = (draft?.rows || []).flatMap(row => rowIssues(row).map(issue => ({ ...issue, rowId: row.id })));
  const totals = reconcileInvoice(draft);
  const sum = [];
  if (!(draft?.rows || []).some(r => r.kind === 'goods')) sum.push({ field: 'rows', level: 'block', message: '품목 행이 없습니다.' });
  if (!totals.hasTotal) sum.push({ field: 'invoiceTotal', level: 'warn', message: '송장 총액이 없어 합계 검산을 할 수 없습니다.' });
  else if (!totals.ok) sum.push({ field: 'invoiceTotal', level: 'block', message: `상품합 ${totals.goods.toFixed(2)} + 부대비 ${totals.extras.toFixed(2)} = ${totals.sum.toFixed(2)} 이 송장 총액 ${totals.total.toFixed(2)} 과 ${totals.diff > 0 ? '+' : ''}${totals.diff.toFixed(2)} 다릅니다.` });
  const all = [...header, ...rows, ...sum];
  return { issues: all, blocking: all.filter(i => i.level === 'block'), warnings: all.filter(i => i.level === 'warn'), totals };
}

/** 사람이 눈으로 확인해야 하는 항목 키 목록. */
export function requiredCheckKeys(draft) {
  const keys = ['country', 'round', 'inputDate', 'farm', 'invoiceNo', 'invoiceTotal'];
  const h = draft?.header || {};
  if (text(h.awb)) keys.push('awb');
  if (finite(h.gw) != null) keys.push('gw');
  if (finite(h.cw) != null) keys.push('cw');
  for (const row of draft?.rows || []) keys.push(`row:${row.id}`);
  return keys;
}

export function invoiceStatus(draft) {
  if (draft?.upload?.state === 'ok') return STATUS.UPLOADED;
  if (draft?.duplicate) return STATUS.DUPLICATE;
  if (draft?.upload?.state === 'error') return STATUS.ERROR;
  const review = reviewInvoice(draft);
  if (review.blocking.length) return STATUS.WARN;
  const checked = draft?.checked || {};
  const allChecked = requiredCheckKeys(draft).every(key => checked[key] === true);
  if (!allChecked) return review.warnings.length ? STATUS.WARN : STATUS.PENDING;
  return STATUS.VERIFIED;
}

/** 1클릭 행 역산. */
export function backSolveRow(row, field) {
  const box = finite(row.boxQty), perBox = finite(row.steamOf1Box), stems = finite(row.steamQty);
  const unit = finite(row.unitPrice), total = finite(row.totalPrice);
  if (field === 'steamQty' && box != null && perBox != null) return { ...row, steamQty: round6(box * perBox) };
  if (field === 'steamOf1Box' && box > 0 && stems != null) return { ...row, steamOf1Box: round4(stems / box) };
  if (field === 'totalPrice' && stems != null && unit != null) return { ...row, totalPrice: round2(stems * unit) };
  if (field === 'unitPrice' && stems > 0 && total != null) return { ...row, unitPrice: round4(total / stems) };
  return row;
}

/** 합계 불일치를 닫는 가장 작은 보정안을 제안한다(자동 적용하지 않는다). */
export function suggestReconcileFix(draft) {
  const totals = reconcileInvoice(draft);
  if (!totals.hasTotal || totals.ok) return null;
  const goods = (draft.rows || []).filter(r => r.kind === 'goods');
  const mismatched = goods.filter(r => finite(r.steamQty) > 0 && finite(r.unitPrice) != null && finite(r.totalPrice) != null
    && Math.abs(round2(finite(r.steamQty) * finite(r.unitPrice)) - finite(r.totalPrice)) > 0.01);
  if (mismatched.length === 1) {
    const row = mismatched[0];
    const fixed = round2(finite(row.steamQty) * finite(row.unitPrice));
    if (Math.abs(round2(totals.diff - (finite(row.totalPrice) - fixed))) <= 0.01) {
      return { kind: 'row', rowId: row.id, field: 'totalPrice', value: fixed, label: `${row.description || '품목'} 금액을 총 송이 × 단가 ${fixed.toFixed(2)}(으)로 역산` };
    }
  }
  const freight = (draft.rows || []).filter(r => r.kind === 'freight');
  if (freight.length === 1) {
    const value = round2((finite(freight[0].totalPrice) ?? 0) - totals.diff);
    if (value >= 0) return { kind: 'freight', rowId: freight[0].id, field: 'totalPrice', value, label: `부대비를 ${value.toFixed(2)}(으)로 맞춤 (차액 ${totals.diff.toFixed(2)})` };
  }
  if (!freight.length && totals.diff < 0) {
    return { kind: 'add-freight', value: round2(-totals.diff), label: `차액 ${round2(-totals.diff).toFixed(2)}을 운송료·PHYTO 행으로 추가` };
  }
  return null;
}

export function applyReconcileFix(draft, fix) {
  if (!fix) return draft;
  if (fix.kind === 'add-freight') {
    return { ...draft, rows: [...draft.rows, blankRow('freight', { unitPrice: fix.value, totalPrice: fix.value })] };
  }
  return { ...draft, rows: draft.rows.map(row => row.id !== fix.rowId ? row
    : row.kind === 'freight' ? { ...row, unitPrice: fix.value, totalPrice: fix.value } : { ...row, [fix.field]: fix.value }) };
}

/** 헤더 GW/CW와 표의 중량 행을 동기화한다(중량 행이 있으면 행 값이 우선). */
export function effectiveWeights(draft) {
  const gwRow = (draft.rows || []).find(r => r.kind === 'gw');
  const cwRow = (draft.rows || []).find(r => r.kind === 'cw');
  return { gw: finite(gwRow?.steamQty) ?? finite(draft.header?.gw), cw: finite(cwRow?.steamQty) ?? finite(draft.header?.cw) };
}

function payloadItems(draft) {
  const rows = draft.rows || [];
  const items = rows.filter(r => r.kind === 'goods').map(row => {
    const stems = finite(row.steamQty) ?? 0;
    const perBunch = finite(row.steamOf1Bunch);
    return {
      prodName: text(row.prodName), orderCode: '',
      boxQty: finite(row.boxQty) ?? 0, steamOf1Box: finite(row.steamOf1Box) ?? 0,
      steamOf1Bunch: perBunch ?? 0, bunchQty: perBunch > 0 ? round6(stems / perBunch) : null,
      steamQty: stems, unitPrice: finite(row.unitPrice) ?? 0, totalPrice: finite(row.totalPrice) ?? 0,
    };
  });
  const extras = round6(rows.filter(r => r.kind === 'freight').reduce((s, r) => s + (finite(r.totalPrice) ?? 0), 0));
  if (rows.some(r => r.kind === 'freight') && extras > 0) {
    // nenova.exe 패킹 엑셀과 동일: 부대비는 운송료 1행(F~J=1, U/T.PRICE=금액)으로 합친다.
    items.push({ prodName: FREIGHT_PRODUCT, orderCode: '', boxQty: 1, steamOf1Box: 1, steamOf1Bunch: 1, bunchQty: 1, steamQty: 1, unitPrice: extras, totalPrice: extras });
  }
  const { gw, cw } = effectiveWeights(draft);
  if (rows.some(r => r.kind === 'gw') && gw > 0) items.push({ prodName: GROSS_WEIGHT_PRODUCT, orderCode: '', boxQty: 1, steamOf1Box: 1, steamOf1Bunch: 1, bunchQty: 1, steamQty: gw, unitPrice: 0, totalPrice: 0 });
  if (rows.some(r => r.kind === 'cw') && cw > 0) items.push({ prodName: CHARGEABLE_WEIGHT_PRODUCT, orderCode: '', boxQty: 1, steamOf1Box: 1, steamOf1Bunch: 1, bunchQty: 1, steamQty: cw, unitPrice: 0, totalPrice: 0 });
  return items;
}

/** 기존 POST /api/warehouse(패킹 업로드) 본문과 같은 형태. */
export function buildWarehouseUploadPayload(draft, { fileName = '', sourceHash = '', includeAwbFreight = true, previewOnly = false } = {}) {
  const h = draft.header || {};
  const { gw, cw } = effectiveWeights(draft);
  return {
    orderYear: text(h.orderYear), orderWeek: normalizeRoundInput(h.orderWeek), farmName: text(h.farmName),
    invoiceNo: text(h.invoiceNo), awb: text(h.awb), inputDate: text(h.inputDate),
    gw: gw ?? null, cw: cw ?? null,
    rate: includeAwbFreight ? finite(h.rate) : null,
    docFee: includeAwbFreight ? finite(h.docFee) : null,
    fileName: text(fileName).slice(0, 60), sourceWorkbookHash: /^[a-f0-9]{64}$/i.test(sourceHash) ? sourceHash.toLowerCase() : '',
    operationId: draft.operationId || null,
    source: 'visual-verify',
    items: payloadItems(draft),
    previewOnly: previewOnly === true,
  };
}

/** nenova.exe Packing 엑셀과 같은 고정 격자(5행 머리글, 6행부터 상세). */
export function buildPackingGrid(draft) {
  const h = draft.header || {};
  const grid = [
    ['PACKING LIST'],
    ['', 'FARM', text(h.farmName), '', '', 'ORDER', normalizeRoundInput(h.orderWeek), '', '', 'INVOICE', text(h.invoiceNo)],
    ['', 'AWB', text(h.awb), '', '', 'DATE', text(h.inputDate).replace(/-/g, '/')],
    [],
    ['COD', 'VARIETY NAME', '', '', 'SIZE', 'BOX', 'STEAM/BUNCH', 'STEAM/BOX', 'TOTAL\nBUNCH', 'TOTAL STEAM', 'U.PRICE', 'T.PRICE'],
  ];
  for (const item of payloadItems(draft)) {
    grid.push(['', item.prodName, '', '', '', item.boxQty, item.steamOf1Bunch, item.steamOf1Box, item.bunchQty ?? '', item.steamQty, item.unitPrice, item.totalPrice]);
  }
  grid.push(['TOTAL']);
  return grid;
}

/** 원문에서 찾을 값 후보(근거 인용이 없거나 값이 바뀌었을 때 사용). */
export function valueSearchQuotes(field, value) {
  const raw = text(value);
  if (!raw) return [];
  if (field === 'awb') {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11) {
      const [p, a, b] = [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7)];
      return [raw, `${p}-${a}${b}`, `${p} ${a} ${b}`, `${p}-${a} ${b}`, `${p} ${a}${b}`, digits];
    }
    return [raw];
  }
  const n = finite(value);
  if (n != null && ['gw', 'cw', 'freight', 'invoiceTotal', 'unitPrice', 'totalPrice'].includes(field)) {
    const fixed2 = n.toFixed(2);
    const grouped = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const euro = grouped.replace(/,/g, '_').replace('.', ',').replace(/_/g, '.');
    const plain = String(n);
    return [...new Set([grouped, fixed2, euro, plain].filter(s => s.length >= 3))];
  }
  if (n != null) return String(n).length >= 3 ? [String(n)] : [];
  return [raw];
}

/**
 * 화면 필드 → 원문 위치 찾기 요청.
 * AWB 서류가 있으면 AWB 번호·GW·CW·운임은 AWB 탭에서 찾는다.
 */
export function evidenceTarget(draft, fieldKey, { hasAwbDoc = false } = {}) {
  const h = draft?.header || {};
  const [scope, rowId, field] = fieldKey.startsWith('row:') ? fieldKey.split(':') : ['header', '', fieldKey];
  if (scope === 'row') {
    const row = (draft.rows || []).find(r => r.id === rowId);
    if (!row) return null;
    const ev = row.evidence?.[field] || null;
    const descEv = row.evidence?.description || null;
    const quotes = [ev?.quote, ...valueSearchQuotes(field, row[field]).filter(() => field !== 'boxQty'), descEv?.quote, row.description].filter(Boolean);
    return { doc: ev?.doc || 'invoice', page: ev?.page ?? descEv?.page ?? null, quotes, bbox: ev?.bbox || descEv?.bbox || null,
      invoiceNo: text(h.invoiceNo), supplier: text(h.supplier), label: ROW_FIELDS.find(([k]) => k === field)?.[1] || '품목' };
  }
  const ev = draft?.evidence?.[field] || null;
  const valueOf = { farm: h.supplier || h.farmName, invoiceNo: h.invoiceNo, awb: h.awb, gw: h.gw, cw: h.cw, freight: h.freight, invoiceTotal: h.invoiceTotal, inputDate: h.invoiceDate, round: '', country: '' }[field];
  const routeAwb = hasAwbDoc && AWB_FIELDS.has(field);
  const doc = hasAwbDoc ? (routeAwb ? 'awb' : (ev?.doc || 'invoice')) : 'invoice';
  const quotes = [ev && ev.doc === doc ? ev.quote : '', ...valueSearchQuotes(field, valueOf)].filter(Boolean);
  if (field === 'country' || field === 'round') quotes.push(h.supplier, h.invoiceNo);
  return { doc, page: ev && ev.doc === doc ? ev.page : null, quotes: [...new Set(quotes)], bbox: ev && ev.doc === doc ? ev.bbox : null,
    invoiceNo: doc === 'invoice' ? text(h.invoiceNo) : '', supplier: doc === 'invoice' ? text(h.supplier) : '', label: HEADER_FIELDS.find(([k]) => k === field)?.[1] || field };
}

/** 연결선 경로: 왼쪽 근거 상자 오른쪽 끝 → 오른쪽 필드 왼쪽 끝. 완만한 3차 곡선. */
export function connectorPath(from, to) {
  if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) return '';
  const dx = Math.max(40, Math.abs(to.x - from.x) * 0.5);
  const r = v => Math.round(v * 10) / 10;
  return `M ${r(from.x)} ${r(from.y)} C ${r(from.x + dx)} ${r(from.y)}, ${r(to.x - dx)} ${r(to.y)}, ${r(to.x)} ${r(to.y)}`;
}

export const CONNECTOR_COLORS = Object.freeze({ checking: '#2563eb', warn: '#d97706', error: '#dc2626', done: '#059669' });

export function connectorTone({ checked = false, issues = [] } = {}) {
  if (issues.some(i => i.level === 'block')) return 'error';
  if (issues.some(i => i.level === 'warn')) return 'warn';
  return checked ? 'done' : 'checking';
}

/** 기입고 대조 결과를 초안에 반영한다(기입고 송장은 자동 체크 해제). */
export function applyExistingReceipts(drafts, matches = []) {
  const byIndex = new Map((matches || []).map(m => [Number(m.index), m]));
  return drafts.map((draft, i) => {
    const match = byIndex.get(i) || null;
    return match ? { ...draft, duplicate: match, selected: false } : { ...draft, duplicate: null };
  });
}

export function duplicateRangeLabel(drafts) {
  const keys = drafts.filter(d => d.duplicate?.warehouseKey).map(d => Number(d.duplicate.warehouseKey)).sort((a, b) => a - b);
  if (!keys.length) return '';
  return keys.length === 1 ? `#${keys[0]}` : `#${keys[0]}~#${keys[keys.length - 1]}`;
}

/**
 * 선택 송장을 송장별 독립 요청으로 순차 입고한다.
 * 각 송장은 previewOnly=true 사전 검증을 통과해야만 본 저장을 보낸다.
 * 성공 건은 잠그고 실패 건은 오류를 남겨 '실패 건만 재업로드'를 할 수 있게 한다.
 */
export async function runSequentialUpload(drafts, { post, buildPayload, onProgress = () => {}, newOperationId }) {
  const results = [];
  for (const draft of drafts) {
    if (!draft.selected || draft.duplicate || draft.upload?.state === 'ok') continue;
    const operationId = draft.operationId || newOperationId();
    const withOp = { ...draft, operationId };
    onProgress({ key: draft.key, stage: 'preview' });
    let outcome;
    try {
      const preview = await post(buildPayload(withOp, true));
      if (!preview?.success) {
        outcome = { key: draft.key, operationId, state: 'error', stage: 'preview', code: preview?.code || '', error: friendlyUploadError(preview) };
      } else {
        onProgress({ key: draft.key, stage: 'commit' });
        const saved = await post(buildPayload(withOp, false));
        outcome = saved?.success && saved.warehouseKey
          ? { key: draft.key, operationId, state: 'ok', warehouseKey: Number(saved.warehouseKey), replay: saved.replay === true }
          : { key: draft.key, operationId, state: 'error', stage: 'commit', code: saved?.code || '', error: friendlyUploadError(saved) };
      }
    } catch (error) {
      outcome = { key: draft.key, operationId, state: 'error', stage: 'network', code: 'NETWORK', error: friendlyUploadError({ error: error?.message, code: 'NETWORK' }) };
    }
    results.push(outcome);
    onProgress({ key: draft.key, stage: 'done', outcome });
  }
  return results;
}

const ERROR_TEXT = Object.freeze({
  DUPLICATE_INVOICE: '같은 연도·차수·농장·송장번호의 입고가 이미 있습니다. 입고관리 목록에서 기존 입고를 확인하세요.',
  WAREHOUSE_WEEK_FIXED: '이 차수는 출고 확정되어 입고를 추가할 수 없습니다. 출고 확정 취소 후 다시 시도하세요.',
  WAREHOUSE_PRODUCT_VALIDATION_FAILED: '전산 품목 확인이 필요한 행이 있습니다. 표시된 품목을 다시 연결하세요.',
  ORDER_YEAR_WEEK_REQUIRED: '주문연도와 차수(예: 48-01)를 입력하세요.',
  WAREHOUSE_INPUT_DATE_REQUIRED: '입고일을 입력하세요.',
  WAREHOUSE_WRITE_FORBIDDEN: '입고 등록 권한이 없습니다. 관리자 또는 수입부 계정으로 진행하세요.',
  WAREHOUSE_OPERATION_CONFLICT: '같은 요청 번호로 다른 내용이 저장되어 있습니다. 화면을 새로 열어 다시 시도하세요.',
  NETWORK: '서버와 연결되지 않았습니다. 네트워크를 확인한 뒤 실패 건만 다시 올리세요.',
});

/** 빈 오류 문구를 남기지 않는 한국어 안내. */
export function friendlyUploadError(response) {
  const code = text(response?.code);
  const message = text(response?.error);
  const details = Array.isArray(response?.errors) ? response.errors.filter(e => text(e?.error)).slice(0, 4)
    .map(e => `${text(e.prodName) || `${e.row}행`}: ${text(e.error)}`) : [];
  const base = message || ERROR_TEXT[code] || '입고 처리 중 알 수 없는 문제가 발생했습니다. 입력값을 확인하고 실패 건만 다시 올리세요.';
  return [base, ...details].join('\n');
}
