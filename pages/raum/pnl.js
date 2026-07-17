// 라움 손익계산서 — 강남/건대 견적서(거래명세표) 업로드 → 품목+단가 동일 합산 → 차수별 손익 저장·인쇄.
// 매출단가 = 견적서 단가(자동), 매입단가 = 수기 입력(전산 참고단가 = Product.Cost÷1.1 채우기 보조).
// 순익분배 기본: 네노바 80% : 미우 20% (차수별 수정 가능). 인쇄는 iframe srcdoc 방식(프로젝트 규칙).
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { runEditWithFixCycle } from '../../lib/fixCycleClient';

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
    return { label: '이번차수 분배없음', tone: 'warn', title: '기준 창(전산 N-2·(N+1)-1)에도, 폴백(N-1, 쌓아두는 품목)에도 라움 분배가 없음 — ⚖ 전산 일괄수정이 신규 분배 후보로 잡아줌' };
  }
  const quoteQty = qtyByProd[it.prodKey] || 0;
  // 단위계수 자동 인식 — 전산은 송이, 견적은 단 기준인 품목(알스트로 등: 430송이@630 = 43단@6,300).
  // 단가 비율이 깨끗한 묶음수(10·20 등)면 그 계수로 환산해 비교. 금액(수량×단가)은 단위와 무관하게 보존됨.
  let k = 1;
  const price = it.price != null ? Number(it.price) : null;
  if (erpPrice > 0 && price > 0) {
    // 계수 탐지는 ±12%(전산 분배단가가 견적과 다른 경우에도 묶음수는 잡히게 — 예: 레드 590.9원/송이 vs 6,300원/단),
    // 일치 판정 자체는 아래에서 ±2% 로 별도 수행되므로 단가 차이는 그대로 ✗ 로 드러난다.
    for (const cand of [1, 5, 10, 12, 20, 25, 30, 50]) {
      if (Math.abs(price - erpPrice * cand) <= price * 0.12) { k = cand; break; }
    }
  }
  const adjQty = erpQty != null ? erpQty / k : null;
  const adjPrice = erpPrice != null ? erpPrice * k : null;
  const qtyOk = adjQty == null ? null : Math.abs(adjQty - quoteQty) < 0.01;
  const priceOk = adjPrice == null || price == null
    ? null
    : Math.abs(adjPrice - price) <= Math.max(1, price * 0.02);
  const parts = [];
  if (it.erpFromPrev) parts.push('(전차수분)'); // 창엔 없고 N-01(쌓아두는 품목)에서 찾음
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

// ── 전산 일괄수정 (견적서 값 → 전산 분배) ─────────────────────
// 견적서 관리와 동일한 API(update-cost/update-quantity)만 경유 — ShipmentDate 동기화(견적서 금액 정합,
// verify:week V1~V3)와 낙관적 동시성(STALE_DATA)이 그 안에서 원자적으로 처리된다 (CONFIRMED_WEEK_EDIT C-1·C-3).
// 확정 행은 서버가 FIXED_WEEK 로 거절 → runEditWithFixCycle(확정해제→적용→재확정, lib/fixCycleClient)로 재시도.

// ERP 행의 수량 편집 단위 — update-quantity 는 '단'=BunchQuantity, '송이'=SteamQuantity, '박스'=BoxQuantity 기준.
// EstQuantity(금액 기준 수량)와 같은 필드를 찾아 그 단위로 편집해야 금액·환산이 정확히 맞는다.
function detectRowUnit(row) {
  const est = Number(row.EstQuantity || 0);
  const near = (v) => Math.abs(Number(v || 0) - est) < 0.01;
  if (est > 0 && near(row.SteamQuantity)) return { unit: '송이', curUserQty: Number(row.SteamQuantity) };
  if (est > 0 && near(row.BunchQuantity)) return { unit: '단', curUserQty: Number(row.BunchQuantity) };
  if (est > 0 && near(row.BoxQuantity)) return { unit: '박스', curUserQty: Number(row.BoxQuantity) };
  return null; // Est 가 어느 환산필드와도 안 맞음 — 수동 처리
}

const round2 = (v) => Math.round(v * 100) / 100;

// 견적서 단위 → adjust API 사용자단위 ('단'=BunchQuantity, '송이'=SteamQuantity, '박스'=BoxQuantity)
function quoteUnitToUserUnit(u) {
  const s = String(u || '').trim();
  if (s === '대' || s === '스팀' || s === '송이') return '송이';
  if (s === '박스') return '박스';
  return '단';
}

/** 견적서 값 기준 전산 수정 계획 — { costEdits, qtyEdits, addEdits, manual, editedWeeks }
 *  호텔 N차 기준 창 = 전산 N-02+(N+1)-01 (windowWeeks). 창에 분배가 없는 품목(쌓아두는 선입고 품목:
 *  White Necklace·다미나·델피늄류)만 prevWeek(N-01) 행을 폴백으로 사용 — 수정도 그 행에 적용된다. */
