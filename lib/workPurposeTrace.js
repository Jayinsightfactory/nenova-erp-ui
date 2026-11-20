// lib/workPurposeTrace.js — 목적 우선 트레이스 도면(components/work/PurposeFlowTrace)에 들어가는 부서·파이프라인 데이터.
// 단계의 manualId 는 data/*handover*.json 의 매뉴얼 id 와 일치해야 하며(__tests__/purposeFlowTrace.test.js 가 검사),
// 단계를 누르면 /work/manuals 가 그 매뉴얼을 연다. 사람 이름·평가 문구는 넣지 않는다.

// 부서별 핵심 목적(왜 하는가 · 막는 문제 · 끝났을 때 남는 것) + 대표 업무 단계
export const DEPT_PURPOSE_TRACES = Object.freeze({
  import: {
    purpose: {
      headline: '농장 인보이스가 전산 입고 · 원가 · 영업 판매가까지 같은 숫자로 이어지게 해, 수량 오차와 원가 누락으로 생기는 손실을 막습니다.',
      prevents: '인보이스와 입고 수량이 어긋나는 일, 통관 지연, 원가자료 누락으로 판매가를 잘못 정하는 일',
      outcome: '차수별 입고 등록 완료 + 수입방에 공유된 원가자료 + 지출결의서',
    },
    busLabel: '서류에서 원가 · 결제로 이어지는 흐름',
    steps: [
      { id: 'packing', manualId: 'packing-list-from-invoice', surface: '수입부 · 서류', title: '패킹리스트 만들기', goal: '농장 인보이스 PDF를 입고용 엑셀로 바꿉니다', token: '인보이스 · Packing List' },
      { id: 'upload', manualId: 'incoming-upload', surface: '수입부 · 전산', title: '입고 등록', goal: '원장 합계가 인보이스와 같은지 맞춥니다', token: '입고 관리 · 업로드' },
      { id: 'customs', manualId: 'customs-docs', surface: '수입부 · 통관', title: '통관 서류 · 도착 공지', goal: '관세법인과 현장이 도착 시각을 미리 압니다', token: 'AWB · 검역증' },
      { id: 'cost', manualId: 'cost-sheet', surface: '수입부 · 원가', title: '원가자료 · 수입방 공유', goal: '영업이 판매가를 정할 도착원가를 올립니다', token: '단가 + 운임 + 통관' },
      { id: 'payment', manualId: 'payment-request', surface: '수입부 · 결제', title: '지출결의서 작성', goal: '해외 대금이 차수 · 업체별로 송금되게 합니다', token: '차수 · 나라 · 업체' },
    ],
  },
  'sales-support': {
    purpose: {
      headline: '거래처 주문이 전산 · 출고 분배 · 견적서까지 한 숫자로 이어지게 해, 출고 오류와 견적 금액이 틀어지는 일을 막습니다.',
      prevents: '주문 누락과 차수 착오, 변경 · 취소가 현장에 전달되지 않는 일, 견적 금액과 판매등록 금액 불일치',
      outcome: '확정된 견적서 + 경영지원에 넘긴 판매등록 · 세금계산서 요청',
    },
    busLabel: '주문에서 견적 · 판매등록으로 이어지는 흐름',
    steps: [
      { id: 'order', manualId: 'customer-order-entry', surface: '영업지원 · 주문', title: '거래처 주문 입력', goal: '카톡 주문을 전산 신규 주문으로 넣습니다', token: '차수 · 거래처 · 수량' },
      { id: 'distribute', manualId: 'shipment-distribution', surface: '영업지원 · 출고', title: '입고 물량 출고 분배', goal: '들어온 물량을 거래처별로 나눕니다', token: '출고 분배 · 재고' },
      { id: 'relay', manualId: 'field-change-relay', surface: '영업지원 · 현장', title: '변경 · 취소 현장 전달', goal: '전산과 현장 추가취소방을 같은 값으로 맞춥니다', token: '추가취소방 · 전산' },
      { id: 'estimate', manualId: 'estimate-confirm', surface: '영업지원 · 견적', title: '견적서 확인 · 차수 확정', goal: '단가와 차감을 확인하고 차수를 확정합니다', token: '견적서 · 확정' },
      { id: 'registration', manualId: 'sales-registration-request', surface: '영업지원 · 정산', title: '판매등록 · 세금계산서 요청', goal: '경영지원 매출액과 견적 합계를 대조합니다', token: '이카운트 · 대조' },
    ],
  },
  sales: {
    purpose: {
      headline: '거래처 요청이 정확한 차수 · 수량으로 수입부와 현장에 전해지게 해, 발주 누락과 출고 착오를 막고 판매 기회를 지킵니다.',
      prevents: '거래처가 다른 품목 · 수량을 받는 일, 이미 나간 박스를 회수하는 일, 불량차감 누락으로 견적이 틀어지는 일',
      outcome: '전산에 입력된 주문 + 수입방 · 영업방에 올라간 변경 글 + 확인된 견적서',
    },
    busLabel: '주문에서 출고 · 견적으로 이어지는 흐름',
    steps: [
      { id: 'erp', manualId: 'customer-order-to-erp', surface: '영업부 · 주문', title: '거래처 주문 전산 입력', goal: '카톡 주문을 전산 신규 주문으로 옮깁니다', token: '신규 주문 등록' },
      { id: 'import-room', manualId: 'import-room-add-cancel', surface: '영업부 · 수입방', title: '발주 추가 · 취소 알림', goal: '수입부가 농장에 정확히 발주하게 알립니다', token: '차수 · 코드 · 수량' },
      { id: 'notice', manualId: 'ship-change-notice', surface: '영업부 · 영업방', title: '변경사항 글 올리기', goal: '출고 거래처 · 수량 · 출고일 변경을 알립니다', token: '영업방 · 변경사항' },
      { id: 'dispatch', manualId: 'dispatch-share', surface: '영업부 · 출고', title: '출고 내역서 · 배차 공유', goal: '지방 출고 박스 수를 현장에 미리 알립니다', token: '출고 내역서 · 배차' },
      { id: 'quote', manualId: 'quote-check-print', surface: '영업부 · 견적', title: '견적서 확인 · 출력', goal: '거래처에 가는 마지막 금액을 확인합니다', token: '단가 · 차감 · 합계' },
    ],
  },
  management: {
    purpose: {
      headline: '송금 · 매출 · 세금계산서가 인보이스와 이카운트 금액에 맞게 마감되게 해, 이중 송금과 미수금 누락을 막습니다.',
      prevents: '인보이스와 입고 수량이 다른 채 송금하는 일, 입출금에 거래처가 비는 일, 세금계산서와 판매 합계 불일치',
      outcome: '대조가 끝난 송금 · 이카운트 대사 + 발행된 세금계산서 + 채권 원장',
    },
    busLabel: '송금에서 매출 · 계산서로 이어지는 흐름',
    steps: [
      { id: 'invoice', manualId: 'invoice-incoming-check', surface: '경영지원 · 서류', title: '인보이스와 입고 수량 대조', goal: '송금 전에 번호 · 박스 · 금액을 전산과 맞춥니다', token: '인보이스 · 입고' },
      { id: 'remit', manualId: 'farm-remittance', surface: '경영지원 · 송금', title: '해외 농장 송금', goal: '월 결제표를 지출결의서와 은행 신청으로 잇습니다', token: '지출결의서 · 송금증' },
      { id: 'bank', manualId: 'bank-ecount-matching', surface: '경영지원 · 대사', title: '입출금 미반영 대사', goal: '거래처가 빈 입출금 줄에 거래처를 붙입니다', token: '이카운트 · 입금보고서' },
      { id: 'weekly', manualId: 'weekly-sales-total', surface: '경영지원 · 매출', title: '차수 매출액 합계 확인', goal: '이카운트 금액과 영업 집계를 맞춥니다', token: '종합견적서 · 합계' },
      { id: 'tax', manualId: 'tax-invoice-issue', surface: '경영지원 · 계산서', title: '세금계산서 발행', goal: '판매 합계와 같은 금액으로 발행합니다', token: '세금계산서 · PDF' },
    ],
  },
});

