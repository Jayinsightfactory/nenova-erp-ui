// Field names and order: Nenova.FormCustomerInfo / FormCustomerAdd.
export const CUSTOMER_FIELDS = [
  ['CustCode', '거래처코드'], ['CustName', '거래처명'], ['Group1', '거래처그룹'],
  ['CustArea', '거래처지역'], ['BusinessNumber', '사업자번호'], ['CEO', '대표자명'],
  ['Manager', '담당자'], ['ProductType', '품목분류'], ['Tel', '전화'],
  ['Mobile', '모바일'], ['OrderCode', '거래처주문코드'], ['BaseOutDay', '기본출고요일'],
  ['Descr', '비고'],
];
export const CUSTOMER_COLUMNS = [
  ['CustKey', '거래처번호'], ['CustCode', '거래처코드'], ['CustName', '거래처명'],
  ['CustArea', '지역'], ['CEO', '대표자명'], ['BusinessNumber', '사업자번호'],
  ['Manager', '담당자'], ['Tel', '전화'], ['Mobile', '모바일'],
  ['BaseOutDay', '기본출고요일'], ['OrderCode', '거래처주문코드'], ['Descr', '비고'],
];
export const CUSTOMER_WEEKDAYS = ['', '일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
export const CUSTOMER_LIMITS = { CustCode: 100, CustName: 100, CEO: 50, Group1: 50, CustArea: 50, BusinessNumber: 20, Manager: 50, ProductType: 20, Tel: 50, Mobile: 50, OrderCode: 20, Descr: 200 };
export function customerDraft(row = {}) {
  return Object.fromEntries(CUSTOMER_FIELDS.map(([key]) => [key, row[key] ?? (key === 'BaseOutDay' ? 0 : '')]));
}
export function validateCustomerDraft(value) {
  const draft = customerDraft(value);
  if (!String(draft.CustName).trim()) throw new Error('거래처명을 입력해 주세요.');
  draft.BaseOutDay = Number(draft.BaseOutDay);
  if (!Number.isInteger(draft.BaseOutDay) || draft.BaseOutDay < 0 || draft.BaseOutDay > 7) throw new Error('기본출고요일을 확인해 주세요.');
  for (const [key] of CUSTOMER_FIELDS) {
    if (key !== 'BaseOutDay' && typeof draft[key] !== 'string') throw new Error('입력값 형식을 확인해 주세요.');
    if (CUSTOMER_LIMITS[key] && draft[key].length > CUSTOMER_LIMITS[key]) throw new Error(`${CUSTOMER_FIELDS.find(([field]) => field === key)[1]}: ${CUSTOMER_LIMITS[key]}자 이내로 입력해 주세요.`);
  }
  return draft;
}
export function customerCell(row, key) {
  return key === 'BaseOutDay' ? CUSTOMER_WEEKDAYS[Number(row[key])] || '' : String(row[key] ?? '');
}
export function filterCustomers(rows, search, filters, sort) {
  const norm = v => String(v ?? '').toLocaleLowerCase('ko').trim();
  const found = rows.filter(row => {
    const matchesSearch = !norm(search) || CUSTOMER_FIELDS.some(([key]) => norm(customerCell(row, key)).includes(norm(search)));
    return matchesSearch && Object.entries(filters).every(([key, text]) => !norm(text) || norm(customerCell(row, key)).includes(norm(text)));
  });
  return found.sort((a, b) => (sort.key === 'CustKey' ? Number(a.CustKey) - Number(b.CustKey)
    : customerCell(a, sort.key).localeCompare(customerCell(b, sort.key), 'ko', { numeric: true })) * sort.direction);
}
