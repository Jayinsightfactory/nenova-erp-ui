// lib/workFlowOwners.js
// ERP 로그인 UserID → 업무흐름 데이터의 사람(name / orbitUid) 매핑. '내 업무흐름 확인' 기능이 본인 것만 보여주는 기준.
// 근거: UserInfo(UserID, UserName) 읽기 조회 + nenova-work-features/confidence.json 의 name→uid (2026-10-01).
// 확신 없는 매핑은 비워 둔다(TODO). 같은 사람이 계정 2개인 경우 주 계정만 넣었다.
export const WORKFLOW_OWNERS = Object.freeze({
  nenovaSS3: { name: '임재용', orbitUid: 'MNH03H73690BB2CD82' },
  nenovaSS2: { name: '설연주', orbitUid: 'MNIAFICB3DC88DCB34' },
  nenovaSS1: { name: '강현우', orbitUid: 'MNMRX6SR07F5FF7C0C' },
  nenovaSS4: { name: '김도준', orbitUid: 'MNF64400D6CD233E3A' },
  nenovaIC4: { name: '김원빈', orbitUid: 'MNMRVD11EDCCF6E7CE' },
  nenovaSD1: { name: '정재훈', orbitUid: 'MN0B1204A46C4B8EAC' },
  nenovaSD3: { name: '조현욱', orbitUid: 'MN506C7A6A710A046E' },
  nenovaSD7: { name: '박성수', orbitUid: 'MN9B6750A0A37D561D' },
  nenova1: { name: '김원영', orbitUid: 'MN2F3C3CEDBE96B26C' },
  // TODO(확인 필요): UserInfo 는 nenovaIC2=아드리아나 인데 confidence.json 후보 uid 는 nenovaIC1 로 추정돼 있었음.
  nenovaIC2: { name: '아드리아나', orbitUid: 'MN8232D542A97C0862' },
  // TODO(확인 필요): UserInfo 는 nenovaMS2=강명훈, confidence.json 후보 uid 는 nenovaMS3.
  nenovaMS2: { name: '강명훈', orbitUid: 'MNMSAQJD78E544A631' },
  // TODO: 임재용 보조 계정 nenovaSS9, 박성수 보조 계정 nenovaST2 는 의도적으로 비움(주 계정으로만 확인).
});

const BY_LOWER = new Map(Object.entries(WORKFLOW_OWNERS).map(([id, v]) => [id.toLowerCase(), { erpUserId: id, ...v }]));

// user = JWT payload({ userId }). 서버측에서만 호출.
export function workflowOwnerOf(user) {
  const id = String(user?.userId ?? '').trim().toLowerCase();
  return id ? BY_LOWER.get(id) || null : null;
}
