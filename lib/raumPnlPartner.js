// 라움/초이문 손익계산서 — 같은 화면·같은 기능, 거래처만 분리.
// 결산 저장 키는 OrderYear + MajorWeek + PartnerCode.
// 전산 조회는 Customer.CustName LIKE 로 거래처를 고르며 OrderWeek 단독 조회는 하지 않는다.

export const PNL_PARTNERS = {
  raum: {
    code: 'raum',
    label: '라움',
    custName: '라움',
    defaultBranch: null,
    sheetMode: 'branches',
    custLikeSql: `(c.CustName LIKE N'%라움%' OR c.CustName LIKE N'%트라움%')`,
    custLookupSql: `(CustName LIKE N'%트라움%' OR CustName LIKE N'%라움%')`,
  },
  choimun: {
    code: 'choimun',
    label: '초이문',
    custName: '초이문',
    defaultBranch: '초이문',
    sheetMode: 'single',
    custLikeSql: `(c.CustName LIKE N'%초이문%')`,
    custLookupSql: `(CustName LIKE N'%초이문%')`,
  },
};

export function resolvePnlPartner(code) {
  const key = String(code == null || code === '' ? 'raum' : code).trim().toLowerCase();
  const partner = PNL_PARTNERS[key];
  if (!partner) throw new Error('거래처는 라움 또는 초이문만 선택할 수 있습니다.');
  return partner;
}

export function defaultPnlTitle(partnerCode, major, suffix = '') {
  const partner = resolvePnlPartner(partnerCode);
  const n = Number(major);
  const week = Number.isFinite(n) && n > 0 ? `${n}차` : '?차';
  return `${partner.label} ${week}${suffix}`;
}

export function isRaumBranch(branch) {
  return branch === '강남' || branch === '건대';
}

/** 선택한 거래처 견적서 시트만 받는다. 라움 파일과 초이문 파일을 섞지 않는다. */
export function acceptQuoteSheet(parsed, partner) {
  if (!parsed?.major) return { ok: false, reason: 'no-major' };
  if (partner.code === 'raum') {
    if (isRaumBranch(parsed.branch)) return { ok: true };
    if (parsed.partnerHint === 'choimun' || parsed.branch === '초이문') {
      return { ok: false, reason: 'choimun-file' };
    }
    return { ok: false, reason: 'not-branch' };
  }
  if (isRaumBranch(parsed.branch) || parsed.partnerHint === 'raum') {
    return { ok: false, reason: 'raum-file' };
  }
  return { ok: true };
}

export function sheetRejectWarning(sheetName, reason) {
  if (reason === 'no-major') return `${sheetName}: 시트명에서 차수를 찾지 못해 제외했습니다. (예: 27차강남양식 또는 32차)`;
  if (reason === 'choimun-file') return `${sheetName}: 초이문 견적서 시트입니다. 상단에서 초이문을 선택한 뒤 다시 올려주세요.`;
  if (reason === 'raum-file') return `${sheetName}: 강남/건대 라움 시트입니다. 상단에서 라움을 선택한 뒤 다시 올려주세요.`;
  return `${sheetName}: 선택한 거래처 견적서 시트가 아니어서 제외했습니다.`;
}

export function emptyWorkbookWarning(partner) {
  return partner.code === 'choimun'
    ? '초이문 견적서 시트를 찾지 못했습니다. 시트명이 32차처럼 차수만 있고 비고에 초이문이 있는지 확인하세요.'
    : '강남/건대 라움 견적서 시트를 찾지 못했습니다.';
}

/** 합계 검증 통과 + 기존 저장본 덮어쓰기 없음 → 업로드 직후 목록에 남겨도 된다. */
export function canAutoCommitRaumPnlImport(batches) {
  if (!Array.isArray(batches) || batches.length === 0) return false;
  return batches.every((batch) => {
    const checks = batch?.verification || [];
    if (checks.some(check => !check?.ok)) return false;
    if (batch?.existingDiff?.hasChanges) return false;
    return true;
  });
}
