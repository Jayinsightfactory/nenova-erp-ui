// 중국 도착원가 이원화 엔진: CLOUD(중국 항공) · HUBFRESH(중국 해상 40ft 혼적 최종본).
// 화면 미리보기와 .xlsx 생성기가 모두 이 순수 함수 하나만 사용한다(같은 입력 → 같은 원가).
// 근거 수식: 47-2A/B·46-2 CLOUD cbm(항공), 46-1·47-1·48-1 해상 HUB(해상). DB 쓰기 없음.
import { CN_MODES, cnCategory, cnCategorySpec, isCnMetaName, matchCnCategory } from './cnArrivalCostRules.js';

export const CN_FORMULA_VERSION = 'CN_CLOUD_HUBFRESH_V1';
export const CN_DEFAULT_EXCHANGE_RATE = 210;
// CLOUD 운임 배분 기준: 0=자동(GW=CW 중량 비례 / GW<CW CBM 비례), 1=CBM 비례 고정, 2=중량 비례 고정
export const CN_ALLOCATION_MODES = Object.freeze({ AUTO: 0, CBM: 1, WEIGHT: 2 });

export const CN_HEADER_FIELDS = Object.freeze({
  CLOUD: Object.freeze([
    { key: 'exchangeRate', label: '환율 (원/CNY)', unit: '원', group: '공통' },
    { key: 'commissionRate', label: '수수료율 (관세 과세표준 제외)', unit: '%', group: '공통', percent: true },
    { key: 'marginRate', label: '목표 마진율', unit: '%', group: '공통', percent: true },
    { key: 'gw', label: 'GW 실중량', unit: 'kg', group: '중량·운임' },
    { key: 'cw', label: 'CW 청구중량', unit: 'kg', group: '중량·운임' },
    { key: 'airFreight', label: '항공운임 합계 (서류 포함)', unit: 'CNY', group: '중량·운임' },
    { key: 'allocationMode', label: '운임 배분 방식', unit: '', group: '중량·운임', select: [
      { value: 0, label: '자동 (GW=CW 중량 / GW<CW CBM)' },
      { value: 1, label: '항공 규격표 CBM 비례 고정' },
      { value: 2, label: '중량(kg) 비례 고정' },
    ] },
    { key: 'orchidPermit', label: '호접란 허가증비', unit: 'CNY', group: '중량·운임' },
    { key: 'warehousePerKg', label: '백상 단가', unit: '원/kg', group: '통관' },
    { key: 'warehouseFeeOverride', label: '백상비 직접입력 (0이면 GW×단가)', unit: '원', group: '통관' },
    { key: 'brokerage', label: '통관 수수료', unit: '원', group: '통관' },
    { key: 'quarantineCount', label: '검역 품목수', unit: '종', group: '통관' },
    { key: 'quarantinePerItem', label: '검역 단가', unit: '원/종', group: '통관' },
    { key: 'domesticTransport', label: '국내 운송비', unit: '원', group: '통관' },
    { key: 'quarantineDeduct', label: '겸역 차감', unit: '원', group: '통관' },
    { key: 'disinfection', label: '소독비', unit: '원', group: '통관' },
  ]),
  HUBFRESH: Object.freeze([
    { key: 'exchangeRate', label: '환율 (원/CNY)', unit: '원', group: '공통' },
    { key: 'commissionRate', label: '수수료율 (관세 과세표준 제외)', unit: '%', group: '공통', percent: true },
    { key: 'marginRate', label: '목표 마진율', unit: '%', group: '공통', percent: true },
    { key: 'nenovaCbm', label: 'Nenova CBM (F40)', unit: 'CBM', group: 'CBM 지분' },
    { key: 'realCbm', label: 'Real CBM 컨테이너 전체 (F41)', unit: 'CBM', group: 'CBM 지분' },
    { key: 'docFee', label: '서류비', unit: 'CNY', group: '컨테이너 비용 (100% 원액)' },
    { key: 'processUnit', label: 'PROCESS 단가', unit: 'CNY/박스', group: '컨테이너 비용 (100% 원액)' },
    { key: 'processBoxes', label: 'PROCESS 박스수', unit: '박스', group: '컨테이너 비용 (100% 원액)' },
    { key: 'quarantineBoxUnit', label: '검역박스 단가', unit: 'CNY/박스', group: '컨테이너 비용 (100% 원액)' },
    { key: 'quarantineBoxes', label: '검역박스 수', unit: '박스', group: '컨테이너 비용 (100% 원액)' },
    { key: 'seaFreight', label: 'SEA FREIGHT 해상운임', unit: 'CNY', group: '컨테이너 비용 (100% 원액)' },
    { key: 'logger', label: '온도 로거', unit: 'CNY', group: '컨테이너 비용 (100% 원액)' },
    { key: 'loading', label: '상차비 Loading', unit: 'CNY', group: '컨테이너 비용 (100% 원액)' },
    { key: 'boxUnitPrice', label: '박스 개당 단가', unit: 'CNY', group: '네노바 단독 비용' },
    { key: 'commonCustoms', label: '컨테이너 공통 통관비 (지분 안분)', unit: '원', group: '통관' },
    { key: 'dedicatedCustoms', label: '네노바 전담 통관비', unit: '원', group: '통관' },
  ]),
});

