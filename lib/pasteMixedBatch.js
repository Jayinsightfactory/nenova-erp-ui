// 붙여넣기 주문등록의 혼합 추가/취소 일괄 처리 순서 계약.
//
// 기존 단건 API 정책은 그대로 두고, 한 번의 실행 안에서 취소를 모두 처리한 뒤
// 추가를 처리하도록 안정적으로 순서만 나눈다. 같은 단계 안에서는 입력 순서를 보존한다.

export function pasteBatchActionType(item) {
  return item?.action === '취소' ? 'CANCEL' : 'ADD';
}

export function pasteBatchRetryKey(item) {
  return `${Number(item?.prodKey)}:${pasteBatchActionType(item)}`;
}

export function orderPasteMixedBatchTargets(items = []) {
  const cancelTargets = [];
  const addTargets = [];

  items.forEach((item) => {
    if (pasteBatchActionType(item) === 'CANCEL') cancelTargets.push(item);
    else addTargets.push(item);
  });

  return [...cancelTargets, ...addTargets];
}