function buildErpSyncPlan(items, erpRows, { addWeek, windowWeeks = [], prevWeek } = {}) {
  const byProd = {};
  const prevByProd = {};
  for (const r of erpRows) {
    if (windowWeeks.includes(r.OrderWeek)) (byProd[r.ProdKey] = byProd[r.ProdKey] || []).push(r);
    else if (r.OrderWeek === prevWeek) (prevByProd[r.ProdKey] = prevByProd[r.ProdKey] || []).push(r);
  }
  // 이동 기능은 비활성 (사장님 최종 규칙: 창=N-02+(N+1)-01, 창 밖은 폴백 확인만)
  const moves = [];
  const stockPairs = [];
  const movedProdKeys = new Set();
  const moveManual = [];
  const groups = {}; // prodKey → { name, unit, qtySum, prices:Set, price(첫 행) }
  const manual = [];
  for (const it of items) {
    if (it.isCustom || it.consigned) continue;
    if (it.prodKey == null) {
      manual.push({ name: it.name, reason: '전산 품목 미매칭(⚪) — 어떤 전산 품목인지 알려주시면 매핑 등록' });
      continue;
    }
    const g = groups[it.prodKey] = groups[it.prodKey] || { name: it.name, unit: it.unit, qtySum: 0, prices: new Set() };
    g.qtySum += Number(it.qty || 0);
    g.prices.add(Number(it.price));
    if (g.price == null) g.price = Number(it.price);
  }
  const costEdits = [];
  const qtyEdits = [];
  const addEdits = [];
  const postMoveTargets = [];
  for (const [pk, g] of Object.entries(groups)) {
    // 창 우선, 없으면 N-01 폴백(쌓아두는 품목) — 수정도 폴백 행에 그대로 적용
    const rows = (byProd[pk] && byProd[pk].length) ? byProd[pk] : (prevByProd[pk] || []);
    if (!rows.length) {
      // 창에도 N-01에도 분배가 없음 → 견적 수량만큼 신규 분배(ADD, 주문+출고 동시 생성)
      addEdits.push({
        prodKey: Number(pk), name: g.name,
        qty: g.qtySum, unit: quoteUnitToUserUnit(g.unit),
        week: addWeek, price: g.price,
      });
      continue;
    }
    const estSum = rows.reduce((a, r) => a + Number(r.EstQuantity || 0), 0);
    const amtSum = rows.reduce((a, r) => a + Number(r.Amount || 0), 0);
    const erpPrice = estSum > 0 ? amtSum / estSum : null;
    // 단위계수(송이↔단) — 대조 칸과 동일 로직 (±12% 탐지)
    let k = 1;
    if (erpPrice > 0 && g.price > 0) {
      for (const cand of [1, 5, 10, 12, 20, 25, 30, 50]) {
        if (Math.abs(g.price - erpPrice * cand) <= g.price * 0.12) { k = cand; break; }
      }
    }
    // 단가: Cost 컬럼은 VAT포함 단가(판매단위당) — 견적단가×1.1 을 전산 금액단위(송이 등)로 환산
    if (g.prices.size > 1) {
      manual.push({ name: g.name, reason: '견적서에 같은 품목이 서로 다른 단가로 존재(이월 분리 행) — 단가는 수동 확인' });
    } else {
      const targetCost = round2((g.price * 1.1) / k);
      for (const r of rows) {
        if (Math.abs(Number(r.Cost || 0) - targetCost) > 0.5) {
          costEdits.push({
            shipmentKey: r.ShipmentKey, sdetailKey: r.SdetailKey,
            cost: targetCost, expectedOldCost: Number(r.Cost || 0),
            prodName: g.name, orderWeek: r.OrderWeek, oldCost: Number(r.Cost || 0),
            categoryLabel: r.CategoryLabel, prodKey: Number(pk),
          });
        }
      }
    }
    // 수량: 품목 합계 기준. 행이 하나일 때만 자동(두 차수 분산이면 어느 주를 고칠지 모호 — 수동)
    const targetEst = round2(g.qtySum * k);
    if (Math.abs(estSum - targetEst) > 0.005) {
      if (rows.length === 1) {
        const r = rows[0];
        const u = detectRowUnit(r);
        if (!u) {
          manual.push({ name: g.name, reason: `전산 행의 금액기준수량(Est=${r.EstQuantity})이 환산필드와 불일치 — 수동 확인` });
        } else {
          qtyEdits.push({
            sdetailKey: r.SdetailKey, shipmentKey: r.ShipmentKey,
            quantity: targetEst, unit: u.unit, expectedOldQuantity: u.curUserQty,
            prodName: g.name, orderWeek: r.OrderWeek, oldQty: u.curUserQty,
            categoryLabel: r.CategoryLabel, prodKey: Number(pk),
          });
        }
      } else {
        const perWeek = {};
        for (const r of rows) perWeek[r.OrderWeek] = (perWeek[r.OrderWeek] || 0) + Number(r.EstQuantity || 0);
        const breakdown = Object.entries(perWeek).map(([w, q]) => `${w}: ${fmt(q)}`).join(' / ');
        manual.push({
          name: g.name,
          reason: `수량이 두 차수에 나뉘어 있음 (${breakdown} — 합 ${fmt(estSum)} vs 견적 ${fmt(targetEst)}) — 어느 차수를 고칠지 수동 결정`,
        });
      }
    }
  }
  manual.push(...moveManual);
  const editedWeeks = [...new Set([...costEdits, ...qtyEdits].map(e => e.orderWeek))];
  return { moves, stockPairs, postMoveTargets, costEdits, qtyEdits, addEdits, manual, editedWeeks, windowWeeks, prevWeek };
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { data = { success: false, error: `HTTP ${res.status}` }; }
  return data;
}

/** 계획 적용.
 *  이동(moves)이 있으면: 전체를 확정해제→적용→재확정 사이클 안에서 실행
 *    — ①이동(CANCEL→ADD, 단가보존) ②재고 쌍보정(+D/−D) ③신규분배 ④수량/단가 ⑤이동품목 견적정렬
 *  이동이 없으면: 기존 direct-first (FIXED_WEEK 거절분만 사이클) */