export const CN_STANDARD_DEFAULTS = Object.freeze({
  CLOUD: Object.freeze({ exchangeRate: CN_DEFAULT_EXCHANGE_RATE, gw: 0, cw: 0, airFreight: 0, allocationMode: 0, orchidPermit: 300,
    commissionRate: 0.03, warehousePerKg: 460, warehouseFeeOverride: 0, brokerage: 33000, quarantineCount: 0, quarantinePerItem: 10000,
    domesticTransport: 195000, quarantineDeduct: 40000, disinfection: 200000, marginRate: 0.15 }),
  HUBFRESH: Object.freeze({ exchangeRate: CN_DEFAULT_EXCHANGE_RATE, nenovaCbm: 0, realCbm: 0, docFee: 1000, processUnit: 2.5, processBoxes: 0,
    quarantineBoxUnit: 5, quarantineBoxes: 0, seaFreight: 0, logger: 300, loading: 1000, boxUnitPrice: 27,
    commonCustoms: 4000000, dedicatedCustoms: 2600000, commissionRate: 0, marginRate: 0.15 }),
});

export const CN_ROW_INPUTS = Object.freeze(['categoryCode', 'bunchesPerBox', 'cbmPerBunch', 'weightKgPerBunch', 'tariffRate', 'stemsPerBunch', 'orchid']);

