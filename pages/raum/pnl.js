// 라움 손익계산서 — 강남/건대 견적서(거래명세표) 업로드 → 품목+단가 동일 합산 → 차수별 손익 저장·인쇄.
// 매출단가 = 견적서 단가(자동), 매입단가 = 수기 입력(전산 참고단가 = Product.Cost÷1.1 채우기 보조).
// 순익분배 기본: 네노바 80% : 미우 20% (차수별 수정 가능). 인쇄는 iframe srcdoc 방식(프로젝트 규칙).
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

const fmt = v => (v == null || Number.isNaN(Number(v)) ? '' : Math.round(Number(v)).toLocaleString());
const fmt1 = v => (v == null || Number.isNaN(Number(v)) ? '' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const pct = v => (v == null || !Number.isFinite(v) ? '' : `${(v * 100).toFixed(1)}%`);
const dateStr = v => (v ? String(v).slice(0, 10) : '');

// 행 계산 — 매입액/이익/분배 (매입단가 미입력 행은 null, 사입 행은 손익 제외)
function computeItemRow(it, nenovaPct) {
  if (it.consigned) {
    return { costAmount: null, profit: null, rate: null, nenova: null, miu: null, consigned: true };
  }
  const cost = it.costPrice != null && it.costPrice !== '' ? Number(it.costPrice) : null;
  const costAmount = cost != null ? cost * Number(it.qty || 0) : null;
  const sale = Number(it.supply || 0);
  const profit = costAmount != null ? sale - costAmount : null;
  const rate = profit != null && sale > 0 ? profit / sale : null;
  return {
    costAmount,
    profit,
    rate,
    nenova: profit != null ? profit * (nenovaPct / 100) : null,
    miu: profit != null ? profit * ((100 - nenovaPct) / 100) : null,
  };
}

// 합계 — 매출(sale)은 사입 포함(견적서와 일치), 손익(cost/profit/분배)은 사입 제외.
// 이익율 분모 = 손익대상 매출(pnlSale = 전체 - 사입)
function computeTotals(items, nenovaPct) {
  let sale = 0; let consignedSale = 0; let consignedCnt = 0; let cost = 0; let missing = 0;
  for (const it of items) {
    const supply = Number(it.supply || 0);
    sale += supply;
    if (it.consigned) {
      consignedSale += supply;
      consignedCnt += 1;
      continue;
    }
    const r = computeItemRow(it, nenovaPct);
    if (r.costAmount == null) missing += 1;
    else cost += r.costAmount;
  }
  const pnlSale = sale - consignedSale;
  const profit = pnlSale - cost;
  return {
    sale, consignedSale, consignedCnt, pnlSale, cost, missing, profit,
    rate: pnlSale > 0 ? profit / pnlSale : null,
    nenova: profit * (nenovaPct / 100),
    miu: profit * ((100 - nenovaPct) / 100),
  };
}

// ── 전산 분배 대조 — 견적서 vs 전산 라움 분배(수량·단가) ──────
// 수량: 같은 전산품목(prodKey)의 견적 행 수량 합 vs 전산 분배수량(EstQuantity 합) — 단가 분리 행도 합쳐 비교.
// 단가: 행 단가 vs 전산 평균 분배단가(±2% — 세부차수 단가 혼합 평균이라 오차 허용).
function quoteQtyByProdKey(items) {
  const m = {};
  for (const it of items) {
    if (it.isCustom || it.consigned || it.prodKey == null) continue;
    m[it.prodKey] = (m[it.prodKey] || 0) + Number(it.qty || 0);
  }
  return m;
}
function erpCompare(it, qtyByProd) {
  if (it.isCustom) return { label: '—', tone: 'muted', title: '수동 추가 행 — 전산 분배 대상 아님' };
  if (it.consigned) return { label: '사입', tone: 'muted', title: '사입(원산지 없음) — 전산 분배 대상 아님' };
  if (it.prodKey == null) return { label: '전산 미매칭 ⚪', tone: 'muted', title: '전산 품목과 매칭되지 않아 비교 불가' };
  const erpQty = it.erpQty != null ? Number(it.erpQty) : null;
  const erpPrice = it.erpSalePrice != null ? Number(it.erpSalePrice) : null;
  if ((erpQty == null || erpQty === 0) && erpPrice == null) {
    return { label: '이번차수 분배없음', tone: 'warn', title: '해당 차수 라움 분배에 이 품목이 없음 — 이월 품목이면 정상' };
  }
  const quoteQty = qtyByProd[it.prodKey] || 0;
  // 단위계수 자동 인식 — 전산은 송이, 견적은 단 기준인 품목(알스트로 등: 430송이@630 = 43단@6,300).
  // 단가 비율이 깨끗한 묶음수(10·20 등)면 그 계수로 환산해 비교. 금액(수량×단가)은 단위와 무관하게 보존됨.
  let k = 1;
  const price = it.price != null ? Number(it.price) : null;
  if (erpPrice > 0 && price > 0) {
    for (const cand of [1, 5, 10, 12, 20, 25, 30, 50]) {
      if (Math.abs(price - erpPrice * cand) <= price * 0.02) { k = cand; break; }
    }
  }
  const adjQty = erpQty != null ? erpQty / k : null;
  const adjPrice = erpPrice != null ? erpPrice * k : null;
  const qtyOk = adjQty == null ? null : Math.abs(adjQty - quoteQty) < 0.01;
  const priceOk = adjPrice == null || price == null
    ? null
    : Math.abs(adjPrice - price) <= Math.max(1, price * 0.02);
  const parts = [];
  if (adjQty != null) parts.push(`수량 ${fmt(adjQty)}${qtyOk ? '✓' : `≠견적 ${fmt(quoteQty)} ✗`}`);
  if (adjPrice != null) parts.push(`단가 ${fmt1(adjPrice)}${priceOk ? '✓' : ' ✗'}`);
  const bad = qtyOk === false || priceOk === false;
  const unitNote = k > 1 ? ` · 전산 송이단위 ×${k} 환산(원값 ${fmt(erpQty)}송이@${fmt1(erpPrice)})` : '';
  return {
    label: parts.join(' · ') || '—',
    tone: bad ? 'bad' : 'ok',
    title: bad
      ? `전산 분배와 다릅니다 — 전산: 수량 ${fmt(adjQty)} / 단가 ${fmt1(adjPrice)}, 견적: 수량 ${fmt(quoteQty)}${quoteQty !== Number(it.qty) ? `(이 행 ${fmt(it.qty)})` : ''} / 단가 ${fmt1(price)}${unitNote}`
      : `전산 분배와 일치 (수량 ${fmt(adjQty)} / 단가 ${fmt1(adjPrice)})${quoteQty !== Number(it.qty || 0) ? ' · 수량은 같은 품목 행 합계 기준' : ''}${unitNote}`,
  };
}
const ERP_TONE = {
  ok: { color: '#166534' },
  bad: { color: '#b91c1c', background: '#fee2e2', fontWeight: 600 },
  warn: { color: '#92400e', background: '#fef3c7' },
  muted: { color: '#94a3b8' },
};

// ── 인쇄 (iframe srcdoc — 프로젝트 규칙: Blob+window.open 금지) ──
function printInIframe(html) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  iframe.srcdoc = html;
  let done = false;
  const cleanup = () => { if (done) return; done = true; setTimeout(() => iframe.remove(), 500); };
  iframe.onload = () => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { console.error('[print]', e); }
    try { iframe.contentWindow.onafterprint = cleanup; } catch { /* cross-origin 등 */ }
    setTimeout(cleanup, 3000);
  };
  document.body.appendChild(iframe);
}

