// lib/workflowReviewStore.js — 직원 본인 업무흐름 확인 저장소(웹 전용 테이블 dbo.WebWorkflowReview).
import { query, sql } from './db.js';
import { assertWebSchemaContract } from './webSchemaContract.js';

const requirements = [
  { table: 'WebWorkflowReview', columns: ['ReviewKey', 'ErpUserId', 'OrbitUid', 'PersonName', 'WorkflowName', 'Verdict', 'CorrectedSteps', 'Comment', 'WorkflowGeneratedAt', 'ReviewedAt'] },
];
export const assertWorkflowReviewSchema = () => assertWebSchemaContract('workflow-review', requirements);
const p = (type, value) => ({ type, value });
export const VERDICTS = Object.freeze(['ok', 'fix', 'reject']);

// 입력 정규화. 수정(fix)은 단계 1개 이상 필수.
export function normalizeReviewInput(input = {}) {
  const workflowName = String(input.workflowName || '').trim().slice(0, 300);
  if (!workflowName) throw new Error('업무흐름 이름이 필요합니다.');
  const verdict = String(input.verdict || '');
  if (!VERDICTS.includes(verdict)) throw new Error('판정은 맞다/틀리다/수정 중 하나여야 합니다.');
  let steps = null;
  if (verdict === 'fix') {
    steps = (Array.isArray(input.correctedSteps) ? input.correctedSteps : []).map((s) => String(s || '').trim().slice(0, 500)).filter(Boolean).slice(0, 40);
    if (!steps.length) throw new Error('수정할 단계를 1개 이상 적어 주세요.');
  }
  return {
    workflowName, verdict, correctedSteps: steps ? JSON.stringify(steps) : null,
    comment: String(input.comment || '').trim().slice(0, 1000) || null,
    generatedAt: String(input.generatedAt || '').slice(0, 40) || null,
  };
}

export async function getReviewsFor(erpUserId) {
  await assertWorkflowReviewSchema();
  const r = await query(`SELECT WorkflowName,Verdict,CorrectedSteps,Comment,ReviewedAt FROM WebWorkflowReview WHERE ErpUserId=@u`, { u: p(sql.NVarChar, erpUserId) });
  return r.recordset.map((row) => ({ workflowName: row.WorkflowName, verdict: row.Verdict, correctedSteps: row.CorrectedSteps ? JSON.parse(row.CorrectedSteps) : null, comment: row.Comment, reviewedAt: row.ReviewedAt }));
}

export async function upsertReview(owner, input) {
  await assertWorkflowReviewSchema();
  const v = normalizeReviewInput(input);
  await query(`
    MERGE WebWorkflowReview WITH (HOLDLOCK) AS t
    USING (SELECT @u AS ErpUserId, @w AS WorkflowName) AS s ON t.ErpUserId=s.ErpUserId AND t.WorkflowName=s.WorkflowName
    WHEN MATCHED THEN UPDATE SET OrbitUid=@uid, PersonName=@name, Verdict=@v, CorrectedSteps=@steps, Comment=@c, WorkflowGeneratedAt=@g, ReviewedAt=SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT (ErpUserId,OrbitUid,PersonName,WorkflowName,Verdict,CorrectedSteps,Comment,WorkflowGeneratedAt) VALUES (@u,@uid,@name,@w,@v,@steps,@c,@g);`, {
    u: p(sql.NVarChar, owner.erpUserId), uid: p(sql.NVarChar, owner.orbitUid || null), name: p(sql.NVarChar, owner.name), w: p(sql.NVarChar, v.workflowName),
    v: p(sql.NVarChar, v.verdict), steps: p(sql.NVarChar, v.correctedSteps), c: p(sql.NVarChar, v.comment), g: p(sql.NVarChar, v.generatedAt),
  });
  return { workflowName: v.workflowName, verdict: v.verdict };
}
