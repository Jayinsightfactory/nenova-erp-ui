import { formatOrderWeekDateRange, orderWeekToDateRange, parseWeekSeq } from './orderWeekDate.js';

export const PIPELINE_COUNTRY_MAP = Object.freeze({
  NL: '네덜란드',
  CO: '콜롬비아',
  CN: '중국',
  EC: '에콰도르',
  TH: '태국',
  AU: '호주',
  US: '미국',
  VN: '베트남',
});

export const PIPELINE_COUNTRIES = Object.freeze([
  Object.freeze({ code: 'ALL', name: '전체 국가' }),
  ...Object.entries(PIPELINE_COUNTRY_MAP).map(([code, name]) => Object.freeze({ code, name })),
]);

export const PIPELINE_STEPS = Object.freeze([
  Object.freeze({
    id: 1,
    key: 'invoice',
    title: '1. 인보이스·패킹 확인',
    shortTitle: '인보이스·패킹',
    description: '인보이스 PDF/Excel 업로드, 품목 매칭, 저장된 초안 문서를 확인합니다.',
  }),
  Object.freeze({
    id: 2,
    key: 'incoming',
    title: '2. 입고관리 업로드·검수',
    shortTitle: '입고 업로드·검수',
    description: '인보이스 문서를 입고 원장에 검수·반영하고 발주↔입고↔분배 대조를 확인합니다.',
  }),
  Object.freeze({
    id: 3,
    key: 'cost',
    title: '3. 도착원가 산출·확정',
    shortTitle: '도착원가 산출·확정',
    description: '입고자료 기반 원가 산출, 승인 원가 엑셀 다운로드 및 차수 도착원가를 점검합니다.',
  }),
  Object.freeze({
    id: 4,
    key: 'share',
    title: '4. 카톡 요약복사 & 드라이브 업로드',
    shortTitle: '카톡 복사·드라이브',
    description: '정형화된 카톡 보고 요약문을 복사(자동 발송 없음)하고 업무·MOYI 드라이브를 연결합니다.',
  }),
]);

export function normalizeCountryCode(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toUpperCase() === 'ALL' || raw === '전체' || raw === '전체 국가') return 'ALL';
  const upper = raw.toUpperCase();
  if (Object.hasOwn(PIPELINE_COUNTRY_MAP, upper)) return upper;
  for (const [code, name] of Object.entries(PIPELINE_COUNTRY_MAP)) {
    if (name === raw) return code;
  }
  return 'ALL';
}

export function countryLabel(countryCode) {
  const code = normalizeCountryCode(countryCode);
  return code === 'ALL' ? '전체 국가' : PIPELINE_COUNTRY_MAP[code];
}

export function normalizePipelineYear(value, fallbackYear = String(new Date().getFullYear())) {
  const raw = String(value ?? '').trim();
  if (/^20\d{2}$/.test(raw)) return { orderYear: raw, valid: true };
  if (raw === '') return { orderYear: fallbackYear, valid: true, defaulted: true };
  return { orderYear: raw, valid: false };
}

export function normalizePipelineWeek(value, fallbackWeek = '') {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return fallbackWeek
      ? { orderWeek: fallbackWeek, valid: true, defaulted: true }
      : { orderWeek: '', valid: false };
  }
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (!match) return { orderWeek: raw, valid: false };
  const weekNum = Number(match[1]);
  const seqNum = Number(match[2]);
  if (weekNum < 1 || weekNum > 53 || seqNum < 1 || seqNum > 99) {
    return { orderWeek: raw, valid: false };
  }
  return {
    orderWeek: `${String(weekNum).padStart(2, '0')}-${String(seqNum).padStart(2, '0')}`,
    valid: true,
  };
}

export function normalizePipelineStep(value) {
  if (value === null || value === undefined || value === '') return 1;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 4) return 1;
  return num;
}

export function normalizePipelineScope(input = {}, defaults = {}) {
  const yearRes = normalizePipelineYear(input.orderYear ?? input.year, defaults.orderYear);
  const weekRes = normalizePipelineWeek(input.orderWeek ?? input.week, defaults.orderWeek);
  const country = normalizeCountryCode(input.country);
  const step = normalizePipelineStep(input.step);
  return {
    orderYear: yearRes.orderYear,
    orderWeek: weekRes.orderWeek,
    country,
    step,
    yearValid: yearRes.valid,
    weekValid: weekRes.valid,
    valid: yearRes.valid && weekRes.valid && Boolean(yearRes.orderYear) && Boolean(weekRes.orderWeek),
  };
}

