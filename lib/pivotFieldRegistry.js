// lib/pivotFieldRegistry.js
// Pivot 통계 필드 레지스트리 — exe DevExpress PivotGrid "Field List" 대응.
//
// exe 의 「업체별 품목 통계」는 DevExpress PivotGrid 라 각 필드를
// 행(Row) / 열(Column) / 필터(Filter) / 값(Data) 영역으로 드래그한다.
// 웹은 자체 구현이라, 여기서 모든 필드의 메타(라벨/데이터키/기본영역/잠금)만 선언하고
// 실제 영역 배치·토글은 pages/stats/pivot.js 가 기존 state(showXxx/viewMode/showSections/filters)에
// 매핑해 구동한다. 이 모듈은 DB/번들러 의존 없는 순수 데이터 → node 단독 import 가능.
//
// kind:'dim'     — 차원(행/열/필터에 놓는 그룹/속성)
// kind:'measure' — 측정값(값 영역. 수량/단가/원가)
// locked:true    — 행 고정(국가/꽃/품목명) 또는 열 고정(구분) — 제거 불가
// filterable     — 필터 영역에도 드롭 가능(값 체크 필터)
// fixedCol       — 측정값이지만 품목당 단일값이라 좌측 고정열로 렌더(입고단가·도착원가·판매금액)

export const ZONES = [
  { id: 'row',    label: '행' },
  { id: 'column', label: '열' },
  { id: 'filter', label: '필터' },
  { id: 'data',   label: '값(측정)' },
];

export const PIVOT_FIELDS = [
  // ── 행(Row) 차원 ──────────────────────────────────────────
  { id: 'country',  label: '국가',         dataKey: 'country',  zone: 'row', kind: 'dim', locked: true,  filterable: true },
  { id: 'flower',   label: '꽃',           dataKey: 'flower',   zone: 'row', kind: 'dim', locked: true,  filterable: true },
  { id: 'prodName', label: '품목명(색상)', dataKey: 'prodName', zone: 'row', kind: 'dim', locked: true,  filterable: true },
  { id: 'area',     label: '지역',         dataKey: 'area',     zone: 'row', kind: 'dim', filterable: true },
  { id: 'outDate',  label: '출고일',       dataKey: 'outDate',  zone: 'row', kind: 'dim', filterable: true },
  { id: 'inPrice',  label: '입고단가',     dataKey: 'inPrice',  zone: 'row', kind: 'dim', numeric: true },
  { id: 'inTotal',  label: '입고총단가',   dataKey: 'inTotal',  zone: 'row', kind: 'dim', numeric: true },
  { id: 'awb',      label: 'AWB',          dataKey: 'awb',      zone: 'row', kind: 'dim', filterable: true },
  { id: 'descr',    label: '비고',         dataKey: 'descr',    zone: 'row', kind: 'dim', filterable: true },
  // ── 열(Column) 차원 ───────────────────────────────────────
  { id: 'custName', label: '거래처명',     dataKey: null,       zone: 'column', kind: 'dim' },   // detail 전개 = orders 키
  { id: 'farmName', label: '농장명',       dataKey: null,       zone: 'column', kind: 'dim' },   // detail 전개 = incoming 키
  { id: 'section',  label: '구분',         dataKey: null,       zone: 'column', kind: 'dim', locked: true }, // showSections
  // ── 값(Data) 측정 ─────────────────────────────────────────
  { id: 'qty',         label: '수량',     dataKey: 'totalOrder',     zone: 'data', kind: 'measure' },
  { id: 'saleCost',    label: '판매단가', dataKey: 'costOrders',     zone: 'data', kind: 'measure' },
  { id: 'distCost',    label: '분배단가', dataKey: 'distCostOrders', zone: 'data', kind: 'measure' },
  { id: 'arrivalCost', label: '도착원가', dataKey: 'arrivalCost',    zone: 'data', kind: 'measure', fixedCol: true }, // /freight displayArrivalKRW 동치
  { id: 'amount',      label: '판매금액', dataKey: null,             zone: 'data', kind: 'measure', fixedCol: true },
];

export const FIELD_BY_ID = Object.fromEntries(PIVOT_FIELDS.map((f) => [f.id, f]));

// 기본 레이아웃 — 각 필드의 zone 기준. filter 는 비어있고, data 는 수량만 기본 활성.
export const DEFAULT_LAYOUT = {
  row:    PIVOT_FIELDS.filter((f) => f.zone === 'row').map((f) => f.id),
  column: PIVOT_FIELDS.filter((f) => f.zone === 'column').map((f) => f.id),
  filter: [],
  data:   ['qty'],
};

// 필드가 특정 영역에 드롭 가능한지
export function canDropInZone(fieldId, zoneId) {
  const f = FIELD_BY_ID[fieldId];
  if (!f) return false;
  if (f.locked) return zoneId === f.zone;
  if (zoneId === 'filter') return f.kind === 'dim' && !!f.dataKey;
  if (zoneId === 'row') return f.zone === 'row' || !!f.fixedCol;
  if (zoneId === 'column') return f.zone === 'column';
  if (zoneId === 'data') return f.kind === 'measure';
  return false;
}

// colGroupOrder 라벨 ↔ 필드 id
export const COL_GROUP_FIELD_MAP = { '지역': 'area', '비고': 'descr', '거래처명': 'custName' };
export const COL_GROUP_LABELS = ['지역', '비고', '거래처명'];
