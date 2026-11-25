import { isAdminUser } from './userAccess.js';

const round3 = value => Math.round(Number(value || 0) * 1000) / 1000;

const KNOWN_CATEGORY_PREFIXES = [
  'SPRAY ROSE',
  'CARNATION',
  'HYDRANGEA',
  'ALSTROMERIA',
  'ALSTROEMERIA',
  'RUSCUS',
  'LISIANTHUS',
  'TULIP',
  'SKIMMIA',
  'LEUCOTHOE',
  'AGAPANTHUS',
  'ANTHURIUM',
  'AMARYLLIS',
  'HYACINTHUS',
  'NERINE',
  'IRIS',
  'CONVALLARIA',
  'CLEMATIS',
  'ASTILBE',
  'GYPSOPHILA',
  'GYPSOPHILIA',
  'ORCHID',
  'ROSE',
];

const COUNTRY_TAGS_RE = /\b(?:CHINA|COLOMBIA|ECUADOR|NETHERLANDS|HOLLAND|ISRAEL|VIETNAM|THAILAND|AUSTRALIA|NEW\s+ZEALAND|USA)\b/gi;
const BRACKET_PREFIX_RE = /^(?:\[[^\]]+\]\s*)+/;
const INTERNAL_REMARK_RE = /^(?:ORPHAN\d+-|발주용\s*코드\(|엑셀\s*출고분배\s*업로드\s*자동\s*주문등록)/i;

export function kstDateString(now = new Date()) {
  if (typeof now === 'string' && /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(now.trim())) {
    return now.trim();
  }
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error('유효한 조회 날짜가 아닙니다.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = type => parts.find(p => p.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function buildKstDayBounds(dateInput = new Date()) {
  const dateText = kstDateString(dateInput);
  const [y, m, d] = dateText.split('-').map(Number);
  const utcNext = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDateText = `${utcNext.getUTCFullYear()}-${String(utcNext.getUTCMonth() + 1).padStart(2, '0')}-${String(utcNext.getUTCDate()).padStart(2, '0')}`;
  return {
    dateText,
    startDtm: `${dateText} 00:00:00.000`,
    endDtm: `${nextDateText} 00:00:00.000`,
  };
}

export function resolveStaffOrderAccess(user = {}) {
  const userId = String(user?.userId ?? user?.UserID ?? '').trim();
  const userName = String(user?.userName ?? user?.UserName ?? '').trim();
  if (!userId && !userName) {
    throw new Error('로그인 계정 정보를 확인할 수 없습니다.');
  }
  return {
    userId,
    userName,
    isAdmin: isAdminUser(user),
  };
}

function normId(value) {
  return String(value || '').trim().toLowerCase();
}

function normName(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

export function resolveOrderRowAttribution(row = {}) {
  const rawActorId = String(row.todayActorId || row.odUpdateId || row.odCreateId || '').trim();
  const rawActorName = String(row.todayActorName || row.odUpdateName || row.odCreateName || '').trim();
  const actorIsGenericAdmin = normId(rawActorId) === 'admin' && !normId(row.todayActorId);

  const actorUserId = actorIsGenericAdmin ? '' : rawActorId;
  const actorUserName = actorIsGenericAdmin ? '' : rawActorName;

  const custManagerRaw = String(row.custManager || '').trim();
  const custManagerId = String(row.custManagerUserId || '').trim();
  const custManagerName = String(row.custManagerUserName || custManagerRaw || '').trim();

  const omManagerRaw = String(row.omManager || '').trim();
  const omManagerIsGenericAdmin = normId(omManagerRaw) === 'admin';
  const orderManagerId = omManagerIsGenericAdmin ? '' : String(row.omManagerUserId || omManagerRaw).trim();
  const orderManagerName = omManagerIsGenericAdmin ? '' : String(row.omManagerUserName || '').trim();

  const ownerId = custManagerId || orderManagerId || actorUserId || 'admin';
  const ownerName = custManagerName || orderManagerName || actorUserName || '관리자';

  return {
    actorUserId,
    actorUserName,
    custManagerId,
    custManagerName,
    orderManagerId,
    orderManagerName,
    ownerId,
    ownerName,
  };
}

export function matchRowToStaff(row = {}, target = {}) {
  const targetId = normId(target.userId);
  const targetName = normName(target.userName);
  if (!targetId && !targetName) return { matched: false, kind: null };

  const attr = resolveOrderRowAttribution(row);
  const matchesPair = (id, name) =>
    (targetId && normId(id) === targetId) ||
    (targetName && (normName(name) === targetName || normName(id) === targetName));

  const isDirectActor = matchesPair(attr.actorUserId, attr.actorUserName) ||
    (targetId === 'admin' && normId(row.todayActorId || row.odCreateId) === 'admin');
  const isAssignedManager =
    matchesPair(attr.custManagerId, attr.custManagerName) ||
    matchesPair(attr.orderManagerId, attr.orderManagerName);

  if (isDirectActor) return { matched: true, kind: 'direct' };
  if (isAssignedManager) return { matched: true, kind: 'assigned_customer' };
  return { matched: false, kind: null };
}

function normalizeSpecCase(text) {
  return String(text || '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\b(\d+(?:\.\d+)?)\s*CM\b/gi, '$1cm')
    .replace(/\b(\d+(?:\.\d+)?)\s*MM\b/gi, '$1mm')
    .replace(/\b(\d+(?:\.\d+)?)\s*G\b/gi, '$1g')
    .replace(/\b(\d+(?:\.\d+)?)\s*KG\b/gi, '$1kg')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCategoryLabel(flowerName = '', baseLabel = '') {
  let category = String(flowerName || '').trim();
  if (category) {
    category = category.replace(/\s+[A-Za-z][A-Za-z\s]*$/, '').trim() || category;
  }
  if (!category || category === '기타') {
    const cleanedBase = String(baseLabel || '')
      .replace(BRACKET_PREFIX_RE, '')
      .replace(COUNTRY_TAGS_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanedBase.includes('/')) {
      const head = cleanedBase.split('/')[0].trim();
      if (head && head.length <= 20) return head;
    }
    return category || '기타';
  }
  return category;
}

function deduplicateParenthetical(text) {
  const m = /^(.+?)\s*\(\s*(.+?)\s*\)$/.exec(text);
  if (!m) return text;
  const outside = m[1].trim();
  const inside = m[2].trim();
  if (normName(outside) === normName(inside)) return inside;
  return text;
}

export function splitProductCategoryAndDetail(raw = {}) {
  const baseText = String(raw.displayName || raw.prodName || '').trim();
  const category = cleanCategoryLabel(raw.flowerName, baseText);
  if (!baseText) return { category: category || '미분류', detail: '-' };

  let detail = baseText.replace(BRACKET_PREFIX_RE, '').trim();
  detail = detail.replace(COUNTRY_TAGS_RE, ' ').replace(/\s+/g, ' ').trim();

  if (category && category !== '기타') {
    const CATEGORY_ALIASES = {
      안시리움: ['안시리움', '안스리움'],
      안스리움: ['안스리움', '안시리움'],
      루스커스: ['루스커스', '루스쿠스'],
      알스트로: ['알스트로메리아', '알스트로'],
      호접난: ['호접난', '호접란'],
      리시안셔스: ['리시안셔스', '리시안사스', '리시안'],
    };
    const candidates = CATEGORY_ALIASES[category] || [category];
    for (const cand of candidates) {
      const escapedCat = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^(?:SPRAY\\s+)?${escapedCat}\\s*(?:/\\s*)?`, 'i');
      if (re.test(detail)) {
        detail = detail.replace(re, '').trim();
        break;
      }
    }
  }

  for (const prefix of KNOWN_CATEGORY_PREFIXES) {
    const re = new RegExp(`^${prefix}\\s*(?:/\\s*)?`, 'i');
    if (re.test(detail)) {
      detail = detail.replace(re, '').trim();
      break;
    }
  }

  detail = detail.replace(/^[/\-:·]+\s*/, '').trim();
  detail = normalizeSpecCase(detail);
  detail = deduplicateParenthetical(detail);

  if (!detail || normName(detail) === normName(category)) {
    return { category: category || '미분류', detail: '-' };
  }
  return { category: category || '미분류', detail };
}

export function normalizePurchaseUnit(unit) {
  const raw = String(unit || '').trim();
  if (!raw || raw === '단위 미지정') return '';
  const upper = raw.toUpperCase();
  if (upper === 'BOX' || raw === '박스') return '박스';
  if (upper === 'BUNCH' || raw === '단') return '단';
  if (upper === 'STEM' || upper === 'STEAM') return '송이';
  return raw;
}

export function sanitizeOrderRemark(descr) {
  const raw = String(descr || '').trim();
  if (!raw || INTERNAL_REMARK_RE.test(raw)) return '';
  return raw;
}

/**
 * 네노바 표준 차수 라벨 생성 (예: 동일 연도 `48-01차`, 타 연도 `2027-01-01차`)
 */
export function formatOrderWeekLabel(orderYear = '', orderWeek = '', referenceDateText = '') {
  let wk = String(orderWeek || '').trim().replace(/차$/, '').trim();
  let yr = String(orderYear || '').trim();
  const fullMatch = /^(\d{4})-(\d{1,2}-\d{1,2}[A-Za-z]?)$/.exec(wk);
  if (fullMatch) {
    if (!yr) yr = fullMatch[1];
    wk = fullMatch[2];
  }
  if (!wk) return '';
  const refYear = /^\d{4}/.test(String(referenceDateText || '')) ? String(referenceDateText).slice(0, 4) : '';
  if (yr && refYear && yr !== refYear) {
    return `${yr}-${wk}차`;
  }
  return `${wk}차`;
}

/**
 * 주문 비고에 차수를 결합하여 반환
 * - 기존 비고 없음: `48-01차`
 * - 기존 비고 있음: `48-01차 / 기존비고` (이미 동일 차수 표기가 들어있으면 중복 방지)
 */
export function formatOrderRemarkWithWeek(orderYear = '', orderWeek = '', rawRemark = '', referenceDateText = '') {
  const weekLabel = formatOrderWeekLabel(orderYear, orderWeek, referenceDateText);
  const cleanRemark = String(rawRemark || '').trim();
  if (!weekLabel) return cleanRemark;
  if (!cleanRemark) return weekLabel;

  const coreWeek = weekLabel.replace(/차$/, '');
  const escapedCore = coreWeek.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alreadyHasWeek = new RegExp(`(?:^|[^0-9])${escapedCore}(?:차|\\b|[^0-9])`).test(cleanRemark);
  if (alreadyHasWeek) return cleanRemark;
  return `${weekLabel} / ${cleanRemark}`;
}

function conciseVarietyLabel(category, detail) {
  if (!detail || detail === '-') return '';
  let label = String(detail).trim();
  const parenKorean = /^([^()]+)\(\s*([가-힣0-9\s/+-]+)\s*\)(.*)$/.exec(label);
  if (parenKorean) {
    const inside = parenKorean[2].trim();
    const tail = parenKorean[3].trim();
    if (inside) label = `${inside}${tail ? ` ${tail}` : ''}`.trim();
  }
  if (category === '루스커스') {
    const strippedGreen = label.replace(/^그린\s*/i, '').replace(/^Green\s*/i, '').trim();
    return strippedGreen;
  }
  return label;
}

export function formatSummaryQty(value) {
  const num = round3(value);
  return num.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
}

function summarizeCategoryItemsCore(items = []) {
  const byCategory = new Map();
  for (const item of items) {
    const qty = round3(item?.qty ?? item?.OutQuantity ?? 0);
    if (!(qty > 0)) continue;
    const category = String(item.category || '기타').trim() || '기타';
    const detail = String(item.detail ?? '-').trim() || '-';
    const unit = normalizePurchaseUnit(item.unit);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({ category, detail, qty, unit });
  }

  const parts = [];
  for (const [category, rows] of byCategory.entries()) {
    const varietyMap = new Map();
    for (const r of rows) {
      const shortLabel = conciseVarietyLabel(category, r.detail) || (r.detail === '-' ? '-' : r.detail);
      const vKey = `${shortLabel}|${r.unit}`;
      if (!varietyMap.has(vKey)) {
        varietyMap.set(vKey, { shortLabel, detail: r.detail, unit: r.unit, qty: 0 });
      }
      varietyMap.get(vKey).qty = round3(varietyMap.get(vKey).qty + r.qty);
    }
    const varieties = [...varietyMap.values()];
    const distinctVarietyNames = new Set(varieties.map(v => v.shortLabel));
    const distinctCount = distinctVarietyNames.size;
    const units = [...new Set(varieties.map(v => v.unit))];
    const singleUnit = units.length === 1 ? units[0] : '';
    const totalQty = round3(varieties.reduce((sum, v) => sum + v.qty, 0));

    if (varieties.length === 1) {
      const v = varieties[0];
      const specPart = v.shortLabel && v.shortLabel !== '-' && normName(v.shortLabel) !== normName(category)
        ? ` ${v.shortLabel}`
        : '';
      parts.push(`${category}${specPart} ${formatSummaryQty(v.qty)}${v.unit}`);
    } else if (distinctCount <= 4 && varieties.length <= 4) {
      const inner = varieties
        .map(v => {
          const name = v.shortLabel === '-' ? category : v.shortLabel;
          const unitSuffix = units.length === 1 ? '' : v.unit;
          return `${name} ${formatSummaryQty(v.qty)}${unitSuffix}`;
        })
        .join(', ');
      parts.push(`${category}(${inner})`);
    } else if (units.length === 1) {
      parts.push(`${category} ${formatSummaryQty(totalQty)}${singleUnit}(${distinctCount}종)`);
    } else {
      const byUnitTotals = units.map(u => {
        const uSum = round3(varieties.filter(v => v.unit === u).reduce((s, v) => s + v.qty, 0));
        return `${formatSummaryQty(uSum)}${u || '미지정'}`;
      });
      parts.push(`${category} ${byUnitTotals.join('·')}(${distinctCount}종)`);
    }
  }
  return parts.join(', ');
}

/**
 * 결정론적 거래처별 주요 발주 내역 요약 포매터 (차수 식별 포함)
 * - 차수 미지정 입력: `루스커스 1박스`, `수국(화이트 1, 진핑크 1, 블루 1)`, `카네이션 14박스(11종)`
 * - 단일 차수 거래처: `[48-02차] 장미(...)`
 * - 복수 차수 거래처: `[49-01차] 카네이션 6박스(5종) / [49-02차] 알스트로 NADYA 16단, 카네이션 17박스(14종)`
 */
export function summarizeCustomerOrderItems(items = [], { referenceDateText = '' } = {}) {
  const validItems = (items || []).filter(item => round3(item?.qty ?? item?.OutQuantity ?? 0) > 0);
  if (!validItems.length) return '';

  const weekGroups = new Map();
  for (const item of validItems) {
    const orderYear = String(item.orderYear ?? item.OrderYear ?? '').trim();
    const orderWeek = String(item.orderWeek ?? item.OrderWeek ?? '').trim();
    const weekLabel = formatOrderWeekLabel(orderYear, orderWeek, referenceDateText);
    const sortKey = `${orderYear || '0000'}|${orderWeek || ''}|${weekLabel}`;
    if (!weekGroups.has(sortKey)) {
      weekGroups.set(sortKey, { weekLabel, orderYear, orderWeek, rows: [] });
    }
    weekGroups.get(sortKey).rows.push(item);
  }

  const orderedGroups = [...weekGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => group);

  const hasAnyWeek = orderedGroups.some(g => Boolean(g.weekLabel));
  if (!hasAnyWeek) {
    return summarizeCategoryItemsCore(validItems);
  }

  return orderedGroups
    .map(group => {
      const body = summarizeCategoryItemsCore(group.rows);
      return group.weekLabel ? `[${group.weekLabel}] ${body}` : body;
    })
    .join(' / ');
}

export function sanitizeFilenamePart(value, fallback = '담당자') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
    .trim();
  return cleaned || fallback;
}

export function buildPurchaseOrderSheetModel(rawRows = [], { staffName = '담당자', dateText = '' } = {}) {
  const resolvedDate = dateText || kstDateString(new Date());
  const normalized = [];

  for (const r of rawRows || []) {
    const qty = round3(r.qty ?? r.outQuantity ?? r.OutQuantity ?? 0);
    if (!(qty > 0)) continue;
    const custName = String(r.custName ?? r.CustName ?? '').trim() || '거래처 미지정';
    const orderYear = String(r.orderYear ?? r.OrderYear ?? '').trim();
    const orderWeek = String(r.orderWeek ?? r.OrderWeek ?? '').trim();
    const hasExplicitCategory = typeof r.category === 'string' && r.category.trim() !== '';
    const parsed = hasExplicitCategory
      ? {
          category: r.category.trim(),
          detail: String(r.detail ?? '').trim() || '-',
        }
      : splitProductCategoryAndDetail({
          flowerName: r.flowerName ?? r.FlowerName,
          counName: r.counName ?? r.CounName,
          prodGroup: r.prodGroup ?? r.ProdGroup,
          prodName: r.prodName ?? r.ProdName,
          displayName: r.displayName ?? r.DisplayName,
        });
    const unit = normalizePurchaseUnit(r.unit ?? r.OutUnit);
    const rawRemark = r.remark !== undefined
      ? String(r.remark || '').trim()
      : sanitizeOrderRemark(r.descr ?? r.OdDescr);
    const weekLabel = formatOrderWeekLabel(orderYear, orderWeek, resolvedDate);
    const remark = formatOrderRemarkWithWeek(orderYear, orderWeek, rawRemark, resolvedDate);

    normalized.push({
      custName,
      category: parsed.category,
      detail: parsed.detail || '-',
      qty,
      unit,
      rawRemark,
      weekLabel,
      remark,
      orderYear,
      orderWeek,
      prodKey: r.prodKey ?? r.ProdKey ?? null,
    });
  }

  // 차수(orderYear + orderWeek)를 병합 키에 포함하여 동일 품종이라도 차수가 다르면 반드시 별도 행으로 분리
  const mergedMap = new Map();
  for (const item of normalized) {
    const mKey = JSON.stringify([
      item.custName,
      item.orderYear,
      item.orderWeek,
      item.category,
      item.detail,
      item.unit,
      item.remark,
    ]);
    if (!mergedMap.has(mKey)) {
      mergedMap.set(mKey, { ...item });
    } else {
      mergedMap.get(mKey).qty = round3(mergedMap.get(mKey).qty + item.qty);
    }
  }

  const sorted = [...mergedMap.values()].sort((a, b) => {
    const byCust = a.custName.localeCompare(b.custName, 'ko');
    if (byCust !== 0) return byCust;
    const byCat = a.category.localeCompare(b.category, 'ko');
    if (byCat !== 0) return byCat;
    const detA = a.detail === '-' ? '' : a.detail;
    const detB = b.detail === '-' ? '' : b.detail;
    const byDet = detA.localeCompare(detB, 'ko');
    if (byDet !== 0) return byDet;
    const byYear = a.orderYear.localeCompare(b.orderYear);
    if (byYear !== 0) return byYear;
    const byWeek = a.orderWeek.localeCompare(b.orderWeek);
    if (byWeek !== 0) return byWeek;
    return a.unit.localeCompare(b.unit, 'ko');
  });

  const detailRows = [];
  let prevCust = null;
  let prevCat = null;
  let totalQty = 0;

  sorted.forEach((item, index) => {
    const isNewCustomer = index === 0 || item.custName !== prevCust;
    const isNewCategory = isNewCustomer || item.category !== prevCat;
    totalQty = round3(totalQty + item.qty);
    detailRows.push({
      no: index + 1,
      custName: item.custName,
      category: item.category,
      customerDisplay: isNewCustomer ? item.custName : '',
      categoryDisplay: isNewCategory ? item.category : '',
      detailDisplay: item.detail || '-',
      qty: item.qty,
      unit: item.unit,
      remark: item.remark,
      weekLabel: item.weekLabel,
      isNewCustomer,
      isNewCategory,
      orderYear: item.orderYear,
      orderWeek: item.orderWeek,
    });
    prevCust = item.custName;
    prevCat = item.category;
  });

  const includedWeeks = [...new Set(
    sorted
      .slice()
      .sort((a, b) => a.orderYear.localeCompare(b.orderYear) || a.orderWeek.localeCompare(b.orderWeek))
      .map(item => item.weekLabel)
      .filter(Boolean),
  )];

  const detailTotalRow = {
    labelA: '총 발주 품목 수 / 단순 수량 합계',
    totalQty,
    countLabelF: `총 ${detailRows.length}건`,
    noteG: '단위(박스/단/대/미지정) 상이함 유의',
  };

  const customerGroups = new Map();
  for (const item of sorted) {
    if (!customerGroups.has(item.custName)) customerGroups.set(item.custName, []);
    customerGroups.get(item.custName).push(item);
  }

  const customerSummaryRows = [];
  for (const [custName, items] of customerGroups.entries()) {
    const custQty = round3(items.reduce((sum, x) => sum + x.qty, 0));
    customerSummaryRows.push({
      custName,
      itemCount: items.length,
      totalQty: custQty,
      summaryText: summarizeCustomerOrderItems(items, { referenceDateText: resolvedDate }),
    });
  }

  const customerSummaryTotalRow = {
    labelA: '합계',
    totalCount: detailRows.length,
    totalQty,
    customerCountLabel: `총 ${customerSummaryRows.length}개 거래처`,
  };

  const safeStaff = sanitizeFilenamePart(staffName, '담당자');
  const filename = `화훼_발주_내역서_${safeStaff}_${resolvedDate}.xlsx`;

  return {
    title: '화훼 발주 내역서',
    summarySectionTitle: '거래처별 발주 요약',
    staffName,
    dateText: resolvedDate,
    filename,
    includedWeeks,
    itemCount: detailRows.length,
    customerCount: customerSummaryRows.length,
    totalQty,
    detailHeaders: ['No.', '거래처', '품목(대분류)', '상세품종 / 규격', '수량', '단위', '비고'],
    detailRows,
    detailTotalRow,
    summaryHeaders: ['거래처', '품목 건수', '단순 수량 합계', '주요 발주 내역 요약'],
    customerSummaryRows,
    customerSummaryTotalRow,
  };
}

export function buildPurchaseOrderSheetRowsAoA(model) {
  const aoa = [];
  aoa.push([model.title || '화훼 발주 내역서', '', '', '', '', '', '']);
  aoa.push(['', '', '', '', '', '', '']);
  aoa.push([...model.detailHeaders]);
  for (const row of model.detailRows) {
    aoa.push([
      row.no,
      row.customerDisplay,
      row.categoryDisplay,
      row.detailDisplay,
      row.qty,
      row.unit,
      row.remark,
    ]);
  }
  aoa.push([
    model.detailTotalRow.labelA,
    '',
    '',
    '',
    model.detailTotalRow.totalQty,
    model.detailTotalRow.countLabelF,
    model.detailTotalRow.noteG,
  ]);
  aoa.push(['', '', '', '', '', '', '']);
  aoa.push([model.summarySectionTitle || '거래처별 발주 요약', '', '', '', '', '', '']);
  aoa.push(['', '', '', '', '', '', '']);
  aoa.push([
    model.summaryHeaders[0],
    model.summaryHeaders[1],
    model.summaryHeaders[2],
    model.summaryHeaders[3],
    '',
    '',
    '',
  ]);
  for (const s of model.customerSummaryRows) {
    aoa.push([s.custName, s.itemCount, s.totalQty, s.summaryText, '', '', '']);
  }
  aoa.push([
    model.customerSummaryTotalRow.labelA,
    model.customerSummaryTotalRow.totalCount,
    model.customerSummaryTotalRow.totalQty,
    model.customerSummaryTotalRow.customerCountLabel,
    '',
    '',
    '',
  ]);
  return aoa;
}
