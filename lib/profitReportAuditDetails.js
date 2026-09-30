// lib/profitReportAuditDetails.js — 주차별 매출이익 보고서 경고의 "무엇이·얼마나·어디서" 상세.
//
// 2026-09-30 사장님 피드백: "모든 경고요소는 명확하게 어떤어떤것인지 표시되어야 해".
// buildProfitReportAudit의 판정 로직·임계값은 그대로 두고, 이미 판정된 이슈마다
//   - summary : 한 줄 요약(반차수·카테고리·필드를 이름으로)
//   - sections: 항목별 있음/없음 + 현재값
//   - impact  : 영향 열(E/F/G/H/I/J…)과 대략 금액, 계산 불가면 그 사유
//   - fix     : 고칠 화면(버튼 동작 + 새 창 URL, 해당 반차수·카테고리 미리 선택)
// 을 순수 함수로 만든다. 계산값을 바꾸지 않으며 표시·진단 전용이다.

const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const has = (v) => v != null && Number.isFinite(Number(v)) && Math.abs(Number(v)) > 0.0001;

export function fmtWon(v) {
  return `${Math.round(n0(v)).toLocaleString('ko-KR')}원`;
}
export function fmtNum(v, digits = 2) {
  const x = n0(v);
  return Number.isInteger(x) ? x.toLocaleString('ko-KR') : x.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

/** 콜롬비아 반차수 그외통관비 구성요소 — CustomsClearancePanel COLOMBIA_FIELDS와 같은 순서·이름. */
export const COLOMBIA_COMPONENT_FIELDS = [
  ['GW', 'GW(kg)', 'kg'],
  ['CW', 'CW(kg)', 'kg'],
  ['HandlingFee', '선율 통관수수료', 'won'],
  ['ItemCount', '품목수', 'count'],
  ['Truck1t', '트럭 1t 대수', 'count'],
  ['Truck2_5t', '트럭 2.5t 대수', 'count'],
  ['Truck5t', '트럭 5t 대수', 'count'],
  ['CustomsFee', '관세료', 'won'],
  ['DisinfectFee', '소독비용', 'won'],
  ['QuarantineDeductFee', '검역비용(차감stems)', 'won'],
];

/** 국가별 그외통관비 구성요소 — 1차/2차 입고 각각. */
export const COUNTRY_COMPONENT_FIELDS = [
  ['GW1', '백상창고료 GW 1차(kg)', 'kg'], ['GW2', '백상창고료 GW 2차(kg)', 'kg'],
  ['Customs1', '관세 1차', 'won'], ['Customs2', '관세 2차', 'won'],
  ['SunYul1', '선율 1차', 'won'], ['SunYul2', '선율 2차', 'won'],
  ['WorldFreight1', '월드운송료(국내운송) 1차', 'won'], ['WorldFreight2', '월드운송료(국내운송) 2차', 'won'],
  ['Quarantine1', '한국방역 1차', 'won'], ['Quarantine2', '한국방역 2차', 'won'],
];

function fmtField(value, kind) {
  if (!has(value)) return '없음';
  if (kind === 'kg') return `${fmtNum(value)}kg`;
  if (kind === 'count') return `${fmtNum(value)}`;
  return fmtWon(value);
}

const COLOMBIA_CATEGORIES = ['콜롬비아 장미', '콜롬비아 카네이션', '콜롬비아 알스트로', '콜롬비아 루스커스'];

/** 화면 이동 링크 — 같은 보고서 안에서 여는 동작(action)과 새 창 URL(href)을 함께 준다. */
export function buildFixLink(action, { orderYear, major, focus } = {}) {
  const q = (params) => Object.entries(params)
    .filter(([, v]) => v != null && String(v) !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  const week = major != null && String(major) !== '' ? String(major).padStart(2, '0') : '';
  switch (action) {
    case 'customs':
      return { action, focus: focus || null, label: `그외통관비 입력 열기${focus ? ` (${focus})` : ''}`,
        href: `/sales/customs-clearance?${q({ year: orderYear, week, focus })}` };
    case 'forwarding':
      return { action, focus: focus || null, label: `항공료 연결 확인 열기${focus ? ` (${focus})` : ''}`,
        href: `/sales/forwarding-clearance?${q({ year: orderYear, week, focus })}` };
    case 'stockPrice':
      return { action, focus: focus || null, label: '재고 매입단가 입력 열기', href: null };
    case 'rate':
      return { action, focus: focus || null, label: `과세환율 입력칸으로 이동${focus ? ` (${focus})` : ''}`, href: null };
    case 'classification':
      return { action, focus: focus || null, label: '기타(미분류) 품목 처리 영역으로 이동', href: null };
    case 'stock':
      return { action, focus: focus || null, label: '재고 현황 열기', href: '/stock' };
    default:
      return null;
  }
}

/**
 * 콜롬비아 4품목 공유 그외통관비 — 반차수별 구성요소 있음/없음.
 * 누락 반차수에는 "다른 반차수에는 있는데 여기엔 없는 구성요소"를 따로 뽑는다(예: 38-02엔 있고 38-01엔 없는 것).
 */
/** 콜롬비아 반차수 GW 상태 문구 — "입력 화면에 없음 but 전산에 있음(자동 적용)" vs "모두 없음"을 구분한다. */
export function colombiaWeekStateText(w = {}, isMissing = false) {
  if (w.inbound === false && !(n0(w.gw) > 0)) return '콜롬비아 4품목 입고 없음(정상)';
  if (isMissing) return w.saved ? '누락(입력 화면 저장행은 있으나 GW 0 · 전산 입고 GW도 없음)' : '누락(입력 화면·전산 입고 모두 GW 없음)';
  if (w.gwSource === 'manual') return '수기 입력';
  if (w.gwSource === 'erp_inbound') {
    const src = (w.erpWeight?.sources || []);
    const farms = [...new Set(src.map((x) => x.farm).filter(Boolean))].join('·') || '포워더';
    const mixed = src.some((x) => x.pooledWithHydrangea) ? ' · 콜카장수국 혼적 AWB 전체를 수국 포함 5품목 한 풀로 배분'
      : src.some((x) => x.mixed) ? ' · 혼적 AWB 박스무게 비율 분할' : '';
    const clamp = src.some((x) => x.gwClampedToCw) ? ' · 전산 GW>CW 라 CW 사용' : '';
    return `입력 화면에 없음 → 전산 입고(${farms}) 자동 적용: GW ${fmtNum(w.erpWeight?.GW)} / CW ${fmtNum(w.erpWeight?.CW)}${mixed}${clamp}`;
  }
  return w.saved ? '입력 저장됨' : '입고관리 GW 자동값';
}

export function buildColombiaCustomsDetail(colombiaWeeks = [], { orderYear, major, currentH = null } = {}) {
  const weeks = (colombiaWeeks || []).map((w) => ({ ...w, components: w.components || {} }));
  const noInbound = (w) => w.inbound === false && !(n0(w.gw) > 0);
  const missingWeeks = weeks.filter((w) => !(n0(w.gw) > 0) && !noInbound(w));
  const presentWeeks = weeks.filter((w) => n0(w.gw) > 0);
  const sections = weeks.map((w) => {
    const isMissing = !(n0(w.gw) > 0) && !noInbound(w);
    const peerHas = (field) => weeks.some((p) => p.orderWeek !== w.orderWeek && has(p.components[field]));
    const items = COLOMBIA_COMPONENT_FIELDS.map(([field, label, kind]) => {
      const value = w.components[field];
      const present = has(value);
      const peer = weeks.find((p) => p.orderWeek !== w.orderWeek && has(p.components[field]));
      return {
        field, label,
        status: present ? 'present' : (peerHas(field) || field === 'GW' ? 'missing' : 'info'),
        value: fmtField(value, kind),
        compare: !present && peer ? `${peer.orderWeek}: ${fmtField(peer.components[field], kind)}` : null,
      };
    });
    const missingVsPeers = items.filter((it) => it.status === 'missing').map((it) => it.label);
    // 어느 반차수에도 값이 없는 구성요소는 한 줄로 접는다(38-01 vs 38-02 비교를 가리지 않게).
    const allEmpty = items.filter((it) => it.status === 'info').map((it) => it.label);
    const shown = items.filter((it) => it.status !== 'info');
    if (allEmpty.length) shown.push({ field: null, label: '모든 반차수에 값 없음', status: 'info', value: allEmpty.join('·'), compare: null });
    return {
      title: `${w.orderWeek} — ${colombiaWeekStateText(w, isMissing)} · 반차수 그외통관비 ${fmtWon(w.total)}`,
      status: isMissing ? 'missing' : noInbound(w) ? 'info' : 'present',
      gwSource: w.gwSource || null,
      orderWeek: w.orderWeek,
      missingVsPeers,
      items: shown,
    };
  });
  const missingText = missingWeeks.map((w) => {
    const sec = sections.find((s) => s.orderWeek === w.orderWeek);
    return `${w.orderWeek}(${(sec?.missingVsPeers || []).join('·') || 'GW(kg)'} 없음)`;
  }).join(', ');
  const presentText = presentWeeks.map((w) => w.orderWeek).join(', ');
  const summary = missingWeeks.length
    ? `콜롬비아 4품목(${COLOMBIA_CATEGORIES.map((c) => c.replace('콜롬비아 ', '')).join('·')}) 그외통관비 — 누락 반차수 ${missingText}${presentText ? ` / 입력됨 ${presentText}` : ''}`
    : '콜롬비아 4품목 그외통관비 — 반차수별 원천 확인 필요';
  // 영향 추정: 누락 반차수도 입력된 반차수와 비슷한 규모라고 보고, 입력된 반차수 평균 합계만큼 H가 적게 잡혀 있다.
  let impact;
  if (missingWeeks.length && presentWeeks.length) {
    const avg = presentWeeks.reduce((s, w) => s + n0(w.total), 0) / presentWeeks.length;
    const est = avg * missingWeeks.length - missingWeeks.reduce((s, w) => s + n0(w.total), 0);
    impact = {
      columns: ['H', 'I', 'J'],
      amount: Math.round(est),
      text: `그외통관비(H)·매출원가(I)가 약 ${fmtWon(est)} 적게, 매출이익(J)이 그만큼 많게 잡혀 있을 수 있습니다(추정: ${presentWeeks.map((w) => `${w.orderWeek} ${fmtWon(w.total)}`).join(', ')} 기준).${currentH != null ? ` 현재 4품목 H 합계 ${fmtWon(currentH)}.` : ''}`,
    };
  } else {
    impact = { columns: ['H', 'I', 'J'], amount: null, text: '영향 계산 불가 — 비교할 입력된 반차수가 없습니다. 원천 입력 후 H가 늘어나는 만큼 매출이익(J)이 줄어듭니다.' };
  }
  return {
    summary,
    sections,
    impact,
    fix: buildFixLink('customs', { orderYear, major, focus: missingWeeks[0]?.orderWeek || null }),
  };
}

/** 국가 카테고리(호주·베트남 등) 그외통관비 — 1차/2차 구성요소별 있음/없음. */
export function buildCountryCustomsDetail(row = {}, { orderYear, major, inboundWeeks = [], components = null } = {}) {
  const comp = components || row.customsComponents || {};
  const items = COUNTRY_COMPONENT_FIELDS.map(([field, label, kind]) => ({
    field, label, status: has(comp[field]) ? 'present' : 'missing', value: fmtField(comp[field], kind),
  }));
  const missing = items.filter((i) => i.status === 'missing').map((i) => i.label);
  const present = items.filter((i) => i.status === 'present').map((i) => `${i.label} ${i.value}`);
  return {
    summary: `${row.category} 그외통관비 — 없음: ${missing.join('·') || '(없음)'}${present.length ? ` / 있음: ${present.join(', ')}` : ''}${inboundWeeks.length ? ` / 입고 반차수 ${inboundWeeks.join(', ')}` : ''}`,
    sections: [{ title: `${row.category} 구성요소 (입고 반차수 ${inboundWeeks.join(', ') || '없음'})`, status: 'missing', items }],
    impact: {
      columns: ['H', 'I', 'J'], amount: null,
      text: `영향 계산 불가 — 현재 H ${fmtWon(row.auto?.H)} 반영. 누락 구성요소 금액만큼 매출원가(I)가 적고 매출이익(J)이 많게 잡혀 있습니다.`,
    },
    fix: buildFixLink('customs', { orderYear, major, focus: row.category }),
  };
}

function productLabel(item) {
  const name = String(item.displayName || item.prodName || '').trim();
  const key = item.prodKey != null && String(item.prodKey) !== '' ? String(item.prodKey) : '';
  return name && key ? `${name}(${key})` : name || (key ? `품목번호 ${key}` : '품목 미상');
}

/** 기초(E)/기말(F) 재고 단가 근거 누락 — 품목별 목록. */
export function buildStockPriceDetail(row = {}, col = 'F', { orderYear, major } = {}) {
  const stock = col === 'E' ? (row.beginStock || {}) : (row.stock || {});
  const label = col === 'E' ? '기초상품재고액(E)' : '기말상품재고액(F)';
  const items = (stock.missingPriceItems || []).map((item) => ({
    label: productLabel(item), status: 'missing',
    value: `매입단가 없음${item.unit ? ` · 단위 ${item.unit}` : ''}`,
  }));
  const conv = (stock.conversionIssues || []).map((item) => ({
    label: `품목번호 ${item.prodKey}`, status: 'missing', value: `단위 환산 없음(${item.outUnit || '?'}→${item.estUnit || '?'})`,
  }));
  const all = [...items, ...conv];
  const count = all.length || Number(stock.missingPriceCount || 0);
  return {
    summary: `${row.category} ${label} — 매입단가 근거 없는 품목 ${count.toLocaleString()}건${all.length ? `: ${all.slice(0, 5).map((i) => i.label).join(', ')}${all.length > 5 ? ` 외 ${all.length - 5}건` : ''}` : ''} (재고수량 ${fmtNum(stock.endQty)}${stock.week ? `, 스냅샷 ${stock.week}` : ''})`,
    sections: [{ title: `${row.category} · ${label} 단가 누락 품목`, status: 'missing', items: all }],
    impact: { columns: [col, 'I', 'J'], amount: null, text: `영향 계산 불가 — 단가가 없어 해당 품목 재고금액이 ${label}에서 빠져 있습니다(단가 입력 전까지 금액 미상).` },
    fix: buildFixLink('stockPrice', { orderYear, major, focus: row.category }),
  };
}

/** 과세환율(R) 누락/근사 — 통화·구매금액·참고 환율과 그 환율로 본 P/T 금액. */
export function buildRateDetail(row = {}, { orderYear, major, approximated = false } = {}) {
  const cur = row.currency || 'USD';
  const q = n0(row.auto?.Q), s = n0(row.auto?.S);
  const sugg = (row.rateSuggestions || []).filter((x) => n0(x.rate) > 0);
  const items = [
    { label: `구매금액 Q(${cur})`, status: has(q) ? 'present' : 'info', value: fmtNum(q) },
    { label: `포워딩 S(${cur === 'KRW' ? 'USD' : cur})`, status: has(s) ? 'present' : 'info', value: fmtNum(s) },
    { label: `과세환율 R(${major}차 ${cur})`, status: approximated ? 'info' : 'missing', value: approximated ? `근사 ${fmtNum(row.auto?.R)}` : '없음' },
    ...sugg.map((x) => ({ label: `참고: ${x.label || x.kind}`, status: 'info', value: fmtNum(x.rate) })),
  ];
  const ref = sugg[0];
  const impact = ref
    ? { columns: ['G', 'P', 'T', 'I', 'J'], amount: Math.round((q + s) * n0(ref.rate)),
      text: approximated
        ? `근사 환율 ${fmtNum(row.auto?.R)} 적용 중 — 실제 신고환율과 1원 차이당 매입액(G)이 약 ${fmtWon(q + s)} 달라집니다.`
        : `환율이 없어 매입액(G=P+T)이 0으로 빠져 있습니다. ${ref.label} ${fmtNum(ref.rate)} 기준 약 ${fmtWon((q + s) * n0(ref.rate))}이 매출원가(I)에 빠지고 매출이익(J)이 그만큼 과대입니다.` }
    : { columns: ['G', 'I', 'J'], amount: null, text: approximated ? '영향 계산 불가 — 비교할 신고 환율이 없습니다.' : '영향 계산 불가 — 참고 환율이 없습니다. 환율 입력 전까지 매입액(G)이 0입니다.' };
  return {
    summary: `${row.category} 과세환율 ${approximated ? '근사 적용' : '없음'} — ${cur} 구매 ${fmtNum(q)}${has(s) ? ` + 포워딩 ${fmtNum(s)}` : ''}${ref ? ` (참고 ${ref.label} ${fmtNum(ref.rate)})` : ''}`,
    sections: [{ title: `${row.category} 환율 원천`, status: approximated ? 'info' : 'missing', items }],
    impact,
    fix: buildFixLink('rate', { orderYear, major, focus: row.category }),
  };
}

/** 항공료(S) 전표 누락 — 콜롬비아 반차수별 감지 여부 또는 국가 범위. */
export function buildForwardingDetail({ category, colombiaWeeks = [], missingScopes = [], rows: ledgerRows = [], orderYear, major, focus = null, previous = false }) {
  const sections = [];
  if (colombiaWeeks.length) {
    sections.push({
      title: '콜롬비아 반차수별 항공료 전표',
      status: colombiaWeeks.some((w) => w.forwardingDetected !== true) ? 'missing' : 'present',
      items: colombiaWeeks.map((w) => ({
        label: w.orderWeek, status: w.forwardingDetected === true ? 'present' : 'missing',
        value: w.forwardingDetected === true ? '전표 연결됨' : '항공료 전표 없음(BILL/AWB 미연결)',
      })),
    });
  }
  if (missingScopes.length) {
    sections.push({ title: '구매는 있는데 항공료가 없는 범위', status: 'missing',
      items: missingScopes.map((m) => ({ label: `${m.orderWeek} ${m.category}`, status: 'missing', value: '항공료 전표 없음' })) });
  }
  if (ledgerRows.length) {
    sections.push({ title: '해당 전표', status: 'missing',
      items: ledgerRows.map((r) => ({ label: `${r.orderWeek || '-'} · ${r.farmName || '-'} · ${r.invoiceNo || r.awb || '-'}`, status: 'missing', value: `${r.prodName || '-'} · ${fmtNum(r.amount)}` })) });
  }
  const missingLabels = [
    ...colombiaWeeks.filter((w) => w.forwardingDetected !== true).map((w) => w.orderWeek),
    ...missingScopes.map((m) => `${m.orderWeek} ${m.category}`),
  ];
  return {
    summary: `${category} 항공료(S)${previous ? ' — 전차수' : ''} — ${missingLabels.length ? `누락: ${missingLabels.join(', ')}` : ledgerRows.length ? `확인 전표 ${ledgerRows.length}건` : '원천 확인 필요'}`,
    sections,
    impact: { columns: previous ? ['E'] : ['S', 'T', 'G', 'I', 'J'], amount: null,
      text: '영향 계산 불가 — 전표 금액이 연결되지 않아 포워딩(S·T)과 매입액(G)이 그만큼 적고 매출이익(J)이 많게 잡혀 있을 수 있습니다.' },
    fix: buildFixLink('forwarding', { orderYear, major, focus: focus || missingLabels[0]?.split(' ')[0] || null }),
  };
}

/** 근사(E/F) — 반영된 근사 금액을 보여준다. */
export function buildApproxStockDetail(row = {}, col = 'F', { orderYear, major } = {}) {
  const stock = col === 'E' ? (row.beginStock || {}) : (row.stock || {});
  const label = col === 'E' ? '기초상품재고액(E)' : '기말상품재고액(F)';
  const auto = col === 'E' ? row.auto?.E : row.auto?.F;
  const items = (stock.needsInputItems || []).map((item) => ({
    label: productLabel(item), status: 'info',
    value: `자동단가 ${fmtNum(item.autoPrice)} × ${fmtNum(item.qty)}${item.reason ? ` · ${item.reason}` : ''}`,
  }));
  return {
    summary: `${row.category} ${label} 근사값 ${fmtWon(auto)} 반영 (방식: ${sourceLabel(row.source?.[col])}${items.length ? `, 자동평가 품목 ${items.length}건` : ''})`,
    sections: items.length ? [{ title: '자동평가(판매단가·이월) 품목', status: 'info', items }] : [],
    impact: { columns: [col, 'I', 'J'], amount: null, text: `영향 계산 불가 — 현재 근사값 ${fmtWon(auto)}이 반영되어 있고, 실제 매입근거와의 차이는 입력 전까지 알 수 없습니다.` },
    fix: buildFixLink('stockPrice', { orderYear, major, focus: row.category }),
  };
}

function sourceLabel(src) {
  return ({
    category_average_fallback: '카테고리 평균원가 확대',
    carried_category_unit_cost: '전차수 단가 이월',
    sales_price_auto: '판매단가 자동평가',
  })[src] || src || '-';
}
