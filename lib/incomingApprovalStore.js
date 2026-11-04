import { createHash } from 'node:crypto';
import { INCOMING_APPROVAL_KIND, approvalError, approvalPermissions, normalizeApprovalDraft, normalizeApprovalMatching, strictApprovalNumber } from './incomingApprovalPolicy.js';

export const approvalHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const approvalParam = (type, value) => ({ type, value });
export function approvalRows(result) {
  if (!Array.isArray(result?.recordset)) throw approvalError('APPROVAL_READ_FAILED', '자료를 완전히 읽지 못했습니다.', 503);
  return result.recordset;
}
export async function assertApprovalSchema(q) {
  const r = approvalRows(await q(`SELECT OBJECT_ID(N'web_mgmt.ApprovalRequest',N'U') RequestTable,
    OBJECT_ID(N'web_mgmt.ApprovalAudit',N'U') AuditTable`))[0];
  if (!r?.RequestTable || !r?.AuditTable) throw approvalError('APPROVAL_SCHEMA_REQUIRED', '승인 요청 저장소가 준비되지 않았습니다. 관리자에게 문의하세요.', 503);
}
const actorOf = user => {
  if (!approvalPermissions(user).request && !approvalPermissions(user).review) throw approvalError('APPROVAL_FORBIDDEN', '수입부 또는 영업지원 권한이 필요합니다.', 403);
  const actor = String(user.userId);
  if (actor.length > 20) throw approvalError('APPROVAL_ACTOR_INVALID', '전산 계정 식별자를 확인하세요.', 403);
  return actor;
};
export async function readApproval(q, types, requestId, locked = false) {
  const id = strictApprovalNumber(requestId, '요청 번호', { integer: true, positive: true });
  const found = approvalRows(await q(`SELECT * FROM web_mgmt.ApprovalRequest ${locked ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE RequestId=@id AND TargetKind=@kind`, { id: approvalParam(types.Int, id), kind: approvalParam(types.NVarChar, INCOMING_APPROVAL_KIND) }));
  if (found.length !== 1) throw approvalError('APPROVAL_NOT_FOUND', '입고 정정 요청을 찾을 수 없습니다.', 404);
  const row = found[0];
  return { ...row, payload: JSON.parse(row.PayloadJson) };
}
export function assertApprovalAccess(row, user) {
  const permissions = approvalPermissions(user);
  actorOf(user);
  if (!permissions.review && row.RequestedBy !== user.userId) throw approvalError('APPROVAL_FORBIDDEN', '본인이 작성한 요청만 열 수 있습니다.', 403);
}
export function assertApprovalRevision(row, revision) {
  if (strictApprovalNumber(revision, '요청 버전', { integer: true, positive: true }) !== row.payload.revision)
    throw approvalError('APPROVAL_STALE', '다른 사용자가 요청을 변경했습니다. 다시 조회한 뒤 검토하세요.');
}
export async function listIncomingApprovals(q, types, user) {
  actorOf(user); await assertApprovalSchema(q);
  const review = approvalPermissions(user).review;
  return approvalRows(await q(`SELECT TOP(200) RequestId,TargetRef,Status,RequestedBy,RequestedAt,DecidedBy,DecidedAt,UpdatedAt,PayloadJson
    FROM web_mgmt.ApprovalRequest WHERE TargetKind=@kind AND (@review=1 OR RequestedBy=@actor)
    ORDER BY UpdatedAt DESC,RequestId DESC`, {
    kind: approvalParam(types.NVarChar, INCOMING_APPROVAL_KIND), review: approvalParam(types.Bit, review), actor: approvalParam(types.NVarChar, user.userId),
  })).map(({ PayloadJson, ...row }) => { const p = JSON.parse(PayloadJson); return { ...row, revision: p.revision, correction: p.correction, reason: p.reason, reviewing: !!p.reviewedBy }; });
}
export async function writeApprovalEvent(q, types, { id, from, to, actor, note, payload, action }) {
  await q(`INSERT web_mgmt.ApprovalAudit(RequestId,FromStatus,ToStatus,ActorId,Note)
    VALUES(@id,@from,@to,@actor,@note);
    INSERT dbo.SystemActionLog(Actor,SessionId,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel)
    VALUES(@actor,@session,N'INCOMING_APPROVAL',N'POST',N'/api/warehouse/approval',N'web_mgmt.ApprovalRequest',1,@payload,N'SUCCESS',@note,N'HIGH')`, {
    id: approvalParam(types.Int, id), from: approvalParam(types.NVarChar, from), to: approvalParam(types.NVarChar, to), actor: approvalParam(types.NVarChar, actor),
    session: approvalParam(types.NVarChar, `incoming-approval:${id}:${payload.revision}`),
    note: approvalParam(types.NVarChar, String(note).slice(0, 400)), payload: approvalParam(types.NVarChar, JSON.stringify({ requestId: id, action, ...payload })),
  });
}
export async function saveApprovalState(q, types, row, { status, payload, actor, note, action }) {
  payload = { ...payload, revision: row.payload.revision + 1 };
  await q(`UPDATE web_mgmt.ApprovalRequest SET Status=@status,PayloadJson=@payload,UpdatedAt=SYSDATETIME(),
    RequestedAt=CASE WHEN @status=N'requested' AND RequestedAt IS NULL THEN SYSDATETIME() ELSE RequestedAt END,
    DecidedBy=CASE WHEN @status IN(N'applied',N'rejected') THEN @actor ELSE DecidedBy END,
    DecidedAt=CASE WHEN @status IN(N'applied',N'rejected') THEN SYSDATETIME() ELSE DecidedAt END,
    DecisionNote=CASE WHEN @status IN(N'applied',N'rejected') THEN @note ELSE DecisionNote END
    WHERE RequestId=@id AND TargetKind=@kind AND Status=@old;
    IF @@ROWCOUNT<>1 THROW 51104,'INCOMING_APPROVAL_STATE_CHANGED',1;`, {
    id: approvalParam(types.Int, row.RequestId), kind: approvalParam(types.NVarChar, INCOMING_APPROVAL_KIND), status: approvalParam(types.NVarChar, status), old: approvalParam(types.NVarChar, row.Status),
    payload: approvalParam(types.NVarChar, JSON.stringify(payload)), actor: approvalParam(types.NVarChar, actor), note: approvalParam(types.NVarChar, String(note).slice(0, 400)),
  });
  await writeApprovalEvent(q, types, { id: row.RequestId, from: row.Status, to: status, actor, note, payload, action });
  return { requestId: row.RequestId, status, revision: payload.revision };
}

