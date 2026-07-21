// 견적서 수량 수정 전 사전검증 결과를 UI에서 일관되게 처리한다.
// 실제 DB 검사는 /api/shipment/exe-errors가 수행하고, 이 파일은 순수한
// 결과 분류/메시지 생성만 담당한다.

export const BLOCKING_EXE_ERROR_CODES = new Set([
  'dateMismatch',
  'zeroOut',
  'ghost',
  'dupDetail',
  'dupMaster',
  'emptyDeletedMaster',
  'yearMismatch',
  'custKeyBad',
  'managerBad',
]);

// 차수 전체 진단 결과와 개별 저장 대상의 무결성 오류를 같은 방식으로
// "전부 차단"하지 않도록, 사용자가 확인할 수 있는 조치 계획을 만든다.
// 자동 조치는 DB 불변식의 기계적 보정만 허용하고, 합산/삭제가 필요한
// 중복·고스트 데이터는 절대 자동으로 건드리지 않는다.
export const QUANTITY_INTEGRITY_ACTIONS = Object.freeze({
  CUSTKEY_MISMATCH: {
    id: 'repairMissingCustKey',
    kind: 'safe',
    label: 'ShipmentDetail 업체키를 마스터 업체키로 보정',
    description: '전산 조인 불변식(CustKey 일치)에 맞춰 해당 차수의 불일치 행만 보정합니다.',
    endpoint: '/api/shipment/distribute-diagnose',
    body: { action: 'repairMissingCustKey' },
  },
  ORDER_YEAR_WEEK_MISMATCH: {
    id: 'fixOrderYearWeek',
    kind: 'safe',
    label: '연도·대차수 키를 전산 형식으로 보정',
    description: 'ShipmentMaster.OrderYearWeek를 OrderYear + 대차수 형식으로 맞춥니다.',
    endpoint: '/api/shipment/fix-orderyearweek',
    body: { action: 'fix' },
  },
  ORDER_MANAGER_INVALID: {
    id: 'fixOrderManager',
    kind: 'safe',
    label: '주문 담당자 키를 유효한 관리자 UserID로 보정',
    description: 'ViewOrder의 UserInfo 조인에서 탈락하지 않도록 잘못된 Manager만 보정합니다.',
    endpoint: '/api/shipment/order-manager-fix',
    body: { action: 'fix' },
  },
  SHIPMENT_DATE_MISSING: {
    id: 'syncShipmentDate',
    kind: 'manual',
    label: '출고분배에서 출고일을 지정하고 다시 저장',
    description: 'ShipmentDate 행이 없으므로 날짜를 임의로 만들지 않고 출고분배 화면에서 확인해야 합니다.',
  },
  SHIPMENT_DATE_INVALID: {
    id: 'repairShipmentDate',
    kind: 'manual',
    label: '출고분배에서 잘못된 출고일을 확인 후 다시 저장',
    description: 'NULL 출고일은 임의 보정하지 않고 전산 출고일 기준으로 확인해야 합니다.',
  },
  SHIPMENT_DTM_MISSING: {
    id: 'setShipmentDtm',
    kind: 'manual',
    label: '출고분배에서 출고일을 먼저 지정',
    description: 'ShipmentDetail 출고일이 비어 있어 전산 출고일과 연결할 수 없습니다.',
  },
  ZERO_OUT_REUSE: {
    id: 'repairZeroOut',
    kind: 'manual',
    label: '기존 0수량 행을 정리한 뒤 정상 분배로 재생성',
    description: '0수량 상세행을 되살리면 전산에서 빈 레코드로 남을 수 있어 관리자 확인이 필요합니다.',
  },
  GHOST_SHIPMENT: {
    id: 'resolveGhostShipment',
    kind: 'manual',
    label: '주문등록 생성 또는 해당 분배 삭제 선택',
    description: '실제 출고라면 주문등록을 먼저 만들고, 오입력이라면 분배를 삭제해야 합니다.',
  },
  DUPLICATE_SHIPMENT_MASTER: {
    id: 'mergeShipmentMaster',
    kind: 'manual',
    label: '중복 ShipmentMaster 통합 대상 확인',
    description: '어느 마스터를 기준으로 할지 판단한 뒤 상세를 통합해야 합니다.',
  },
  DUPLICATE_SHIPMENT_DETAIL: {
    id: 'mergeShipmentDetail',
    kind: 'manual',
    label: '중복 ShipmentDetail 합산·삭제 여부 확인',
    description: '수량을 자동 합산하거나 삭제하지 않고 주문 원본과 전산 화면을 대조합니다.',
  },
});

