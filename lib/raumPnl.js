// lib/raumPnl.js — 라움 손익계산서
// 견적서(거래명세표) 엑셀 업로드 → 강남/건대 시트 파싱·합산(품목명+단가 동일할 때만) →
// 차수별 저장(WebRaumPnl/WebRaumPnlItem, 웹 전용) + 전산 참고단가(Product.Cost÷1.1) 조회.
// 매출단가 = 견적서 단가(확정), 매입단가 = 사용자 수기 입력(참고단가는 채우기 보조).
import { query, withTransaction, sql } from './db';
import { loadMappings, getMapping, findMappingFuzzy } from './parseMappings';
import { scoreMatch } from './displayName';
import { getArrivalCostsWithFallback } from './catalogArrival';
import { resolveCatalogArrivalDisplay } from './catalogUnitMatch';

export const DEFAULT_NENOVA_PCT = 80; // 순익분배 네노바 80 : 미우 20 (2026-07 사장님 확정)

// ── 견적서 파싱 ─────────────────────────────────────────────

const normSpace = (s) => String(s ?? '').replace(/[\s ]+/g, ' ').trim();

function findHeader(aoa) {
  for (let r = 0; r < Math.min(aoa.length, 40); r += 1) {
    const row = aoa[r] || [];
    const cells = row.map(normSpace);
    const nameIdx = cells.findIndex(c => c === '품목명' || c === '품명');
    const qtyIdx = cells.findIndex(c => c === '수량');
    const priceIdx = cells.findIndex(c => c === '단가');
    if (nameIdx >= 0 && qtyIdx >= 0 && priceIdx >= 0) {
      return {
        row: r,
        name: nameIdx,
        qty: qtyIdx,
        price: priceIdx,
        unit: cells.findIndex(c => c === '단위'),
        origin: cells.findIndex(c => c === '원산지'),
        supply: cells.findIndex(c => c === '공급가액'),
        vat: cells.findIndex(c => c === '부가세'),
        remark: cells.findIndex(c => c === '적요' || c === '비고'),
      };
    }
  }
  return null;
}

function detectBranch(sheetName, aoa) {
  const m = String(sheetName).match(/(\d{1,2})\s*차\s*([가-힣A-Za-z]+?)(?:양식)?$/);
  let major = m ? m[1].padStart(2, '0') : null;
  let branch = m ? m[2] : null;
  if (!branch) {
    for (let r = 0; r < Math.min(aoa.length, 14); r += 1) {
      for (const cell of aoa[r] || []) {
        const t = normSpace(cell);
        const bm = t.match(/(강남|건대)\s*라움/);
        if (bm) { branch = bm[1]; break; }
      }
      if (branch) break;
    }
  }
  return { major, branch: branch || sheetName };
}

function detectQuoteDate(aoa) {
  for (let r = 0; r < Math.min(aoa.length, 8); r += 1) {
    for (const cell of aoa[r] || []) {
      if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
        // SheetJS 는 날짜 셀(자정)을 수십 초 이른 시각으로 파싱(1900 에포크 보정+시간대).
        // +12시간 후 날짜부만 취하면 어느 시간대에서도 의도한 날짜가 나온다.
        return new Date(cell.getTime() + 12 * 3600 * 1000);
      }
    }
  }
  return null;
}

function parseSheet(sheetName, aoa) {
  const header = findHeader(aoa);
  if (!header) return null;
  const { major, branch } = detectBranch(sheetName, aoa);
  const items = [];
  let summarySupply = null;
  let summaryVat = null;
  let summaryTotal = null;
  for (let r = header.row + 1; r < aoa.length; r += 1) {
    const row = aoa[r] || [];
    const first = normSpace(row[0]);
    // 하단 요약행: A열 '공급가액' … 'VAT' … '합계' 라벨 뒤 숫자
    if (first === '공급가액' || first === '합계') {
      for (let c = 0; c < row.length; c += 1) {
        const label = normSpace(row[c]);
        const findNumAfter = (from) => {
          for (let k = from + 1; k < row.length; k += 1) {
            const n = Number(row[k]);
            if (Number.isFinite(n) && n !== 0) return n;
          }
          return null;
        };
        if (label === '공급가액' && summarySupply == null) summarySupply = findNumAfter(c);
        if (label === 'VAT' && summaryVat == null) summaryVat = findNumAfter(c);
        if (label === '합계' && summaryTotal == null) summaryTotal = findNumAfter(c);
      }
      break;
    }
    const name = normSpace(row[header.name]);
    const qty = Number(row[header.qty]);
    if (!name || !Number.isFinite(qty) || qty === 0) continue;
    const price = Number(row[header.price]);
    if (!Number.isFinite(price)) continue;
    let supply = header.supply >= 0 ? Number(row[header.supply]) : NaN;
    if (!Number.isFinite(supply) || supply === 0) supply = qty * price;
    // 수식 캐시 없는 셀은 null→0 으로 읽힘 — 0 도 미기재로 보고 공급가액×10% 폴백 (VAT 0% 품목 없음)
    let vat = header.vat >= 0 ? Number(row[header.vat]) : NaN;
    if (!Number.isFinite(vat) || vat === 0) vat = supply * 0.1;
    items.push({
      name,
      unit: header.unit >= 0 ? normSpace(row[header.unit]) : '',
      qty,
      price,
      supply,
      vat,
      // 원산지 빈 행 = 업체 사입분 (2026-07-14 사장님 확정) — 매출 합산엔 포함, 손익 계산에선 제외
      consigned: header.origin >= 0 && !normSpace(row[header.origin]),
      remark: header.remark >= 0 ? normSpace(row[header.remark]) : '',
    });
  }
  return { sheetName, major, branch, quoteDate: detectQuoteDate(aoa), items, summarySupply, summaryVat, summaryTotal };
}