// 부서 설정이 아직 없을 때(새 부서) — 인수인계 자료의 첫 매뉴얼 5개로 도면을 만든다.
export function resolveDeptTrace(deptId, handoverData, deptName = '') {
  const manuals = Array.isArray(handoverData?.manuals) ? handoverData.manuals : [];
  const byId = new Set(manuals.map((m) => m.id));
  const preset = DEPT_PURPOSE_TRACES[deptId];
  if (preset) {
    const steps = preset.steps.filter((s) => !manuals.length || byId.has(s.manualId));
    if (steps.length >= 2) return { purpose: preset.purpose, busLabel: preset.busLabel, steps };
  }
  const picked = [...manuals].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)).slice(0, 5);
  if (picked.length < 2) return null;
  const name = deptName || handoverData?.dept || '이 부서';
  return {
    purpose: {
      headline: `${name} 업무가 순서대로 빠짐없이 끝나게 해, 다음 부서로 넘기는 숫자와 서류가 틀어지는 일을 막습니다.`,
      prevents: '앞 단계 확인 없이 다음 단계로 넘어가 생기는 수량 · 금액 불일치',
      outcome: `${name} 대표 업무 ${picked.length}단계 완료`,
    },
    busLabel: '다음 줄 단계로 이어지는 흐름',
    steps: picked.map((m, i) => ({
      id: m.id,
      manualId: m.id,
      surface: `${name} · ${i + 1}단계`,
      title: m.title,
      goal: m.oneLine || m.why || m.title,
      token: Array.isArray(m.screens) && m.screens[0] ? String(m.screens[0]) : m.title,
    })),
  };
}

// 수입 원스톱 파이프라인(/import/pipeline) — 단계 id 는 lib/importOneStopPipeline.js PIPELINE_STEPS 와 같다(1~4).
export const IMPORT_PIPELINE_PURPOSE = Object.freeze({
  headline: '인보이스 확인 → 입고 검수 → 도착원가 확정 → 공유까지 화면 왕복을 없애고 원가 조기 확정으로 영업 마진을 방어',
  prevents: '단계마다 화면을 오가다 수량 · 원가가 어긋나는 일, 도착원가 확정이 늦어 영업이 판매가를 잘못 정하는 일',
  outcome: '차수 입고 검수 완료 + 승인된 도착원가 + 영업에 공유된 요약문',
});

export const IMPORT_PIPELINE_TRACE_STEPS = Object.freeze([
  { id: 1, surface: '수입부 · 인보이스', title: '인보이스 · 패킹 확인', goal: '농장 인보이스와 품목 매칭을 먼저 맞춥니다', token: 'invoice · packing list' },
  { id: 2, surface: '수입부 · 입고', title: '입고 업로드 · 검수', goal: '발주 · 입고 · 분배 수량을 원장과 대조합니다', token: '발주 = 입고 = 분배' },
  { id: 3, surface: '수입부 · 원가', title: '도착원가 산출 · 확정', goal: '원가를 일찍 확정해 영업 마진 기준을 만듭니다', token: 'arrival cost · 승인' },
  { id: 4, surface: '수입부 · 공유', title: '카톡 요약복사 · 드라이브', goal: '확정 결과를 영업에 같은 숫자로 전달합니다', token: '요약문 복사 · 드라이브' },
]);
