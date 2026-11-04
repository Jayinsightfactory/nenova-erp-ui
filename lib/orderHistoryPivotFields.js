// FormOrderHistory pivot field registry (see docs/PIVOT_EXE_DEVEXPRESS_LAYOUT_SPEC.md section 1).
export const ORDER_HISTORY_FIELDS = [
  { id: 'CounName', label: '국가', numeric: false },
  { id: 'FlowerName', label: '꽃', numeric: false },
  { id: 'ProdName', label: '품목명(색상)', numeric: false },
  { id: 'OrderCode', label: 'C.N.', numeric: false },
  { id: 'ChangeDtm', label: '입력일자', numeric: false },
  { id: 'AfterValue', label: '변경수량', numeric: true },
  { id: 'OrderWeek', label: '주문주차', numeric: false },
  { id: 'CustName', label: '거래처명', numeric: false },
  { id: 'OutUnit', label: '단위', numeric: false },
];

export const ORDER_HISTORY_DEFAULT_LAYOUT = Object.freeze({
  row: ['CounName', 'FlowerName', 'ProdName', 'OrderCode'],
  column: ['ChangeDtm'],
  data: ['AfterValue'],
  filter: ['OrderWeek', 'CustName', 'OutUnit'],
});
