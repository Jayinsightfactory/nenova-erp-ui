// This workflow deliberately has no receipt writer/commit dependency.
export async function prepareInvoiceCostOnly({ record, saveDraft, readDocument, previewLink, confirmLink, linkExisting, verify, isCurrent = () => true }) {
  const check = () => { if (!isCurrent()) throw new Error('선택 문서가 변경되었습니다. 현재 문서를 다시 확인하세요.'); };
  check();
  if (!record || record.pendingOperation || record.recoveryRequired) throw new Error('이전 작업 결과를 먼저 조회하세요. 입고를 다시 등록하지 않습니다.');
  let document = record.document;
  const committed = (document.operations || []).filter(operation => operation.status === 'COMMITTED');
  if (committed.length) {
    if (record.dirty || !committed.some(operation => Number(operation.documentRevision) === Number(document.revision))) {
      throw new Error('입고 후 변경된 초안입니다. 기존 입고와 다른 값을 원가에 사용할 수 없습니다. 저장된 입고 문서를 다시 불러오세요.');
    }
    const fresh = await readDocument(document.documentId);
    check(); verify(fresh, document);
    return fresh;
  }
  if (!['NL', 'CN', 'TH'].includes(document.reviewedMetadata?.country)) {
    throw new Error('이 국가의 기존 전산 입고 연결은 아직 지원하지 않습니다. 웹에서 입고한 자료는 저장 문서를 불러오세요. 신규 입고는 자동 실행하지 않습니다.');
  }
  if (record.dirty || document.revision == null) document = await saveDraft(record);
  check();
  const preview = await previewLink(document);
  check();
  if (preview?.canLink !== true || !preview.baselineDigest || !preview.warehouseKey) throw new Error('기존 입고 대조가 완료되지 않았습니다. 새 입고는 등록하지 않습니다.');
  if (!await confirmLink(preview, document)) return null;
  check();
  const result = await linkExisting(document, preview);
  check();
  const fresh = await readDocument(document.documentId);
  check(); verify(fresh, { ...document, operationId: result.operationId, warehouseKey: result.warehouseKey });
  return fresh;
}