// ── 검증 리포트 — 파싱/합산이 견적서 원본 숫자와 맞는지 ✓/✗ 근거 제공 ──
// tol: 견적서 하단 셀은 원단위 반올림이라 소액 오차 허용, 보존 검증(합산 전후)은 부동소수점 오차만 허용
function buildVerification(sheets, mergedItems) {
  const checks = [];
  const push = (group, label, sheetVal, parsedVal, tol) => {
    if (sheetVal == null) return; // 견적서에 해당 요약 셀이 없으면 비교 불가 — 항목 생략
    const diff = parsedVal - sheetVal;
    checks.push({
      group, label,
      sheetVal: Math.round(sheetVal * 100) / 100,
      parsedVal: Math.round(parsedVal * 100) / 100,
      diff: Math.round(diff * 100) / 100,
      ok: Math.abs(diff) <= tol,
    });
  };
  for (const sh of sheets) {
    const supply = sh.items.reduce((a, it) => a + it.supply, 0);
    const vat = sh.items.reduce((a, it) => a + it.vat, 0);
    push(sh.branch, '공급가액', sh.summarySupply, supply, 5);
    push(sh.branch, '부가세(VAT)', sh.summaryVat, vat, 5);
    push(sh.branch, '합계(VAT포함)', sh.summaryTotal, supply + vat, 5);
  }
  // 합산 보존 — 시트 전체 합 = 합산 후 합 (다르면 합산 로직이 행을 잃거나 중복시킨 것)
  const allSheetItems = sheets.flatMap(s => s.items);
  const sheetQty = allSheetItems.reduce((a, it) => a + it.qty, 0);
  const sheetSupply = allSheetItems.reduce((a, it) => a + it.supply, 0);
  const mergedQty = mergedItems.reduce((a, it) => a + it.qty, 0);
  const mergedSupply = mergedItems.reduce((a, it) => a + it.supply, 0);
  push('합산 보존', '수량 (시트합 = 합산합)', sheetQty, mergedQty, 0.01);
  push('합산 보존', '공급가액 (시트합 = 합산합)', sheetSupply, mergedSupply, 0.5);
  checks.push({
    group: '합산 보존', label: '품목 행수',
    sheetVal: allSheetItems.length, parsedVal: mergedItems.length,
    diff: mergedItems.length - allSheetItems.length,
    ok: true, info: `${allSheetItems.length}행 → ${mergedItems.length}행 (품목+단가 동일 ${allSheetItems.length - mergedItems.length}건 합산)`,
  });
  return checks;
}

/** 워크북 전체 파싱 + 지점 합산.
 *  합산 규칙: 품목명+단가가 완전히 같을 때만 수량/금액 합산, 단가가 다르면 별도 행 유지. */
export function parseRaumQuoteWorkbook(XLSX, workbook) {
  let sheets = [];
  const warnings = [];
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const parsed = parseSheet(sheetName, aoa);
    if (!parsed || parsed.items.length === 0) continue;
    // 불일치 경고는 buildVerification 이 일괄 생성 (검증 패널과 단일 소스)
    sheets.push({ ...parsed, parsedSupply: parsed.items.reduce((a, it) => a + it.supply, 0) });
  }
  if (sheets.length === 0) {
    return { sheets: [], items: [], major: null, quoteDate: null, warnings: ['견적서 시트를 찾지 못했습니다. 품목명/수량/단가 헤더가 있는 시트인지 확인하세요.'] };
  }

  // 업체가 매주 같은 워크북에 시트를 누적(27차·28차…)하므로 — 최신 차수 시트만 반영.
  // 안 그러면 지난 차수와 중첩 합산돼 수량이 부풀고 검증이 깨진다 (2026-07-17 사장님 리포트).
  const majors = [...new Set(sheets.map(s => s.major).filter(Boolean))];
  if (majors.length > 1) {
    const latest = String(Math.max(...majors.map(Number))).padStart(2, '0');
    const dropped = sheets.filter(s => s.major && s.major !== latest);
    sheets = sheets.filter(s => !s.major || s.major === latest);
    warnings.push(
      `워크북에 여러 차수 시트가 있어(${majors.map(Number).sort((a, b) => a - b).join('·')}차) 최신 ${Number(latest)}차 시트만 반영했습니다. ` +
      `제외: ${dropped.map(s => s.sheetName).join(', ')} — 지난 차수는 이미 저장된 기록을 사용하세요.`
    );
  }
  const major = sheets.map(s => s.major).find(Boolean) || null;
  // 견적일(일련번호 날짜)은 반영된 차수 시트에서 가장 최근 값
  const quoteDate = sheets.map(s => s.quoteDate).filter(Boolean).sort((a, b) => b - a)[0] || null;

  // 지점 합산 — key = 품목명 + 단가(소수 2자리) + 사입 여부(사입/일반 행은 섞지 않음)
  const map = new Map();
  const order = [];
  for (const sh of sheets) {
    for (const it of sh.items) {
      const key = `${it.name}|${it.price.toFixed(2)}|${it.consigned ? 'C' : ''}`;
      if (!map.has(key)) {
        map.set(key, {
          name: it.name, unit: it.unit, price: it.price, consigned: !!it.consigned,
          qty: 0, supply: 0, byBranch: {}, remarks: new Set(),
        });
        order.push(key);
      }
      const acc = map.get(key);
      acc.qty += it.qty;
      acc.supply += it.supply;
      acc.byBranch[sh.branch] = (acc.byBranch[sh.branch] || 0) + it.qty;
      if (!acc.unit && it.unit) acc.unit = it.unit;
      if (it.remark) acc.remarks.add(it.remark);
    }
  }
  const items = order.map((key, i) => {
    const acc = map.get(key);
    return {
      seq: i + 1,
      name: acc.name,
      unit: acc.unit,
      qty: acc.qty,
      price: acc.price,
      supply: acc.supply,
      byBranch: acc.byBranch,
      consigned: acc.consigned,
      remark: [...acc.remarks].join(', '),
    };
  });

  const verification = buildVerification(sheets, items);
  for (const c of verification) {
    if (!c.ok) warnings.push(`검증 실패 — [${c.group}] ${c.label}: 견적서 ${c.sheetVal.toLocaleString()} vs 파싱 ${c.parsedVal.toLocaleString()} (차이 ${c.diff.toLocaleString()})`);
  }
  return { sheets, items, major, quoteDate, warnings, verification };
}