export function parsePipelineQuery(search = '', defaults = {}) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  return normalizePipelineScope({
    orderYear: params.get('year') ?? params.get('orderYear') ?? '',
    orderWeek: params.get('week') ?? params.get('orderWeek') ?? '',
    country: params.get('country') ?? 'ALL',
    step: params.get('step') ?? '1',
  }, defaults);
}

export function pipelineQueryString(scope, { popup = false } = {}) {
  const params = new URLSearchParams();
  if (scope?.orderYear) params.set('year', String(scope.orderYear));
  if (scope?.orderWeek) params.set('week', String(scope.orderWeek));
  const country = normalizeCountryCode(scope?.country);
  if (country && country !== 'ALL') params.set('country', country);
  const step = normalizePipelineStep(scope?.step);
  if (step !== 1) params.set('step', String(step));
  if (popup) params.set('popup', '1');
  return params.toString();
}

function formatUtcIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function weekDateWindow(orderYear, orderWeek) {
  const parsed = parseWeekSeq(orderWeek);
  const year = Number(orderYear);
  if (!parsed || !Number.isFinite(year)) return { startDate: '', endDate: '', label: '' };
  const range = orderWeekToDateRange(year, parsed.week, parsed.seq);
  const startDate = formatUtcIsoDate(range?.start);
  const endDate = formatUtcIsoDate(range?.end);
  const label = formatOrderWeekDateRange(orderYear, orderWeek);
  return { startDate, endDate, label };
}

export function buildPipelineDeepLinks(scope = {}) {
  const { orderYear = '', orderWeek = '', country = 'ALL' } = scope;
  const { startDate, endDate } = weekDateWindow(orderYear, orderWeek);
  const importParams = new URLSearchParams();
  if (orderYear) importParams.set('year', orderYear);
  if (orderWeek) importParams.set('week', orderWeek);

  const incomingParams = new URLSearchParams();
  if (orderWeek) incomingParams.set('week', orderWeek);
  if (startDate) incomingParams.set('from', startDate);
  if (endDate) incomingParams.set('to', endDate);

  const incomingToolsParams = new URLSearchParams({ tab: 'incoming' });
  if (orderWeek) incomingToolsParams.set('week', orderWeek);
  if (startDate) incomingToolsParams.set('from', startDate);
  if (endDate) incomingToolsParams.set('to', endDate);

  const arrivalParams = new URLSearchParams();
  if (orderYear) arrivalParams.set('year', orderYear);
  if (orderWeek) arrivalParams.set('week', orderWeek);
  if (country && country !== 'ALL') arrivalParams.set('country', country);

  return {
    importHub: `/import${importParams.toString() ? `?${importParams}` : ''}`,
    importTools: '/import/tools',
    importToolsIncoming: `/import/tools?${incomingToolsParams}`,
    incoming: `/incoming${incomingParams.toString() ? `?${incomingParams}` : ''}`,
    warehouse: '/warehouse',
    arrivalCost: `/arrival-cost${arrivalParams.toString() ? `?${arrivalParams}` : ''}`,
    workDrive: '/work/drive',
    moyiDrive: '/integrations/moyi-drive',
  };
}

export function formatShortDriveCycle(orderWeek) {
  const parsed = parseWeekSeq(orderWeek);
  if (!parsed) return '';
  return `${parsed.week}-${parsed.seq}`;
}

export function matchesDriveCycle(fileCycle, orderWeek) {
  const target = formatShortDriveCycle(orderWeek);
  const rawCycle = String(fileCycle || '').trim();
  if (!target || !rawCycle) return false;
  const parsedFile = parseWeekSeq(rawCycle);
  if (parsedFile) {
    return `${parsedFile.week}-${parsedFile.seq}` === target;
  }
  const majorOnly = /^(\d{1,2})$/.exec(rawCycle);
  if (majorOnly) {
    return Number(majorOnly[1]) === parseWeekSeq(orderWeek)?.week;
  }
  return false;
}

