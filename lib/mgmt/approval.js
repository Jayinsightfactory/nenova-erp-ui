// 승인요청(결재선) 저장 로직. 상태기계는 approvalPolicy.js. applied 는 web_mgmt 내부 상태 변경만 뜻한다.
import { query, withTransaction, sql } from '../db.js';
import { ensureMgmtSchema } from './schema.js';
import { APPROVAL_STATUS, assertTransition, assertSeparationOfDuty } from './approvalPolicy.js';

export { APPROVAL_STATUS, APPROVAL_TRANSITIONS, canTransition, assertTransition, assertSeparationOfDuty } from './approvalPolicy.js';

export async function createApprovalRequest({ targetKind, targetRef, payload, actorId }) {
  await ensureMgmtSchema();
  const r = await query(
    `INSERT INTO web_mgmt.ApprovalRequest (TargetKind, TargetRef, Version, Status, PayloadJson, RequestedBy, CreatedBy)
     OUTPUT INSERTED.RequestId
     SELECT @kind, @ref, ISNULL(MAX(Version),0)+1, 'draft', @payload, @actor, @actor
     FROM web_mgmt.ApprovalRequest WHERE TargetKind=@kind AND TargetRef=@ref`,
    {
      kind: { type: sql.NVarChar(40), value: targetKind },
      ref: { type: sql.NVarChar(200), value: targetRef },
      payload: { type: sql.NVarChar(sql.MAX), value: payload == null ? null : JSON.stringify(payload) },
      actor: { type: sql.NVarChar(100), value: actorId || '' },
    },
  );
  const id = r.recordset[0].RequestId;
  await query(
    `INSERT INTO web_mgmt.ApprovalAudit (RequestId, FromStatus, ToStatus, ActorId) VALUES (@id, NULL, 'draft', @actor)`,
    { id: { type: sql.Int, value: id }, actor: { type: sql.NVarChar(100), value: actorId || '' } },
  );
  return id;
}

export async function transitionApproval({ requestId, to, actorId, note }) {
  await ensureMgmtSchema();
  return withTransaction(async (tx) => {
    const cur = await tx.request()
      .input('id', sql.Int, requestId)
      .query(`SELECT RequestId, Status, RequestedBy FROM web_mgmt.ApprovalRequest WITH (UPDLOCK) WHERE RequestId=@id`);
    const row = cur.recordset[0];
    if (!row) throw new Error(`승인요청 없음: ${requestId}`);
    assertTransition(row.Status, to);
    assertSeparationOfDuty(row, actorId, to);
    const req = tx.request()
      .input('id', sql.Int, requestId)
      .input('to', sql.NVarChar(12), to)
      .input('actor', sql.NVarChar(100), actorId || '')
      .input('note', sql.NVarChar(400), note || null)
      .input('from', sql.NVarChar(12), row.Status);
    await req.query(
      `UPDATE web_mgmt.ApprovalRequest SET Status=@to, UpdatedAt=SYSDATETIME(),
         RequestedAt = CASE WHEN @to='requested' THEN SYSDATETIME() ELSE RequestedAt END,
         DecidedBy   = CASE WHEN @to IN ('approved','rejected') THEN @actor ELSE DecidedBy END,
         DecidedAt   = CASE WHEN @to IN ('approved','rejected') THEN SYSDATETIME() ELSE DecidedAt END,
         DecisionNote= CASE WHEN @to IN ('approved','rejected') THEN @note ELSE DecisionNote END
       WHERE RequestId=@id;
       INSERT INTO web_mgmt.ApprovalAudit (RequestId, FromStatus, ToStatus, ActorId, Note)
       VALUES (@id, @from, @to, @actor, @note);`,
    );
    return { requestId, from: row.Status, to };
  });
}

export async function listApprovals({ targetKind, status, limit = 200 } = {}) {
  await ensureMgmtSchema();
  const r = await query(
    `SELECT TOP (@limit) RequestId, TargetKind, TargetRef, Version, Status, PayloadJson, RequestedBy, RequestedAt, DecidedBy, DecidedAt, DecisionNote, CreatedAt, UpdatedAt
     FROM web_mgmt.ApprovalRequest
     WHERE (@kind IS NULL OR TargetKind=@kind) AND (@status IS NULL OR Status=@status)
     ORDER BY UpdatedAt DESC`,
    {
      limit: { type: sql.Int, value: Math.min(Number(limit) || 200, 1000) },
      kind: { type: sql.NVarChar(40), value: targetKind || null },
      status: { type: sql.NVarChar(12), value: status || null },
    },
  );
  return r.recordset || [];
}