// ── 전산 참고단가 조회 ──────────────────────────────────────
// 참고단가 = Product.Cost ÷ 1.1 (전산 품목원가는 VAT 포함 저장 — lib/profitReport.js 평가단가와 동일 해석).
// 매칭: order-mappings.json(라움 발주 업로드 학습) → 해당 차수 라움 분배 품목명 토큰 매칭.

const UNIT_WORDS = new Set(['단', '대', '박스', '송이', '스팀', '개']);

function tokensOf(name) {
  return normSpace(name).toLowerCase().split(' ').filter(t => t.length >= 2 && !UNIT_WORDS.has(t));
}

// quoteItems: [{ name, price }] — price 는 유사매칭 검증용(분배단가=견적단가 원리)
export async function lookupErpRefPrices(quoteItems, major, orderYear) {
  // 호텔(라움) 차수 규칙 (사장님 최종 확정 2026-07-17): 기준 창 = 전산 N-02 + (N+1)-01.
  // 창에서 분배를 못 찾는 품목(쌓아두는 선입고 품목: White Necklace·다미나·델피늄류)만 N-01 을 폴백으로 확인.
  const mj = String(major).padStart(2, '0');
  const nextMj = String(Number(major) + 1).padStart(2, '0');
  const wPrev = `${mj}-01`;
  const w1 = `${mj}-02`;
  const w2 = `${nextMj}-01`;
  const yw1 = `${orderYear}${mj}%`;
  const yw2 = `${orderYear}${nextMj}%`;
  // 도착원가 — 창의 마지막 전산 주((N+1)-01)부터 과거로 내려가며 품목별 가장 최근 값
  let arrivalMap = {};
  let arrivalErr = null;
  try {
    const arr = await getArrivalCostsWithFallback({
      orderYear: String(orderYear),
      anchorWeek: w2,
      maxWeeks: 26,
    });
    arrivalMap = arr.map || {};
  } catch (e) {
    arrivalErr = e.message;
  }
  // 라움(트라움) 분배 품목 — 창(N-02·(N+1)-01)과 폴백(N-01)을 zone 으로 구분해 집계
  const erp = await query(
    `SELECT p.ProdKey, p.ProdName, ISNULL(p.DisplayName, '') AS DisplayName,
            ISNULL(p.FlowerName, '') AS FlowerName, ISNULL(p.CounName, '') AS CounName,
            ISNULL(p.Cost, 0) AS Cost,
            p.EstUnit, p.OutUnit, p.SteamOf1Box, p.BunchOf1Box, p.SteamOf1Bunch,
            CASE WHEN sm.OrderWeek = @wPrev THEN 'prev' ELSE 'win' END AS Zone,
            SUM(ISNULL(sd.EstQuantity, 0)) AS EstQty, SUM(ISNULL(sd.Amount, 0)) AS Amt
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Customer c ON sm.CustKey = c.CustKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
      WHERE ISNULL(sm.isDeleted, 0) = 0
        AND c.isDeleted = 0 AND (c.CustName LIKE N'%라움%' OR c.CustName LIKE N'%트라움%')
        AND ((sm.OrderWeek IN (@wPrev, @w1) AND ISNULL(sm.OrderYearWeek, '') LIKE @yw1)
          OR (sm.OrderWeek = @w2 AND ISNULL(sm.OrderYearWeek, '') LIKE @yw2))
      GROUP BY p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.Cost,
               p.EstUnit, p.OutUnit, p.SteamOf1Box, p.BunchOf1Box, p.SteamOf1Bunch,
               CASE WHEN sm.OrderWeek = @wPrev THEN 'prev' ELSE 'win' END`,
    {
      wPrev: { type: sql.NVarChar, value: wPrev },
      w1: { type: sql.NVarChar, value: w1 },
      w2: { type: sql.NVarChar, value: w2 },
      yw1: { type: sql.NVarChar, value: yw1 },
      yw2: { type: sql.NVarChar, value: yw2 },
    }
  );
  // 품목별: 창(win) 우선, 창에 없으면 N-01(prev) 폴백 (fromPrev 표시)
  const winByKey = new Map();
  const prevByKey = new Map();
  for (const r of erp.recordset || []) {
    (r.Zone === 'win' ? winByKey : prevByKey).set(Number(r.ProdKey), r);
  }
  const erpByKey = new Map();
  for (const [pk, r] of winByKey) erpByKey.set(pk, { ...r, fromPrev: false });
  for (const [pk, r] of prevByKey) if (!erpByKey.has(pk)) erpByKey.set(pk, { ...r, fromPrev: true });
  const erpRows = [...erpByKey.values()];

  const mappings = loadMappings(true);
  const dbMaps = await loadRaumItemMaps(quoteItems.map(it => it.name)); // 사장님 확정 매핑 — 최우선
  const results = {};
  const extraKeys = new Set(); // 매핑은 됐지만 이번 차수 분배에 없는 품목 → Product.Cost 별도 조회

  for (const { name, price } of quoteItems) {
    let prodKey = null;
    let matchType = null;
    const dbMapped = dbMaps[costKey(name)];
    if (dbMapped != null) { prodKey = Number(dbMapped); matchType = '확정매핑'; }
    const direct = prodKey == null ? getMapping(name) : null;
    if (direct?.prodKey) { prodKey = Number(direct.prodKey); matchType = '매핑'; }
    if (!prodKey) {
      const fuzzy = findMappingFuzzy(name, mappings);
      if (fuzzy?.value?.prodKey) { prodKey = Number(fuzzy.value.prodKey); matchType = '매핑(유사)'; }
    }
    if (!prodKey) {
      // 이번 차수 라움 분배 품목 안에서 토큰 포함 매칭 (후보 1개일 때만 채택)
      const toks = tokensOf(name);
      if (toks.length > 0) {
        const cands = erpRows.filter(r => {
          const hay = `${r.ProdName} ${r.DisplayName} ${r.FlowerName}`.toLowerCase();
          return toks.every(t => hay.includes(t));
        });
        if (cands.length === 1) { prodKey = Number(cands[0].ProdKey); matchType = '분배품목'; }
      }
    }
    if (!prodKey && erpRows.length > 0) {
      // scoreMatch(한글→영문 별칭+자모 매칭) — 이번 차수 라움 분배 품목만 후보로, 최고점 60+ 이고
      // 2위와 10점 이상 차이날 때만 채택 (참고단가 용도라 보수적으로).
      // 추가 가드: 견적서는 전산 분배에서 생성되므로 분배단가=견적단가 — 단가가 3% 이상 다르면 오매칭으로 보고 버림.
      const scored = erpRows
        .map(r => ({ r, s: scoreMatch(name, r) }))
        .sort((a, b) => b.s - a.s);
      if (scored[0].s >= 60 && (scored.length < 2 || scored[0].s - scored[1].s >= 10)) {
        const cand = scored[0].r;
        const candSale = Number(cand.EstQty) > 0 ? Number(cand.Amt) / Number(cand.EstQty) : null;
        const priceOk = candSale == null || price == null || Math.abs(candSale - price) <= Math.max(1, price * 0.03);
        if (priceOk) {
          prodKey = Number(cand.ProdKey);
          matchType = `유사(${scored[0].s}점)`;
        }
      }
    }
    if (!prodKey) { results[name] = null; continue; }
    const inWeek = erpByKey.get(prodKey);
    if (!inWeek) extraKeys.add(prodKey);
    results[name] = { prodKey, matchType, row: inWeek || null };
  }

  if (extraKeys.size > 0) {
    const keys = [...extraKeys];
    const params = Object.fromEntries(keys.map((k, i) => [`k${i}`, { type: sql.Int, value: k }]));
    const r = await query(
      `SELECT ProdKey, ProdName, ISNULL(Cost, 0) AS Cost,
              EstUnit, OutUnit, SteamOf1Box, BunchOf1Box, SteamOf1Bunch
         FROM Product
        WHERE ProdKey IN (${keys.map((_, i) => `@k${i}`).join(',')})`,
      params
    );
    const byKey = new Map((r.recordset || []).map(x => [Number(x.ProdKey), x]));
    for (const name of Object.keys(results)) {
      const m = results[name];
      if (m && !m.row && byKey.has(m.prodKey)) {
        const p = byKey.get(m.prodKey);
        m.row = { ...p, EstQty: 0, Amt: 0 };
        m.outOfWeek = true;
      }
    }
  }

  const quoteByName = new Map(quoteItems.map(it => [it.name, it]));
  const out = Object.fromEntries(Object.entries(results).map(([name, m]) => {
    if (!m?.row) return [name, null];
    const cost = Number(m.row.Cost || 0);
    const estQty = Number(m.row.EstQty || 0);
    const amt = Number(m.row.Amt || 0);
    // 매입단가 기준 = 도착원가(가장 최근, 100원 단위 반올림) — 사장님 확정(2026-07-14).
    // 도착원가는 박스/송이 단위일 수 있어 카탈로그와 동일하게 판매단위(EstUnit)로 환산 후 반올림.
    // 환산 실패(단위 불일치)나 견적단가 대비 3배 초과는 오류로 보고 자동입력하지 않음.
    const arrival = arrivalMap[m.prodKey];
    let arrival100 = null;
    let arrivalNote = null;
    if (arrival && Number(arrival.arrivalCost || 0) > 0) {
      const disp = resolveCatalogArrivalDisplay(m.row, arrival);
      const price = Number(quoteByName.get(name)?.price || 0);
      const sane = disp.arrivalCost > 0 && !disp.unitMismatch && disp.matchedBy !== 'none'
        && (!(price > 0) || disp.arrivalCost <= price * 3);
      if (sane) {
        arrival100 = Math.round(disp.arrivalCost / 100) * 100;
        arrivalNote = `도착원가 ${arrival.arrivalWeek}${arrival.isFallback ? '(이전차수)' : ''} ${Math.round(disp.arrivalCost).toLocaleString()}원/${disp.arrivalUnit}→100원반올림`;
      } else {
        arrivalNote = `도착원가 단위환산 불가(${Math.round(arrival.arrivalCost).toLocaleString()}원/${disp.rawUnit}) — 직접 입력 필요`;
      }
    }
    return [name, {
      prodKey: m.prodKey,
      prodName: m.row.ProdName,
      matchType: m.matchType + (m.outOfWeek ? '·차수외' : ''),
      refPrice: arrival100 != null ? arrival100 : (cost > 0 ? Math.round((cost / 1.1) * 10) / 10 : null),
      refSource: arrival100 != null
        ? arrivalNote
        : (cost > 0 ? `전산원가÷1.1 (${m.matchType})${arrivalNote ? ` · ${arrivalNote}` : ''}` : arrivalNote),
      isArrival: arrival100 != null,
      erpSalePrice: estQty > 0 ? Math.round((amt / estQty) * 10) / 10 : null, // 분배단가(검증용)
      erpQty: estQty,
      erpFromPrev: !!m.row.fromPrev, // 창엔 없고 N-01(쌓아두는 품목)에서 찾음
    }];
  }));
  if (arrivalErr) out.__arrivalError = `도착원가 조회 실패: ${arrivalErr}`;
  return out;
}

