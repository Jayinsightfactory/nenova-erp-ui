// lib/raumPnlParse.js — 라움/초이문 견적서 파싱 (DB 없음)
import {
  acceptQuoteSheet, emptyWorkbookWarning, resolvePnlPartner, sheetRejectWarning,
} from './raumPnlPartner.js';

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

function detectHeaderVatTotal(aoa, headerRow) {
  const limit = headerRow == null ? Math.min(aoa.length, 14) : headerRow;
  for (let r = 0; r < limit; r += 1) {
    for (const cell of aoa[r] || []) {
      const t = String(cell ?? '');
      const m = t.match(/[￦₩]\s*([\d,]+)\s*원/);
      if (m) {
        const n = Number(m[1].replace(/,/g, ''));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return null;
}

function detectBranch(sheetName, aoa) {
  const name = String(sheetName || '');
  const withBranch = name.match(/(\d{1,2})\s*차\s*([가-힣A-Za-z]+?)(?:양식)?$/);
  const majorOnly = name.match(/(\d{1,2})\s*차(?:양식)?$/);
  let major = withBranch ? withBranch[1].padStart(2, '0') : (majorOnly ? majorOnly[1].padStart(2, '0') : null);
  let branch = withBranch ? withBranch[2] : null;
  let partnerHint = null;
  for (let r = 0; r < Math.min(aoa.length, 14); r += 1) {
    for (const cell of aoa[r] || []) {
      const t = normSpace(cell);
      if (!t) continue;
      const bm = t.match(/(강남|건대)\s*라움/);
      if (bm) {
        branch = branch || bm[1];
        partnerHint = 'raum';
      }
      if (/초이문/.test(t)) {
        partnerHint = partnerHint || 'choimun';
        if (!branch) branch = '초이문';
      }
    }
  }
  if (branch === '강남' || branch === '건대') partnerHint = partnerHint || 'raum';
  if (branch === '초이문') partnerHint = partnerHint || 'choimun';
  return { major, branch: branch || sheetName, partnerHint };
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
  const { major, branch, partnerHint } = detectBranch(sheetName, aoa);
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
      // 원산지 빈 행 = 업체 사입분 (2026-07-14 사장님 확정) — 매출에는 포함하고,
      // 매입단가 입력 시 매입·이익에도 포함한다. 미입력 상태는 검증 대상으로 남긴다.
      consigned: header.origin >= 0 && !normSpace(row[header.origin]),
      remark: header.remark >= 0 ? normSpace(row[header.remark]) : '',
    });
  }
  if (summaryTotal == null) summaryTotal = detectHeaderVatTotal(aoa, header.row);
  return { sheetName, major, branch, partnerHint, quoteDate: detectQuoteDate(aoa), items, summarySupply, summaryVat, summaryTotal };
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

  // 레거시 단일차수 화면용 파서는 누적 워크북에서 가장 큰 차수 하나를 표시한다.
  // 안 그러면 지난 차수와 중첩 합산돼 수량이 부풀고 검증이 깨진다 (2026-07-17 사장님 리포트).
  const majors = [...new Set(sheets.map(s => s.major).filter(Boolean))];
  if (majors.length > 1) {
    const latest = String(Math.max(...majors.map(Number))).padStart(2, '0');
    const dropped = sheets.filter(s => s.major && s.major !== latest);
    sheets = sheets.filter(s => !s.major || s.major === latest);
    warnings.push(
      `워크북에 여러 차수 시트가 있어(${majors.map(Number).sort((a, b) => a - b).join('·')}차) ${Number(latest)}차를 단일 화면에 표시합니다. ` +
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

/**
 * 한 견적서에 누적된 모든 차수를 독립 결산 단위로 분리한다.
 *
 * 기존 parseRaumQuoteWorkbook 는 단일 차수 화면과의 호환을 위해 최신 차수만 반환한다.
 * 일괄 업로드는 이 함수를 사용해야 하며, 차수를 넘어서 품목을 합산하면 안 된다.
 */
export function parseRaumQuoteWorkbookGroups(XLSX, workbook, options = {}) {
  const partner = resolvePnlPartner(options.partnerCode);
  const warnings = [];
  const byMajor = new Map();

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const parsed = parseSheet(sheetName, aoa);
    if (!parsed || !parsed.items.length) continue;
    const accepted = acceptQuoteSheet(parsed, partner);
    if (!accepted.ok) {
      warnings.push(sheetRejectWarning(sheetName, accepted.reason));
      continue;
    }
    const major = String(parsed.major).padStart(2, '0');
    const branch = partner.defaultBranch || parsed.branch;
    if (!byMajor.has(major)) byMajor.set(major, []);
    byMajor.get(major).push({
      ...parsed, major, branch,
      parsedSupply: parsed.items.reduce((a, it) => a + it.supply, 0),
    });
  }

  const batches = [...byMajor.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([major, sheets]) => {
      const map = new Map();
      const order = [];
      for (const sh of sheets) {
        for (const it of sh.items) {
          // 사입 여부가 다른 행은 서로 다른 손익 정책이므로 합치지 않는다.
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
          seq: i + 1, name: acc.name, unit: acc.unit, qty: acc.qty, price: acc.price,
          supply: acc.supply, byBranch: acc.byBranch, consigned: acc.consigned,
          remark: [...acc.remarks].join(', '),
        };
      });
      const verification = buildVerification(sheets, items);
      const branchCounts = new Map();
      for (const sh of sheets) branchCounts.set(sh.branch, (branchCounts.get(sh.branch) || 0) + 1);
      for (const sh of sheets) if (sh.summaryTotal == null) verification.push({
        group: sh.branch, label: '합계(VAT포함) 요약셀', sheetVal: null, parsedVal: sh.parsedSupply,
        diff: null, ok: false, info: '원본 시트의 합계 요약셀이 없어 저장할 수 없습니다.',
      });
      for (const [branch, count] of branchCounts) if (count > 1) verification.push({
        group: branch, label: '동일 차수·지점 시트', sheetVal: count, parsedVal: count,
        diff: 0, ok: false, info: `${Number(major)}차 ${branch} 시트가 ${count}개라 중복 합산 위험이 있습니다.`,
      });
      const batchWarnings = verification.filter(c => !c.ok).map(c =>
        `검증 실패 — [${c.group}] ${c.label}: 견적서 ${c.sheetVal.toLocaleString()} vs 파싱 ${c.parsedVal.toLocaleString()} (차이 ${c.diff.toLocaleString()})`
      );
      return {
        major, sheets, items, partnerCode: partner.code,
        quoteDate: sheets.map(s => s.quoteDate).filter(Boolean).sort((a, b) => b - a)[0] || null,
        verification,
        warnings: batchWarnings,
      };
    });

  if (!batches.length) warnings.push(emptyWorkbookWarning(partner));
  return { batches, warnings, partnerCode: partner.code };
}