function actionForIssue(issue) {
  const action = QUANTITY_INTEGRITY_ACTIONS[String(issue?.code || '')];
  return action || {
    id: String(issue?.code || 'unknown'),
    kind: 'manual',
    label: '관리자 정합성 진단에서 원인 확인',
    description: String(issue?.message || '저장 대상의 정합성을 확인해야 합니다.'),
  };
}

export function summarizeQuantityPreflight(payload, week) {
  const checks = Array.isArray(payload?.checks) ? payload.checks : [];
  const blockers = checks
    .filter((check) => BLOCKING_EXE_ERROR_CODES.has(check.code) && Number(check.count || 0) > 0)
    .map((check) => ({
      code: check.code,
      title: check.title,
      count: Number(check.count || 0),
      sample: Array.isArray(check.items) ? check.items.slice(0, 3) : [],
    }));

  return {
    week: String(week || payload?.week || ''),
    ok: blockers.length === 0,
    totalIssues: Number(payload?.totalIssues || 0),
    blockers,
  };
}

export function buildQuantityPreflightError(results) {
  const blocked = (results || []).filter((result) => !result.ok);
  if (blocked.length === 0) return null;

  const details = blocked.flatMap((result) =>
    result.blockers.map((blocker) => `${result.week} ${blocker.title} ${blocker.count}건`)
  );
  const error = new Error(
    `수량 수정 전 사전검증에서 확인이 필요합니다.\n${details.join('\n')}\n` +
    '자동 보정 가능 항목은 확인 후 보정하고, 수동 판단 항목만 먼저 처리하세요.'
  );
  error.code = 'ERP_INTEGRITY_ACTION_REQUIRED';
  error.preflight = blocked;
  return error;
}

// 실제 저장 대상만 dry-run 한 결과를 사용자용 조치 계획으로 변환한다.
export function buildQuantityItemPreflightError(failures) {
  const items = (failures || []).map((failure) => {
    const issueList = Array.isArray(failure?.error?.issues) && failure.error.issues.length > 0
      ? failure.error.issues
      : [{ code: failure?.error?.code || 'UNKNOWN', message: failure?.error?.message || '무결성 확인 실패' }];
    return {
      key: failure?.item?.keyNumber,
      sdetailKey: failure?.item?.isEstimate ? null : failure?.item?.keyNumber,
      estimateKey: failure?.item?.isEstimate ? failure?.item?.keyNumber : null,
      week: failure?.item?.item?.OrderWeek || failure?.item?.item?.orderWeek || '',
      custName: failure?.item?.item?.CustName || failure?.item?.item?.CustomerName || '',
      prodName: failure?.item?.item?.ProdName || '',
      issues: issueList,
      error: failure?.error?.message || '무결성 확인 실패',
    };
  });

  const safeActions = [];
  const manualActions = [];
  const seen = new Set();
  for (const item of items) {
    for (const issue of item.issues) {
      const base = actionForIssue(issue);
      const action = {
        ...base,
        week: item.week,
        body: { ...(base.body || {}), week: item.week },
        source: { ...issue, key: item.key, sdetailKey: item.sdetailKey, prodName: item.prodName },
      };
      const key = `${action.kind}:${action.id}:${action.week}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (action.kind === 'safe' ? safeActions : manualActions).push(action);
    }
  }

  const error = new Error(
    `저장 전 확인이 필요한 항목 ${items.length}건입니다.\n` +
    `${safeActions.length ? `자동 보정 가능 ${safeActions.length}건` : ''}` +
    `${safeActions.length && manualActions.length ? ' / ' : ''}` +
    `${manualActions.length ? `사용자 선택 필요 ${manualActions.length}건` : ''}`
  );
  error.code = 'ERP_INTEGRITY_ACTION_REQUIRED';
  error.preflight = { items, safeActions, manualActions };
  return error;
}