async function applyErpSyncPlan(plan, log, { custKey, fetchRows } = {}) {
  const results = { moveOk: 0, stockOk: 0, addOk: 0, qtyOk: 0, costOk: 0, failed: [] };

  const postQty = async (e) => postJson('/api/estimate/update-quantity', {
    sdetailKey: e.sdetailKey, shipmentKey: e.shipmentKey,
    quantity: e.quantity, unit: e.unit, expectedOldQuantity: e.expectedOldQuantity,
  });
  const postCost = async (edits) => postJson('/api/estimate/update-cost', {
    items: edits.map(e => ({ shipmentKey: e.shipmentKey, sdetailKey: e.sdetailKey, cost: e.cost, expectedOldCost: e.expectedOldCost })),
    mode: 'once',
  });

  // ── 신규 분배 추가 — 차수피벗과 동일 API(주문+출고+출고일 동시 생성) + 견적서 단가 세팅 ──
  const doAdds = async () => {
    if (!plan.addEdits?.length) return;
    if (!custKey) { results.failed.push('신규 분배: 라움 CustKey 조회 실패 — 추가 건너뜀'); return; }
    const added = [];
    for (const a of plan.addEdits) {
      log(`신규 분배: ${a.name} [${a.week}] ${fmt(a.qty)}${a.unit} 추가 …`);
      const body = { custKey, prodKey: a.prodKey, week: a.week, type: 'ADD', qty: a.qty, unit: a.unit, memo: '라움 손익 일괄수정(견적서 기준)' };
      let d = await postJson('/api/shipment/adjust', body);
      if (!d.success && /입고/.test(d.error || '')) {
        log('  입고 미등록/초과 — force 재시도');
        d = await postJson('/api/shipment/adjust', { ...body, force: true });
      }
      if (d.success) { results.addOk += 1; added.push(a); }
      else results.failed.push(`${a.name} 신규분배: ${d.error || '실패'}`);
    }
    if (added.length && typeof fetchRows === 'function') {
      log('신규 분배 단가를 견적서 단가로 세팅 중 …');
      try {
        const freshRows = await fetchRows();
        const extraCost = [];
        for (const a of added) {
          for (const r of freshRows.filter(x => Number(x.ProdKey) === a.prodKey && x.OrderWeek === a.week)) {
            const est = Number(r.EstQuantity || 0);
            const k = est > 0 && a.qty > 0 ? Math.max(1, Math.round(est / a.qty)) : 1;
            const targetCost = round2((a.price * 1.1) / k);
            if (Math.abs(Number(r.Cost || 0) - targetCost) > 0.5) {
              extraCost.push({ shipmentKey: r.ShipmentKey, sdetailKey: r.SdetailKey, cost: targetCost, expectedOldCost: Number(r.Cost || 0) });
            }
          }
        }
        if (extraCost.length) {
          const d = await postCost(extraCost);
          if (d.success) results.costOk += extraCost.length;
          else results.failed.push(`신규분배 단가 세팅: ${d.error || '실패'}`);
        }
      } catch (e) {
        results.failed.push(`신규분배 단가 세팅: ${e.message}`);
      }
    }
  };

  // ── 차수 이동 — 원천 CANCEL → 목적지 ADD (주문·출고·출고일 함께 이동) ──
  const doMoves = async () => {
    for (const m of plan.moves || []) {
      log(`이동: ${m.name} [${m.fromWeek} → ${m.toWeek}] ${fmt(m.qty)}${m.unit} …`);
      const memo = `차수이동 ${m.fromWeek}→${m.toWeek} (라움 손익 일괄수정)`;
      let d = await postJson('/api/shipment/adjust', { custKey, prodKey: m.prodKey, week: m.fromWeek, type: 'CANCEL', qty: m.qty, unit: m.unit, memo });
      if (!d.success) { results.failed.push(`${m.name} 이동(원천취소): ${d.error || '실패'}`); continue; }
      const addBody = { custKey, prodKey: m.prodKey, week: m.toWeek, type: 'ADD', qty: m.qty, unit: m.unit, memo };
      d = await postJson('/api/shipment/adjust', addBody);
      if (!d.success && /입고/.test(d.error || '')) d = await postJson('/api/shipment/adjust', { ...addBody, force: true });
      if (!d.success) {
        results.failed.push(`${m.name} 이동(목적지추가): ${d.error || '실패'} ⚠ 원천(${m.fromWeek})은 이미 취소됨 — 수동 복구 필요`);
        continue;
      }
      results.moveOk += 1;
    }
    // 이동 행 단가 보존 — 목적지 새 행의 Cost 를 원천 Cost 로 (견적 정렬 대상이면 뒤에서 다시 견적단가로 덮임)
    const movedWithCost = (plan.moves || []).filter(m => m.cost > 0);
    if (movedWithCost.length && typeof fetchRows === 'function') {
      try {
        const freshRows = await fetchRows();
        const costFix = [];
        for (const m of movedWithCost) {
          for (const r of freshRows.filter(x => Number(x.ProdKey) === m.prodKey && x.OrderWeek === m.toWeek)) {
            if (Math.abs(Number(r.Cost || 0) - m.cost) > 0.5) {
              costFix.push({ shipmentKey: r.ShipmentKey, sdetailKey: r.SdetailKey, cost: m.cost, expectedOldCost: Number(r.Cost || 0) });
            }
          }
        }
        if (costFix.length) {
          log(`이동 행 단가 보존 ${costFix.length}건 …`);
          const d = await postCost(costFix);
          if (!d.success) results.failed.push(`이동 단가 보존: ${d.error || '실패'}`);
        }
      } catch (e) {
        results.failed.push(`이동 단가 보존: ${e.message}`);
      }
    }
  };

  // ── 재고 쌍보정 — +D(목적지 주) / −D(원천 주), StockHistory 재고조정 (두 차수 합 0 → 이후 차수 불변) ──
  // adjust-batch 는 live(Product.Stock) 기준 afterStock: +D 후 원상복귀시키면 live 순변화 0, 주별 delta 만 남는다.
  const doStockPairs = async () => {
    for (const s of plan.stockPairs || []) {
      log(`재고 쌍보정: ${s.name} — ${s.plusWeek} +${fmt(s.delta)}박스 / ${s.minusWeek} −${fmt(s.delta)}박스 …`);
      const descr = `수동보정:차수잔량 (차수이동 ${plan.moveWeek}→${plan.moveTarget} 라움)`;
      let d = await postJson('/api/stock/adjust-batch', {
        week: s.plusWeek, force: true,
        edits: [{ prodKey: s.prodKey, afterStock: round2(s.live + s.delta), descr }],
      });
      if (!d.success && !(d.results || []).some(x => x.ok)) {
        results.failed.push(`${s.name} 재고보정(+): ${d.error || JSON.stringify(d.errors || '')}`);
        continue;
      }
      d = await postJson('/api/stock/adjust-batch', {
        week: s.minusWeek, force: true,
        edits: [{ prodKey: s.prodKey, afterStock: round2(s.live), descr: `${descr} 상쇄` }],
      });
      if (!d.success && !(d.results || []).some(x => x.ok)) {
        results.failed.push(`${s.name} 재고보정(−): ${d.error || ''} ⚠ +측만 적용됨 — 재고관리에서 ${s.minusWeek} 확인 필요`);
        continue;
      }
      results.stockOk += 1;
    }
  };

  const doQtyList = async (edits, viaCycle) => {
    const rejected = [];
    for (const e of edits) {
      log(`수량${viaCycle ? '(사이클)' : ''}: ${e.prodName} [${e.orderWeek}] ${fmt(e.oldQty)}→${fmt(e.quantity)}${e.unit} …`);
      const d = await postQty(e);
      if (d.success) { results.qtyOk += 1; continue; }
      if (d.code === 'FIXED_WEEK' && !viaCycle) rejected.push({ e, fixedWeeks: d.fixedWeeks || [], fixedCategories: d.fixedCategories || [] });
      else results.failed.push(`${e.prodName} 수량: ${d.error || '실패'}${d.code === 'STALE_DATA' ? ' (조회 후 변경됨 — 새로고침 후 재시도)' : ''}`);
    }
    return rejected;
  };
  const doCostBatch = async (edits, viaCycle) => {
    if (!edits.length) return null;
    log(`단가${viaCycle ? '(사이클)' : ''} ${edits.length}건 일괄 적용 …`);
    const d = await postCost(edits);
    if (d.success) { results.costOk += edits.length; return null; }
    if (d.code === 'FIXED_WEEK' && !viaCycle) return { fixedWeeks: d.fixedWeeks || [], fixedCategories: d.fixedCategories || [] };
    results.failed.push(`단가 일괄: ${d.error || '실패'}`);
    return null;
  };

  // ── 이동 품목 — 이동 완료 후 창 안 행을 재조회해 견적 수량·단가로 정렬 ──
  const doPostMoveAlign = async () => {
    if (!plan.postMoveTargets?.length || typeof fetchRows !== 'function') return;
    log('이동 품목을 견적 기준 수량·단가로 정렬 중 …');
    const freshRows = await fetchRows();
    const windowRows = freshRows.filter(r => (plan.windowWeeks || []).includes(r.OrderWeek));
    const qtyList = [];
    const costList = [];
    for (const t of plan.postMoveTargets) {
      const rows = windowRows.filter(r => Number(r.ProdKey) === t.prodKey);
      if (!rows.length) { results.failed.push(`${t.name} 이동후정렬: 창 안 행 없음`); continue; }
      const estSum = rows.reduce((a, r) => a + Number(r.EstQuantity || 0), 0);
      const amtSum = rows.reduce((a, r) => a + Number(r.Amount || 0), 0);
      const erpPrice = estSum > 0 ? amtSum / estSum : null;
      let k = 1;
      if (t.targetPrice > 0 && erpPrice > 0) {
        for (const cand of [1, 5, 10, 12, 20, 25, 30, 50]) {
          if (Math.abs(t.targetPrice - erpPrice * cand) <= t.targetPrice * 0.12) { k = cand; break; }
        }
      }
      if (t.targetPrice != null) {
        const targetCost = round2((t.targetPrice * 1.1) / k);
        for (const r of rows) {
          if (Math.abs(Number(r.Cost || 0) - targetCost) > 0.5) {
            costList.push({ shipmentKey: r.ShipmentKey, sdetailKey: r.SdetailKey, cost: targetCost, expectedOldCost: Number(r.Cost || 0) });
          }
        }
      }
      const targetEst = round2(t.targetQty * k);
      if (Math.abs(estSum - targetEst) > 0.005) {
        // 수량 조정은 이동 목적지(N-02) 행에 — 없으면 유일 행에
        const target = rows.find(r => r.OrderWeek === plan.moveTarget) || (rows.length === 1 ? rows[0] : null);
        if (!target) { results.failed.push(`${t.name} 이동후정렬: 대상 행 특정 불가(두 차수 분산) — 수동 확인`); continue; }
        const u = detectRowUnit(target);
        if (!u) { results.failed.push(`${t.name} 이동후정렬: 환산필드 불일치 — 수동 확인`); continue; }
        const othersEst = estSum - Number(target.EstQuantity || 0);
        const newQty = round2(targetEst - othersEst); // 이 행이 부담할 몫
        if (newQty < 0) { results.failed.push(`${t.name} 이동후정렬: 목표(${fmt(targetEst)})가 타 행 합(${fmt(othersEst)})보다 작음 — 수동 확인`); continue; }
        qtyList.push({
          sdetailKey: target.SdetailKey, shipmentKey: target.ShipmentKey,
          quantity: newQty, unit: u.unit, expectedOldQuantity: u.curUserQty,
          prodName: t.name, orderWeek: target.OrderWeek, oldQty: u.curUserQty,
        });
      }
    }
    await doQtyList(qtyList, true);
    await doCostBatch(costList, true);
  };

  // ═══ 실행 ═══
  if ((plan.moves || []).length) {
    if (!custKey) { results.failed.push('이동: 라움 CustKey 조회 실패 — 중단'); return results; }
    // 이동은 확정 차수(N-02)가 대상이므로 처음부터 사이클로 감싼다.
    // 수량/단가 편집이 걸린 차수(N-01 포함)도 사이클에 넣어야 확정 행 수정이 통과한다.
    const weekSet = new Set([plan.moveTarget, ...plan.editedWeeks]);
    const minW = [...weekSet].sort()[0];
    try {
      const fs = await fetch(`/api/shipment/fix-status?fromWeek=${minW}&toWeek=${plan.moveWeek}`).then(r => r.json());
      for (const w of fs.weeks || []) {
        if ((w.status === 'FIXED' || w.status === 'PARTIAL') && w.OrderWeek >= minW) weekSet.add(w.OrderWeek);
      }
    } catch { /* fix-status 실패 시 편집 차수만으로 진행 */ }
    const weeks = [...weekSet].sort();
    const all = [...plan.moves, ...plan.qtyEdits, ...plan.costEdits];
    const countryFlowers = [...new Set(all.map(e => e.categoryLabel).filter(Boolean))];
    const stockProdKeys = [...new Set(all.map(e => e.prodKey).filter(Boolean).concat((plan.postMoveTargets || []).map(t => t.prodKey)))];
    log(`차수 이동 포함 — [${weeks.join(', ')}] 확정해제→적용→재확정 사이클로 실행`);
    await runEditWithFixCycle({
      weeks, countryFlowers, stockProdKeys,
      progress: (m) => log(m),
      apply: async () => {
        await doMoves();
        await doStockPairs();
        await doAdds();
        await doQtyList(plan.qtyEdits, true);
        await doCostBatch(plan.costEdits, true);
        await doPostMoveAlign();
        return { success: true };
      },
    });
    return results;
  }

  // ── 이동 없음 — 기존 direct-first 경로 ──
  await doAdds();
  const rejectedQtyInfo = await doQtyList(plan.qtyEdits, false);
  const rejectedCostInfo = await doCostBatch(plan.costEdits, false);
  const rejectedQty = rejectedQtyInfo.map(x => x.e);
  const rejectedCost = rejectedCostInfo ? plan.costEdits : [];
  if (rejectedQty.length || rejectedCost.length) {
    const editedWeeks = new Set([...rejectedQty, ...rejectedCost].map(e => e.orderWeek));
    rejectedQtyInfo.forEach(x => x.fixedWeeks.forEach(w => editedWeeks.add(w)));
    (rejectedCostInfo?.fixedWeeks || []).forEach(w => editedWeeks.add(w));
    const minWeek = [...editedWeeks].sort()[0];
    try {
      const fsRes = await fetch(`/api/shipment/fix-status?fromWeek=${minWeek}&toWeek=${[...editedWeeks].sort().pop()}`);
      const fs = await fsRes.json();
      for (const w of fs.weeks || []) {
        if ((w.status === 'FIXED' || w.status === 'PARTIAL') && w.OrderWeek >= minWeek) editedWeeks.add(w.OrderWeek);
      }
    } catch { /* fix-status 조회 실패 시 편집 차수+서버 통보분만으로 진행 */ }
    const weeks = [...editedWeeks].sort();
    const serverCats = [
      ...rejectedQtyInfo.flatMap(x => x.fixedCategories),
      ...(rejectedCostInfo?.fixedCategories || []),
    ];
    const countryFlowers = [...new Set([...rejectedQty, ...rejectedCost].map(e => e.categoryLabel).filter(Boolean).concat(serverCats))];
    const stockProdKeys = [...new Set([...rejectedQty, ...rejectedCost].map(e => e.prodKey).filter(Boolean))];
    log(`확정 차수 감지 — [${weeks.join(', ')}] 확정해제→적용→재확정 사이클 시작 (카테고리 ${countryFlowers.length}개 범위)`);
    await runEditWithFixCycle({
      weeks, countryFlowers, stockProdKeys,
      progress: (m) => log(m),
      apply: async () => {
        await doQtyList(rejectedQty, true);
        await doCostBatch(rejectedCost, true);
        return { success: true };
      },
    });
  }
  return results;
}

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