const PRINT_CSS = `
  * { box-sizing: border-box; font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; }
  body { margin: 0; padding: 16px 20px; color: #111; }
  h1 { font-size: 17px; text-align: center; margin: 0 0 4px; }
  .sub { text-align: center; font-size: 11px; color: #444; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th, td { border: 1px solid #555; padding: 3px 5px; }
  th { background: #f0f0f0; font-weight: 700; text-align: center; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.ctr { text-align: center; }
  tr.total td { font-weight: 700; background: #fafafa; }
  .note { margin-top: 10px; font-size: 11px; }
  .missing { color: #b91c1c; }
  @media print { @page { size: A4 landscape; margin: 9mm 10mm; } }
`;

function buildDetailPrintHtml(meta, items, totals, branches) {
  const nen = Number(meta.nenovaPct);
  const rows = items.map((it, i) => {
    const r = computeItemRow(it, nen);
    const costCell = it.consigned ? '<span style="color:#888">사입</span>'
      : (it.costPrice != null ? fmt1(it.costPrice) : '<span class="missing">미입력</span>');
    return `<tr${it.consigned ? ' style="background:#f3f4f6;color:#555"' : ''}>
      <td class="ctr">${i + 1}</td>
      <td>${it.name}${it.consigned ? ' <small>(사입)</small>' : ''}</td>
      <td class="ctr">${it.unit || ''}</td>
      ${branches.map(b => `<td class="num">${fmt(it.byBranch?.[b])}</td>`).join('')}
      <td class="num">${fmt(it.qty)}</td>
      <td class="num">${costCell}</td>
      <td class="num">${fmt(r.costAmount)}</td>
      <td class="num">${fmt1(it.price)}</td>
      <td class="num">${fmt(it.supply)}</td>
      <td class="num">${it.consigned ? '—' : fmt(r.profit)}</td>
      <td class="num">${pct(r.rate)}</td>
      <td class="num">${fmt(r.nenova)}</td>
      <td class="num">${fmt(r.miu)}</td>
    </tr>`;
  }).join('');
  const missingNote = totals.missing > 0 ? `<div class="note missing">⚠ 매입단가 미입력 품목 ${totals.missing}건 — 총매입/이익은 입력된 품목만 합산된 값입니다.</div>` : '';
  const consignedNote = totals.consignedSale > 0
    ? `<div class="note">사입(원산지 없음) ${totals.consignedCnt}건 매출 ${fmt(totals.consignedSale)}원 — 매출액 합계에는 포함, 손익(매입·이익·분배) 계산에서는 제외. 이익율 분모는 손익대상 매출 ${fmt(totals.pnlSale)}원.</div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${meta.title}</title><style>${PRINT_CSS}</style></head><body>
    <h1>${meta.title} 손익계산서</h1>
    <div class="sub">견적일 ${dateStr(meta.quoteDate) || '-'} · 순익분배 네노바 ${nen}% : 미우 ${100 - nen}% · VAT 별도</div>
    <table>
      <thead><tr>
        <th>순번</th><th>품목명</th><th>단위</th>
        ${branches.map(b => `<th>${b}</th>`).join('')}
        <th>수량계</th><th>매입단가</th><th>매입액</th><th>매출단가</th><th>매출액</th>
        <th>이익</th><th>이익율</th><th>네노바이익<br/>(${nen}%)</th><th>미우이익<br/>(${100 - nen}%)</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="total">
          <td class="ctr" colspan="3">합계</td>
          ${branches.map(b => `<td class="num">${fmt(items.reduce((a, it) => a + Number(it.byBranch?.[b] || 0), 0))}</td>`).join('')}
          <td class="num">${fmt(items.reduce((a, it) => a + Number(it.qty || 0), 0))}</td>
          <td></td>
          <td class="num">${fmt(totals.cost)}</td>
          <td></td>
          <td class="num">${fmt(totals.sale)}</td>
          <td class="num">${fmt(totals.profit)}</td>
          <td class="num">${pct(totals.rate)}</td>
          <td class="num">${fmt(totals.nenova)}</td>
          <td class="num">${fmt(totals.miu)}</td>
        </tr>
      </tbody>
    </table>
    ${meta.note ? `<div class="note"><b>특이사항</b> ${meta.note}</div>` : ''}
    ${consignedNote}
    ${missingNote}
  </body></html>`;
}

// 차수별 손익 — 매출은 사입 포함, 이익은 사입 제외 (분모 = 손익대상 매출)
function masterProfit(m) {
  const sale = Number(m.SaleTotal || 0);
  const pnlSale = sale - Number(m.ConsignedSale || 0);
  const profit = pnlSale - Number(m.CostTotal || 0);
  return { sale, pnlSale, profit, rate: pnlSale > 0 ? profit / pnlSale : null };
}