const num = value => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
const positive = value => Number.isFinite(num(value)) && num(value) > 0 ? num(value) : null;
const round = (value, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;

export function detectCnMode(farmName) {
  const text = String(farmName || '');
  if (/HUB\s*FRESH|\bHUB2\b|허브프레시/i.test(text)) return { mode: CN_MODES.HUBFRESH, legacy: false };
  if (/MELODY|멜로디|HENGGE|헨지|\[MEL\]|\[오경\]/i.test(text)) return { mode: CN_MODES.CLOUD, legacy: true };
  return { mode: CN_MODES.CLOUD, legacy: false };
}

// 입고 원본(WarehouseMaster+Detail+Product 조인 행, 단건 또는 복수 입고) → 정규화 소스.
// 메타·공란·HUB2(중국 TOTAL) 행은 상품에서 제외하고 중량·운임 힌트만 추출한다. 오염된 TariffRate/FlowerName/BoxQuantity=1은 원가 계산에 쓰지 않는다.
export function cnSourceFromDbRows(rows = []) {
  const head = rows[0] || {};
  const warehouseKeys = [...new Set(rows.map(r => r.WarehouseKey).filter(Boolean))];
  const farms = [...new Set(rows.map(r => String(r.FarmName ?? '').trim()).filter(Boolean))];
  const invoices = [...new Set(rows.map(r => String(r.InvoiceNo ?? '').trim()).filter(Boolean))];
  const lines = [], excluded = [], weightHints = [];
  let explicitGw = 0, explicitCw = 0, hasExplicitGw = false, hasExplicitCw = false;
  const seenHeaders = new Set();
  for (const row of rows) {
    if (row.WarehouseKey != null && !seenHeaders.has(row.WarehouseKey)) {
      seenHeaders.add(row.WarehouseKey);
      if (positive(row.GrossWeight)) { explicitGw += Number(row.GrossWeight); hasExplicitGw = true; }
      if (positive(row.ChargeableWeight)) { explicitCw += Number(row.ChargeableWeight); hasExplicitCw = true; }
    }
    const name = String(row.ProdName ?? '').trim();
    const blank = (row.ProdKey == null || row.ProdKey === '') && !name;
    if (blank) {
      if (Number(row.SteamQuantity) > 0) weightHints.push(Number(row.SteamQuantity));
      excluded.push({ wdetailKey: row.WdetailKey, warehouseKey: row.WarehouseKey ?? null, name: '(공란 중량·비상품 행)', amount: Number(row.TPrice) || 0, quantity: row.SteamQuantity ?? null });
      continue;
    }
    if (isCnMetaName(name)) {
      const qtyCandidate = positive(row.OutQuantity) ?? positive(row.SteamQuantity) ?? null;
      if (/^gross\s*weig/i.test(name) && !hasExplicitGw && qtyCandidate > 1) weightHints.push(qtyCandidate);
      if (/^chargeable\s*weig/i.test(name) && !hasExplicitCw && qtyCandidate > 1) weightHints.push(qtyCandidate);
      excluded.push({ wdetailKey: row.WdetailKey, warehouseKey: row.WarehouseKey ?? null, name, amount: Number(row.TPrice) || 0, quantity: qtyCandidate });
      continue;
    }
    lines.push({ wdetailKey: row.WdetailKey, warehouseKey: row.WarehouseKey ?? null, prodKey: row.ProdKey, name, outUnit: row.OutUnit ?? null,
      boxQuantity: row.BoxQuantity ?? null, bunchQuantity: row.BunchQuantity ?? null, stemQuantity: row.SteamQuantity ?? null,
      outQuantity: row.OutQuantity ?? null, unitPrice: row.UPrice ?? null, lineAmount: row.TPrice ?? null,
      stemsPerBunch: row.SteamOf1Bunch ?? null, productStemsPerBunch: row.ProductSteamOf1Bunch ?? null,
      country: row.CounName ?? null });
  }
  const distinct = [...new Set(weightHints)];
  const gw = hasExplicitGw ? explicitGw : (distinct.length === 2 ? Math.min(...distinct) : null);
  const cw = hasExplicitCw ? explicitCw : (distinct.length >= 1 ? Math.max(...distinct) : null);
  return { warehouseKey: head.WarehouseKey ?? null, warehouseKeys, orderYear: head.OrderYear ?? '', orderWeek: head.OrderWeek ?? '',
    farmName: farms.join(' · ') || (head.FarmName ?? ''), invoiceNo: invoices.join(', ') || (head.InvoiceNo ?? ''), orderNo: head.OrderNo ?? '',
    gw, cw, lines, excluded,
    gwCwAmbiguous: !hasExplicitGw && weightHints.length >= 2 && distinct.length === 1,
    weightSource: hasExplicitGw ? '입고 헤더' : distinct.length ? '입고 중량행' : null };
}

function lineQuantity(line) {
  const stemUnit = /송이|stem/i.test(String(line.outUnit || ''));
  if (stemUnit) return positive(line.outQuantity) ?? positive(line.stemQuantity) ?? 0;
  return positive(line.bunchQuantity) ?? positive(line.outQuantity) ?? 0;
}
function lineStemsPerBunch(line) {
  if (/송이|stem/i.test(String(line.outUnit || ''))) return 1;
  const own = positive(line.stemsPerBunch);
  if (own) return own;
  const bunches = positive(line.bunchQuantity), stems = positive(line.stemQuantity);
  if (bunches && stems) return stems / bunches;
  const master = positive(line.productStemsPerBunch);
  return master ?? 1;
}

export function cnRowDefaults(categoryCode, mode) {
  const category = cnCategory(categoryCode), spec = cnCategorySpec(categoryCode, mode);
  if (!category || !spec) return null;
  return { categoryCode: category.code, bunchesPerBox: spec.bunchesPerBox, cbmPerBunch: round(spec.cbmPerBunch, 9),
    weightKgPerBunch: mode === CN_MODES.CLOUD ? spec.weightKgPerBunch : 0, tariffRate: spec.tariffRate, orchid: category.orchid ? 1 : 0 };
}

function resolveAllocationMode(header = {}) {
  if (Number.isFinite(num(header.allocationMode)) && [0, 1, 2].includes(Number(header.allocationMode))) return Number(header.allocationMode);
  if (Object.hasOwn(header, 'allocationBasisCbm') && Number.isFinite(num(header.allocationBasisCbm))) {
    return Number(header.allocationBasisCbm) === 0 ? CN_ALLOCATION_MODES.WEIGHT : CN_ALLOCATION_MODES.CBM;
  }
  return CN_ALLOCATION_MODES.AUTO;
}

export function isCnWeightAllocation(header = {}) {
  const mode = resolveAllocationMode(header);
  if (mode === CN_ALLOCATION_MODES.WEIGHT) return true;
  if (mode === CN_ALLOCATION_MODES.CBM) return false;
  const gw = num(header.gw), cw = num(header.cw);
  return Number.isFinite(gw) && gw > 0 && Number.isFinite(cw) && Math.abs(gw - cw) < 1e-9;
}

export function cnBasisMetric(row, header) {
  return isCnWeightAllocation(header) ? num(row.weightKgPerBunch) : num(row.cbmPerBunch);
}

// memory: { [prodKey]: {categoryCode,bunchesPerBox,cbmPerBunch,weightKgPerBunch,tariffRate,stemsPerBunch} } — 브라우저 로컬스토리지 기억값(Tier 2).
export function buildCnDraft(source, options = {}) {
  const detected = detectCnMode(source.farmName);
  const mode = options.mode === CN_MODES.HUBFRESH || options.mode === CN_MODES.CLOUD ? options.mode : detected.mode;
  const legacy = mode === CN_MODES.CLOUD && detected.legacy;
  const memory = options.memory || {};
  const notices = [];
  const rows = (source.lines || []).map((line, index) => {
    const matched = matchCnCategory(line.name);
    const remembered = line.prodKey != null ? memory[String(line.prodKey)] : null;
    const rememberedCategory = remembered && cnCategory(remembered.categoryCode) ? remembered.categoryCode : null;
    const code = rememberedCategory || matched?.code || 'MANUAL_STANDARD';
    const base = cnRowDefaults(code, mode);
    const quantity = lineQuantity(line);
    const fob = positive(line.unitPrice) ?? (positive(line.lineAmount) && quantity ? Number(line.lineAmount) / quantity : 0);
    const row = { lineId: `wd-${line.wdetailKey ?? index}`, lineNo: index + 1, wdetailKey: line.wdetailKey ?? null,
      warehouseKey: line.warehouseKey ?? source.warehouseKey ?? null, prodKey: line.prodKey ?? null,
      name: line.name, outUnit: line.outUnit ?? null, quantity, fob, ...base, stemsPerBunch: lineStemsPerBunch(line),
      matchedCode: matched?.code ?? null, needsReview: !matched && !rememberedCategory,
      reviewReason: !matched && !rememberedCategory ? '미등록 품종 · 카테고리 선택 필요 (임시 10단 규격)' : (cnCategory(code)?.needsReview ? '구 항공 품종 · 규격 확인' : ''),
      memoryApplied: false };
    if (remembered) {
      for (const key of ['bunchesPerBox', 'cbmPerBunch', 'weightKgPerBunch', 'tariffRate', 'stemsPerBunch']) if (Number.isFinite(num(remembered[key]))) row[key] = num(remembered[key]);
      row.memoryApplied = true;
    }
    return row;
  });
  const fields = CN_STANDARD_DEFAULTS[mode];
  const header = { ...fields }, headerSources = Object.fromEntries(Object.keys(fields).map(key => [key, '표준 기본값']));
  const set = (key, value, label) => { if (Number.isFinite(num(value))) { header[key] = num(value); headerSources[key] = label; } };
  set('exchangeRate', source.exchangeRate, source.exchangeRateSource || '표준 기본 환율 (210원)');
  const freightRows = (source.excluded || []).filter(row => /운송료|항공운임|해상운임|운임/i.test(row.name) && Number(row.amount) > 0);
  const freightTotal = freightRows.reduce((sum, row) => sum + Number(row.amount), 0);
  if (mode === CN_MODES.CLOUD) {
    if (legacy) { header.commissionRate = 0; headerSources.commissionRate = '레거시(멜로디·헨지) 호환 · 수수료 0%'; }
    set('gw', source.gw, source.weightSource || '입고 자동추출');
    set('cw', source.cw, source.weightSource || '입고 자동추출');
    if (Number.isFinite(num(source.airFreight))) set('airFreight', source.airFreight, source.airFreightSource || '업로드 서류 자동추출');
    else if (freightTotal > 0) set('airFreight', freightTotal, `입고 운송료 행 ${freightRows.map(r => `#${r.wdetailKey}`).join('·')}`);
    const hasOrchid = rows.some(row => row.orchid === 1 && row.quantity > 0);
    header.orchidPermit = hasOrchid ? 300 : 0; headerSources.orchidPermit = hasOrchid ? '호접란 포함 · 기본 300 CNY' : '호접란 없음 · 0';
    header.quarantineCount = new Set(rows.filter(row => row.quantity > 0).map(row => row.categoryCode)).size;
    headerSources.quarantineCount = '실제 입고 품목(카테고리) 수';
    header.allocationMode = CN_ALLOCATION_MODES.AUTO;
    headerSources.allocationMode = isCnWeightAllocation(header) ? '자동 (GW = CW · 중량 비례)' : '자동 (GW < CW · 항공 규격표 CBM 비례)';
    if (!(header.gw > 0)) notices.push({ level: 'warn', text: 'GW가 입고에 없습니다. 백상비(GW × 단가)를 위해 GW를 입력하거나 업로드 서류를 불러오세요.' });
    if (!(header.airFreight > 0)) notices.push({ level: 'warn', text: '항공운임이 입고·서류에서 확인되지 않았습니다. 인보이스 항공료(서류비 포함)를 입력하세요.' });
    if (source.gwCwAmbiguous) notices.push({ level: 'warn', text: '입고 공란 중량행 두 값이 같아 GW와 CW를 구분할 수 없습니다. 서류의 GW를 확인하세요.' });
  } else {
    const nenovaCbm = rows.reduce((sum, row) => sum + row.quantity * row.cbmPerBunch, 0);
    const boxes = rows.reduce((sum, row) => sum + (row.bunchesPerBox > 0 ? row.quantity / row.bunchesPerBox : 0), 0);
    set('nenovaCbm', source.nenovaCbm ?? round(nenovaCbm, 4), source.nenovaCbm != null ? '서류 파싱값' : '규격표 합산 초안 · 실선적 CBM으로 수정');
    set('realCbm', source.realCbm ?? header.nenovaCbm, source.realCbm != null ? '서류 파싱값' : '단독 컨테이너 기본값(100%) · 혼적이면 전체 CBM 입력');
    header.processBoxes = Number.isFinite(num(source.processBoxes)) ? num(source.processBoxes) : Math.round(boxes);
    headerSources.processBoxes = Number.isFinite(num(source.processBoxes)) ? '서류 파싱값' : '규격표 역산 박스수';
    header.quarantineBoxes = Number.isFinite(num(source.quarantineBoxes)) ? num(source.quarantineBoxes) : Math.round(boxes);
    headerSources.quarantineBoxes = Number.isFinite(num(source.quarantineBoxes)) ? '서류 파싱값' : '규격표 역산 박스수';
    for (const k of ['docFee', 'processUnit', 'quarantineBoxUnit', 'logger', 'loading']) {
      if (Number.isFinite(num(source[k]))) set(k, source[k], '서류 파싱값');
    }
    if (Number.isFinite(num(source.seaFreight))) set('seaFreight', source.seaFreight, '서류 파싱값');
    else if (freightTotal > 0) {
      // #8170 함정: ERP 운송료 = 컨테이너 100% 원액 + 네노바 박스비. 박스비를 떼어 낸 뒤 SEA FREIGHT 초안을 역산한다.
      const containerTotal = freightTotal - Math.round(boxes) * header.boxUnitPrice;
      const others = header.docFee + header.processUnit * header.processBoxes + header.quarantineBoxUnit * header.quarantineBoxes + header.logger + header.loading;
      header.seaFreight = Math.max(0, round(containerTotal - others, 2));
      headerSources.seaFreight = `ERP 운송료 ${freightTotal.toLocaleString('ko-KR')} CNY에서 박스비 분리 역산 초안`;
      notices.push({ level: 'warn', text: `ERP 운송료 행 ${freightTotal.toLocaleString('ko-KR')} CNY는 컨테이너 100% 원액과 박스비(${Math.round(boxes)}박스 × ${header.boxUnitPrice})가 합산된 값입니다. 그대로 쓰면 타사 몫까지 원가에 들어가므로, 인보이스 하단 서류·PROCESS·검역박스·SEA FREIGHT·로거·상차비로 분리해 CBM 지분율만큼만 안분합니다.` });
    } else notices.push({ level: 'warn', text: 'ERP 운송료가 0원입니다. 인보이스 하단 SEA FREIGHT(해상운임 원액)를 입력하거나 인보이스 서류를 불러오세요.' });
    notices.push({ level: 'info', text: 'ERP 입고상세의 BoxQuantity=1은 더미값이라 쓰지 않습니다. 박스비는 박스단가 ÷ 박스당단수로 행마다 계산합니다.' });
  }
  if ((source.excluded || []).some(row => /중국\s*total/i.test(row.name))) {
    notices.push({ level: rows.length === 0 ? 'warn' : 'info', text: rows.length === 0
      ? '이 전표는 HUB2(중국 TOTAL) 타사 혼적 총액 수동 전표여서 네노바 도착원가 대상 품목이 없습니다. 같은 BL의 네노바 HUBFRESH 입고를 선택하세요.'
      : 'HUB2 중국 TOTAL 수동 전표 행은 타사 혼적 총액이라 네노바 원가에서 제외했습니다.' });
  }
  const review = rows.filter(row => row.needsReview).length;
  if (review) notices.push({ level: 'warn', text: `미등록 품종 ${review}건 · 행의 카테고리를 선택하세요. 선택 전에는 임시 10단 규격으로 계산합니다.` });
  return { formulaVersion: CN_FORMULA_VERSION, mode, legacy, warehouseKey: source.warehouseKey ?? null,
    warehouseKeys: source.warehouseKeys ?? (source.warehouseKey ? [source.warehouseKey] : []),
    orderYear: source.orderYear ?? '', orderWeek: source.orderWeek ?? '',
    farmName: source.farmName ?? '', invoiceNo: source.invoiceNo ?? '', header, headerSources, rows, notices,
    excluded: source.excluded || [] };
}

// 사용자가 행 규격·카테고리를 바꿨을 때, 아직 수동 수정하지 않은 상단 자동파생 기본값(검역 품목수·허가증·규격표 CBM/박스수)을 함께 갱신한다.
export function reconcileCnAutoHeader(draft) {
  if (!draft) return draft;
  const header = { ...draft.header }, headerSources = { ...draft.headerSources };
  const rows = draft.rows || [];
  if (draft.mode === CN_MODES.CLOUD) {
    if (headerSources.quarantineCount !== '화면 수정값') {
      header.quarantineCount = new Set(rows.filter(r => Number(r.quantity) > 0).map(r => r.categoryCode)).size;
      headerSources.quarantineCount = '실제 입고 품목(카테고리) 수';
    }
    if (headerSources.orchidPermit !== '화면 수정값') {
      const hasOrchid = rows.some(r => Number(r.orchid) === 1 && Number(r.quantity) > 0);
      header.orchidPermit = hasOrchid ? 300 : 0;
      headerSources.orchidPermit = hasOrchid ? '호접란 포함 · 기본 300 CNY' : '호접란 없음 · 0';
    }
  } else {
    const nenovaCbm = round(rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.cbmPerBunch) || 0), 0), 4);
    const boxes = Math.round(rows.reduce((s, r) => s + (Number(r.bunchesPerBox) > 0 ? (Number(r.quantity) || 0) / Number(r.bunchesPerBox) : 0), 0));
    if (headerSources.nenovaCbm?.startsWith('규격표')) header.nenovaCbm = nenovaCbm;
    if (headerSources.realCbm?.startsWith('단독 컨테이너')) header.realCbm = header.nenovaCbm;
    if (headerSources.processBoxes === '규격표 역산 박스수') header.processBoxes = boxes;
    if (headerSources.quarantineBoxes === '규격표 역산 박스수') header.quarantineBoxes = boxes;
  }
  return { ...draft, header, headerSources };
}

