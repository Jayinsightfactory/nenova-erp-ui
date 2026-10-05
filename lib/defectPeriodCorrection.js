import { isDefectAdmin } from './salesDefectDeductionCore.js';

export function validatePeriodCorrection({ year, week, targetYear, targetWeek, rows, reason, user }) {
  if (!isDefectAdmin(user)) throw new Error('차수 정정은 관리자만 가능합니다.');
  for (const [y, w] of [[year, week], [targetYear, targetWeek]]) {
    if (!Number.isInteger(Number(y)) || Number(y) < 2000 || Number(y) > 2100
      || !Number.isInteger(Number(w)) || Number(w) < 1 || Number(w) > 53) throw new Error('연도와 차수를 확인하세요.');
  }
  if (Number(year) === Number(targetYear) && Number(week) === Number(targetWeek)) throw new Error('다른 대상 차수를 선택하세요.');
  if (!String(reason || '').trim() || String(reason).length > 300) throw new Error('정정 사유를 1~300자로 입력하세요.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new Error('저장된 행 1~100건을 선택하세요.');
  const keys = new Set();
  for (const row of rows) {
    if (!Number.isInteger(row.deductionKey) || row.deductionKey <= 0 || keys.has(row.deductionKey)
      || !Number.isInteger(row.expectedRowVersionNo) || row.expectedRowVersionNo < 1) throw new Error('저장번호·버전을 다시 조회하세요.');
    keys.add(row.deductionKey);
  }
}

export function assertCorrectableDraft(row, expected, year, week) {
  if (!row || row.isDeleted || row.status !== 'DRAFT' || row.estimateKey || row.importConfirmed
    || row.isCarryoverLedger || row.appliedOrderYear || row.appliedOrderWeek || row.appliedShipmentKey
    || Number(row.orderYear) !== Number(year) || Number(row.orderWeek) !== Number(week)
    || Number(row.rowVersionNo) !== expected.expectedRowVersionNo) {
    throw new Error(`저장번호 ${expected.deductionKey}: 변경되었거나 처리된 행입니다. 재조회하세요.`);
  }
}
