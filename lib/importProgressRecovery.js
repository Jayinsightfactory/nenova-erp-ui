// Read-only recovery: an orphaned worker never causes an ERP replay or audit rewrite.
export async function recoverImportProgress(progress, owner, readAudit) {
  if (!progress) return progress;
  const uncertainTerminal = progress.finished && progress.error?.code === 'IMPORT_PROGRESS_LOST';
  if ((progress.finished && !uncertainTerminal) || (!progress.finished && progress.workerAlive !== false)) return progress;
  let audit = null;
  if (Number.isSafeInteger(progress.auditKey) && /^\d{4}$/.test(progress.year) && /^\d{2}-\d{2}$/.test(progress.week)) {
    audit = await readAudit({ auditKey: progress.auditKey, owner, year: progress.year, week: progress.week });
  }
  const committed = ['SUCCESS', 'SUCCESS_WITH_WARNINGS'].includes(audit?.AuditStatus);
  const code = committed ? 'IMPORT_COMMITTED_REVIEW_REQUIRED' : 'IMPORT_PROGRESS_LOST';
  const message = committed
    ? `작업 ${progress.auditKey}의 저장 완료 이력은 확인됐지만 서버 재시작으로 최종 결과 확인이 중단됐습니다. 재적용하지 말고 업로드 이력을 확인하세요.`
    : '작업을 수행하던 서버가 종료되어 반영 여부를 확정할 수 없습니다. 자동 재적용하지 않았습니다. 업로드 이력과 재검증 결과를 확인하세요.';
  return { ...progress, finished: true, failed: true, outcomeUnknown: true, committed,
    error: { code, message }, result: { success: false, code, error: message, outcomeUnknown: true, committed,
      auditBatchKey: progress.auditKey || null } };
}
