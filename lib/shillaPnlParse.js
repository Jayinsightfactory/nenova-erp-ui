// lib/shillaPnlParse.js — 신라호텔 차수별 결산 워크북 파서 (순수 함수, DB/네트워크 없음)
//
// 원본: docs/work-reports/2026-09-07_shilla-pnl-design.md
// - 시트당 1개 차수. 헤더는 행 위치가 아니라 텍스트로 찾는다 (열 위치는 시트마다 다름).
// - 첫 '합계' 행까지만 품목으로 인정하고, 그 아래 전산 참고내역은 읽지 않는다.
// - 매입액=수량×매입단가, 매출액=수량×매출단가, 이익=매출액-매입액을 원본 캐시 값과 대조한다.
// - 0은 값이고 null/수식 오류(둘 다 시트 읽기에서 null로 들어옴)는 누락이다.
// - 이름 칸이 비면 추측하지 않고 칼라 칸 값을 그대로 보이는 자리표시자로 쓰거나,
//   그마저 없으면 고정 자리표시자를 쓰고 항상 검증 실패로 표시한다.
// - 단위 문자열(예: 단-5스팀, 8스팀)은 원문 그대로 보존하고 절대 환산/추정하지 않는다.
// - 배분 비율은 헤더 문구("네노바이익\r\n(80%)")에서만 읽는다. 그 열의 데이터 값은 비율이 아니라
//   비율만큼의 이익 분배 금액이며, 기본값(예: 80)을 일괄 주입하지 않는다.

const normSpace = (s) => String(s ?? '').replace(/[\s ]+/g, ' ').trim();
const normHeader = (s) => normSpace(s).replace(/\s+\(/g, '(');

const LINE_TOL = 1; // 원단위 반올림 허용
const TOTAL_TOL = 5;

function requireOrderYear(orderYear) {
  const n = Number(orderYear);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new Error('parseShillaPnlWorkbookGroups: orderYear는 2000~2100 범위의 정수로 명시해야 합니다.');
  }
  return n;
}

/** null/undefined/빈문자열/수식오류(시트 읽기 단계에서 이미 null로 들어옴)는 누락. 0은 값. */
function numOrMissing(v) {
  if (v === null || v === undefined || v === '') return { missing: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n)) return { missing: true, value: null };
  return { missing: false, value: n };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── 시트명 분류 — 단일 차수만 인정, 범위/결산/검토 시트는 제외 ──────────────
function classifySheetName(sheetName) {
  const name = normSpace(sheetName);
  if (!name) return { skip: true, reason: 'empty-name' };
  if (/~/.test(name)) return { skip: true, reason: 'range' };
  if (/결산|검토리포트/.test(name)) return { skip: true, reason: 'summary-sheet' };
  const m = name.match(/^(\d{1,2})\s*차/);
  if (!m) return { skip: true, reason: 'no-major' };
  const rest = name.slice(m[0].length);
  if (/\d{1,2}\s*차/.test(rest)) return { skip: true, reason: 'range' };
  const major = m[1].padStart(2, '0');
  return { skip: false, major, titleSuffix: rest.trim() };
}

