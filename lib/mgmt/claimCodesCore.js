// 클레임 사유코드 순수 로직(DB 의존 없음): 시드, 최신 연결 선택, 농장×사유 집계.
export const CLAIM_SEED_CODES = [
  { code: 'Q-WILT', label: '시듦', category: '품질', sortOrder: 10 },
  { code: 'Q-DISEASE', label: '병해', category: '품질', sortOrder: 20 },
  { code: 'Q-SPEC', label: '규격미달', category: '품질', sortOrder: 30 },
  { code: 'C-SHORT', label: '부족', category: '수량', sortOrder: 40 },
  { code: 'C-WRONG', label: '오배송', category: '수량', sortOrder: 50 },
  { code: 'T-DAMAGE', label: '파손', category: '운송', sortOrder: 60 },
  { code: 'T-DELAY', label: '지연', category: '운송', sortOrder: 70 },
  { code: 'ETC', label: '기타', category: '기타', sortOrder: 99 },
];

export const DEFECT_SOURCE_TABLE = 'defect_deduction';
export const NO_FARM_LABEL = '농장 미연결';
export const NO_CODE_LABEL = '미분류';

// 이미 있는 코드는 제외 — 시드 멱등(2회 호출해도 두 번째는 빈 배열).
export function seedsToInsert(existingCodes) {
  const have = new Set((existingCodes || []).map((c) => String(c).toUpperCase()));
  return CLAIM_SEED_CODES.filter((s) => !have.has(s.code));
}

// 같은 SourceKey 에 연결이 여러 개면 LinkKey 가 큰(최신) 것 하나만.
export function latestLinkBySource(links) {
  const m = new Map();
  for (const l of links || []) {
    const k = String(l.sourceKey);
    const cur = m.get(k);
    if (!cur || Number(l.linkKey || 0) >= Number(cur.linkKey || 0)) m.set(k, l);
  }
  return m;
}

// rows: [{ deductionKey, farmName, quantity }], links: [{ linkKey, sourceKey, code }]
// 반환: [{ farm, code, count, quantity }] (농장, 사유코드 순 정렬)
export function aggregateByFarmReason(rows, links) {
  const latest = latestLinkBySource(links);
  const acc = new Map();
  for (const r of rows || []) {
    const farm = String(r.farmName || '').trim() || NO_FARM_LABEL;
    const link = latest.get(String(r.deductionKey));
    const code = link ? link.code : NO_CODE_LABEL;
    const k = `${farm}\u0000${code}`;
    const cur = acc.get(k) || { farm, code, count: 0, quantity: 0 };
    cur.count += 1;
    cur.quantity += Number(r.quantity || 0);
    acc.set(k, cur);
  }
  return [...acc.values()].sort((a, b) => a.farm.localeCompare(b.farm, 'ko') || a.code.localeCompare(b.code));
}