// ── 저장/조회 (웹 전용 테이블) ─────────────────────────────

let _ensured = null;
export async function ensureRaumPnlTables() {
  if (_ensured) return _ensured;
  _ensured = query(
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebRaumPnl')
     BEGIN
       CREATE TABLE WebRaumPnl (
         PnlKey INT IDENTITY(1,1) PRIMARY KEY,
         OrderYear NVARCHAR(4) NOT NULL,
         MajorWeek NVARCHAR(4) NOT NULL,
         Title NVARCHAR(100) NULL,
         QuoteDate DATE NULL,
         NenovaPct FLOAT NOT NULL DEFAULT 80,
         Note NVARCHAR(2000) NULL,
         SourceFile NVARCHAR(200) NULL,
         CreatedBy NVARCHAR(50) NULL,
         CreatedAt DATETIME DEFAULT GETDATE(),
         UpdatedBy NVARCHAR(50) NULL,
         UpdatedAt DATETIME NULL,
         isDeleted BIT NOT NULL DEFAULT 0
       );
     END;
     IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebRaumPnlItem')
     BEGIN
       CREATE TABLE WebRaumPnlItem (
         ItemKey INT IDENTITY(1,1) PRIMARY KEY,
         PnlKey INT NOT NULL,
         Seq INT NULL,
         ItemName NVARCHAR(200) NOT NULL,
         Unit NVARCHAR(20) NULL,
         Qty FLOAT NOT NULL DEFAULT 0,
         BranchJson NVARCHAR(500) NULL,
         SalePrice FLOAT NULL,
         SaleAmount FLOAT NULL,
         CostPrice FLOAT NULL,
         RefPrice FLOAT NULL,
         RefSource NVARCHAR(60) NULL,
         ErpSalePrice FLOAT NULL,
         ProdKey INT NULL,
         Remark NVARCHAR(300) NULL
       );
       CREATE INDEX IX_WebRaumPnlItem_PnlKey ON WebRaumPnlItem(PnlKey);
     END;
     -- 2026-07-14 검증 리포트 저장 (기존 테이블에 컬럼 추가 — 웹 전용 테이블만 ALTER)
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnl') AND name = 'VerifyJson')
       ALTER TABLE WebRaumPnl ADD VerifyJson NVARCHAR(MAX) NULL;
     -- 2026-07-14 수동 행(손실 등) 구분
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnlItem') AND name = 'IsCustom')
       ALTER TABLE WebRaumPnlItem ADD IsCustom BIT NOT NULL DEFAULT 0;
     -- 2026-07-14 매입단가 출처 (manual=직접입력·학습대상 / arrival=도착원가 자동 / learned=학습값 자동)
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnlItem') AND name = 'CostSource')
       ALTER TABLE WebRaumPnlItem ADD CostSource NVARCHAR(10) NULL;
     -- 2026-07-14 사입(원산지 없음) — 매출 합산 포함, 손익 계산 제외
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnlItem') AND name = 'IsConsigned')
       ALTER TABLE WebRaumPnlItem ADD IsConsigned BIT NOT NULL DEFAULT 0;
     -- 2026-07-17 전산 분배 대조 — 해당 차수 라움 분배수량(EstQuantity 합) 스냅샷
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnlItem') AND name = 'ErpQty')
       ALTER TABLE WebRaumPnlItem ADD ErpQty FLOAT NULL;
     -- 2026-07-14 매입단가 학습 — 품목명(정규화)별 마지막 입력값, 다음 업로드 때 자동 채움
     IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebRaumCostPrice')
     BEGIN
       CREATE TABLE WebRaumCostPrice (
         ItemName NVARCHAR(200) PRIMARY KEY,
         CostPrice FLOAT NOT NULL,
         UpdatedBy NVARCHAR(50) NULL,
         UpdatedAt DATETIME DEFAULT GETDATE()
       );
     END;
     -- 2026-07-17 품목 매칭(사장님 확정) — 견적 품목명 → 전산 ProdKey. DB 저장이라 배포에도 유지.
     -- order-mappings.json 보다 우선 적용 (파일은 배포 시 git reset 으로 초기화되는 함정)
     IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebRaumItemMap')
     BEGIN
       CREATE TABLE WebRaumItemMap (
         ItemName NVARCHAR(200) PRIMARY KEY,
         ProdKey INT NOT NULL,
         ProdName NVARCHAR(200) NULL,
         UpdatedBy NVARCHAR(50) NULL,
         UpdatedAt DATETIME DEFAULT GETDATE()
       );
     END;
     -- 2026-07-17 수동 사입 지정 — 원산지가 있어도 사입(손익 제외)으로 취급할 품목명 (사장님 지정, 배포에도 유지)
     IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebRaumConsignedItem')
     BEGIN
       CREATE TABLE WebRaumConsignedItem (
         ItemName NVARCHAR(200) PRIMARY KEY,
         UpdatedBy NVARCHAR(50) NULL,
         UpdatedAt DATETIME DEFAULT GETDATE()
       );
     END`,
    {}
  );
  return _ensured;
}

const costKey = (name) => normSpace(name).toLowerCase();

// ── 품목 매칭 (사장님 확정 매핑 — DB, 최우선 적용) ─────────────
export async function loadRaumItemMaps(itemNames) {
  await ensureRaumPnlTables();
  const keys = [...new Set((itemNames || []).map(costKey).filter(Boolean))];
  if (!keys.length) return {};
  const params = Object.fromEntries(keys.map((k, i) => [`n${i}`, { type: sql.NVarChar, value: k }]));
  const r = await query(
    `SELECT ItemName, ProdKey FROM WebRaumItemMap WHERE ItemName IN (${keys.map((_, i) => `@n${i}`).join(',')})`,
    params
  );
  return Object.fromEntries((r.recordset || []).map(x => [x.ItemName, Number(x.ProdKey)]));
}

// ── 수동 사입 지정 — 지정된 품목명은 업로드 시 사입(매출 포함·손익 제외)으로 분류 ──
export async function loadRaumConsignedSet(itemNames) {
  await ensureRaumPnlTables();
  const keys = [...new Set((itemNames || []).map(costKey).filter(Boolean))];
  if (!keys.length) return new Set();
  const params = Object.fromEntries(keys.map((k, i) => [`n${i}`, { type: sql.NVarChar, value: k }]));
  const r = await query(
    `SELECT ItemName FROM WebRaumConsignedItem WHERE ItemName IN (${keys.map((_, i) => `@n${i}`).join(',')})`,
    params
  );
  return new Set((r.recordset || []).map(x => x.ItemName));
}

export async function saveRaumConsigned(itemName, consigned, actor) {
  await ensureRaumPnlTables();
  const key = costKey(itemName).slice(0, 200);
  if (!key) throw new Error('품목명이 비어있습니다.');
  if (!consigned) {
    await query(`DELETE FROM WebRaumConsignedItem WHERE ItemName=@n`, { n: { type: sql.NVarChar, value: key } });
    return { removed: true };
  }
  await query(
    `MERGE WebRaumConsignedItem AS t USING (SELECT @n AS ItemName) AS s ON t.ItemName=s.ItemName
     WHEN MATCHED THEN UPDATE SET UpdatedBy=@actor, UpdatedAt=GETDATE()
     WHEN NOT MATCHED THEN INSERT (ItemName, UpdatedBy) VALUES (@n, @actor);`,
    { n: { type: sql.NVarChar, value: key }, actor: { type: sql.NVarChar, value: actor || 'user' } }
  );
  return { consigned: true };
}

export async function saveRaumItemMap(itemName, prodKey, actor) {
  await ensureRaumPnlTables();
  const key = costKey(itemName).slice(0, 200);
  if (!key) throw new Error('품목명이 비어있습니다.');
  if (prodKey == null) {
    await query(`DELETE FROM WebRaumItemMap WHERE ItemName=@n`, { n: { type: sql.NVarChar, value: key } });
    return { removed: true };
  }
  const prod = await query(
    `SELECT ProdKey, ProdName FROM Product WHERE ProdKey=@pk AND isDeleted=0`,
    { pk: { type: sql.Int, value: Number(prodKey) } }
  );
  if (!prod.recordset[0]) throw new Error(`ProdKey=${prodKey} 품목을 찾을 수 없습니다.`);
  await query(
    `MERGE WebRaumItemMap AS t USING (SELECT @n AS ItemName) AS s ON t.ItemName=s.ItemName
     WHEN MATCHED THEN UPDATE SET ProdKey=@pk, ProdName=@pn, UpdatedBy=@actor, UpdatedAt=GETDATE()
     WHEN NOT MATCHED THEN INSERT (ItemName, ProdKey, ProdName, UpdatedBy) VALUES (@n, @pk, @pn, @actor);`,
    {
      n: { type: sql.NVarChar, value: key },
      pk: { type: sql.Int, value: Number(prodKey) },
      pn: { type: sql.NVarChar, value: String(prod.recordset[0].ProdName || '').slice(0, 200) },
      actor: { type: sql.NVarChar, value: actor || 'user' },
    }
  );
  return { prodKey: Number(prodKey), prodName: prod.recordset[0].ProdName };
}

/** 품목명별 학습된 매입단가 조회 — { 정규화품목명: 단가 } */
export async function loadLearnedCosts(itemNames) {
  await ensureRaumPnlTables();
  const keys = [...new Set((itemNames || []).map(costKey).filter(Boolean))];
  if (!keys.length) return {};
  const params = Object.fromEntries(keys.map((k, i) => [`n${i}`, { type: sql.NVarChar, value: k }]));
  const r = await query(
    `SELECT ItemName, CostPrice FROM WebRaumCostPrice WHERE ItemName IN (${keys.map((_, i) => `@n${i}`).join(',')})`,
    params
  );
  return Object.fromEntries((r.recordset || []).map(x => [x.ItemName, Number(x.CostPrice)]));
}

/** 차수(연도+대차수) 단위 upsert — 이미 있으면 마스터 갱신 + 품목 전체 교체 */
export async function saveRaumPnl({ orderYear, major, title, quoteDate, nenovaPct, note, sourceFile, items, verification, actor }) {
  await ensureRaumPnlTables();
  const mj = String(major).padStart(2, '0');
  return withTransaction(async (tQuery) => {
    const existing = await tQuery(
      `SELECT TOP 1 PnlKey FROM WebRaumPnl WHERE OrderYear=@yr AND MajorWeek=@mj AND isDeleted=0 ORDER BY PnlKey DESC`,
      { yr: { type: sql.NVarChar, value: String(orderYear) }, mj: { type: sql.NVarChar, value: mj } }
    );
    let pnlKey = existing.recordset[0]?.PnlKey || null;
    const common = {
      title: { type: sql.NVarChar, value: title || `라움 ${Number(mj)}차` },
      // 날짜는 정오로 고정(루트 CLAUDE.md — 자정 Date 는 시간대 변환으로 하루 밀림)
      qd: { type: sql.Date, value: quoteDate ? new Date(`${String(quoteDate).slice(0, 10)}T12:00:00`) : null },
      pct: { type: sql.Float, value: Number(nenovaPct) || DEFAULT_NENOVA_PCT },
      note: { type: sql.NVarChar, value: note || '' },
      src: { type: sql.NVarChar, value: sourceFile || '' },
      vj: { type: sql.NVarChar, value: verification ? JSON.stringify(verification) : null },
      actor: { type: sql.NVarChar, value: actor || 'user' },
    };
    if (pnlKey) {
      await tQuery(
        `UPDATE WebRaumPnl SET Title=@title, QuoteDate=@qd, NenovaPct=@pct, Note=@note, SourceFile=@src,
                VerifyJson=COALESCE(@vj, VerifyJson), UpdatedBy=@actor, UpdatedAt=GETDATE() WHERE PnlKey=@key`,
        { ...common, key: { type: sql.Int, value: pnlKey } }
      );
      await tQuery(`DELETE FROM WebRaumPnlItem WHERE PnlKey=@key`, { key: { type: sql.Int, value: pnlKey } });
    } else {
      const ins = await tQuery(
        `INSERT INTO WebRaumPnl (OrderYear, MajorWeek, Title, QuoteDate, NenovaPct, Note, SourceFile, VerifyJson, CreatedBy)
         OUTPUT INSERTED.PnlKey
         VALUES (@yr, @mj, @title, @qd, @pct, @note, @src, @vj, @actor)`,
        {
          ...common,
          yr: { type: sql.NVarChar, value: String(orderYear) },
          mj: { type: sql.NVarChar, value: mj },
        }
      );
      pnlKey = ins.recordset[0].PnlKey;
    }
    for (const it of items || []) {
      const cp = it.costPrice != null && it.costPrice !== '' ? Number(it.costPrice) : null;
      await tQuery(
        `INSERT INTO WebRaumPnlItem
           (PnlKey, Seq, ItemName, Unit, Qty, BranchJson, SalePrice, SaleAmount, CostPrice, RefPrice, RefSource, ErpSalePrice, ProdKey, Remark, IsCustom, CostSource, IsConsigned, ErpQty)
         VALUES (@key, @seq, @name, @unit, @qty, @bj, @sp, @sa, @cp, @rp, @rs, @esp, @pk, @rm, @ic, @cs, @icon, @eq)`,
        {
          key: { type: sql.Int, value: pnlKey },
          seq: { type: sql.Int, value: Number(it.seq) || 0 },
          name: { type: sql.NVarChar, value: String(it.name || '').slice(0, 200) },
          unit: { type: sql.NVarChar, value: String(it.unit || '').slice(0, 20) },
          qty: { type: sql.Float, value: Number(it.qty) || 0 },
          bj: { type: sql.NVarChar, value: JSON.stringify(it.byBranch || {}).slice(0, 500) },
          sp: { type: sql.Float, value: it.price != null ? Number(it.price) : null },
          sa: { type: sql.Float, value: it.supply != null ? Number(it.supply) : null },
          cp: { type: sql.Float, value: cp },
          rp: { type: sql.Float, value: it.refPrice != null ? Number(it.refPrice) : null },
          rs: { type: sql.NVarChar, value: it.refSource || (it.refPrice != null ? '전산원가÷1.1' : null) },
          esp: { type: sql.Float, value: it.erpSalePrice != null ? Number(it.erpSalePrice) : null },
          pk: { type: sql.Int, value: it.prodKey != null ? Number(it.prodKey) : null },
          rm: { type: sql.NVarChar, value: String(it.remark || '').slice(0, 300) },
          ic: { type: sql.Bit, value: it.isCustom ? 1 : 0 },
          cs: { type: sql.NVarChar, value: it.costSource || null },
          icon: { type: sql.Bit, value: it.consigned ? 1 : 0 },
          eq: { type: sql.Float, value: it.erpQty != null ? Number(it.erpQty) : null },
        }
      );
      // 매입단가 학습 — 사용자가 직접 타이핑한 값만 (도착원가/학습 자동채움값은 재학습 안 함 —
      // 안 그러면 낡은 도착원가가 학습으로 굳어 다음 차수의 새 도착원가를 가려버림). 수동 행·사입 제외.
      if (cp != null && !it.isCustom && !it.consigned && it.costSource === 'manual' && costKey(it.name)) {
        await tQuery(
          `MERGE WebRaumCostPrice AS t USING (SELECT @n AS ItemName) AS s ON t.ItemName=s.ItemName
           WHEN MATCHED THEN UPDATE SET CostPrice=@c, UpdatedBy=@actor, UpdatedAt=GETDATE()
           WHEN NOT MATCHED THEN INSERT (ItemName, CostPrice, UpdatedBy) VALUES (@n, @c, @actor);`,
          {
            n: { type: sql.NVarChar, value: costKey(it.name).slice(0, 200) },
            c: { type: sql.Float, value: cp },
            actor: { type: sql.NVarChar, value: actor || 'user' },
          }
        );
      }
    }
    return pnlKey;
  });
}

export async function loadRaumPnlList() {
  await ensureRaumPnlTables();
  const r = await query(
    `SELECT m.PnlKey, m.OrderYear, m.MajorWeek, m.Title, m.QuoteDate, m.NenovaPct, m.Note, m.SourceFile,
            m.CreatedBy, m.CreatedAt, m.UpdatedBy, m.UpdatedAt,
            COUNT(i.ItemKey) AS ItemCount,
            SUM(ISNULL(i.SaleAmount, 0)) AS SaleTotal,
            SUM(CASE WHEN ISNULL(i.IsConsigned,0)=1 THEN ISNULL(i.SaleAmount,0) ELSE 0 END) AS ConsignedSale,
            SUM(CASE WHEN ISNULL(i.IsConsigned,0)=0 AND i.CostPrice IS NOT NULL THEN i.CostPrice * i.Qty ELSE 0 END) AS CostTotal,
            SUM(CASE WHEN ISNULL(i.IsConsigned,0)=0 AND i.CostPrice IS NULL THEN 1 ELSE 0 END) AS MissingCost
       FROM WebRaumPnl m
       LEFT JOIN WebRaumPnlItem i ON i.PnlKey = m.PnlKey
      WHERE m.isDeleted = 0
      GROUP BY m.PnlKey, m.OrderYear, m.MajorWeek, m.Title, m.QuoteDate, m.NenovaPct, m.Note, m.SourceFile,
               m.CreatedBy, m.CreatedAt, m.UpdatedBy, m.UpdatedAt
      ORDER BY m.OrderYear DESC, m.MajorWeek DESC`,
    {}
  );
  return r.recordset || [];
}

export async function loadRaumPnlDetail(pnlKey) {
  await ensureRaumPnlTables();
  const [m, i] = await Promise.all([
    query(`SELECT * FROM WebRaumPnl WHERE PnlKey=@key AND isDeleted=0`, { key: { type: sql.Int, value: Number(pnlKey) } }),
    query(`SELECT * FROM WebRaumPnlItem WHERE PnlKey=@key ORDER BY Seq, ItemKey`, { key: { type: sql.Int, value: Number(pnlKey) } }),
  ]);
  const master = m.recordset[0];
  if (!master) return null;
  let verification = null;
  try { verification = master.VerifyJson ? JSON.parse(master.VerifyJson) : null; } catch { /* 구버전 저장본 */ }
  return {
    master,
    verification,
    items: (i.recordset || []).map(row => ({
      itemKey: row.ItemKey,
      seq: row.Seq,
      name: row.ItemName,
      unit: row.Unit || '',
      qty: Number(row.Qty || 0),
      byBranch: (() => { try { return JSON.parse(row.BranchJson || '{}'); } catch { return {}; } })(),
      price: row.SalePrice != null ? Number(row.SalePrice) : null,
      supply: row.SaleAmount != null ? Number(row.SaleAmount) : null,
      costPrice: row.CostPrice != null ? Number(row.CostPrice) : null,
      refPrice: row.RefPrice != null ? Number(row.RefPrice) : null,
      refSource: row.RefSource || null,
      erpSalePrice: row.ErpSalePrice != null ? Number(row.ErpSalePrice) : null,
      prodKey: row.ProdKey != null ? Number(row.ProdKey) : null,
      remark: row.Remark || '',
      isCustom: !!row.IsCustom,
      costSource: row.CostSource || null,
      isArrival: /도착원가/.test(row.RefSource || ''),
      consigned: !!row.IsConsigned,
      erpQty: row.ErpQty != null ? Number(row.ErpQty) : null,
    })),
  };
}

export async function deleteRaumPnl(pnlKey, actor) {
  await ensureRaumPnlTables();
  await query(
    `UPDATE WebRaumPnl SET isDeleted=1, UpdatedBy=@actor, UpdatedAt=GETDATE() WHERE PnlKey=@key`,
    { key: { type: sql.Int, value: Number(pnlKey) }, actor: { type: sql.NVarChar, value: actor || 'user' } }
  );
}
