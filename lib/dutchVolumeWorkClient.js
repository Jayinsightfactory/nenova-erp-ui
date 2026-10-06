import { dutchSourceIdentity } from './dutchVolumeDraft.js';

export const DUTCH_WORK_CLIENT_MAX_BYTES = 900 * 1024;

// Work archives never contain a server plan, acknowledgements or ERP result.
export function buildDutchWorkPayload({ name, sourceMode, fileName, year, week, workbook, entries, prices, sourceIdentity, bulkPriceConfig }) {
  if (!workbook || !entries?.length) throw new Error('저장할 원본 물량표가 없습니다.');
  return {
    name: String(name || `${year}년 ${week} ${fileName}`).trim(),
    sourceMode: sourceMode === 'LIVE' ? 'LIVE' : 'UPLOAD',
    fileName, orderYear: Number(year), orderWeek: String(week),
    workbook, entries, prices, sourceIdentity: String(sourceIdentity || ''), bulkPriceConfig,
  };
}

export function restoreDutchWorkSnapshot(snapshot) {
  if (!snapshot?.id || !snapshot.workbook?.SheetNames?.length || !Array.isArray(snapshot.entries) || !snapshot.entries.length) {
    throw new Error('저장본의 원본 시트 또는 작업 행이 올바르지 않습니다.');
  }
  const year = Number(snapshot.orderYear);
  const week = String(snapshot.orderWeek || '');
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !/^\d{2}-\d{2}$/.test(week)) throw new Error('저장본의 연도·차수를 확인하세요.');
  const baseIdentity = `saved:${snapshot.id}`;
  return {
    workbook: snapshot.workbook, entries: snapshot.entries, prices: snapshot.prices || {}, bulkPriceConfig: snapshot.bulkPriceConfig,
    year, week, fileName: snapshot.fileName, name: snapshot.name,
    baseIdentity, identity: dutchSourceIdentity(baseIdentity, snapshot.entries, year, week),
  };
}