// 사용자가 행 카테고리를 바꾸면 규격·관세율을 새 카테고리 표준값으로 다시 채운다(단당줄기수는 유지).
export function applyCnCategory(row, categoryCode, mode) {
  const base = cnRowDefaults(categoryCode, mode);
  if (!base) return row;
  return { ...row, ...base, needsReview: false, reviewReason: cnCategory(categoryCode)?.needsReview ? '구 항공 품종 · 규격 확인' : '' };
}

// 핵심 계산. 엑셀 수식과 1:1 같은 순서로 계산한다.
export function computeCnCost(input) {
  const mode = input.mode === CN_MODES.HUBFRESH ? CN_MODES.HUBFRESH : CN_MODES.CLOUD;
  const rawHeader = { ...CN_STANDARD_DEFAULTS[mode], ...(input.header || {}) };
  if (mode === CN_MODES.CLOUD && !Object.hasOwn(input.header || {}, 'allocationMode') && Object.hasOwn(input.header || {}, 'allocationBasisCbm')) {
    rawHeader.allocationMode = resolveAllocationMode(input.header);
  }
  const header = Object.fromEntries(Object.entries(rawHeader).map(([key, value]) => [key, num(value)]));
  const issues = [];
  for (const field of CN_HEADER_FIELDS[mode]) if (!Number.isFinite(header[field.key]) || header[field.key] < 0) issues.push({ key: field.key, text: `${field.label} 값을 0 이상의 숫자로 입력하세요.` });
  const rows = (input.rows || []).map(row => ({ ...row, quantity: num(row.quantity), fob: num(row.fob), bunchesPerBox: num(row.bunchesPerBox), cbmPerBunch: num(row.cbmPerBunch),
    weightKgPerBunch: num(row.weightKgPerBunch ?? 0), tariffRate: num(row.tariffRate), stemsPerBunch: num(row.stemsPerBunch), orchid: num(row.orchid ?? 0) ? 1 : 0 }));
  rows.forEach(row => {
    for (const key of ['quantity', 'fob', 'cbmPerBunch', 'tariffRate']) if (!Number.isFinite(row[key]) || row[key] < 0) issues.push({ lineId: row.lineId, text: `${row.name}: ${key} 값을 확인하세요.` });
    for (const key of ['bunchesPerBox', 'stemsPerBunch']) if (!(row[key] > 0)) issues.push({ lineId: row.lineId, text: `${row.name}: ${key === 'bunchesPerBox' ? '박스당단수' : '단당줄기수'}는 0보다 커야 합니다.` });
  });
  const totalQty = rows.reduce((sum, row) => sum + (row.quantity > 0 ? row.quantity : 0), 0);
  if (!(totalQty > 0)) issues.push({ text: '입고 수량 합계가 0입니다.' });
  if (issues.length) return { mode, header, rows: [], derived: null, totals: null, issues };
  const fx = header.exchangeRate, commission = header.commissionRate, margin = header.marginRate;
  if (margin >= 1) return { mode, header, rows: [], derived: null, totals: null, issues: [{ key: 'marginRate', text: '목표 마진율은 100% 미만이어야 합니다.' }] };
  const derived = { totalQty };
  let freightOf, extraOf, customsPerBunch;
  if (mode === CN_MODES.HUBFRESH) {
    if (!(header.nenovaCbm > 0) || !(header.realCbm > 0)) return { mode, header, rows: [], derived: null, totals: null, issues: [{ text: 'Nenova CBM과 Real CBM을 0보다 크게 입력하세요.' }] };
    derived.share = header.nenovaCbm / header.realCbm;
    derived.containerCharges = header.docFee + header.processUnit * header.processBoxes + header.quarantineBoxUnit * header.quarantineBoxes + header.seaFreight + header.logger + header.loading;
    derived.allocatedFreight = derived.containerCharges * derived.share;
    derived.rate = derived.allocatedFreight / header.nenovaCbm;
    derived.customsTotal = header.commonCustoms * derived.share + header.dedicatedCustoms;
    customsPerBunch = derived.customsTotal / totalQty;
    derived.customsPerBunch = customsPerBunch;
    derived.rowCbm = rows.reduce((sum, row) => sum + row.quantity * row.cbmPerBunch, 0);
    if (derived.share > 1 + 1e-9) issues.push({ key: 'realCbm', text: 'Nenova CBM이 컨테이너 전체 Real CBM보다 큽니다. 지분율이 100%를 넘지 않게 확인하세요.' });
    freightOf = row => row.cbmPerBunch * derived.rate;
    extraOf = row => header.boxUnitPrice / row.bunchesPerBox;
  } else {
    derived.useWeight = isCnWeightAllocation(header);
    derived.warehouseFee = header.warehouseFeeOverride > 0 ? header.warehouseFeeOverride : header.gw * header.warehousePerKg;
    derived.quarantineFee = header.quarantineCount * header.quarantinePerItem;
    derived.customsTotal = derived.warehouseFee + header.brokerage + derived.quarantineFee + header.domesticTransport + header.quarantineDeduct + header.disinfection;
    customsPerBunch = derived.customsTotal / totalQty;
    derived.customsPerBunch = customsPerBunch;
    derived.totalMetric = rows.reduce((sum, row) => sum + row.quantity * cnBasisMetric(row, header), 0);
    derived.orchidQty = rows.reduce((sum, row) => sum + row.quantity * row.orchid, 0);
    if (!(derived.totalMetric > 0)) return { mode, header, rows: [], derived: null, totals: null, issues: [{ text: '배분 기준(CBM 또는 중량) 합계가 0입니다. 행 규격을 확인하세요.' }] };
    derived.rate = header.airFreight / derived.totalMetric;
    freightOf = row => cnBasisMetric(row, header) * derived.rate;
    extraOf = row => derived.orchidQty > 0 ? row.orchid * header.orchidPermit / derived.orchidQty : 0;
  }
  const out = rows.map(row => {
    const extra = extraOf(row), freight = freightOf(row);
    const cnf = row.fob + extra + freight;
    const fee = cnf * commission * fx, cnfKrw = cnf * fx, duty = cnfKrw * row.tariffRate;
    const cost = fee + cnfKrw + duty + customsPerBunch;
    return { ...row, boxFee: mode === CN_MODES.HUBFRESH ? extra : 0, permit: mode === CN_MODES.CLOUD ? extra : 0, freight, cnf, fee, cnfKrw, duty,
      customs: customsPerBunch, cost, costPerStem: cost / row.stemsPerBunch, salePrice: cost / (1 - margin) * 1.1, totalCost: cost * row.quantity };
  });
  const sum = key => out.reduce((total, row) => total + row[key] * row.quantity, 0);
  const totals = { quantity: totalQty, fobCny: sum('fob'), freightCny: sum('freight'), boxFeeCny: sum('boxFee'), permitCny: sum('permit'),
    feeKrw: sum('fee'), cnfKrw: sum('cnfKrw'), dutyKrw: sum('duty'), customsKrw: sum('customs'), totalCostKrw: sum('cost') };
  return { mode, header, rows: out, derived, totals, issues };
}

