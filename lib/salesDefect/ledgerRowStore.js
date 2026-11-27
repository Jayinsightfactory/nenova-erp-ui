import { sql } from '../db.js';
import { assertDeductionRegistrationScope } from '../salesDefectDeductionState.js';
import { getSupportLinkedEstimate } from '../salesDefectSupportStatus.js';
import { assertDefectSourceReviewed, buildDefectAutoSourceSql } from '../salesDefectAutoSource.js';
import { text } from './lookupAndMatching.js';
import { buildBaseDefectSnapshot, changeSummary } from './snapshotAndSummary.js';

export const AUTO_SOURCE_D = buildDefectAutoSourceSql('d');
export const AUTO_SOURCE_WD = buildDefectAutoSourceSql('wd');

export function snapshot(row) {
  const item = buildBaseDefectSnapshot(row);
  item.verifiedLinkedEstimate = getSupportLinkedEstimate(item);
  return item;
}

export async function writeHistory(tQuery, { key, action, user, before, after }) {
  const summary = action === 'SUPPORT_HOLD'
    ? '담당자 선택 보류: 원장·견적 보존'
    : action === 'SUPPORT_RESUME'
    ? '담당자 보류 해제: 기존 등록조건 재검사'
    : action === 'MANUAL_SOURCE_CONFIRM'
    ? '사용자 수기입력 확인: 원천 표식 오분류 정정 (입력값·견적 보존)'
    : ['SOURCE_REVIEW_RELEASE', 'SOURCE_REVIEW_CONFIRM'].includes(action)
    ? '원문 대조 완료: 검토 해제 (실제 견적·ERP 보존)'
    : changeSummary(before, after, action);
  if (/변경\s*없음$/.test(summary)) return false;
  await tQuery(
    `INSERT INTO WebSalesDefectDeductionHistory
       (DeductionKey, ActionType, ChangedBy, ChangedByName, ChangeSummary, BeforeJson, AfterJson)
     VALUES (@key,@action,@by,@name,@summary,@before,@after)`,
    {
      key: { type: sql.Int, value: Number(key) },
      action: { type: sql.NVarChar, value: text(action, 30) },
      by: { type: sql.NVarChar, value: text(user?.userId, 100) },
      name: { type: sql.NVarChar, value: text(user?.userName, 100) },
      summary: { type: sql.NVarChar, value: summary },
      before: { type: sql.NVarChar, value: before ? JSON.stringify(before) : '' },
      after: { type: sql.NVarChar, value: after ? JSON.stringify(after) : '' },
    },
  );
}

export async function getStoredRow(tQuery, key, lock = false) {
  const result = await tQuery(
    `SELECT d.*, ${AUTO_SOURCE_D.projection}
       FROM WebSalesDefectDeduction d ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
      WHERE d.DeductionKey=@key`,
    { key: { type: sql.Int, value: Number(key) } },
  );
  return result.recordset[0] || null;
}

export async function queryStoredSnapshot(q, key, { lock = false } = {}) {
  const result = await q(
    `SELECT d.*,
            ${AUTO_SOURCE_D.projection},
            c.CustName AS CurrentCustName,
            c.Descr AS CurrentCustomerDescr,
            p.ProdName AS CurrentProdName,
            p.DisplayName AS CurrentDisplayName,
            p.FlowerName AS CurrentFlowerName,
            p.CounName AS CurrentCounName,
            p.CountryFlower AS CurrentCountryFlower,
            p.EstUnit AS CurrentEstUnit,
            f.FarmName AS CurrentFarmName
       FROM WebSalesDefectDeduction d ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
       LEFT JOIN Customer c ON c.CustKey=d.CustKey
       LEFT JOIN Product p ON p.ProdKey=d.ProdKey
       LEFT JOIN Farm f ON f.FarmKey=d.FarmKey
      WHERE d.DeductionKey=@key`,
    { key: { type: sql.Int, value: Number(key) } },
  );
  return result.recordset[0] ? snapshot(result.recordset[0]) : null;
}

export function assertRegisterable(row) {
  if (!row.CustKey) throw new Error('거래처 매칭이 필요합니다.');
  if (!row.ProdKey) throw new Error('품목 매칭이 필요합니다.');
  if (!(Number(row.Quantity) > 0)) throw new Error('차감수량이 필요합니다.');
}

export function assertRemainingForRegistration(row) {
  if (Boolean(row.IsCarryoverLedger) && !(Number(row.RemainingQuantity ?? row.Quantity) > 0)) {
    throw new Error('잔여수량이 없는 완료 행은 다시 등록할 수 없습니다.');
  }
}

export function assertConfirmedForRegistration(row) {
  assertRemainingForRegistration(row);
}

export function assertRegistrationScope(row, targetYear, targetWeek) {
  assertDefectSourceReviewed(row);
  assertDeductionRegistrationScope(row, targetYear, targetWeek);
}