const COUNTRY_NAME_PATTERNS = Object.freeze({
  NL: /네덜란드|holland|netherlands|\bnl\b|holex/i,
  CO: /콜롬비아|colombia|\bco\b|콜수국|콜카장/i,
  CN: /중국|china|\bcn\b|yunnan|hub\s*fresh|cloud\s*land/i,
  EC: /에콰도르|에쿠아도르|ecuador|\bec\b/i,
  TH: /태국|thailand|\bth\b/i,
  AU: /호주|australia|\bau\b/i,
  US: /미국|\busa\b|\bus\b/i,
  VN: /베트남|viet\s*nam|vietnam|\bvn\b/i,
});

export function matchesCountryText(value, countryCode) {
  const code = normalizeCountryCode(countryCode);
  if (code === 'ALL') return true;
  const name = PIPELINE_COUNTRY_MAP[code];
  const text = String(value || '').trim();
  if (!text) return false;
  if (text.toUpperCase() === code || text === name) return true;
  const pattern = COUNTRY_NAME_PATTERNS[code];
  return pattern ? pattern.test(text) : text.includes(name);
}

export function filterDriveFilesByScope(files = [], { orderYear, orderWeek, country = 'ALL' } = {}) {
  const yearNum = Number(orderYear);
  const cycleFiles = (Array.isArray(files) ? files : []).filter((file) => {
    if (!matchesDriveCycle(file?.cycle, orderWeek)) return false;
    if (Number.isFinite(yearNum) && yearNum > 2000) {
      const explicitFileYear = Number(file?.year);
      if (Number.isFinite(explicitFileYear) && explicitFileYear > 2000 && explicitFileYear !== yearNum) {
        return false;
      }
      const nameYearMatch = String(file?.filename || '').match(/(?:^|[^\d])(20\d{2})(?:년|-\d{2}차|\s*\d{2}차)/);
      if (nameYearMatch && Number(nameYearMatch[1]) !== yearNum) {
        return false;
      }
    }
    return true;
  });

  const code = normalizeCountryCode(country);
  const countryFiles = code === 'ALL'
    ? cycleFiles
    : cycleFiles.filter((file) => matchesCountryText(file?.filename, code));

  const stageCounts = {};
  for (const file of cycleFiles) {
    const stage = file?.stage || '미분류';
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
  }

  return { cycleFiles, countryFiles, stageCounts };
}

export function filterBoardByCountry(board, country = 'ALL') {
  const code = normalizeCountryCode(country);
  const cards = Array.isArray(board?.cards) ? board.cards : [];
  const items = Array.isArray(board?.items) ? board.items : [];
  if (code === 'ALL') {
    return {
      cards,
      items,
      totals: board?.totals || {
        ordered: items.reduce((sum, item) => sum + (Number(item.ordered) || 0), 0),
        received: items.reduce((sum, item) => sum + (Number(item.received) || 0), 0),
        shipped: items.reduce((sum, item) => sum + (Number(item.shipped) || 0), 0),
        missing: items.filter((item) => item.tag === '미입고').length,
        short: items.filter((item) => item.tag === '부족').length,
        over: items.filter((item) => item.tag === '초과').length,
        unordered: items.filter((item) => item.tag === '미발주').length,
      },
    };
  }
  const scopedCards = cards.filter((card) => matchesCountryText(card?.country, code));
  const scopedItems = items.filter((item) => matchesCountryText(item?.country, code));
  return {
    cards: scopedCards,
    items: scopedItems,
    totals: {
      ordered: scopedItems.reduce((sum, item) => sum + (Number(item.ordered) || 0), 0),
      received: scopedItems.reduce((sum, item) => sum + (Number(item.received) || 0), 0),
      shipped: scopedItems.reduce((sum, item) => sum + (Number(item.shipped) || 0), 0),
      missing: scopedItems.filter((item) => item.tag === '미입고').length,
      short: scopedItems.filter((item) => item.tag === '부족').length,
      over: scopedItems.filter((item) => item.tag === '초과').length,
      unordered: scopedItems.filter((item) => item.tag === '미발주').length,
    },
  };
}

export function filterArrivalRowsByCountry(rows = [], country = 'ALL') {
  const code = normalizeCountryCode(country);
  const list = Array.isArray(rows) ? rows : [];
  if (code === 'ALL') return list;
  return list.filter((row) =>
    matchesCountryText(row?.countryName, code) || matchesCountryText(row?.dbCountryName, code));
}

