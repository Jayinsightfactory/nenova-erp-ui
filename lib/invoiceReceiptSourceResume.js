import { assertReceiptScope } from './invoiceReceiptWorkflow.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sameSource = (a, b) => a?.documentId === b?.documentId && a?.sourceHash === b?.sourceHash;

// Three-way source refresh: only apply changed source values where the user has
// not edited that value in the workbench. Server revisions are not source data.
function mergeSource(base, incoming, current) {
  if (equal(base, incoming)) return current;
  if (equal(base, current)) return incoming;
  if (object(base) && object(incoming) && object(current)) {
    return Object.fromEntries([...new Set([...Object.keys(incoming), ...Object.keys(current)])]
      .map(key => [key, mergeSource(base[key], incoming[key], current[key])]));
  }
  if ([base, incoming, current].every(Array.isArray)
    && [...base, ...incoming, ...current].every(row => row?.lineId)) {
    const old = new Map(base.map(row => [row.lineId, row]));
    const next = new Map(incoming.map(row => [row.lineId, row]));
    const now = new Map(current.map(row => [row.lineId, row]));
    return [...new Set([...now.keys(), ...next.keys()])].map(id =>
      mergeSource(old.get(id), next.get(id), now.get(id))).filter(Boolean);
  }
  return current;
}

export function resumeReceiptSource(source, previous, saved) {
  if (sameSource(previous?.document, source)) {
    const document = previous.sourceDocument
      ? mergeSource(previous.sourceDocument, source, previous.document) : previous.document;
    const changed = !equal(document, previous.document);
    return { ...previous, document, sourceDocument: source,
      ...(changed ? { dirty: true, preview: null, stageProgress: {} } : {}) };
  }
  if (saved) {
    assertReceiptScope(saved, { ...source,
      orderYear: source.orderYear || saved.orderYear, orderWeek: source.orderWeek || saved.orderWeek,
    }, saved.revision);
    return { document: saved, sourceDocument: source, dirty: false, preview: null, resumed: true };
  }
  return { document: source, sourceDocument: source, dirty: true, preview: null };
}

export async function readExistingReceiptSource(source, readDocument) {
  try { return await readDocument(source.documentId); }
  catch (error) {
    if (error.httpStatus === 404 && error.code === 'INVOICE_DOCUMENT_NOT_FOUND') return null;
    throw error;
  }
}

export function draftConflictMessage(code) {
  if (code === 'INVOICE_DOCUMENT_ALREADY_EXISTS') return '이 인보이스는 이미 초안으로 저장되어 있습니다. 「같은 문서 다시 불러오기」로 저장된 매칭과 입력값을 이어서 사용하세요. 중복 입고는 실행하지 않았습니다.';
  if (['INVOICE_REVISION_CONFLICT', 'INVOICE_ROW_VERSION_CONFLICT'].includes(code)) return '다른 작업에서 이 초안이 변경되었습니다. 현재 입력은 유지했습니다. 「같은 문서 다시 불러오기」로 최신 저장본을 확인한 뒤 이어서 진행하세요.';
  return '';
}
