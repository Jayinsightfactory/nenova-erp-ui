// 승인요청 상태기계(순수 로직, DB 의존 없음). ECOUNT 이관 Outbox 설계와 같은 상태 의미(설계 §6).
export const APPROVAL_STATUS = ['draft', 'requested', 'approved', 'rejected', 'applied', 'cancelled'];

export const APPROVAL_TRANSITIONS = {
  draft: ['requested', 'cancelled'],
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['applied', 'cancelled'],
  rejected: [],
  applied: [],
  cancelled: [],
};

export function canTransition(from, to) {
  return Boolean(APPROVAL_TRANSITIONS[from]?.includes(to));
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new Error(`승인 상태 전환 불가: ${from} → ${to}`);
}

// 요청자와 결정자는 달라야 한다(이중승인 최소 규칙).
export function assertSeparationOfDuty(request, actorId, to) {
  if ((to === 'approved' || to === 'rejected') && request.RequestedBy && request.RequestedBy === actorId) {
    throw new Error('요청자 본인은 승인/반려할 수 없습니다.');
  }
}