function buildSummaryPrintHtml(list) {
  const rows = list.map(m => {
    const { profit, rate } = masterProfit(m);
    const nen = Number(m.NenovaPct);
    return `<tr>
      <td class="ctr">${Number(m.MajorWeek)}차</td>
      <td class="ctr">${dateStr(m.QuoteDate)}</td>
      <td class="num">${fmt(m.CostTotal)}</td>
      <td class="num">${fmt(m.SaleTotal)}</td>
      <td class="num">${fmt(profit)}</td>
      <td class="num">${pct(rate)}</td>
      <td class="num">${fmt(profit * nen / 100)}</td>
      <td class="num">${fmt(profit * (100 - nen) / 100)}</td>
    </tr>`;
  }).join('');
  const totalSale = list.reduce((a, m) => a + Number(m.SaleTotal || 0), 0);
  const totalPnlSale = list.reduce((a, m) => a + masterProfit(m).pnlSale, 0);
  const totalCost = list.reduce((a, m) => a + Number(m.CostTotal || 0), 0);
  const totalProfit = totalPnlSale - totalCost;
  const totalNen = list.reduce((a, m) => a + masterProfit(m).profit * Number(m.NenovaPct) / 100, 0);
  const year = list[0]?.OrderYear || new Date().getFullYear();
  return `<!doctype html><html><head><meta charset="utf-8"><title>라움 결산</title><style>${PRINT_CSS}</style></head><body>
    <h1>${year} 라움 손익 결산</h1>
    <div class="sub">차수별 합산 · VAT 별도 · 매입은 수기 입력 기준</div>
    <table>
      <thead><tr><th>차수</th><th>견적일</th><th>총 매입</th><th>총 매출(VAT별도)</th><th>총 이익</th><th>이익율</th><th>네노바이익</th><th>미우이익</th></tr></thead>
      <tbody>${rows}
        <tr class="total"><td class="ctr" colspan="2">합계</td>
          <td class="num">${fmt(totalCost)}</td><td class="num">${fmt(totalSale)}</td>
          <td class="num">${fmt(totalProfit)}</td><td class="num">${pct(totalPnlSale > 0 ? totalProfit / totalPnlSale : null)}</td>
          <td class="num">${fmt(totalNen)}</td><td class="num">${fmt(totalProfit - totalNen)}</td></tr>
      </tbody>
    </table>
  </body></html>`;
}