// ── 품목 매칭 편집 모달 (모듈 스코프 — C-6) ──
// 견적 품목명 ↔ 전산 품목 매칭을 검색해서 바꾼다. DB(WebRaumItemMap) 저장 — 다음 업로드부터 자동 적용, 배포에도 유지.
function MatchEditorModal({ edit, onPick, onClear, onClose }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (edit?.open) { setQ(''); setList([]); setErr(''); }
  }, [edit?.open, edit?.name]);
  if (!edit?.open) return null;
  const doSearch = async (term) => {
    const t = String(term || '').trim();
    if (!t) return;
    setSearching(true);
    setErr('');
    try {
      const r = await fetch(`/api/raum/item-mapping?q=${encodeURIComponent(t)}`);
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '검색 실패');
      setList(j.products || []);
      if (!(j.products || []).length) setErr('검색 결과 없음 — 다른 검색어로 시도하세요 (영문 품종명도 가능)');
    } catch (e) {
      setErr(e.message);
    } finally {
      setSearching(false);
    }
  };
  const cellTd = { border: '1px solid #e2e8f0', padding: '4px 8px', fontSize: 12, whiteSpace: 'nowrap' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '18px 22px', width: 'min(720px, 94vw)', maxHeight: '84vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>🔗 품목 매칭 수정 — {edit.name}</div>
        <div style={{ fontSize: 12.5, color: '#475569', marginBottom: 10 }}>
          현재 매칭: {edit.current ? <b>{edit.current}</b> : <span style={{ color: '#b91c1c' }}>미매칭 ⚪</span>}
          {' '}· 선택하면 기억해서 다음 업로드부터 자동 적용됩니다 (전산 분배 대조·도착원가에도 반영)
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            autoFocus
            style={{ flex: 1, padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
            placeholder="전산 품목 검색 (한글/영문 — 예: Damina, 아바란체, Hydrangea)"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') doSearch(q); }}
          />
          <button style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', cursor: 'pointer' }} disabled={searching} onClick={() => doSearch(q)}>
            {searching ? '검색 중…' : '🔍 검색'}
          </button>
        </div>
        {err ? <div style={{ fontSize: 12.5, color: '#b91c1c', marginBottom: 6 }}>{err}</div> : null}
        {list.length ? (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>{['품목명', '분류', '원산지', ''].map(h => <th key={h} style={{ ...cellTd, background: '#f1f5f9', fontWeight: 700 }}>{h}</th>)}</tr></thead>
            <tbody>{list.map(p => (
              <tr key={p.ProdKey} style={{ cursor: 'pointer' }} onClick={() => onPick(p)}>
                <td style={{ ...cellTd, whiteSpace: 'normal' }}>{p.ProdName}{p.DisplayName ? ` (${p.DisplayName})` : ''}</td>
                <td style={cellTd}>{p.FlowerName}</td>
                <td style={cellTd}>{p.CounName}</td>
                <td style={cellTd}><button style={{ padding: '2px 10px', borderRadius: 5, border: '1px solid #16a34a', background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 12 }}>선택</button></td>
              </tr>
            ))}</tbody>
          </table>
        ) : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {edit.current ? (
            <button style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', cursor: 'pointer' }} onClick={onClear}>매칭 해제</button>
          ) : null}
          <button style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }} onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// ── 전산 일괄수정 모달 (모듈 스코프 — C-6 포커스/리마운트 함정 방지) ──
function ErpSyncModal({ sync, onApply, onClose }) {
  if (!sync?.open) return null;
  const { plan, logs, running, done, results } = sync;
  const cellTd = { border: '1px solid #e2e8f0', padding: '3px 8px', whiteSpace: 'nowrap', fontSize: 12 };
  const numTd = { ...cellTd, textAlign: 'right' };
  const total = plan.costEdits.length + plan.qtyEdits.length + (plan.addEdits?.length || 0) + (plan.moves?.length || 0);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '18px 22px', width: 'min(880px, 94vw)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>⚖ 전산 분배를 견적서 값으로 일괄수정</div>
        <div style={{ fontSize: 12.5, color: '#475569', marginBottom: 12 }}>
          견적서 관리와 동일한 수정 API를 사용합니다 — 견적서 금액(ShipmentDate)·환산수량이 함께 갱신되고,
          확정된 차수는 자동으로 <b>확정해제 → 적용 → 재확정</b> 사이클을 탑니다 (수 분 소요될 수 있음).
          적용 후 전산 견적서 화면에서 금액을 한 번 확인하세요.
        </div>

        {plan.moves?.length ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, margin: '8px 0 4px' }}>
              🔀 차수 이동 {plan.moves.length}건 <span style={{ fontWeight: 400, color: '#64748b' }}>({plan.moveWeek}에 잘못 입력된 라움 분배 → {plan.moveTarget}로 주문·분배 이동, 단가 보존)</span>
            </div>
            <table style={{ borderCollapse: 'collapse' }}>
              <thead><tr>{['품목', '이동', '수량', '단가(보존)'].map(h => <th key={h} style={{ ...cellTd, background: '#fdf4ff', fontWeight: 700 }}>{h}</th>)}</tr></thead>
              <tbody>{plan.moves.map(m => (
                <tr key={`m${m.sdetailKey}`}>
                  <td style={cellTd}>{m.name}</td>
                  <td style={{ ...cellTd, textAlign: 'center' }}>{m.fromWeek} → <b>{m.toWeek}</b></td>
                  <td style={{ ...numTd, fontWeight: 700 }}>{fmt(m.qty)}{m.unit}</td>
                  <td style={numTd}>{fmt1(m.cost)}</td>
                </tr>
              ))}</tbody>
            </table>
            {plan.stockPairs?.length ? (
              <div style={{ background: '#fdf4ff', border: '1px solid #e9d5ff', borderRadius: 6, padding: '6px 10px', fontSize: 12, margin: '6px 0' }}>
                <b>재고 쌍보정 {plan.stockPairs.length}건</b> — 이동으로 {plan.moveTarget} 잔량이 음수가 되는 만큼만 +/− 로 보정 (두 차수 합 0, 이후 차수 영향 없음)
                {plan.stockPairs.map((s, i) => <div key={i}>· {s.name}: {s.plusWeek} <b>+{fmt1(s.delta)}</b>박스 / {s.minusWeek} <b>−{fmt1(s.delta)}</b>박스</div>)}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#64748b', margin: '4px 0' }}>재고 쌍보정 불필요 — 이동 후에도 {plan.moveTarget} 잔량이 음수가 되지 않습니다.</div>
            )}
            {plan.postMoveTargets?.length ? (
              <div style={{ fontSize: 12, color: '#64748b', margin: '4px 0' }}>
                이동 후 견적 기준 정렬 대상: {plan.postMoveTargets.map(t => `${t.name}(수량 ${fmt(t.targetQty)}${t.targetPrice != null ? ` · 단가 ${fmt1(t.targetPrice)}` : ''})`).join(', ')}
              </div>
            ) : null}
          </>
        ) : null}

        {plan.addEdits?.length ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, margin: '8px 0 4px' }}>
              신규 분배 추가 {plan.addEdits.length}건 <span style={{ fontWeight: 400, color: '#64748b' }}>(전산에 분배가 없는 품목 — 주문+출고 동시 생성, 단가는 견적서 단가로 세팅)</span>
            </div>
            <table style={{ borderCollapse: 'collapse' }}>
              <thead><tr>{['품목', '대상 차수', '추가 수량', '단가(견적)'].map(h => <th key={h} style={{ ...cellTd, background: '#ecfdf5', fontWeight: 700 }}>{h}</th>)}</tr></thead>
              <tbody>{plan.addEdits.map(a => (
                <tr key={`a${a.prodKey}`}>
                  <td style={cellTd}>{a.name}</td>
                  <td style={{ ...cellTd, textAlign: 'center' }}>{a.week}</td>
                  <td style={{ ...numTd, fontWeight: 700, color: '#166534' }}>+{fmt(a.qty)}{a.unit}</td>
                  <td style={numTd}>{fmt1(a.price)}</td>
                </tr>
              ))}</tbody>
            </table>
          </>
        ) : null}

        {plan.qtyEdits.length ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, margin: '8px 0 4px' }}>수량 변경 {plan.qtyEdits.length}건</div>
            <table style={{ borderCollapse: 'collapse' }}>
              <thead><tr>{['품목', '차수', '전산 현재', '→ 견적 기준'].map(h => <th key={h} style={{ ...cellTd, background: '#f1f5f9', fontWeight: 700 }}>{h}</th>)}</tr></thead>
              <tbody>{plan.qtyEdits.map(e => (
                <tr key={`q${e.sdetailKey}`}>
                  <td style={cellTd}>{e.prodName}</td>
                  <td style={{ ...cellTd, textAlign: 'center' }}>{e.orderWeek}</td>
                  <td style={numTd}>{fmt(e.oldQty)}{e.unit}</td>
                  <td style={{ ...numTd, fontWeight: 700, color: '#1d4ed8' }}>{fmt(e.quantity)}{e.unit}</td>
                </tr>
              ))}</tbody>
            </table>
          </>
        ) : null}

        {plan.costEdits.length ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, margin: '10px 0 4px' }}>단가 변경 {plan.costEdits.length}건 <span style={{ fontWeight: 400, color: '#64748b' }}>(VAT포함 단가 기준 = 견적단가×1.1)</span></div>
            <table style={{ borderCollapse: 'collapse' }}>
              <thead><tr>{['품목', '차수', '전산 현재', '→ 견적 기준'].map(h => <th key={h} style={{ ...cellTd, background: '#f1f5f9', fontWeight: 700 }}>{h}</th>)}</tr></thead>
              <tbody>{plan.costEdits.map(e => (
                <tr key={`c${e.sdetailKey}`}>
                  <td style={cellTd}>{e.prodName}</td>
                  <td style={{ ...cellTd, textAlign: 'center' }}>{e.orderWeek}</td>
                  <td style={numTd}>{fmt1(e.oldCost)}</td>
                  <td style={{ ...numTd, fontWeight: 700, color: '#1d4ed8' }}>{fmt1(e.cost)}</td>
                </tr>
              ))}</tbody>
            </table>
          </>
        ) : null}

        {!total ? <div style={{ fontSize: 13, color: '#166534', margin: '8px 0' }}>✅ 자동으로 적용할 불일치가 없습니다.</div> : null}

        {plan.info?.length ? (
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, padding: '8px 12px', fontSize: 12, margin: '10px 0' }}>
            <b>ℹ 조치 불필요 {plan.info.length}건</b> — 인접 세부차수에 이미 동일하게 분배됨 (이중분배 방지를 위해 제외)
            {plan.info.map((m, i) => <div key={i}>· {m.name} — {m.note}</div>)}
          </div>
        ) : null}

        {plan.manual.length ? (
          <div style={{ background: '#fef3c7', border: '1px solid #fde047', borderRadius: 6, padding: '8px 12px', fontSize: 12, margin: '10px 0' }}>
            <b>수동 확인 필요 {plan.manual.length}건</b> (자동수정에서 제외)
            {plan.manual.map((m, i) => <div key={i}>· {m.name} — {m.reason}</div>)}
          </div>
        ) : null}

        {logs.length ? (
          <pre style={{ background: '#0f172a', color: '#e2e8f0', borderRadius: 6, padding: 10, fontSize: 11.5, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
            {logs.join('\n')}
          </pre>
        ) : null}

        {done && results ? (
          <div style={{ background: results.failed.length ? '#fee2e2' : '#dcfce7', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, margin: '8px 0' }}>
            완료 — 이동 {results.moveOk || 0}건 · 재고보정 {results.stockOk || 0}건 · 신규분배 {results.addOk || 0}건 · 수량 {results.qtyOk}건 · 단가 {results.costOk}건 적용{results.failed.length ? ` · 실패 ${results.failed.length}건` : ''}
            {results.failed.map((f, i) => <div key={i} style={{ color: '#991b1b' }}>✗ {f}</div>)}
            <div style={{ marginTop: 4, color: '#475569' }}>대조 칸이 새 전산값으로 갱신됐습니다. [💾 저장]을 눌러 스냅샷을 기록하세요.</div>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {!done ? (
            <button
              style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #dc2626', background: running ? '#fca5a5' : '#dc2626', color: '#fff', fontWeight: 700, cursor: running ? 'wait' : 'pointer' }}
              disabled={running || !total}
              onClick={onApply}
            >{running ? '적용 중… (창을 닫지 마세요)' : `⚠ 전산에 적용 (${total}건)`}</button>
          ) : null}
          <button style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }} disabled={running} onClick={onClose}>닫기</button>
        </div>
      </div>
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

  // ── 품목 매칭 편집 ──
  const [matchEdit, setMatchEdit] = useState(null); // { open, name, current }

  const applyMatch = async (prodKeyOrNull, prodName) => {
    const name = matchEdit?.name;
    if (!name) return;
    try {
      const r = await fetch('/api/raum/item-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, prodKey: prodKeyOrNull }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '매칭 저장 실패');
      // 같은 품목명 행 전부에 반영 (단가 분리 행 포함)
      setDetail(d => ({
        ...d,
        items: d.items.map(it => (String(it.name).trim() === String(name).trim()
          ? { ...it, prodKey: prodKeyOrNull, prodName: prodKeyOrNull != null ? (j.prodName || prodName) : null, erpQty: null, erpSalePrice: null }
          : it)),
        unsaved: true,
      }));
      setMatchEdit(null);
      setMessage(prodKeyOrNull != null
        ? `매칭 저장: ${name} → ${j.prodName || prodName} (다음 업로드부터 자동 적용)`
        : `매칭 해제: ${name}`);
      // 대조값 즉시 갱신
      try { await refreshErpCompare(); } catch { /* 대조 갱신 실패는 치명 아님 — 재업로드로 갱신 가능 */ }
    } catch (e) {
      setError(e.message);
    }
  };

  // ── 수동 사입 지정/해제 — DB 저장(다음 업로드 자동 적용), 같은 품목명 행 전부 반영 ──
  const markConsigned = async (name, on) => {
    setError('');
    try {
      const r = await fetch('/api/raum/consigned-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, consigned: on }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '사입 지정 실패');
      setDetail(d => ({
        ...d,
        items: d.items.map(it => (String(it.name).trim() === String(name).trim() && !it.isCustom
          ? { ...it, consigned: on, consignedManual: on }
          : it)),
        unsaved: true,
      }));
      setMessage(on
        ? `사입 제외 지정: ${name} — 매출에는 포함되고 손익 계산에서 빠집니다 (다음 업로드부터 자동)`
        : `사입 지정 해제: ${name}`);
    } catch (e) {
      setError(e.message);
    }
  };

  // ── 전산 일괄수정 (견적서 값 기준) ──
  const [sync, setSync] = useState(null); // { open, plan, logs, running, done, results }

  const refreshErpCompare = async () => {
    // 최신 전산 행으로 대조값(erpQty/erpSalePrice) 갱신 — { rows, custKey } 반환
    const r = await fetch(`/api/raum/pnl-erp-rows?major=${detail.meta.major}&year=${detail.meta.orderYear}`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error || '전산 행 조회 실패');
    // 대조(erpQty): 창(N-02·(N+1)-01) 우선, 창에 없는 품목만 N-01 폴백(쌓아두는 품목)
    const windowWeeks = j.weeks || [];
    const winAgg = {};
    const prevAgg = {};
    for (const row of j.rows) {
      const target = windowWeeks.includes(row.OrderWeek) ? winAgg : prevAgg;
      const a = target[row.ProdKey] = target[row.ProdKey] || { est: 0, amt: 0 };
      a.est += Number(row.EstQuantity || 0);
      a.amt += Number(row.Amount || 0);
    }
    setDetail(d => ({
      ...d,
      items: d.items.map(it => {
        if (it.prodKey == null) return it;
        const a = winAgg[it.prodKey] || prevAgg[it.prodKey];
        const fromPrev = !winAgg[it.prodKey] && !!prevAgg[it.prodKey];
        return {
          ...it,
          erpQty: a ? a.est : null,
          erpSalePrice: a && a.est > 0 ? Math.round((a.amt / a.est) * 10) / 10 : null,
          erpFromPrev: fromPrev,
        };
      }),
      unsaved: true,
    }));
    return {
      rows: j.rows, custKey: j.custKey, windowWeeks,
      prevWeek: j.prevWeek,
    };
  };

  const openErpSync = async () => {
    setError('');
    try {
      const ctx = await refreshErpCompare();
      const plan = buildErpSyncPlan(detail.items, ctx.rows, {
        addWeek: ctx.windowWeeks[ctx.windowWeeks.length - 1], // 신규 분배는 창의 마지막 주((N+1)-01)에 생성
        windowWeeks: ctx.windowWeeks,
        prevWeek: ctx.prevWeek,
      });
      setSync({ open: true, plan, custKey: ctx.custKey, logs: [], running: false, done: false, results: null });
    } catch (e) {
      setError(e.message);
    }
  };

  const applyErpSync = async () => {
    if (!sync?.plan) return;
    const addCnt = sync.plan.addEdits?.length || 0;
    const moveCnt = sync.plan.moves?.length || 0;
    const total = sync.plan.costEdits.length + sync.plan.qtyEdits.length + addCnt + moveCnt;
    if (!window.confirm(
      `전산 분배 ${total}건(차수이동 ${moveCnt} · 신규추가 ${addCnt} · 수량 ${sync.plan.qtyEdits.length} · 단가 ${sync.plan.costEdits.length})을 견적서 값으로 수정합니다.\n` +
      (moveCnt ? `${sync.plan.moveWeek}의 라움 분배를 ${sync.plan.moveTarget}로 옮기고 필요한 만큼 재고를 쌍보정합니다.\n` : '') +
      `확정된 차수는 자동으로 확정해제→적용→재확정됩니다.\n계속할까요?`
    )) return;
    setSync(s => ({ ...s, running: true, logs: [] }));
    const log = (m) => setSync(s => (s ? { ...s, logs: [...s.logs, m] } : s));
    try {
      const results = await applyErpSyncPlan(sync.plan, log, {
        custKey: sync.custKey,
        fetchRows: async () => (await refreshErpCompare()).rows,
      });
      log('전산값 재조회 중…');
      await refreshErpCompare();
      setSync(s => ({ ...s, running: false, done: true, results }));
    } catch (e) {
      setSync(s => ({ ...s, running: false, done: true, results: { qtyOk: 0, costOk: 0, failed: [`중단: ${e.message}`] } }));
    }
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
      <ErpSyncModal sync={sync} onApply={applyErpSync} onClose={() => setSync(null)} />
      <MatchEditorModal
        edit={matchEdit}
        onPick={(p) => applyMatch(p.ProdKey, p.ProdName)}
        onClear={() => applyMatch(null)}
        onClose={() => setMatchEdit(null)}
      />

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
            <button
              style={{ ...st.btn, borderColor: '#f59e0b' }}
              onClick={openErpSync}
              title="전산 분배 대조에서 어긋난 품목의 수량·단가를 견적서 값 기준으로 전산에 일괄 반영합니다 (견적서 관리와 동일 수정 로직·확정차수 자동 사이클). 적용 전 변경 목록을 먼저 보여줍니다."
            >⚖ 전산 일괄수정</button>
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
                  <th style={st.th} title="전산 라움 분배와 견적서 비교 — 기준 창 = 전산 N-2차+(N+1)-1차. 창에 없는 품목(쌓아두는 선입고 품목)만 N-1차를 폴백으로 확인('(전차수분)' 표시). 수량은 같은 품목 행 합계 기준, 단가는 ±2%">전산 분배 대조</th>
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
                        ) : (
                          <>
                            {it.name}{it.prodName ? '' : ' ⚪'}
                            {!it.consigned ? (
                              <button
                                style={{ marginLeft: 5, padding: '0 5px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11, color: '#475569' }}
                                title={`품목 매칭 ${it.prodName ? '수정' : '연결'} — 전산 품목을 검색해서 바꿉니다 (기억됨)`}
                                onClick={() => setMatchEdit({ open: true, name: it.name, current: it.prodName || null })}
                              >✎</button>
                            ) : null}
                          </>
                        )}
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
                        const smallBtn = { marginLeft: 5, padding: '0 6px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 11 };
                        return (
                          <td style={{ ...st.td, fontSize: 11.5, whiteSpace: 'nowrap', ...ERP_TONE[cmp.tone] }} title={cmp.title}>
                            {cmp.label}
                            {!it.isCustom && it.consigned && it.consignedManual ? (
                              <button style={{ ...smallBtn, color: '#b91c1c' }} title="수동 사입 지정을 해제합니다 (다음 업로드부터 다시 손익에 포함)" onClick={() => markConsigned(it.name, false)}>해제</button>
                            ) : null}
                            {!it.isCustom && !it.consigned && cmp.label === '이번차수 분배없음' ? (
                              <button style={{ ...smallBtn, color: '#475569' }} title="이 품목을 사입으로 지정 — 매출에는 포함, 손익 계산·전산 일괄수정에서 제외됩니다 (기억됨)" onClick={() => markConsigned(it.name, true)}>사입 제외</button>
                            ) : null}
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