export function filterUploadHistoryByCountry(rows = [], country = 'ALL') {
  const code = normalizeCountryCode(country);
  const list = Array.isArray(rows) ? rows : [];
  if (code === 'ALL') return list;
  return list.filter((row) => String(row?.country || '').trim().toUpperCase() === code);
}

export function summarizePipelineSteps({
  scope,
  drafts = [],
  warehouses = [],
  board = null,
  invoiceCosts = [],
  arrivalCosts = [],
  uploadHistory = [],
  driveFiles = [],
  activePackingSource = null,
  copiedAt = '',
  errors = {},
} = {}) {
  const country = normalizeCountryCode(scope?.country);
  const scopedDrafts = Array.isArray(drafts) ? drafts : [];
  const draftCommittedCount = scopedDrafts.filter((doc) => doc?.receiptStatus === 'COMMITTED').length;
  const draftPendingCount = scopedDrafts.filter((doc) => doc?.receiptStatus !== 'COMMITTED').length;
  const scopedUploads = filterUploadHistoryByCountry(uploadHistory, country);
  const hasActiveSessionInvoice = Boolean(activePackingSource?.file && (activePackingSource?.excels?.length || activePackingSource?.invoices?.length));

  let step1Status = 'pending';
  if (errors?.drafts && scopedDrafts.length === 0) {
    step1Status = 'error';
  } else if (scopedDrafts.length > 0 && draftPendingCount === 0 && draftCommittedCount > 0) {
    step1Status = 'complete';
  } else if (scopedDrafts.length > 0 || scopedUploads.length > 0 || hasActiveSessionInvoice) {
    step1Status = 'in_progress';
  }

  const warehouseList = Array.isArray(warehouses) ? warehouses : [];
  const boardFiltered = filterBoardByCountry(board, country);
  const orderedQty = Number(boardFiltered.totals.ordered || 0);
  const receivedQty = Number(boardFiltered.totals.received || 0);
  const shippedQty = Number(boardFiltered.totals.shipped || 0);
  const missingItems = Number(boardFiltered.totals.missing || 0);
  const fillRate = orderedQty > 0 ? Math.round((receivedQty / orderedQty) * 100) : null;

  let step2Status = 'pending';
  if (errors?.warehouses && warehouseList.length === 0) {
    step2Status = 'error';
  } else if (warehouseList.length > 0 && receivedQty > 0 && missingItems === 0 && draftPendingCount === 0) {
    step2Status = 'complete';
  } else if (warehouseList.length > 0 || receivedQty > 0 || draftCommittedCount > 0) {
    step2Status = 'in_progress';
  }

  const invoiceCostList = Array.isArray(invoiceCosts) ? invoiceCosts : [];
  const approvedInvoiceCostCount = invoiceCostList.filter((row) => Boolean(row?.currentActual)).length;
  const staleInvoiceCostCount = invoiceCostList.filter((row) => !row?.currentActual && Boolean(row?.latestStale)).length;
  const totalApprovedCostKRW = invoiceCostList.reduce(
    (sum, row) => sum + (Number(row?.currentActual?.totalCostKRW) || 0),
    0,
  );

  const scopedArrivalRows = filterArrivalRowsByCountry(arrivalCosts, country);
  const arrivalUploadedRows = scopedArrivalRows.filter((row) => row?.uploadStatus !== 'COST_NOT_UPLOADED');
  const arrivalMissingCount = scopedArrivalRows.filter((row) => row?.uploadStatus === 'COST_NOT_UPLOADED').length;
  const arrivalMatchedCount = arrivalUploadedRows.filter((row) => row?.matchStatus === 'MATCHED').length;
  const arrivalUnmatchedCount = arrivalUploadedRows.filter((row) => row?.matchStatus !== 'MATCHED').length;

  let step3Status = 'pending';
  if (errors?.arrivalCosts && errors?.invoiceCosts) {
    step3Status = 'error';
  } else if (
    (approvedInvoiceCostCount > 0 || arrivalMatchedCount > 0)
    && staleInvoiceCostCount === 0
    && arrivalMissingCount === 0
    && arrivalUnmatchedCount === 0
  ) {
    step3Status = 'complete';
  } else if (approvedInvoiceCostCount > 0 || staleInvoiceCostCount > 0 || arrivalUploadedRows.length > 0) {
    step3Status = 'in_progress';
  }

  const driveSummary = filterDriveFilesByScope(driveFiles, scope);
  const driveTotalCount = driveSummary.cycleFiles.length;
  const driveCountryCount = driveSummary.countryFiles.length;
  const driveReceiptStageCount = driveSummary.stageCounts['입고'] || 0;
  const driveCostStageCount = driveSummary.stageCounts['원가·운임'] || 0;
  const hasCopiedSummary = Boolean(copiedAt);

  let step4Status = 'pending';
  if (errors?.drive && driveTotalCount === 0 && !hasCopiedSummary) {
    step4Status = 'error';
  } else if (hasCopiedSummary && driveTotalCount > 0) {
    step4Status = 'complete';
  } else if (hasCopiedSummary || driveTotalCount > 0) {
    step4Status = 'in_progress';
  }

  const steps = [
    {
      id: 1,
      key: 'invoice',
      status: step1Status,
      metrics: {
        draftTotal: scopedDrafts.length,
        draftCommittedCount,
        draftPendingCount,
        uploadHistoryCount: scopedUploads.length,
        hasActiveSessionInvoice,
      },
      summaryText: scopedDrafts.length > 0
        ? `문서 ${scopedDrafts.length}건 (확정 ${draftCommittedCount} · 대기 ${draftPendingCount})`
        : hasActiveSessionInvoice
          ? '현재 작업 인보이스 준비됨'
          : `팀 업로드 ${scopedUploads.length}건 · 저장 문서 없음`,
    },
    {
      id: 2,
      key: 'incoming',
      status: step2Status,
      metrics: {
        warehouseCount: warehouseList.length,
        orderedQty,
        receivedQty,
        shippedQty,
        missingItems,
        shortItems: Number(boardFiltered.totals.short || 0),
        overItems: Number(boardFiltered.totals.over || 0),
        unorderedItems: Number(boardFiltered.totals.unordered || 0),
        fillRate,
      },
      summaryText: warehouseList.length > 0 || receivedQty > 0
        ? `입고 ${warehouseList.length}건 · 입고율 ${fillRate == null ? '—' : `${fillRate}%`} · 미입고 ${missingItems}품목`
        : '전산 입고 내역 없음',
    },
    {
      id: 3,
      key: 'cost',
      status: step3Status,
      metrics: {
        approvedInvoiceCostCount,
        staleInvoiceCostCount,
        totalApprovedCostKRW,
        arrivalTotalCount: scopedArrivalRows.length,
        arrivalUploadedCount: arrivalUploadedRows.length,
        arrivalMatchedCount,
        arrivalUnmatchedCount,
        arrivalMissingCount,
      },
      summaryText: approvedInvoiceCostCount > 0 || arrivalUploadedRows.length > 0
        ? `승인 ${approvedInvoiceCostCount}건 · 원가반영 ${arrivalUploadedRows.length}행${arrivalMissingCount > 0 ? ` · 미업로드 ${arrivalMissingCount}` : ''}${staleInvoiceCostCount > 0 ? ` · 재승인필요 ${staleInvoiceCostCount}` : ''}`
        : '산출된 도착원가 없음',
    },
    {
      id: 4,
      key: 'share',
      status: step4Status,
      metrics: {
        driveTotalCount,
        driveCountryCount,
        driveReceiptStageCount,
        driveCostStageCount,
        hasCopiedSummary,
        copiedAt: copiedAt || null,
      },
      summaryText: `드라이브 ${driveTotalCount}건 · 카톡요약 ${hasCopiedSummary ? '복사됨' : '미복사'}`,
    },
  ];

  const completedCount = steps.filter((step) => step.status === 'complete').length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  return {
    steps,
    completedCount,
    totalSteps: steps.length,
    progressPercent,
    boardFiltered,
    scopedArrivalRows,
    driveSummary,
  };
}

