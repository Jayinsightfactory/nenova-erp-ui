// lib/pivotFieldRegistry.js
// Pivot 통계 필드 레지스트리 — exe DevExpress PivotGrid "Field List" 대응.

export const ZONES = [
  { id: 'row',    label: '행' },
  { id: 'column', label: '열' },
  { id: 'filter', label: '필터' },
  { id: 'data',   label: '값(측정)' },
];

// 구분(섹션) 열 필드 — columnZone 배치 시 해당 섹션 표시
export const SECTION_FIELDS = [
  { id: 'secPrev',     label: '01.전재고', sectionKey: 'prev' },
  { id: 'secOrder',    label: '02.주문',   sectionKey: 'order' },
  { id: 'secIncoming', label: '03.입고',   sectionKey: 'incoming' },
  { id: 'secOut',      label: '04.출고',   sectionKey: 'out' },
  { id: 'secNone',     label: '03.미발주', sectionKey: 'none' },
  { id: 'secCur',      label: '05.현재고', sectionKey: 'cur' },
];

export const SECTION_BY_ID = Object.fromEntries(SECTION_FIELDS.map((f) => [f.id, f]));

export const PIVOT_FIELDS = [
  // ── 행(Row) 차원 ──────────────────────────────────────────
  { id: 'country',  label: '국가',         dataKey: 'country',  zone: 'row', kind: 'dim', locked: true,  filterable: true },
  { id: 'flower',   label: '꽃',           dataKey: 'flower',   zone: 'row', kind: 'dim', locked: true,  filterable: true },
  { id: 'prodName', label: '품목명(색상)', dataKey: 'prodName', zone: 'row', kind: 'dim', locked: true,  filterable: true },
  { id: 'area',     label: '지역',         dataKey: 'area',     zone: 'row', kind: 'dim', filterable: true, columnGroup: true },
  { id: 'outDate',  label: '출고일',       dataKey: 'outDate',  zone: 'row', kind: 'dim', filterable: true },
  { id: 'inPrice',  label: '입고단가',     dataKey: 'inPrice',  zone: 'row', kind: 'dim', numeric: true },
  { id: 'inTotal',  label: '입고총단가',   dataKey: 'inTotal',  zone: 'row', kind: 'dim', numeric: true },
  { id: 'awb',      label: 'AWB',          dataKey: 'awb',      zone: 'row', kind: 'dim', filterable: true },
  { id: 'descr',    label: '비고',         dataKey: 'descr',    zone: 'row', kind: 'dim', filterable: true, columnGroup: true },
  // ── 열(Column) 차원 ───────────────────────────────────────
  ...SECTION_FIELDS.map((s) => ({ ...s, zone: 'column', kind: 'dim' })),
  { id: 'custName', label: '거래처명', dataKey: null, zone: 'column', kind: 'dim', columnGroup: true, filterable: true },
  { id: 'farmName', label: '농장명',   dataKey: null, zone: 'column', kind: 'dim', filterable: true },
  // ── 값(Data) 측정 ─────────────────────────────────────────
  { id: 'qty',         label: '수량',     dataKey: 'totalOrder',     zone: 'data', kind: 'measure' },
  { id: 'saleCost',    label: '판매단가', dataKey: 'costOrders',     zone: 'data', kind: 'measure' },
  { id: 'distCost',    label: '분배단가', dataKey: 'distCostOrders', zone: 'data', kind: 'measure' },
  { id: 'arrivalCost', label: '도착원가', dataKey: 'arrivalCost',    zone: 'data', kind: 'measure', fixedCol: true },
  { id: 'amount',      label: '판매금액', dataKey: null,             zone: 'data', kind: 'measure', fixedCol: true },
];

export const FIELD_BY_ID = Object.fromEntries(PIVOT_FIELDS.map((f) => [f.id, f]));

export const DEFAULT_COLUMN_ZONE = [
  'secPrev', 'secOrder', 'area', 'descr', 'custName',
  'secIncoming', 'farmName', 'secOut', 'secNone', 'secCur',
];

export const DEFAULT_LAYOUT = {
  row:    PIVOT_FIELDS.filter((f) => f.zone === 'row').map((f) => f.id),
  column: DEFAULT_COLUMN_ZONE,
  filter: [],
  data:   ['qty'],
};

// colGroupOrder 라벨 ↔ 필드 id (02.주문 열 그룹 계층)
export const COL_GROUP_FIELD_MAP = { '지역': 'area', '비고': 'descr', '거래처명': 'custName' };
export const COL_GROUP_LABELS = ['지역', '비고', '거래처명'];
export const COL_GROUP_IDS = ['area', 'descr', 'custName'];

// columnZone → showSections 파생
export function sectionsFromColumnZone(columnZone) {
  const cz = columnZone || [];
  return {
    prev:     cz.includes('secPrev'),
    order:    cz.includes('secOrder') || cz.includes('custName'),
    incoming: cz.includes('secIncoming') || cz.includes('farmName'),
    out:      cz.includes('secOut'),
    none:     cz.includes('secNone'),
    cur:      cz.includes('secCur'),
  };
}

// showSections(레거시) → columnZone 복원
export function columnZoneFromSections(showSections, colGroupOrder) {
  const z = [];
  if (showSections?.prev)     z.push('secPrev');
  if (showSections?.order)    z.push('secOrder');
  if (showSections?.incoming) z.push('secIncoming');
  if (showSections?.out)      z.push('secOut');
  if (showSections?.none)     z.push('secNone');
  if (showSections?.cur)      z.push('secCur');
  const cg = colGroupOrder || COL_GROUP_LABELS;
  if (cg.includes('지역'))   z.push('area');
  if (cg.includes('비고'))   z.push('descr');
  if (showSections?.order !== false) z.push('custName');
  if (showSections?.incoming !== false) z.push('farmName');
  return [...new Set(z)];
}

export function canDropInZone(fieldId, zoneId) {
  const f = FIELD_BY_ID[fieldId];
  if (!f) return false;
  if (f.locked) return zoneId === 'row';
  if (zoneId === 'filter') {
    return !!(f.filterable || f.dataKey || fieldId === 'custName' || fieldId === 'farmName');
  }
  if (zoneId === 'row') {
    return f.zone === 'row' || !!(f.kind === 'measure' && f.fixedCol);
  }
  if (zoneId === 'column') {
    return f.zone === 'column' || !!f.columnGroup;
  }
  if (zoneId === 'data') return f.kind === 'measure';
  return false;
}
