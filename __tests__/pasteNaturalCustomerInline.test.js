// 실행: node __tests__/pasteNaturalCustomerInline.test.js

async function main() {
  const { parseNaturalInlineOrderLine } = await import('../lib/pasteNaturalInlineOrder.js');
  const { resolveImportCustomer } = await import('../lib/orderImportCustomerMatch.js');
  const assert = (condition, message) => { if (!condition) throw new Error(message); };

  const inline = parseNaturalInlineOrderLine('남대문 중앙 - 블루 1박스 취소');
  assert(inline?.customerName === '남대문 중앙', `업체명 파싱 실패: ${inline?.customerName}`);
  assert(inline?.productName === '블루', `품목 파싱 실패: ${inline?.productName}`);
  assert(inline?.quantityText === '1' && inline?.unitText === '박스' && inline?.action === '취소', '수량/단위/동작 파싱 실패');
  assert(parseNaturalInlineOrderLine('남대문-중앙') === null, '업체명 내부 하이픈을 구분자로 오인');
  assert(parseNaturalInlineOrderLine('일요일 출고건 입니다.') === null, '출고 메모를 주문행으로 오인');

  const matched = resolveImportCustomer('남대문 중앙', [
    { CustKey: 75, CustName: '남대문-중앙', CustCode: '', OrderCode: '', CustArea: '' },
  ], { savedMappings: {} });
  assert(matched.custKey === 75, `공백/하이픈 업체 매칭 실패: ${matched.custKey}`);
  assert(matched.confidenceLabel === 'high', `업체 매칭 신뢰도 실패: ${matched.confidenceLabel}`);
  console.log('paste natural customer inline tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