function formatNum(value, digits = 0) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

export function buildKakaoSummaryText({
  scope = {},
  summary = null,
  drafts = [],
  warehouses = [],
  invoiceCosts = [],
  arrivalCosts = [],
  driveFiles = [],
  includeItems = true,
  customNote = '',
} = {}) {
  const year = scope.orderYear || '----';
  const week = scope.orderWeek || '--';
  const dateRange = weekDateWindow(year, week).label;
  const countryName = countryLabel(scope.country);
  const computed = summary || summarizePipelineSteps({
    scope,
    drafts,
    warehouses,
    invoiceCosts,
    arrivalCosts,
    driveFiles,
  });

  const [step1, step2, step3, step4] = computed.steps;
  const lines = [
    `[수입 현황 요약] ${year}년 ${week}차${dateRange ? ` (${dateRange})` : ''} · ${countryName}`,
    `진행률: ${computed.completedCount}/4단계 완료 (${computed.progressPercent}%)`,
    '',
    `1) 인보이스·패킹 확인: 저장문서 ${step1.metrics.draftTotal}건 (입고확정 ${step1.metrics.draftCommittedCount} / 대기 ${step1.metrics.draftPendingCount})`,
  ];

  const warehouseList = Array.isArray(warehouses) ? warehouses : [];
  if (warehouseList.length > 0) {
    const farmNames = [...new Set(warehouseList.map((row) => String(row?.FarmName || '').trim()).filter(Boolean))];
    lines.push(
      `2) 입고 검수: 전산 입고 ${step2.metrics.warehouseCount}건 (${farmNames.slice(0, 5).join(', ')}${farmNames.length > 5 ? ` 외 ${farmNames.length - 5}곳` : ''})`,
    );
  } else {
    lines.push(`2) 입고 검수: 전산 입고 ${step2.metrics.warehouseCount}건`);
  }
  lines.push(
    `   발주 ${formatNum(step2.metrics.orderedQty)} → 입고 ${formatNum(step2.metrics.receivedQty)} → 분배 ${formatNum(step2.metrics.shippedQty)} (미입고 ${step2.metrics.missingItems} · 부족 ${step2.metrics.shortItems} · 초과 ${step2.metrics.overItems})`,
  );

  lines.push(
    `3) 도착원가: 인보이스 승인 ${step3.metrics.approvedInvoiceCostCount}건${step3.metrics.totalApprovedCostKRW > 0 ? ` (${formatNum(step3.metrics.totalApprovedCostKRW)}원)` : ''}${step3.metrics.staleInvoiceCostCount > 0 ? ` · 재승인필요 ${step3.metrics.staleInvoiceCostCount}건` : ''} / 차수 원가 ${step3.metrics.arrivalUploadedCount}행 (매칭완료 ${step3.metrics.arrivalMatchedCount} · 미매칭 ${step3.metrics.arrivalUnmatchedCount} · 미업로드 ${step3.metrics.arrivalMissingCount})`,
  );

  if (includeItems) {
    const sampleCosts = (computed.scopedArrivalRows || [])
      .filter((row) => row?.uploadStatus !== 'COST_NOT_UPLOADED')
      .slice(0, 8);
    if (sampleCosts.length > 0) {
      lines.push('   [주요 품목 도착원가]');
      for (const row of sampleCosts) {
        const prod = row.displayName || row.prodName || row.productNameRaw || '품목미상';
        const farm = row.farmName || row.autoFarmName || row.farmNameRaw || '농장미지정';
        const rawCost = row.selectedArrivalCostKRW ?? row.sourceArrivalCostKRW;
        const costText = rawCost == null ? '원가 미기재' : `${formatNum(rawCost)}원/${row.unit || '단위'}`;
        lines.push(`   - ${prod} (${farm}): ${costText}`);
      }
      const remaining = (computed.scopedArrivalRows || []).filter((row) => row?.uploadStatus !== 'COST_NOT_UPLOADED').length - sampleCosts.length;
      if (remaining > 0) lines.push(`   - 외 ${remaining}건 (네노바웹 도착원가 화면에서 전체 확인)`);
    }
  }

  lines.push(
    `4) 드라이브 공유: 업무드라이브 ${step4.metrics.driveTotalCount}건 (입고 ${step4.metrics.driveReceiptStageCount} · 원가·운임 ${step4.metrics.driveCostStageCount})`,
  );

  const note = String(customNote || '').trim();
  if (note) {
    lines.push('', `특이사항: ${note}`);
  }

  lines.push('', '확인: 네노바웹 /import/pipeline (자동 발송 아님 · 담당자 확인 후 공유)');
  return lines.join('\n');
}
