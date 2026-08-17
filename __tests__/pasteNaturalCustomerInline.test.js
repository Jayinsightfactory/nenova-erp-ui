// 실행: node __tests__/pasteNaturalCustomerInline.test.js

async function main() {
  const { parseNaturalInlineOrderLine, parseNaturalSectionActionLine, stripTrailingOrderMemo } = await import('../lib/pasteNaturalInlineOrder.js');
  const { resolveImportCustomer } = await import('../lib/orderImportCustomerMatch.js');
  const assert = (condition, message) => { if (!condition) throw new Error(message); };

  const inline = parseNaturalInlineOrderLine('남대문 중앙 - 블루 1박스 취소');
  assert(inline?.customerName === '남대문 중앙', `업체명 파싱 실패: ${inline?.customerName}`);
  assert(inline?.productName === '블루', `품목 파싱 실패: ${inline?.productName}`);
  assert(inline?.quantityText === '1' && inline?.unitText === '박스' && inline?.action === '취소', '수량/단위/동작 파싱 실패');
  assert(parseNaturalInlineOrderLine('남대문-중앙') === null, '업체명 내부 하이픈을 구분자로 오인');
  assert(parseNaturalInlineOrderLine('일요일 출고건 입니다.') === null, '출고 메모를 주문행으로 오인');

  const proudMemo = stripTrailingOrderMemo('프라우드 10단 취소 (밀라그로)');
  assert(proudMemo === '프라우드 10단 취소', `동작 뒤 농장 메모 제거 실패: ${proudMemo}`);
  assert(stripTrailingOrderMemo('프라우드 10단 추가 (밀라그로) (농장확인)') === '프라우드 10단 추가', '연속 괄호 메모 제거 실패');

  const roseLines = [
    '비스위트 10단 취소', '코랄리프 10단 취소', '프리덤 10단 취소', '프라우드 10단 취소 (밀라그로)',
    '브라이튼 10단 취소', '만달라 20단 취소',
    '비스위트 10단 추가', '코랄리프 10단 추가', '프리덤 10단 추가',
    '브라이튼 10단 추가', '만달라 20단 추가', '프라우드 10단 추가 (밀라그로)',
  ].map(parseNaturalSectionActionLine);
  assert(roseLines.every(Boolean) && roseLines.length === 12, '취소 6건+추가 6건이 모두 분석되어야 함');
  assert(roseLines.filter(row => row.action === '취소').length === 6, '취소는 6건이어야 함');
  assert(roseLines.filter(row => row.action === '추가').length === 6, '추가는 6건이어야 함');
  assert(roseLines[3].productName === '프라우드' && roseLines[11].productName === '프라우드', '괄호 메모는 프라우드 품목명에서 제외되어야 함');

  const matched = resolveImportCustomer('남대문 중앙', [
    { CustKey: 75, CustName: '남대문-중앙', CustCode: '', OrderCode: '', CustArea: '' },
  ], { savedMappings: {} });
  assert(matched.custKey === 75, `공백/하이픈 업체 매칭 실패: ${matched.custKey}`);
  assert(matched.confidenceLabel === 'high', `업체 매칭 신뢰도 실패: ${matched.confidenceLabel}`);
  console.log('paste natural customer inline tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
