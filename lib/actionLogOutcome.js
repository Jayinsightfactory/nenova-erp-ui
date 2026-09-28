// Display evidence, never infer a commit from HTTP success or a neighbouring log.
export const DEFECT_ACTION_LABELS = {
  save: '불량 입력 저장', preflight: '견적 등록 전 검증', register: '견적 차감 등록',
  rematch: '품목 재매칭 미리보기', 'incoming-confirm': '수입부 확인',
  'incoming-confirm-cancel': '수입부 확인 취소', 'incoming-review-resolve': '보완 확인',
  'manual-cost-save': '수기 단가 저장', 'manual-complete': '수작업 완료 표시',
  'manager-save': '담당자 설정', delete: '차감 삭제',
};
const text = v => typeof v === 'string' ? v.slice(0, 180) : typeof v === 'number' ? String(v) : '';
const count = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
const arr = v => Array.isArray(v) ? v : [];
export function actionTarget(row = {}) {
  if (!row || typeof row !== 'object') return '';
  return [text(row.custName || row.customerName || row.CustomerName || row.CustName) || (row.custKey || row.CustKey ? `업체 #${row.custKey || row.CustKey}` : ''),
    text(row.prodName || row.productName || row.ProductName || row.ProdName) || (row.prodKey || row.ProdKey ? `품목 #${row.prodKey || row.ProdKey}` : ''),
    row.deductionKey || row.DeductionKey ? `원장 #${row.deductionKey || row.DeductionKey}` : ''].filter(Boolean).join(' · ');
}

// Bounded valid JSON instead of cutting a batch body in the middle of a row.
// Only business identifiers/response counters retained; no tokens, raw notes or credentials.
export function buildDefectActionAudit(body = {}, response = {}) {
  if (!body || typeof body !== 'object') body = {};
  const rows = arr(body.rows), ids = arr(body.ids);
  const audit = { schema: 'defect-action-v1', action: text(body.action || 'save'), year: text(body.year), week: text(body.week),
    targetCount: rows.length || ids.length || (body.deductionKey ? 1 : 0),
    targets: (rows.length ? rows : ids.length ? ids.map(deductionKey => ({ deductionKey })) : [body]).slice(0, 12).map(actionTarget).filter(Boolean),
    response: Object.fromEntries(['saved','registered','confirmed','cancelled','completed','invalidCount'].map(k => [k,count(response?.[k])]).filter(([,v]) => v !== null)),
    skipped: arr(response?.skipped).length,
    reasons: [...arr(response?.skipped), ...arr(response?.rows).filter(r => r?.error)].slice(0, 3).map(r => text(r.error)),
  };
  audit.incomplete = audit.targetCount > audit.targets.length;
  while (JSON.stringify(audit).length > 3900 && audit.targets.length) { audit.targets.pop(); audit.incomplete = true; }
  return audit;
}

export function describeActionLog(log = {}) {
  let payload = {}, incomplete = false;
  try { payload = typeof log.Payload === 'string' ? JSON.parse(log.Payload || '{}') : log.Payload || {}; }
  catch { incomplete = true; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { payload = {}; incomplete = true; }
  const defect = log.ActionType === 'SALES_DEFECT_DEDUCTION';
  const modern = defect && payload.schema === 'defect-action-v1';
  const action = log.Method === 'DELETE' ? 'delete' : text(payload.action);
  const label = defect ? (DEFECT_ACTION_LABELS[action] || '불량차감 작업 (세부 작업 미기록)') : log.ActionType;
  const scope = [text(payload.year || payload.orderYear), text(payload.week || payload.orderWeek)].filter(Boolean).join(' / ');
  const targets = modern ? arr(payload.targets).filter(v => typeof v === 'string') :
    [...arr(payload.rows), ...arr(payload.entries), ...arr(payload.ids).map(deductionKey => ({ deductionKey })), payload].map(actionTarget).filter(Boolean);
  const reason = text(log.ResultDesc) || (log.Result === 'SUCCESS' ? '성공 응답 · 상세 사유 미기록' : '실패 사유가 기록되지 않았습니다.');
  let storage = '저장 여부 확인 필요', next = '대상 업무의 처리 이력을 확인한 뒤 재시도하세요. 전체 재실행은 중복될 수 있습니다.';
  if (defect && log.Result !== 'SUCCESS' && log.ResultDesc === '영업지원 전산등록 권한이 필요합니다.') {
    storage = '권한 검사 차단 · 업무 저장 안 함'; next = '영업지원 권한이 있는 계정으로 확인하세요. 같은 계정에서 반복 실행해도 해결되지 않습니다.';
  } else if ((defect && ['preflight','rematch'].includes(action)) || payload.preflightOnly === true) {
    storage = '검증·미리보기 · 저장 작업 아님'; next = '검증 결과를 확인하고 업무 화면에서 별도로 등록하세요.';
  } else if (modern && log.Result === 'SUCCESS') {
    const resultKey = {save:'saved',register:'registered','incoming-confirm':'confirmed','incoming-confirm-cancel':'cancelled','manual-complete':'completed'}[action];
    const n = count(payload.response?.[resultKey]);
    if (n !== null) {
      storage = `${action === 'register' ? '견적 등록' : action === 'save' ? '웹 입력 저장' : '처리'} ${n}건 (서버 응답)${payload.skipped ? ` · 제외/대기 ${payload.skipped}건` : ''}`;
      next = '이 요청의 서버 응답입니다. 제외/대기 건은 상세 사유를 확인하고, 완료 건은 다시 등록하지 마세요.';
    }
  } else if (log.Result === 'SUCCESS') {
    storage = '성공 응답 · 저장 범위 미확인'; next = '성공 응답만으로 앞선 실패 건이 처리됐다고 판단하지 마세요. 대상별 업무 이력을 확인하세요.';
  }
  return { label, action, scope: scope || '연도·차수 미기록', targets: [...new Set(targets)], reason,
    fullReason: log.ResultDesc || reason, storage, next, incomplete: incomplete || payload.incomplete === true,
    reasons: modern ? arr(payload.reasons) : [], counts: modern ? payload.response : {} };
}