// ── 스타일 ──────────────────────────────────────────────────
// ── 검증 패널 — 견적서 원본 숫자와 파싱/합산 결과 대조 (✓ 전부 일치해야 안심) ──
function VerifyPanel({ verification, items }) {
  const [open, setOpen] = useState(true);
  if (!verification?.length) {
    return (
      <div style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px' }}>
        검증 정보 없음 — 이 기록은 검증 패널 추가 전에 저장됐습니다. 같은 견적서를 다시 업로드하면 생성됩니다.
      </div>
    );
  }
  const fails = verification.filter(c => !c.ok);
  const erpMismatch = (items || []).filter(it => it.erpSalePrice != null && it.price != null && Math.abs(it.erpSalePrice - it.price) > 1);
  const allOk = fails.length === 0;
  const head = allOk
    ? `✅ 검증 통과 — 견적서 합계와 ${verification.filter(c => c.ok && !c.info).length}개 항목 모두 일치`
    : `🚨 검증 실패 ${fails.length}건 — 아래 불일치 항목을 확인하세요 (저장 전 원본 견적서와 대조 필요)`;
  const n = v => (v == null ? '' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  return (
    <div style={{
      border: `1px solid ${allOk ? '#86efac' : '#fca5a5'}`, background: allOk ? '#f0fdf4' : '#fef2f2',
      borderRadius: 8, padding: '10px 14px', margin: '0 0 12px', fontSize: 12.5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <b style={{ color: allOk ? '#166534' : '#991b1b' }}>{head}</b>
        <span style={{ color: '#64748b' }}>{open ? '▲ 접기' : '▼ 자세히'}</span>
      </div>
      {open ? (
        <table style={{ borderCollapse: 'collapse', marginTop: 8, fontSize: 12 }}>
          <thead>
            <tr>
              {['구분', '항목', '견적서 값', '파싱/합산 값', '차이', '판정'].map(h => (
                <th key={h} style={{ border: '1px solid #d7dde5', background: '#fff', padding: '3px 10px', fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {verification.map((c, i) => (
              <tr key={i} style={{ background: c.ok ? '#fff' : '#fee2e2' }}>
                <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }}>{c.group}</td>
                <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }}>{c.label}</td>
                {c.info ? (
                  <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }} colSpan={3}>{c.info}</td>
                ) : (
                  <>
                    <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px', textAlign: 'right' }}>{n(c.sheetVal)}</td>
                    <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px', textAlign: 'right' }}>{n(c.parsedVal)}</td>
                    <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px', textAlign: 'right', color: c.ok ? '#94a3b8' : '#b91c1c' }}>{n(c.diff)}</td>
                  </>
                )}
                <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px', textAlign: 'center' }}>{c.ok ? '✓' : '✗'}</td>
              </tr>
            ))}
            <tr>
              <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }}>전산 교차</td>
              <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }}>견적단가 ↔ 전산 분배단가</td>
              <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px' }} colSpan={3}>
                {erpMismatch.length === 0
                  ? '매칭된 품목 모두 전산 분배단가와 일치'
                  : `단가 다른 품목 ${erpMismatch.length}건 (행의 ⚠ 표시) — 이월 품목이면 정상`}
              </td>
              <td style={{ border: '1px solid #e2e8f0', padding: '3px 10px', textAlign: 'center' }}>{erpMismatch.length === 0 ? '✓' : '⚠'}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

// ── 강남·건대 비교검증 표 — 원본 지점별 수량/금액이 합산 행으로 어떻게 모였는지 눈으로 대조 ──
// 초록 = 양쪽 지점이 실제로 합산된 행 / 주황 = 같은 품목인데 단가가 달라 분리 유지된 행(이월분 등)
const HL = {
  merged: '#dcfce7',   // 강남+건대 합산됨
  priceDiff: '#ffedd5', // 같은 품목명·다른 단가 → 분리
  consigned: '#f1f5f9', // 사입(원산지 없음) — 매출 포함·손익 제외
};
function multiPriceNames(items) {
  const byName = {};
  for (const it of items) {
    const k = String(it.name || '').trim();
    byName[k] = (byName[k] || new Set()).add(Number(it.price));
  }
  return new Set(Object.entries(byName).filter(([, s]) => s.size > 1).map(([k]) => k));
}
function rowHighlight(it, branches, multiNames) {
  if (it.consigned) return { bg: HL.consigned, why: '사입(원산지 없음) — 매출 합계에는 포함, 손익 계산에서는 제외' };
  if (multiNames.has(String(it.name || '').trim())) return { bg: HL.priceDiff, why: '같은 품목명이 다른 단가로 존재 — 합산하지 않고 분리 유지 (이월분이면 정상)' };
  const present = branches.filter(b => Number(it.byBranch?.[b] || 0) !== 0);
  if (present.length > 1) return { bg: HL.merged, why: `${present.join('+')} 합산된 행` };
  return { bg: null, why: present[0] ? `${present[0]} 단독` : '' };
}

function BranchComparePanel({ items, sheets, branches }) {
  const [open, setOpen] = useState(true);
  if (!branches.length || !items.length) return null;
  const multiNames = multiPriceNames(items.filter(it => !it.isCustom));
  const cellTd = { border: '1px solid #e2e8f0', padding: '3px 8px', whiteSpace: 'nowrap' };
  const numTd = { ...cellTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const branchTotals = Object.fromEntries(branches.map(b => [b, { qty: 0, amt: 0 }]));
  for (const it of items) {
    for (const b of branches) {
      const q = Number(it.byBranch?.[b] || 0);
      branchTotals[b].qty += q;
      branchTotals[b].amt += q * Number(it.price || 0);
    }
  }
  const sheetByBranch = Object.fromEntries((sheets || []).map(s => [s.branch, s]));
  const mergedCnt = items.filter(it => !it.isCustom && branches.filter(b => Number(it.byBranch?.[b] || 0) !== 0).length > 1).length;
  return (
    <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 14px', margin: '0 0 12px', fontSize: 12.5, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => setOpen(o => !o)}>
        <b>🔍 {branches.join('·')} 비교검증</b>
        <span style={{ background: HL.merged, padding: '1px 8px', borderRadius: 4 }}>합산된 행 {mergedCnt}건</span>
        <span style={{ background: HL.priceDiff, padding: '1px 8px', borderRadius: 4 }}>단가 달라 분리된 품목 {multiNames.size}개</span>
        <span style={{ color: '#64748b' }}>{open ? '▲ 접기' : '▼ 펼치기'}</span>
      </div>
      {open ? (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...cellTd, background: '#f1f5f9', fontWeight: 700 }} rowSpan={2}>순번</th>
                <th style={{ ...cellTd, background: '#f1f5f9', fontWeight: 700 }} rowSpan={2}>품목명</th>
                <th style={{ ...cellTd, background: '#f1f5f9', fontWeight: 700 }} rowSpan={2}>단가</th>
                {branches.map(b => (
                  <th key={b} style={{ ...cellTd, background: '#e0f2fe', fontWeight: 700, textAlign: 'center' }} colSpan={2}>{b}</th>
                ))}
                <th style={{ ...cellTd, background: '#f1f5f9', fontWeight: 700, textAlign: 'center' }} colSpan={2}>합산</th>
                <th style={{ ...cellTd, background: '#f1f5f9', fontWeight: 700 }} rowSpan={2}>판정</th>
              </tr>
              <tr>
                {branches.map(b => (
                  <Fragment key={b}>
                    <th style={{ ...cellTd, background: '#e0f2fe', fontWeight: 600 }}>수량</th>
                    <th style={{ ...cellTd, background: '#e0f2fe', fontWeight: 600 }}>금액</th>
                  </Fragment>
                ))}
                <th style={{ ...cellTd, background: '#f1f5f9', fontWeight: 600 }}>수량</th>
                <th style={{ ...cellTd, background: '#f1f5f9', fontWeight: 600 }}>금액</th>
              </tr>
            </thead>
            <tbody>
              {items.filter(it => !it.isCustom).map((it, i) => {
                const hl = rowHighlight(it, branches, multiNames);
                const priceDiff = multiNames.has(String(it.name || '').trim());
                return (
                  <tr key={it.itemKey ?? `${it.name}|${it.price}`} style={hl.bg ? { background: hl.bg } : undefined} title={hl.why}>
                    <td style={{ ...cellTd, textAlign: 'center' }}>{i + 1}</td>
                    <td style={{ ...cellTd, fontWeight: priceDiff ? 700 : 400 }}>{it.name}</td>
                    <td style={{ ...numTd, fontWeight: priceDiff ? 700 : 400, color: priceDiff ? '#c2410c' : undefined }}>{fmt1(it.price)}</td>
                    {branches.map(b => {
                      const q = Number(it.byBranch?.[b] || 0);
                      return (
                        <Fragment key={b}>
                          <td style={{ ...numTd, fontWeight: q ? 600 : 400, color: q ? undefined : '#cbd5e1' }}>{q ? fmt(q) : '·'}</td>
                          <td style={{ ...numTd, color: q ? '#475569' : '#cbd5e1' }}>{q ? fmt(q * Number(it.price || 0)) : '·'}</td>
                        </Fragment>
                      );
                    })}
                    <td style={{ ...numTd, fontWeight: 700 }}>{fmt(it.qty)}</td>
                    <td style={{ ...numTd, fontWeight: 700 }}>{fmt(it.supply)}</td>
                    <td style={{ ...cellTd, fontSize: 11.5, color: '#64748b' }}>{hl.why}</td>
                  </tr>
                );
              })}
              <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                <td style={{ ...cellTd, textAlign: 'center' }} colSpan={3}>지점 합계</td>
                {branches.map(b => {
                  const sh = sheetByBranch[b];
                  const expect = sh?.summarySupply ?? sh?.parsedSupply ?? null;
                  const ok = expect == null || Math.abs(branchTotals[b].amt - expect) <= 5;
                  return (
                    <Fragment key={b}>
                      <td style={numTd}>{fmt(branchTotals[b].qty)}</td>
                      <td style={{ ...numTd, color: ok ? undefined : '#b91c1c' }}
                        title={expect != null ? `견적서 ${b} 공급가액 ${fmt(expect)}원과 ${ok ? '일치' : '불일치!'}` : ''}>
                        {fmt(branchTotals[b].amt)}{expect != null ? (ok ? ' ✓' : ' ✗') : ''}
                      </td>
                    </Fragment>
                  );
                })}
                <td style={numTd}>{fmt(items.filter(it => !it.isCustom).reduce((a, it) => a + Number(it.qty || 0), 0))}</td>
                <td style={numTd}>{fmt(items.filter(it => !it.isCustom).reduce((a, it) => a + Number(it.supply || 0), 0))}</td>
                <td style={cellTd}></td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 6, fontSize: 11.5, color: '#64748b' }}>
            <span style={{ background: HL.merged, padding: '0 6px', borderRadius: 3 }}>초록</span> = 강남·건대 양쪽 수량이 합산된 행 ·{' '}
            <span style={{ background: HL.priceDiff, padding: '0 6px', borderRadius: 3 }}>주황</span> = 같은 품목명이지만 단가가 달라 분리 유지된 행(이월분이면 정상) ·{' '}
            <span style={{ background: HL.consigned, padding: '0 6px', borderRadius: 3, border: '1px solid #cbd5e1' }}>회색</span> = 사입(원산지 없음, 손익 제외) ·{' '}
            <b>·</b> = 해당 지점에 없음 · 지점 합계의 ✓ = 견적서 원본 하단 합계와 일치
          </div>
        </div>
      ) : null}
    </div>
  );
}

