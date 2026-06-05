// lib/workflowConfig.js
// nenovakakao 업무플로우 파이프라인 모델 — pipeline_config.json(2026-04-11) 이식.
// 단계(IMPORT→…→SYSTEM) / 이벤트타입 / 핵심 인물(역할·단계) / 방→단계 매핑.

export const PIPELINE_STAGES = [
  { key: 'IMPORT', name: '수입/입고', rooms: ['수입방', '네노바&선울', '3.미우신라방'] },
  { key: 'QC', name: '검수/불량', rooms: ['네노바 수입(불량 공유방)', '불량'] },
  { key: 'INVENTORY', name: '재고/입고수량', rooms: ['발번호및 입고수량확인방', '백상'] },
  { key: 'ORDER', name: '발주/영업', rooms: ['영업방팀 발주 및 추가 재고확인', '견적방', '영업지원팀'] },
  { key: 'DISTRIBUTE', name: '출고/분배', rooms: ['주님방', '현장단체방', '현장 추가취소방', '네노바현장팀'] },
  { key: 'FIELD', name: '현장/방역', rooms: ['한국방역'] },
  { key: 'SYSTEM', name: '시스템/테스트', rooms: ['전산테스트팀'] },
];

export const STAGE_ORDER = PIPELINE_STAGES.map(s => s.key);

export const EVENT_TYPES = {
  DEFECT: '불량 보고', CLAIM: '클레임', ORDER_NEW: '신규 발주', ORDER_CHANGE: '발주 변경',
  SHIPMENT: '출고/배차', ARRIVAL: '입고/도착', INQUIRY: '수량확인/문의', DECISION: '의사결정',
  PHOTO: '사진/파일', INFO: '정보 공유',
};

export const KEY_PERSONNEL = {
  '네노바조': { role: '검수팀', stage: 'QC' },
  '네노바박성수친구': { role: '검수/현장', stage: 'QC' },
  '네노바 변진형 과장님': { role: '검수 과장', stage: 'QC' },
  '네노바 정재훈님': { role: '검수 담당', stage: 'QC' },
  '가브리엘': { role: '수입 담당(해외)', stage: 'IMPORT' },
  '김원빈': { role: '수입 매니저', stage: 'IMPORT' },
  'Teresa': { role: '수입 담당(해외)', stage: 'IMPORT' },
  '아드리아나': { role: '수입 담당(해외)', stage: 'IMPORT' },
  '네노바김원영차장님': { role: '현장 차장', stage: 'DISTRIBUTE' },
  '네노바연주': { role: '발주/영업', stage: 'ORDER' },
};

// 방 이름 → 단계 키 (부분일치)
export function stageOfRoom(room) {
  const r = String(room || '');
  for (const s of PIPELINE_STAGES) {
    if (s.rooms.some(rm => r.includes(rm) || rm.includes(r))) return s.key;
  }
  if (/불량/.test(r)) return 'QC';
  if (/영업|발주|견적/.test(r)) return 'ORDER';
  if (/현장|출고|분배/.test(r)) return 'DISTRIBUTE';
  if (/입고|발번호|재고/.test(r)) return 'INVENTORY';
  if (/수입/.test(r)) return 'IMPORT';
  return '';
}

export function stageName(key) {
  return (PIPELINE_STAGES.find(s => s.key === key) || {}).name || key || '미분류';
}

export function personRole(sender) {
  return KEY_PERSONNEL[String(sender || '').trim()] || null;
}