// 제목의 M.D (예: "23차 9.10") 를 지정 연도 기준 날짜로. 자정/ISOString 은 시간대에 따라
// 하루 밀릴 수 있어 정오로 고정한다 (루트 CLAUDE.md 규칙 3).
function detectSheetDateFromTitle(sheetName, orderYear) {
  const m = String(sheetName || '').match(/(\d{1,2})\.(\d{1,2})(?!\d)/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  return new Date(orderYear, month - 1, day, 12, 0, 0);
}

// 품명에 줄바꿈으로 붙은 포장 단위는 별도 열이 아니라 원문 품명의 일부다.
// 단위값을 환산하지 않고, 표시용 품명과 원문 단위를 분리해 보존한다.
function splitEmbeddedPackUnit(nameText) {
  const text = normSpace(nameText);
  const match = text.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (!match) return { name: text, unit: '' };
  const unit = normSpace(match[2]);
  // '(단)', '(단-5스팀)', '(8스팀)' 등 실제 원본 포장 단위만 분리한다.
  // 일반 품명 괄호는 원문 품명으로 남긴다.
  if (!/(?:단|스팀|송이|박스|\bEA\b|\bPK\b)/i.test(unit)) return { name: text, unit: '' };
  return { name: normSpace(match[1]), unit };
}

function sourceTitleAndErpNote(aoa, orderYear) {
  const titleRow = aoa[0] || [];
  const sourceTitle = normSpace(titleRow.find(cell => normSpace(cell)));
  const erpNotes = [...new Set(titleRow
    .map(normSpace)
    .filter(text => /전산/.test(text)))];
  return {
    sourceTitle: sourceTitle || null,
    sourceDate: detectSheetDateFromTitle(sourceTitle, orderYear),
    erpWeekNote: erpNotes.length ? erpNotes.join(' / ') : null,
  };
}

// ── 헤더 탐색 — 텍스트 매칭, 고정 열/고정 행 가정 금지 ──────────────────────
function findHeader(aoa) {
  for (let r = 0; r < Math.min(aoa.length, 12); r += 1) {
    const row = aoa[r] || [];
    const cells = row.map(normHeader);
    const nameIdx = cells.findIndex((c) => c === '품명' || c === '품목명');
    const qtyIdx = cells.findIndex((c) => c === '입고수량' || c === '수량');
    const buyPriceIdx = cells.findIndex((c) => c === '매입단가');
    const sellPriceIdx = cells.findIndex((c) => c === '매출단가');
    if (nameIdx >= 0 && qtyIdx >= 0 && buyPriceIdx >= 0 && sellPriceIdx >= 0) {
      // 배분 비율은 별도 % 열이 아니라 헤더 문구 안에 박혀 있다: "네노바이익\r\n(80%)".
      // 열 값 자체는 비율이 아니라 그 비율만큼의 이익 분배 금액이다.
      const nenovaIdx = cells.findIndex((c) => /^네노바이익\(\d{1,3}\s*%\)/.test(c));
      const miuIdx = cells.findIndex((c) => /^미우이익\(\d{1,3}\s*%\)/.test(c));
      const nenovaPctMatch = nenovaIdx >= 0 ? cells[nenovaIdx].match(/\((\d{1,3})\s*%\)/) : null;
      const miuPctMatch = miuIdx >= 0 ? cells[miuIdx].match(/\((\d{1,3})\s*%\)/) : null;
      return {
        row: r,
        name: nameIdx,
        qty: qtyIdx,
        buyPrice: buyPriceIdx,
        sellPrice: sellPriceIdx,
        color: cells.findIndex((c) => c === '칼라' || c === '색상'),
        unit: cells.findIndex((c) => c === '단위'),
        buyAmount: cells.findIndex((c) => c === '매입액'),
        sellAmount: cells.findIndex((c) => c === '매출액'),
        profit: cells.findIndex((c) => c === '이익'),
        nenovaAmount: nenovaIdx,
        miuAmount: miuIdx,
        nenovaPctFromHeader: nenovaPctMatch ? Number(nenovaPctMatch[1]) : null,
        miuPctFromHeader: miuPctMatch ? Number(miuPctMatch[1]) : null,
      };
    }
  }
  return null;
}

function isTotalRow(row, header) {
  const candidates = [header.name, header.color, 0, 1].filter((i) => i != null && i >= 0);
  return candidates.some((idx) => normSpace(row[idx]) === '합계');
}

// ── 한 시트 파싱 ────────────────────────────────────────────────────────────
function parseSheet(sheetName, aoa, meta, orderYear) {
  const header = findHeader(aoa);
  if (!header) return null;
  const { major, titleSuffix } = meta;
  const sourceMeta = sourceTitleAndErpNote(aoa, orderYear);
  const sheetDate = sourceMeta.sourceDate || detectSheetDateFromTitle(sheetName, orderYear);

  const items = [];
  let totalRow = null;
  let totalRowIndex = null;

  for (let r = header.row + 1; r < aoa.length; r += 1) {
    const row = aoa[r] || [];
    if (row.every((c) => normSpace(c) === '')) continue; // 완전 공백행은 건너뜀

    if (isTotalRow(row, header)) {
      totalRow = row;
      totalRowIndex = r;
      break; // 첫 합계 행까지만 품목 — 그 아래 전산 참고내역은 읽지 않는다
    }

    const nameText = normSpace(header.name >= 0 ? row[header.name] : null);
    const embedded = splitEmbeddedPackUnit(nameText);
    const colorText = normSpace(header.color >= 0 ? row[header.color] : null);
    const qty = numOrMissing(header.qty >= 0 ? row[header.qty] : null);
    const buyPrice = numOrMissing(header.buyPrice >= 0 ? row[header.buyPrice] : null);
    const sellPrice = numOrMissing(header.sellPrice >= 0 ? row[header.sellPrice] : null);
    const buyAmountCached = numOrMissing(header.buyAmount >= 0 ? row[header.buyAmount] : null);
    const sellAmountCached = numOrMissing(header.sellAmount >= 0 ? row[header.sellAmount] : null);
    const profitCached = numOrMissing(header.profit >= 0 ? row[header.profit] : null);
    const nenovaAmountCached = numOrMissing(header.nenovaAmount >= 0 ? row[header.nenovaAmount] : null);
    const miuAmountCached = numOrMissing(header.miuAmount >= 0 ? row[header.miuAmount] : null);

    // 이름/수량/단가/칼라가 전부 비어 있는 행은 순수 여백행으로 보고 건너뜀.
    if (!nameText && !colorText && qty.missing && buyPrice.missing && sellPrice.missing) continue;

    const issues = [];
    let name = embedded.name;
    let nameSource = 'name';
    if (!nameText) {
      if (colorText) {
        name = colorText;
        nameSource = 'color-fallback';
        issues.push('품명 칸이 비어 있어 칼라 칸 값을 이름으로 표시했습니다. 원본 확인 필요.');
      } else {
        name = '(품목명 미기재 — 원본 확인 필요)';
        nameSource = 'missing';
        issues.push('품명·칼라 칸이 모두 비어 있습니다. 원본 확인 필요.');
      }
    }

    if (qty.missing) issues.push('입고수량 누락(원본 확인 필요)');
    if (buyPrice.missing) issues.push('매입단가 누락(원본 확인 필요)');
    if (sellPrice.missing) issues.push('매출단가 누락(원본 확인 필요)');

    const expectedBuyAmount = (!qty.missing && !buyPrice.missing) ? round2(qty.value * buyPrice.value) : null;
    const expectedSellAmount = (!qty.missing && !sellPrice.missing) ? round2(qty.value * sellPrice.value) : null;

    let buyAmount = buyAmountCached.value;
    if (buyAmountCached.missing) {
      buyAmount = expectedBuyAmount;
      if (expectedBuyAmount != null) issues.push('매입액 원본 값 누락 — 수량×매입단가로 표시했습니다. 원본 확인 필요.');
    } else if (expectedBuyAmount != null && Math.abs(buyAmountCached.value - expectedBuyAmount) > LINE_TOL) {
      issues.push(`매입액 불일치: 원본 ${buyAmountCached.value.toLocaleString()} vs 수량×매입단가 ${expectedBuyAmount.toLocaleString()}`);
    }

    let sellAmount = sellAmountCached.value;
    if (sellAmountCached.missing) {
      sellAmount = expectedSellAmount;
      if (expectedSellAmount != null) issues.push('매출액 원본 값 누락 — 수량×매출단가로 표시했습니다. 원본 확인 필요.');
    } else if (expectedSellAmount != null && Math.abs(sellAmountCached.value - expectedSellAmount) > LINE_TOL) {
      issues.push(`매출액 불일치: 원본 ${sellAmountCached.value.toLocaleString()} vs 수량×매출단가 ${expectedSellAmount.toLocaleString()}`);
    }

    const expectedProfit = (buyAmount != null && sellAmount != null) ? round2(sellAmount - buyAmount) : null;
    let profit = profitCached.value;
    if (profitCached.missing) {
      profit = expectedProfit;
      if (expectedProfit != null) issues.push('이익 원본 값 누락 — 매출액-매입액으로 표시했습니다. 원본 확인 필요.');
    } else if (expectedProfit != null && Math.abs(profitCached.value - expectedProfit) > LINE_TOL) {
      issues.push(`이익 불일치: 원본 ${profitCached.value.toLocaleString()} vs 매출액-매입액 ${expectedProfit.toLocaleString()}`);
    }

    // 배분 금액 열(있는 경우)은 헤더에 박힌 비율(예: 80%)만큼의 이익 분배액이어야 한다.
    // 비율은 헤더 문구에서만 읽고, 데이터 열 값으로 비율을 역산/추정하지 않는다.
    const nenovaAmount = nenovaAmountCached.missing ? null : nenovaAmountCached.value;
    const miuAmount = miuAmountCached.missing ? null : miuAmountCached.value;
    if (header.nenovaPctFromHeader != null && profit != null && !nenovaAmountCached.missing) {
      const expectedNenovaAmount = round2(profit * (header.nenovaPctFromHeader / 100));
      if (Math.abs(nenovaAmountCached.value - expectedNenovaAmount) > LINE_TOL) {
        issues.push(`네노바이익 배분액 불일치: 원본 ${nenovaAmountCached.value.toLocaleString()} vs 이익×${header.nenovaPctFromHeader}% ${expectedNenovaAmount.toLocaleString()}`);
      }
    }
    if (header.miuPctFromHeader != null && profit != null && !miuAmountCached.missing) {
      const expectedMiuAmount = round2(profit * (header.miuPctFromHeader / 100));
      if (Math.abs(miuAmountCached.value - expectedMiuAmount) > LINE_TOL) {
        issues.push(`미우이익 배분액 불일치: 원본 ${miuAmountCached.value.toLocaleString()} vs 이익×${header.miuPctFromHeader}% ${expectedMiuAmount.toLocaleString()}`);
      }
    }

    const excelRow = r + 1;
    items.push({
      seq: items.length + 1,
      name,
      nameSource,
      sourceName: nameText,
      unit: (header.unit >= 0 ? normSpace(row[header.unit]) : '') || embedded.unit,
      color: colorText,
      qty: qty.missing ? 0 : qty.value,
      buyPrice: buyPrice.missing ? null : buyPrice.value,
      sellPrice: sellPrice.missing ? null : sellPrice.value,
      buyAmount,
      sellAmount,
      profit,
      nenovaAmount,
      miuAmount,
      ok: issues.length === 0,
      issues,
      remark: `${sheetName} ${excelRow}행`,
      source: { sheetName, row: excelRow },
    });
  }

  const nenovaPct = header.nenovaPctFromHeader ?? null;
  const miuPct = header.miuPctFromHeader ?? null;

  const verification = [];
  if (!totalRow) {
    verification.push({
      group: sheetName,
      label: '합계 행',
      sheetVal: null,
      parsedVal: items.length,
      diff: null,
      ok: false,
      info: '원본 시트에서 합계 행을 찾지 못해 저장할 수 없습니다.',
    });
  } else {
    const parsedQty = round2(items.reduce((a, it) => a + it.qty, 0));
    const parsedBuyAmount = round2(items.reduce((a, it) => a + (it.buyAmount ?? 0), 0));
    const parsedSellAmount = round2(items.reduce((a, it) => a + (it.sellAmount ?? 0), 0));
    const parsedProfit = round2(items.reduce((a, it) => a + (it.profit ?? 0), 0));

    const push = (label, colIdx, parsedVal, tol) => {
      if (colIdx == null || colIdx < 0) return;
      const cached = numOrMissing(totalRow[colIdx]);
      if (cached.missing) {
        verification.push({
          group: sheetName, label, sheetVal: null, parsedVal, diff: null, ok: false,
          info: `합계 행의 ${label} 원본 값이 비어 있어(수식 오류 포함) 대조할 수 없습니다.`,
        });
        return;
      }
      const diff = round2(parsedVal - cached.value);
      verification.push({
        group: sheetName, label, sheetVal: cached.value, parsedVal, diff, ok: Math.abs(diff) <= tol,
      });
    };
    // 서로 다른 단위(단/스팀/묶음)가 섞인 신라 원본은 수량 합계가 의미 있는
    // 공통 기준이 아니다. 원본 합계 셀을 실제로 제공한 경우에만 대조한다.
    if (!numOrMissing(totalRow[header.qty]).missing) push('입고수량 합계', header.qty, parsedQty, 0.01);
    push('매입액 합계', header.buyAmount, parsedBuyAmount, TOTAL_TOL);
    push('매출액 합계', header.sellAmount, parsedSellAmount, TOTAL_TOL);
    push('이익 합계', header.profit, parsedProfit, TOTAL_TOL);
    // 배분율은 행별 값뿐 아니라 합계행도 같은 헤더 비율로 대조한다. 다만 합계
    // 셀이 실제로 없는 양식에는 값을 만들어 내거나 실패를 추가하지 않는다.
    const parsedNenovaAmount = round2(items.reduce((a, it) => a + (it.nenovaAmount ?? 0), 0));
    const parsedMiuAmount = round2(items.reduce((a, it) => a + (it.miuAmount ?? 0), 0));
    if (header.nenovaAmount >= 0 && !numOrMissing(totalRow[header.nenovaAmount]).missing) {
      push('네노바이익 합계', header.nenovaAmount, parsedNenovaAmount, TOTAL_TOL);
    }
    if (header.miuAmount >= 0 && !numOrMissing(totalRow[header.miuAmount]).missing) {
      push('미우이익 합계', header.miuAmount, parsedMiuAmount, TOTAL_TOL);
    }
  }

  for (const it of items) {
    if (!it.ok) {
      verification.push({
        group: sheetName,
        label: `행 확인 필요 (${it.remark})`,
        sheetVal: null,
        parsedVal: null,
        diff: null,
        ok: false,
        info: `${it.name}: ${it.issues.join(' / ')}`,
      });
    }
  }

  if (nenovaPct != null && miuPct != null && Math.abs(nenovaPct + miuPct - 100) > 0.01) {
    verification.push({
      group: sheetName,
      label: '배분 비율 합계 불일치',
      sheetVal: 100,
      parsedVal: nenovaPct + miuPct,
      diff: round2(nenovaPct + miuPct - 100),
      ok: false,
      info: `헤더의 네노바이익(${nenovaPct}%)+미우이익(${miuPct}%)이 100%가 아닙니다.`,
    });
  }
  if (nenovaPct == null || miuPct == null) {
    verification.push({
      group: sheetName,
      label: '배분 비율 헤더 누락',
      sheetVal: null,
      parsedVal: null,
      diff: null,
      ok: false,
      info: '네노바이익·미우이익 비율이 모두 적힌 원본 헤더가 없어 저장할 수 없습니다. 기본 비율을 추정하지 않습니다.',
    });
  }

  return {
    sheetName,
    major,
    titleSuffix,
    sourceTitle: sourceMeta.sourceTitle,
    erpWeekNote: sourceMeta.erpWeekNote,
    sheetDate,
    hasHeader: true,
    hasTotalRow: !!totalRow,
    totalRowIndex,
    items,
    nenovaPct,
    miuPct,
    verification,
  };
}

function warningText(check) {
  const sv = check.sheetVal == null ? '없음' : Number(check.sheetVal).toLocaleString();
  const pv = check.parsedVal == null ? '없음' : Number(check.parsedVal).toLocaleString();
  const diffText = check.diff == null ? '' : ` (차이 ${Number(check.diff).toLocaleString()})`;
  const infoText = check.info ? ` — ${check.info}` : '';
  return `검증 실패 — [${check.group}] ${check.label}: 원본 ${sv} vs 파싱 ${pv}${diffText}${infoText}`;
}

// ── 차수(major) 별 배치 구성 ─────────────────────────────────────────────
function buildBatch(major, sheets) {
  const items = [];
  for (const sh of sheets) {
    for (const it of sh.items) items.push({ ...it, seq: items.length + 1 });
  }

  const verification = [];
  for (const sh of sheets) verification.push(...sh.verification);

  if (sheets.length > 1) {
    verification.push({
      group: `${Number(major)}차`,
      label: '동일 차수 시트 중복',
      sheetVal: sheets.length,
      parsedVal: sheets.length,
      diff: 0,
      ok: false,
      info: `${Number(major)}차 시트가 ${sheets.length}개 있어 중복 집계 위험이 있습니다: ${sheets.map((s) => s.sheetName).join(', ')}`,
    });
  }

  const nenovaPctValues = [...new Set(sheets.map((s) => s.nenovaPct).filter((v) => v != null))];
  const miuPctValues = [...new Set(sheets.map((s) => s.miuPct).filter((v) => v != null))];
  const sourceTitles = [...new Set(sheets.map((s) => s.sourceTitle).filter(Boolean))];
  const erpWeekNotes = [...new Set(sheets.map((s) => s.erpWeekNote).filter(Boolean))];

  const warnings = verification.filter((c) => !c.ok).map(warningText);

  return {
    major,
    sheets,
    items,
    partnerCode: 'shilla',
    sourceTitle: sourceTitles.join(' / ') || null,
    erpWeekNote: erpWeekNotes.join(' / ') || null,
    quoteDate: sheets.map((s) => s.sheetDate).filter(Boolean).sort((a, b) => b - a)[0] || null,
    nenovaPct: nenovaPctValues.length === 1 ? nenovaPctValues[0] : null,
    miuPct: miuPctValues.length === 1 ? miuPctValues[0] : null,
    verification,
    warnings,
  };
}

/**
 * 신라호텔 차수별 결산 워크북을 차수(major) 단위 독립 배치로 파싱한다.
 * DB/ERP 조회·쓰기 없음. 순수 함수 — 동일 입력에는 항상 동일 출력.
 *
 * @param {object} XLSX - 'xlsx' 패키지 모듈 (호출자가 주입)
 * @param {object} workbook - XLSX.read/readFile 결과 워크북
 * @param {{ orderYear: number }} options - orderYear 는 2000~2100 범위의 정수로 명시 필수
 */
export function parseShillaPnlWorkbookGroups(XLSX, workbook, options = {}) {
  const orderYear = requireOrderYear(options.orderYear);
  const warnings = [];
  const sourceSheets = [];
  const byMajor = new Map();

  for (const sheetName of (workbook?.SheetNames || [])) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) {
      sourceSheets.push({ sheetName, included: false, reason: 'empty-sheet' });
      continue;
    }
    const meta = classifySheetName(sheetName);
    if (meta.skip) {
      sourceSheets.push({ sheetName, included: false, reason: meta.reason });
      continue;
    }
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const parsed = parseSheet(sheetName, aoa, meta, orderYear);
    if (!parsed) {
      sourceSheets.push({ sheetName, included: false, reason: 'no-header' });
      warnings.push(`${sheetName}: 품명/입고수량/매입단가/매출단가 헤더를 찾지 못해 제외했습니다.`);
      continue;
    }
    if (!parsed.items.length && !parsed.hasTotalRow) {
      sourceSheets.push({ sheetName, included: false, reason: 'no-items' });
      warnings.push(`${sheetName}: 품목 행을 찾지 못해 제외했습니다.`);
      continue;
    }
    sourceSheets.push({
      sheetName,
      included: true,
      major: parsed.major,
      itemCount: parsed.items.length,
      hasTotalRow: parsed.hasTotalRow,
      sheetDate: parsed.sheetDate,
      sourceTitle: parsed.sourceTitle,
      erpWeekNote: parsed.erpWeekNote,
      nenovaPct: parsed.nenovaPct,
      miuPct: parsed.miuPct,
    });
    if (!byMajor.has(parsed.major)) byMajor.set(parsed.major, []);
    byMajor.get(parsed.major).push(parsed);
  }

  const batches = [...byMajor.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([major, sheets]) => buildBatch(major, sheets));

  for (const batch of batches) warnings.push(...batch.warnings);
  if (!batches.length) {
    warnings.push('신라호텔 결산 차수 시트를 찾지 못했습니다. 시트명(예: 27차)과 품명/입고수량/매입단가/매출단가 헤더를 확인하세요.');
  }

  const nenovaPct = Object.fromEntries(batches.map((b) => [b.major, b.nenovaPct]));
  const verification = batches.flatMap((b) => b.verification);

  return {
    batches,
    warnings,
    verification,
    sourceSheets,
    nenovaPct,
    partnerCode: 'shilla',
    orderYear,
  };
}