// 서버 입력 정규화(화면 → API). 허용된 숫자 키만 받고 행 수를 제한한다.
export function normalizeCnPayload(payload) {
  if (!payload || typeof payload !== 'object') throw Object.assign(new Error('원가 입력값을 확인하세요.'), { statusCode: 400 });
  const mode = payload.mode === CN_MODES.HUBFRESH ? CN_MODES.HUBFRESH : payload.mode === CN_MODES.CLOUD ? CN_MODES.CLOUD : null;
  if (!mode) throw Object.assign(new Error('CLOUD 또는 HUBFRESH 모드를 선택하세요.'), { statusCode: 400 });
  const rawHeader = { ...CN_STANDARD_DEFAULTS[mode], ...(payload.header || {}) };
  if (mode === CN_MODES.CLOUD && !Object.hasOwn(payload.header || {}, 'allocationMode') && Object.hasOwn(payload.header || {}, 'allocationBasisCbm')) {
    rawHeader.allocationMode = resolveAllocationMode(payload.header);
  }
  const header = {};
  for (const field of CN_HEADER_FIELDS[mode]) header[field.key] = num(rawHeader[field.key]);
  if (!Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > 1000) throw Object.assign(new Error('품목 행은 1~1,000행이어야 합니다.'), { statusCode: 400 });
  const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, max);
  const rows = payload.rows.map((row, index) => ({ lineId: text(row.lineId || `row-${index + 1}`, 60), lineNo: index + 1, prodKey: row.prodKey ?? null,
    name: text(row.name, 200), categoryCode: cnCategory(row.categoryCode) ? row.categoryCode : 'MANUAL_STANDARD', quantity: num(row.quantity), fob: num(row.fob),
    bunchesPerBox: num(row.bunchesPerBox), cbmPerBunch: num(row.cbmPerBunch), weightKgPerBunch: num(row.weightKgPerBunch ?? 0), tariffRate: num(row.tariffRate),
    stemsPerBunch: num(row.stemsPerBunch), orchid: num(row.orchid ?? 0) ? 1 : 0, needsReview: !!row.needsReview }));
  const warehouseKeys = Array.isArray(payload.warehouseKeys)
    ? payload.warehouseKeys.map(Number).filter(n => Number.isSafeInteger(n) && n > 0).slice(0, 50)
    : [];
  const meta = { warehouseKey: Number.isSafeInteger(Number(payload.warehouseKey)) ? Number(payload.warehouseKey) : (warehouseKeys[0] ?? null),
    warehouseKeys, orderYear: text(payload.orderYear, 4), orderWeek: text(payload.orderWeek, 8), farmName: text(payload.farmName, 120), invoiceNo: text(payload.invoiceNo, 80) };
  return { mode, header, rows, ...meta };
}