const st = {
  page: { padding: '18px 22px', maxWidth: 1500 },
  h1: { fontSize: 20, fontWeight: 700, margin: '0 0 4px' },
  desc: { fontSize: 12.5, color: '#64748b', margin: '0 0 14px' },
  bar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 },
  btn: { padding: '7px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 13 },
  btnPrimary: { padding: '7px 14px', borderRadius: 6, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnDanger: { padding: '5px 10px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', cursor: 'pointer', fontSize: 12 },
  table: { borderCollapse: 'collapse', fontSize: 12.5, width: '100%' },
  th: { border: '1px solid #d7dde5', background: '#f1f5f9', padding: '6px 8px', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'center' },
  td: { border: '1px solid #e2e8f0', padding: '5px 8px', whiteSpace: 'nowrap' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  input: { width: 84, padding: '3px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 12.5, textAlign: 'right' },
  warn: { background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, margin: '0 0 10px', whiteSpace: 'pre-wrap' },
  err: { background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, margin: '0 0 10px', color: '#991b1b' },
  ok: { background: '#dcfce7', border: '1px solid #86efac', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, margin: '0 0 10px', color: '#166534' },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 600 },
};

export default function RaumPnlPage() {
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // detail: { meta:{pnlKey?, orderYear, major, title, quoteDate, nenovaPct, note, sourceFile}, items, warnings, sheets, unsaved }
  const [detail, setDetail] = useState(null);
  const fileRef = useRef(null);

  const loadList = async () => {
    setLoadingList(true);
    setError('');
    try {
      const r = await fetch('/api/raum/pnl?view=list');
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '목록 조회 실패');
      setList(j.list || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingList(false);
    }
  };
  useEffect(() => { loadList(); }, []);

  // ── 업로드 → 미리보기 ──
  const onUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/raum/pnl-import', { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '업로드 실패');
      const warnings = [...(j.warnings || [])];
      if (j.existing) {
        warnings.push(`${Number(j.major)}차는 이미 저장돼 있습니다 (${dateStr(j.existing.UpdatedAt || j.existing.CreatedAt)}). 저장하면 품목이 이번 업로드 내용으로 교체됩니다 (수기 매입단가 포함 초기화).`);
      }
      setDetail({
        meta: {
          pnlKey: j.existing?.PnlKey || null,
          orderYear: j.orderYear,
          major: j.major || '',
          title: `라움 ${Number(j.major) || '?'}차`,
          quoteDate: j.quoteDate,
          nenovaPct: j.nenovaPct,
          note: '',
          sourceFile: j.fileName,
        },
        sheets: j.sheets,
        items: j.items.map(it => ({ ...it, costPrice: it.costPrice ?? null })),
        verification: j.verification || null,
        warnings,
        unsaved: true,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── 저장본 열기 ──
  const openDetail = async (pnlKey) => {
    setError('');
    setMessage('');
    try {
      const r = await fetch(`/api/raum/pnl?key=${pnlKey}`);
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '조회 실패');
      setDetail({
        meta: {
          pnlKey: j.master.PnlKey,
          orderYear: j.master.OrderYear,
          major: j.master.MajorWeek,
          title: j.master.Title || `라움 ${Number(j.master.MajorWeek)}차`,
          quoteDate: dateStr(j.master.QuoteDate),
          nenovaPct: Number(j.master.NenovaPct),
          note: j.master.Note || '',
          sourceFile: j.master.SourceFile || '',
        },
        sheets: null,
        items: j.items,
        verification: j.verification || null,
        warnings: [],
        unsaved: false,
      });
    } catch (e) {
      setError(e.message);
    }
  };

  const save = async () => {
    if (!detail) return;
    const { meta, items } = detail;
    if (!meta.major) { setError('차수를 입력하세요 (예: 27).'); return; }
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/raum/pnl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          orderYear: meta.orderYear,
          major: meta.major,
          title: meta.title,
          quoteDate: meta.quoteDate,
          nenovaPct: meta.nenovaPct,
          note: meta.note,
          sourceFile: meta.sourceFile,
          items,
          verification: detail.verification || null,
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '저장 실패');
      setDetail(d => ({ ...d, meta: { ...d.meta, pnlKey: j.pnlKey }, unsaved: false }));
      setMessage(`저장 완료 — ${Number(meta.major)}차 손익계산서가 히스토리에 기록되었습니다.`);
      loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (pnlKey, title) => {
    if (!window.confirm(`${title} 손익계산서를 삭제할까요? (히스토리에서 제거)`)) return;
    try {
      const r = await fetch('/api/raum/pnl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', key: pnlKey }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '삭제 실패');
      if (detail?.meta?.pnlKey === pnlKey) setDetail(null);
      loadList();
    } catch (e) {
      setError(e.message);
    }
  };

  const setItem = (idx, patch) => {
    setDetail(d => {
      const items = d.items.slice();
      const next = { ...items[idx], ...patch };
      // 수동 행(손실 등)은 수량/매출단가 수정 시 매출액 자동 재계산
      if (next.isCustom && ('qty' in patch || 'price' in patch)) {
        next.supply = (Number(next.qty) || 0) * (Number(next.price) || 0);
      }
      items[idx] = next;
      return { ...d, items, unsaved: true };
    });
  };

  const addCustomRow = () => {
    setDetail(d => ({
      ...d,
      items: [...d.items, {
        seq: d.items.length + 1,
        _uid: `c${Date.now()}`,
        name: '손실', unit: '', qty: 1, price: 0, supply: 0, byBranch: {},
        costPrice: 0, refPrice: null, refSource: null, erpSalePrice: null, prodKey: null,
        remark: '', isCustom: true,
      }],
      unsaved: true,
    }));
  };

  const removeItem = (idx) => {
    setDetail(d => ({ ...d, items: d.items.filter((_, i) => i !== idx), unsaved: true }));
  };

  const downloadExcel = async () => {
    setError('');
    try {
      const r = await fetch('/api/raum/pnl?excel=1');
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `엑셀 생성 실패 (${r.status})`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `라움 손익계산서.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(e.message);
    }
  };
  const setMeta = patch => setDetail(d => ({ ...d, meta: { ...d.meta, ...patch }, unsaved: true }));

  const fillRefPrices = () => {
    const n = detail.items.filter(it => it.refPrice != null).length;
    if (!window.confirm(`참고단가(도착원가 우선)가 있는 ${n}개 품목의 매입단가를 모두 다시 채울까요?\n직접 입력한 값도 덮어씁니다.`)) return;
    setDetail(d => ({
      ...d,
      items: d.items.map(it => it.refPrice != null
        ? { ...it, costPrice: it.refPrice, costSource: it.isArrival ? 'arrival' : 'ref', costLearned: false }
        : it),
      unsaved: true,
    }));
  };

  const branches = useMemo(() => {
    if (!detail) return [];
    const set = new Set();
    for (const it of detail.items) Object.keys(it.byBranch || {}).forEach(b => set.add(b));
    return [...set];
  }, [detail]);

  const nenovaPct = detail ? Number(detail.meta.nenovaPct) || 0 : 80;
  const totals = useMemo(() => (detail ? computeTotals(detail.items, nenovaPct) : null), [detail, nenovaPct]);
  const hasRef = detail ? detail.items.some(it => it.refPrice != null) : false;
  const gridMultiNames = useMemo(
    () => (detail ? multiPriceNames(detail.items.filter(it => !it.isCustom)) : new Set()),
    [detail]
  );
  const erpQtyMap = useMemo(() => (detail ? quoteQtyByProdKey(detail.items) : {}), [detail]);

  // ── 렌더 ──
  return (
    <div style={st.page}>
      <h1 style={st.h1}>라움 손익계산서</h1>
      <p style={st.desc}>
        강남/건대 라움 견적서(거래명세표 엑셀)를 업로드하면 품목+단가가 같은 행을 합산해 차수별 손익계산서를 만듭니다.
        매출단가는 견적서 단가, 매입단가는 <b>가장 최근 도착원가(100원 단위 반올림)가 자동 입력</b>되며(🚢), 직접 고치면 그 값을 기억해 다음부터 우선 적용합니다(🧠).
        저장하면 차수별 히스토리가 남습니다.
      </p>

      {error ? <div style={st.err}>{error}</div> : null}
      {message ? <div style={st.ok}>{message}</div> : null}

      <div style={st.bar}>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => onUpload(e.target.files?.[0])}
        />
        <button style={st.btnPrimary} disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? '분석 중…' : '📤 견적서 업로드'}
        </button>
        {detail ? (
          <>
            <button style={st.btn} onClick={() => { setDetail(null); setMessage(''); setError(''); }}>← 결산 목록</button>
            <button style={st.btnPrimary} disabled={saving} onClick={save}>{saving ? '저장 중…' : '💾 저장'}</button>
            <button
              style={st.btn}
              onClick={() => printInIframe(buildDetailPrintHtml(detail.meta, detail.items, totals, branches))}
            >🖨 인쇄</button>
            <button
              style={{ ...st.btn, opacity: detail.unsaved ? 0.5 : 1 }}
              disabled={detail.unsaved}
              title={detail.unsaved ? '저장 후 다운로드할 수 있습니다 (엑셀은 저장본 기준)' : '차수별 시트 + 결산 시트 (수식 포함)'}
              onClick={downloadExcel}
            >📥 엑셀 다운로드</button>
            {detail.unsaved ? <span style={{ ...st.badge, background: '#fef3c7', color: '#92400e' }}>저장 전</span>
              : <span style={{ ...st.badge, background: '#dcfce7', color: '#166534' }}>저장됨</span>}
          </>
        ) : (
          <>
            <button style={st.btn} disabled={!list.length} onClick={() => printInIframe(buildSummaryPrintHtml(list))}>🖨 결산표 인쇄</button>
            <button style={st.btn} disabled={!list.length} title="차수별 시트 + 결산 시트 (수식 포함)" onClick={downloadExcel}>📥 엑셀 다운로드</button>
          </>
        )}
      </div>

      {!detail ? (
        // ── 결산(히스토리) 목록 ──
        <div>
          {loadingList ? <div style={{ fontSize: 13, color: '#64748b' }}>불러오는 중…</div> : null}
          {!loadingList && !list.length ? (
            <div style={{ fontSize: 13.5, color: '#64748b', padding: '30px 0' }}>
              저장된 손익계산서가 없습니다. 위 [견적서 업로드]로 시작하세요.
            </div>
          ) : null}
          {list.length ? (
            <table style={{ ...st.table, maxWidth: 1100 }}>
              <thead>
                <tr>
                  {['차수', '견적일', '품목수', '총 매입', '총 매출(VAT별도)', '총 이익', '이익율', '네노바이익', '미우이익', '수정일', ''].map(h => (
                    <th key={h} style={st.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map(m => {
                  const { profit, rate } = masterProfit(m);
                  const nen = Number(m.NenovaPct);
                  return (
                    <tr key={m.PnlKey} style={{ cursor: 'pointer' }} onClick={() => openDetail(m.PnlKey)}>
                      <td style={{ ...st.td, fontWeight: 700 }}>{Number(m.MajorWeek)}차</td>
                      <td style={st.td}>{dateStr(m.QuoteDate)}</td>
                      <td style={{ ...st.td, ...st.num }}>
                        {m.ItemCount}{Number(m.MissingCost) > 0 ? <span style={{ color: '#b91c1c' }}> (매입단가 미입력 {m.MissingCost})</span> : null}
                      </td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(m.CostTotal)}</td>
                      <td style={{ ...st.td, ...st.num }} title={Number(m.ConsignedSale) > 0 ? `사입 ${fmt(m.ConsignedSale)}원 포함 (손익 제외)` : ''}>
                        {fmt(m.SaleTotal)}{Number(m.ConsignedSale) > 0 ? ' ▪' : ''}
                      </td>
                      <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(profit)}</td>
                      <td style={{ ...st.td, ...st.num }}>{pct(rate)}</td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(profit * nen / 100)} <span style={{ color: '#94a3b8' }}>({nen}%)</span></td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(profit * (100 - nen) / 100)}</td>
                      <td style={st.td}>{dateStr(m.UpdatedAt || m.CreatedAt)}</td>
                      <td style={st.td} onClick={e => e.stopPropagation()}>
                        <button style={st.btnDanger} onClick={() => remove(m.PnlKey, `${Number(m.MajorWeek)}차`)}>삭제</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : (
        // ── 상세 (미리보기/편집) ──
        <div>
          <VerifyPanel verification={detail.verification} items={detail.items} />
          <BranchComparePanel items={detail.items} sheets={detail.sheets} branches={branches} />
          {detail.warnings?.length ? <div style={st.warn}>{detail.warnings.map((w, i) => `⚠ ${w}`).join('\n')}</div> : null}

          <div style={{ ...st.bar, gap: 14 }}>
            <label style={{ fontSize: 13 }}>차수{' '}
              <input
                style={{ ...st.input, width: 46, textAlign: 'center' }}
                value={detail.meta.major}
                onChange={e => setMeta({ major: e.target.value.replace(/[^0-9]/g, '').slice(0, 2), title: `라움 ${Number(e.target.value) || '?'}차` })}
              />차 ({detail.meta.orderYear}년)
            </label>
            <label style={{ fontSize: 13 }}>견적일{' '}
              <input style={{ ...st.input, width: 110, textAlign: 'center' }} value={detail.meta.quoteDate || ''}
                onChange={e => setMeta({ quoteDate: e.target.value })} placeholder="YYYY-MM-DD" />
            </label>
            <label style={{ fontSize: 13 }}>순익분배 네노바{' '}
              <input
                style={{ ...st.input, width: 46, textAlign: 'center' }}
                value={detail.meta.nenovaPct}
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9.]/g, '');
                  setMeta({ nenovaPct: v === '' ? '' : Math.min(100, Number(v)) });
                }}
              />% : 미우 {Number.isFinite(nenovaPct) ? 100 - nenovaPct : ''}%
            </label>
            {hasRef ? (
              <button style={st.btn} onClick={fillRefPrices} title="참고단가(가장 최근 도착원가 100원 반올림, 없으면 전산원가÷1.1)로 매입단가를 전부 다시 채웁니다.">
                🚢 도착원가 다시 채우기
              </button>
            ) : null}
            <button style={st.btn} onClick={addCustomRow} title="견적서에 없는 행(손실 등)을 직접 추가합니다. 품목명/수량/단가를 입력하면 이익·분배에 반영됩니다. 손실은 매입단가에 손실액, 매출단가 0 으로 넣으면 이익에서 차감됩니다.">
              ＋ 손실/수동 행
            </button>
            {detail.sheets ? (
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {detail.sheets.map(s => `${s.branch} ${s.itemCount}품목 ${fmt(s.parsedSupply)}원`).join(' · ')} → 합산 {detail.items.length}품목
              </span>
            ) : null}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>순번</th>
                  <th style={st.th}>품목명</th>
                  <th style={st.th}>단위</th>
                  {branches.map(b => <th key={b} style={st.th}>{b}</th>)}
                  <th style={st.th}>수량계</th>
                  <th style={st.th}>매입단가 ✏️</th>
                  <th style={st.th}>매입액</th>
                  <th style={st.th}>매출단가</th>
                  <th style={st.th}>매출액</th>
                  <th style={st.th}>이익</th>
                  <th style={st.th}>이익율</th>
                  <th style={st.th}>네노바이익 ({nenovaPct}%)</th>
                  <th style={st.th}>미우이익 ({100 - nenovaPct}%)</th>
                  <th style={st.th}>참고단가(도착원가)</th>
                  <th style={st.th}>적요</th>
                  <th style={st.th} title="전산에 라움으로 분배된 수량·단가와 견적서 비교 — 수량은 같은 품목 행 합계 기준, 단가는 ±2%">전산 분배 대조</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((it, i) => {
                  const r = computeItemRow(it, nenovaPct);
                  const erpMismatch = it.erpSalePrice != null && it.price != null && Math.abs(it.erpSalePrice - it.price) > 1;
                  const hl = it.isCustom ? { bg: '#fffbeb', why: '수동 추가 행' } : rowHighlight(it, branches, gridMultiNames);
                  return (
                    <tr key={it.itemKey ?? it._uid ?? `${it.name}|${it.price}`} style={hl.bg ? { background: hl.bg } : undefined} title={hl.why}>
                      <td style={{ ...st.td, textAlign: 'center' }}>{i + 1}</td>
                      <td style={st.td} title={it.isCustom ? '수동 추가 행' : (it.prodName ? `전산 매칭: ${it.prodName}` : '전산 미매칭')}>
                        {it.isCustom ? (
                          <input style={{ ...st.input, width: 130, textAlign: 'left' }} value={it.name}
                            onChange={e => setItem(i, { name: e.target.value })} />
                        ) : <>{it.name}{it.prodName ? '' : ' ⚪'}</>}
                        {it.isCustom ? ' ✍' : ''}
                      </td>
                      <td style={{ ...st.td, textAlign: 'center' }}>
                        {it.isCustom ? (
                          <input style={{ ...st.input, width: 40, textAlign: 'center' }} value={it.unit}
                            onChange={e => setItem(i, { unit: e.target.value })} />
                        ) : it.unit}
                      </td>
                      {branches.map(b => <td key={b} style={{ ...st.td, ...st.num }}>{fmt(it.byBranch?.[b])}</td>)}
                      <td style={{ ...st.td, ...st.num, fontWeight: 600 }}>
                        {it.isCustom ? (
                          <input style={{ ...st.input, width: 56 }} value={it.qty}
                            onChange={e => setItem(i, { qty: e.target.value.replace(/[^0-9.\-]/g, '') })} />
                        ) : fmt(it.qty)}
                      </td>
                      <td style={{ ...st.td, ...st.num }}>
                        {it.consigned ? (
                          <span style={{ color: '#64748b', fontSize: 12 }} title="사입(원산지 없음) — 매출에는 포함, 손익 계산에서는 제외되므로 매입단가가 필요 없습니다">사입 제외</span>
                        ) : (
                        <>
                        <input
                          style={{ ...st.input, background: it.costPrice != null && it.costPrice !== '' ? '#ecfdf5' : '#fff' }}
                          value={it.costPrice ?? ''}
                          placeholder={it.refPrice != null ? String(it.refPrice) : ''}
                          title={
                            it.costSource === 'learned' ? '직접 입력해 학습된 매입단가가 자동 입력됨 — 수정하면 저장 시 다시 학습'
                            : it.costSource === 'arrival' ? `가장 최근 도착원가를 100원 단위 반올림해 자동 입력 (${it.refSource || ''}) — 직접 고치면 그 값을 학습`
                            : '직접 입력하면 저장 시 이 품목의 매입단가를 기억해 다음 업로드에 자동 입력'
                          }
                          onChange={e => setItem(i, { costPrice: e.target.value.replace(/[^0-9.\-]/g, ''), costSource: 'manual', costLearned: false })}
                        />
                        {it.costSource === 'learned' ? <span title="직접 입력 학습값" style={{ marginLeft: 3 }}>🧠</span>
                          : it.costSource === 'arrival' ? <span title={it.refSource || '도착원가 자동'} style={{ marginLeft: 3 }}>🚢</span>
                          : it.costSource === 'manual' ? <span title="직접 입력 — 저장 시 학습됨" style={{ marginLeft: 3 }}>✍</span> : null}
                        </>
                        )}
                      </td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(r.costAmount)}</td>
                      <td style={{ ...st.td, ...st.num }} title={erpMismatch ? `전산 분배단가 ${fmt1(it.erpSalePrice)}원과 다름` : (it.erpSalePrice != null ? '전산 분배단가와 일치' : '')}>
                        {it.isCustom ? (
                          <input style={{ ...st.input, width: 70 }} value={it.price}
                            onChange={e => setItem(i, { price: e.target.value.replace(/[^0-9.\-]/g, '') })} />
                        ) : <>{fmt1(it.price)}{erpMismatch ? ' ⚠' : ''}</>}
                      </td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(it.supply)}</td>
                      <td style={{ ...st.td, ...st.num, color: r.profit != null && r.profit < 0 ? '#b91c1c' : undefined }}>{fmt(r.profit)}</td>
                      <td style={{ ...st.td, ...st.num }}>{pct(r.rate)}</td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(r.nenova)}</td>
                      <td style={{ ...st.td, ...st.num }}>{fmt(r.miu)}</td>
                      <td style={{ ...st.td, ...st.num, color: '#64748b' }} title={it.refSource || ''}>{it.refPrice != null ? fmt1(it.refPrice) : ''}</td>
                      <td style={{ ...st.td, fontSize: 11.5, color: '#64748b' }}>
                        {it.isCustom ? (
                          <button style={{ ...st.btnDanger, padding: '2px 8px' }} onClick={() => removeItem(i)} title="이 수동 행 삭제">✕ 삭제</button>
                        ) : it.remark}
                      </td>
                      {(() => {
                        const cmp = erpCompare(it, erpQtyMap);
                        return (
                          <td style={{ ...st.td, fontSize: 11.5, whiteSpace: 'nowrap', ...ERP_TONE[cmp.tone] }} title={cmp.title}>
                            {cmp.label}
                          </td>
                        );
                      })()}
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ ...st.td, textAlign: 'center', fontWeight: 700 }} colSpan={3}>합계</td>
                  {branches.map(b => (
                    <td key={b} style={{ ...st.td, ...st.num, fontWeight: 700 }}>
                      {fmt(detail.items.reduce((a, it) => a + Number(it.byBranch?.[b] || 0), 0))}
                    </td>
                  ))}
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(detail.items.reduce((a, it) => a + Number(it.qty || 0), 0))}</td>
                  <td style={st.td}></td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(totals.cost)}</td>
                  <td style={st.td}></td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(totals.sale)}</td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(totals.profit)}</td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{pct(totals.rate)}</td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(totals.nenova)}</td>
                  <td style={{ ...st.td, ...st.num, fontWeight: 700 }}>{fmt(totals.miu)}</td>
                  <td style={st.td} colSpan={3}></td>
                </tr>
              </tbody>
            </table>
          </div>

          {totals.consignedSale > 0 ? (
            <div style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, marginTop: 10 }}>
              ▪ 사입(원산지 없음) {totals.consignedCnt}건 매출 {fmt(totals.consignedSale)}원 — <b>매출액 합계에는 포함</b>(견적서와 일치), <b>손익 계산(매입·이익·8:2 분배)에서는 제외</b>. 이익율 분모 = 손익대상 매출 {fmt(totals.pnlSale)}원.
            </div>
          ) : null}
          {totals.missing > 0 ? (
            <div style={{ ...st.warn, marginTop: 10 }}>
              ⚠ 매입단가 미입력 {totals.missing}건 — 도착원가도 학습값도 없는 품목입니다(전산 미매칭 ⚪ 또는 입고이력 없음). 직접 입력하면 다음부터 자동 적용됩니다. 총매입/이익은 입력된 품목만 합산됩니다.
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>특이사항</label>
            <textarea
              style={{ width: '100%', maxWidth: 700, minHeight: 54, border: '1px solid #cbd5e1', borderRadius: 6, padding: 8, fontSize: 13 }}
              value={detail.meta.note}
              onChange={e => setMeta({ note: e.target.value })}
              placeholder="예: 손실 분배, 이월 품목 포함 여부 등"
            />
          </div>
        </div>
      )}
    </div>
  );
}