export async function mutateIncomingApproval({ withTransactionFn, types, user, input, readBaseline }) {
  const actor = actorOf(user), permissions = approvalPermissions(user), action = input.action;
  return withTransactionFn(async q => {
    await assertApprovalSchema(q);
    if (action === 'create') {
      if (!permissions.request) throw approvalError('APPROVAL_FORBIDDEN', '수입부 요청 권한이 필요합니다.', 403);
      if (!/^[a-f0-9-]{36}$/i.test(input.operationId ?? '')) throw approvalError('APPROVAL_OPERATION_REQUIRED', '작업번호를 확인하세요.', 400);
      const draft = normalizeApprovalDraft(input), target = `receipt:${draft.correction.warehouseKey}`;
      await q(`DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=10000;
        IF @r<0 THROW 51104,'INCOMING_APPROVAL_BUSY',1;`, { resource: approvalParam(types.NVarChar, `incoming-approval-create:${actor}:${input.operationId}`) });
      const prior = approvalRows(await q(`SELECT RequestId,PayloadJson FROM web_mgmt.ApprovalRequest WITH (UPDLOCK,HOLDLOCK)
        WHERE TargetKind=@kind AND RequestedBy=@actor AND JSON_VALUE(PayloadJson,N'$.operationId')=@operation`, {
        kind: approvalParam(types.NVarChar, INCOMING_APPROVAL_KIND), actor: approvalParam(types.NVarChar, actor), operation: approvalParam(types.NVarChar, input.operationId),
      }));
      if (prior.length) {
        const payload = JSON.parse(prior[0].PayloadJson);
        if (prior.length !== 1 || payload.creationHash !== approvalHash(draft)) throw approvalError('APPROVAL_OPERATION_CONFLICT', '같은 작업번호의 요청 내용이 다릅니다.');
        return { requestId: prior[0].RequestId, revision: payload.revision, replayed: true };
      }
      const baseline = await readBaseline(q, draft.correction);
      const payload = { ...draft, revision: 1, operationId: input.operationId, creationHash: approvalHash(draft), baseline,
        matching: { rows: [], farms: [] }, reviewedBy: null };
      const inserted = approvalRows(await q(`INSERT web_mgmt.ApprovalRequest(TargetKind,TargetRef,Version,Status,PayloadJson,RequestedBy,CreatedBy)
        OUTPUT inserted.RequestId VALUES(@kind,@target,1,N'draft',@payload,@actor,@actor)`, {
        kind: approvalParam(types.NVarChar, INCOMING_APPROVAL_KIND), target: approvalParam(types.NVarChar, target), payload: approvalParam(types.NVarChar, JSON.stringify(payload)), actor: approvalParam(types.NVarChar, actor),
      }))[0];
      await writeApprovalEvent(q, types, { id: inserted.RequestId, from: null, to: 'draft', actor, note: draft.reason, payload, action });
      return { requestId: inserted.RequestId, status: 'draft', revision: 1 };
    }
    const row = await readApproval(q, types, input.requestId, true);
    assertApprovalAccess(row, user); assertApprovalRevision(row, input.revision);
    const own = permissions.request && row.RequestedBy === actor;
    if (['applied', 'cancelled', 'rejected'].includes(row.Status)) throw approvalError('APPROVAL_TERMINAL', '종료된 요청은 수정할 수 없습니다. 새 요청을 작성하세요.');
    let payload = row.payload, status = row.Status, note = String(input.note ?? '').trim();
    if (action === 'saveDraft' && own && status === 'draft') {
      const draft = normalizeApprovalDraft(input);
      if (draft.correction.warehouseKey !== payload.correction.warehouseKey) throw approvalError('APPROVAL_SCOPE_MISMATCH', '요청 대상 입고를 변경할 수 없습니다.');
      payload = { ...payload, ...draft, baseline: await readBaseline(q, draft.correction), matching: { rows: [], farms: [] } };
    } else if (action === 'submit' && own && status === 'draft') {
      const current = await readBaseline(q, payload.correction);
      if (current.digest !== payload.baseline.digest) throw approvalError('APPROVAL_RECEIPT_STALE', '초안 저장 후 입고가 변경되었습니다. 초안을 다시 검토·저장하세요.');
      status = 'requested';
    } else if (action === 'saveMatching' && permissions.review && status === 'requested') {
      payload = { ...payload, matching: normalizeApprovalMatching(input.matching), reviewedBy: actor };
    } else if (action === 'reject' && permissions.review && status === 'requested') {
      if (!note) throw approvalError('APPROVAL_REASON_REQUIRED', '반려 사유를 입력하세요.', 400);
      status = 'rejected';
    } else if (action === 'cancel' && own) {
      status = 'cancelled';
    } else throw approvalError('APPROVAL_TRANSITION_FORBIDDEN', '현재 상태에서 이 작업을 할 권한이 없습니다.', 403);
    return saveApprovalState(q, types, row, { status, payload, actor, note: note || payload.reason, action });
  }, { retries: 0 });
}
