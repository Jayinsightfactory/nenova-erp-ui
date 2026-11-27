import { query, sql, withTransaction } from '../db.js';
import { omissionSql } from '../defectPermanentOmission.js';
import { validatePeriodCorrection, assertCorrectableDraft } from '../defectPeriodCorrection.js';
import {
  canUseDefectSupport as omissionSupport,
  normalizeDeductionRow,
  isEarlierOrSameScope,
  normalizeParentWeek,
  normalizeUnit,
  normalizeYear,
} from '../salesDefectDeductionCore.js';
import { normalizeManagementRequest, planDefectLedgerManagement } from '../defectLedgerManagement.js';
import { resolveManualCostContext } from '../salesDefectManualCost.js';
import { assertNotDefectAutoSource } from '../salesDefectAutoSource.js';
import { ensureSalesDefectTables, resolveEstimateContext } from '../salesDefectDeductions.js';
import { text } from './lookupAndMatching.js';
import { rowParams, queryEstimateTypeCode } from './snapshotAndSummary.js';
import {
  snapshot,
  writeHistory,
  getStoredRow,
  queryStoredSnapshot,
  assertRegisterable,
  assertRegistrationScope,
} from './ledgerRowStore.js';

export async function correctDraftPeriod(input, { transaction = withTransaction, ensure = ensureSalesDefectTables, readSnapshot = queryStoredSnapshot } = {}) {
  validatePeriodCorrection(input);
  const { year, week, targetYear, targetWeek, rows, reason, user } = input;
  await ensure();
  return transaction(async (q) => {
    const closed = await q(`SELECT DeductionKey FROM WebSalesDefectDeduction WITH (UPDLOCK,HOLDLOCK)
      WHERE IsDeleted=0 AND COALESCE(AppliedOrderYear,OrderYear)=@year
        AND TRY_CONVERT(INT,COALESCE(NULLIF(AppliedOrderWeek,N''),OrderWeek))=@week
        AND (EstimateKey IS NOT NULL OR Status IN (N'REGISTERED',N'MANUAL_COMPLETED'))`, {
      year: { type: sql.Int, value: Number(targetYear) }, week: { type: sql.Int, value: Number(targetWeek) },
    });
    if (closed.recordset.length) throw new Error('대상 차수는 이미 전산등록되어 마감되었습니다.');
    const result = [];
    for (const expected of [...rows].sort((a, b) => a.deductionKey - b.deductionKey)) {
      const key = expected.deductionKey;
      const before = await readSnapshot(q, key, { lock: true });
      assertCorrectableDraft(before, expected, year, week);
      const applications = await q(`SELECT ApplicationKey FROM WebSalesCarryoverApplication WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key`, { key: { type: sql.Int, value: key } });
      if (applications.recordset.length) throw new Error(`저장번호 ${key}: 이월 처리 이력이 있습니다.`);
      const updated = await q(`UPDATE WebSalesDefectDeduction
        SET OrderYear=@targetYear, OrderWeek=@targetWeek,
            UpdatedBy=@by, UpdatedByName=@name, UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
        WHERE DeductionKey=@key AND OrderYear=@year AND OrderWeek=@week AND RowVersionNo=@version
          AND IsDeleted=0 AND Status=N'DRAFT' AND EstimateKey IS NULL`, {
        targetYear: { type: sql.Int, value: Number(targetYear) },
        targetWeek: { type: sql.NVarChar, value: String(Number(targetWeek)) },
        year: { type: sql.Int, value: Number(year) }, week: { type: sql.NVarChar, value: String(Number(week)) },
        key: { type: sql.Int, value: key }, version: { type: sql.Int, value: expected.expectedRowVersionNo },
        by: { type: sql.NVarChar, value: text(user.userId, 100) }, name: { type: sql.NVarChar, value: text(user.userName, 100) },
      });
      if (updated.rowsAffected[0] !== 1) throw new Error('동시 변경 감지: 전체 정정을 취소합니다.');
      const after = await readSnapshot(q, key);
      await writeHistory(q, { key, action: 'PERIOD_CORRECT', user, before, after: { ...after, correctionReason: reason.trim() } });
      result.push(after);
    }
    return result;
  });
}

export async function syncLinkedEstimate(tQuery, { year, week, item, estimateKey, autoSourceRow = {} }) {
  assertNotDefectAutoSource(autoSourceRow);
  assertRegisterable({ CustKey: item.custKey, ProdKey: item.prodKey, Quantity: item.quantity });
  const ctx = await resolveManualCostContext({
    row: { DeductionKey: item.deductionKey, CustKey: item.custKey, ProdKey: item.prodKey, SourceUnit: item.sourceUnit },
    targetYear: year, targetWeek: week, q: tQuery,
    resolveContext: () => resolveEstimateContext({ year, week, custKey: item.custKey, prodKey: item.prodKey }, tQuery),
  });
  if (!ctx.shipmentKey) throw new Error(`${item.customerName || '거래처'} ${week}차 출고가 없어 연결 견적을 갱신할 수 없습니다.`);
  if (!(ctx.cost > 0)) throw new Error(`${item.customerName || '거래처'} / ${item.productName || '품목'}의 이전 차수 분배 단가가 없습니다.`);
  const typeCode = await queryEstimateTypeCode(item.deductionType, tQuery);
  const qty = -Math.abs(Number(item.quantity) || 0);
  const cost = Number(ctx.cost) || 0;
  const amount = Math.round(qty * cost / 1.1);
  const vat = qty * cost - amount;
  await tQuery(
    `UPDATE Estimate
        SET EstimateType=@type, EstimateDtm=@dt, ProdKey=@pk, Unit=@unit,
            Quantity=@qty, Cost=@cost, Amount=@amount, Vat=@vat, Descr=@descr,
            ShipmentKey=@sk
      WHERE EstimateKey=@ek`,
    {
      type: { type: sql.NVarChar, value: typeCode },
      dt: { type: sql.DateTime, value: ctx.estimateDate || new Date() },
      pk: { type: sql.Int, value: Number(item.prodKey) },
      unit: { type: sql.NVarChar, value: ctx.unit || normalizeUnit(item.sourceUnit) || '단' },
      qty: { type: sql.Float, value: qty },
      cost: { type: sql.Float, value: cost },
      amount: { type: sql.Float, value: amount },
      vat: { type: sql.Float, value: vat },
      descr: { type: sql.NVarChar, value: '' },
      sk: { type: sql.Int, value: Number(ctx.shipmentKey) },
      ek: { type: sql.Int, value: Number(estimateKey) },
    },
  );
  return {
    cost,
    estimateDate: ctx.estimateDate || new Date(),
    targetShipmentKey: ctx.shipmentKey,
    costSourceYear: ctx.costSourceYear,
    costSourceWeek: ctx.costSourceWeek,
  };
}

export async function assertIdempotentApplicationEstimateLive(tQuery, idempotentApplication = {}) {
  const estimateKey = Number(idempotentApplication.EstimateKey);
  if (!Number.isInteger(estimateKey) || estimateKey <= 0) {
    throw new Error('기존 등록 요청의 견적서 연결정보가 올바르지 않습니다. 새로고침 후 다시 확인하세요.');
  }
  const liveEstimate = await tQuery(
    `SELECT EstimateKey FROM Estimate WITH (UPDLOCK,HOLDLOCK) WHERE EstimateKey=@ek`,
    { ek: { type: sql.Int, value: estimateKey } },
  );
  if (!liveEstimate.recordset?.[0]) {
    throw new Error('기존 견적서 등록이 취소되었습니다. 같은 요청을 다시 적용하지 않았습니다. 새로고침 후 필요한 경우 새 등록 요청으로 진행하세요.');
  }
  return true;
}

export async function manageDeductions(input = {}, dependencies = {}) {
  const request = normalizeManagementRequest(input);
  const transaction = dependencies.withTransaction || withTransaction;
  let operationStage = '관리 원장 잠금·범위 확인';
  try {
    return await transaction(async (tQuery) => {
      const plans = [];
      for (const selection of request.rows) {
        const row = await getStoredRow(tQuery, selection.deductionKey, true);
        const applications = await tQuery(`SELECT * FROM WebSalesCarryoverApplication WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key`,
          { key: { type: sql.Int, value: selection.deductionKey } });
        const histories = await tQuery(`SELECT ActionType,BeforeJson,AfterJson FROM WebSalesDefectDeductionHistory WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key`,
          { key: { type: sql.Int, value: selection.deductionKey } });
        const plan = planDefectLedgerManagement({ request, selection, row,
          applications: applications.recordset || [], histories: histories.recordset || [] });
        if (request.action === 'manage-edit' && !plan.noteOnly && Object.keys(request.changes).length) {
          for (const [field, table, pk, changeField] of [['CustKey', 'Customer', 'CustKey', 'custKey'], ['ProdKey', 'Product', 'ProdKey', 'prodKey']]) {
            if (!Object.prototype.hasOwnProperty.call(request.changes, changeField)) continue;
            const exists = await tQuery(`SELECT ${pk} FROM ${table} WITH (HOLDLOCK) WHERE ${pk}=@id AND ISNULL(isDeleted,0)=0`,
              { id: { type: sql.Int, value: Number(plan.after[field]) || 0 } });
            if (exists.recordset.length !== 1) throw new Error('활성 전산 업체·품목 매칭을 선택하세요.');
          }
        }
        plans.push(plan);
      }
      if (request.preview) return { preview: true, beforeCount: plans.length, afterCount: plans.length,
        rows: plans.map((p) => ({ deductionKey: p.deductionKey, noteOnly: p.noteOnly, action: p.action,
          before: snapshot(p.before), after: snapshot(p.after) })) };
      const result = [];
      operationStage = '관리 원장 저장·감사';
      for (const plan of plans) {
        const a = plan.after;
        const params = { key: { type: sql.Int, value: plan.deductionKey },
          version: { type: sql.Int, value: Number(plan.before.RowVersionNo) },
          by: { type: sql.NVarChar, value: text(input.user?.userId, 100) },
          name: { type: sql.NVarChar, value: text(input.user?.userName, 100) } };
        let update;
        if (request.action === 'manage-archive') {
          update = `UPDATE WebSalesDefectDeduction SET IsDeleted=1,Status=N'DELETED',DeletedBy=@by,DeletedAt=GETDATE(),
            UpdatedBy=@by,UpdatedByName=@name,UpdatedAt=GETDATE(),RowVersionNo=RowVersionNo+1
            OUTPUT INSERTED.DeductionKey WHERE DeductionKey=@key AND RowVersionNo=@version AND IsDeleted=0`;
        } else if (plan.noteOnly) {
          params.note = { type: sql.NVarChar, value: a.Note || '' };
          update = `UPDATE WebSalesDefectDeduction SET Note=@note,
            UpdatedBy=@by,UpdatedByName=@name,UpdatedAt=GETDATE(),RowVersionNo=RowVersionNo+1
            OUTPUT INSERTED.DeductionKey WHERE DeductionKey=@key AND RowVersionNo=@version AND IsDeleted=0`;
        } else {
          Object.assign(params, { ck: { type: sql.Int, value: a.CustKey }, cn: { type: sql.NVarChar, value: a.CustName },
            pk: { type: sql.Int, value: a.ProdKey }, pn: { type: sql.NVarChar, value: a.ProdName },
            qty: { type: sql.Decimal(18, 4), value: a.Quantity }, unit: { type: sql.NVarChar, value: a.SourceUnit },
            note: { type: sql.NVarChar, value: a.Note || '' }, reset: { type: sql.Bit, value: Boolean(plan.importReset) },
            original: { type: sql.Decimal(18, 4), value: a.OriginalQuantity ?? null },
            remaining: { type: sql.Decimal(18, 4), value: a.RemainingQuantity ?? null } });
          update = `UPDATE WebSalesDefectDeduction SET CustKey=@ck,CustName=@cn,ProdKey=@pk,ProdName=@pn,
            Quantity=@qty,SourceUnit=@unit,Note=@note,OriginalQuantity=@original,RemainingQuantity=@remaining,
            ImportConfirmed=CASE WHEN @reset=1 THEN 0 ELSE ImportConfirmed END,
            ImportConfirmedBy=CASE WHEN @reset=1 THEN N'' ELSE ImportConfirmedBy END,
            ImportConfirmedByName=CASE WHEN @reset=1 THEN N'' ELSE ImportConfirmedByName END,
            ImportConfirmedAt=CASE WHEN @reset=1 THEN NULL ELSE ImportConfirmedAt END,
            UpdatedBy=@by,UpdatedByName=@name,UpdatedAt=GETDATE(),RowVersionNo=RowVersionNo+1
            OUTPUT INSERTED.DeductionKey WHERE DeductionKey=@key AND RowVersionNo=@version AND IsDeleted=0`;
        }
        const saved = await tQuery(update, params);
        if (saved.recordset?.length !== 1) { const e = new Error('원장이 변경됐습니다. 다시 조회하세요.'); e.statusCode = 409; throw e; }
        const after = await getStoredRow(tQuery, plan.deductionKey);
        await tQuery(`INSERT INTO WebSalesDefectDeductionHistory
          (DeductionKey,ActionType,ChangedBy,ChangedByName,ChangeSummary,BeforeJson,AfterJson)
          VALUES (@key,@action,@by,@name,@summary,@before,@after)`, {
          key: params.key, action: { type: sql.NVarChar, value: plan.action }, by: params.by, name: params.name,
          summary: { type: sql.NVarChar, value: text(`${plan.action}: 웹 원장 관리; 연결 견적·적용 이력 보존${input.reason ? ` / ${text(input.reason, 1000)}` : ''}`, 1000) },
          before: { type: sql.NVarChar, value: JSON.stringify(plan.before) },
          after: { type: sql.NVarChar, value: JSON.stringify({ ...after, managementReason: text(input.reason, 1000) }) },
        });
        result.push({ ...snapshot(after), noteOnly: plan.noteOnly });
      }
      return { preview: false, beforeCount: plans.length,
        afterCount: request.action === 'manage-archive' ? 0 : result.length,
        archived: request.action === 'manage-archive' ? result.length : 0,
        updated: request.action === 'manage-edit' ? result.length : 0, rows: result };
    });
  } catch (error) { error.operationStage = operationStage; throw error; }
}

export async function permanentlyOmitDeductions({ year, week, rows, user }, deps = {}) {
  if (!omissionSupport(user)) throw Object.assign(Error('영업지원 권한이 필요합니다.'), { statusCode: 403 });
  if (!Array.isArray(rows) || !rows.length || rows.length > 500 || new Set(rows.map(r => r.deductionKey)).size !== rows.length) throw Error('누락 처리할 행을 선택하세요.');
  return (deps.transaction || withTransaction)(async q => {
    const result = [];
    for (const selected of rows) {
      const row = await getStoredRow(q, Number(selected.deductionKey), true);
      if (!row || row.IsDeleted || Number(row.RowVersionNo) !== Number(selected.expectedRowVersionNo)) throw Error('원장이 변경됐습니다. 다시 조회하세요.');
      assertRegistrationScope(row, normalizeYear(year), normalizeParentWeek(week));
      if (row.EstimateKey || ['REGISTERED', 'COMPLETED', 'MANUAL_COMPLETED'].includes(row.Status)) throw Error('이미 처리된 행은 누락 처리할 수 없습니다.');
      if (!row.CustKey || !row.ProdKey || !(row.Quantity > 0)) throw Error('업체·품목·수량을 확인하세요.');
      if (!row.PermanentOmitted) await q(`INSERT INTO WebSalesDefectDeductionHistory (DeductionKey,ActionType,ChangedBy,ChangedByName,ChangeSummary,BeforeJson,AfterJson) VALUES(@key,N'PERMANENT_OMIT',@by,@name,N'선택 누락 처리: 동일 업무자료 재업로드 고정 제외',@before,@after)`, { key: { type: sql.Int, value: row.DeductionKey }, by: { type: sql.NVarChar, value: text(user.userId, 100) }, name: { type: sql.NVarChar, value: text(user.userName, 100) }, before: { type: sql.NVarChar, value: JSON.stringify(snapshot(row)) }, after: { type: sql.NVarChar, value: JSON.stringify(snapshot(row)) } });
      result.push(row.DeductionKey);
    }
    return { omitted: result.length, ids: result };
  });
}

export async function filterPermanentlyOmittedRows({ year, week, rows }, q = query) {
  const accepted = [], excluded = [];
  const y = normalizeYear(year), w = normalizeParentWeek(week);
  if (!y || !w) throw Error('연도·차수를 확인하세요.');
  for (const row of rows) {
    const params = rowParams(normalizeDeductionRow(row), { year: y, week: w, user: {}, owner: { id: '', name: '' }, sourceFileName: '' });
    const found = await q(`SELECT 1 AS Omitted FROM (SELECT @year AS OrderYear,@week AS OrderWeek,@ck AS CustKey,@pk AS ProdKey,@qty AS Quantity,@unit AS SourceUnit)d WHERE ${omissionSql('d')}`, params);
    (found.recordset.length ? excluded : accepted).push(row);
  }
  return { rows: accepted, excludedCount: excluded.length };
}

export async function listOmissionHistory({ year, user }, q = query) {
  if (!omissionSupport(user)) throw Object.assign(Error('영업지원 권한이 필요합니다.'), { statusCode: 403 });
  const y = normalizeYear(year); if (!y) throw Error('연도를 확인하세요.');
  const r = await q(`SELECT h.HistoryKey,h.DeductionKey,h.ChangedAt,h.ChangedByName,h.AfterJson,
  CASE WHEN EXISTS(SELECT 1 FROM WebSalesDefectDeductionHistory c WHERE c.ActionType=N'PERMANENT_OMIT_CANCEL' AND TRY_CONVERT(INT,JSON_VALUE(CASE WHEN ISJSON(c.AfterJson)=1 THEN c.AfterJson ELSE N'{}' END,N'$.omissionHistoryKey'))=h.HistoryKey) THEN 1 ELSE 0 END AS Cancelled
  FROM WebSalesDefectDeductionHistory h WHERE h.ActionType=N'PERMANENT_OMIT' AND TRY_CONVERT(INT,JSON_VALUE(CASE WHEN ISJSON(h.AfterJson)=1 THEN h.AfterJson ELSE N'{}' END,N'$.orderYear'))=@year ORDER BY h.HistoryKey DESC`, { year: { type: sql.Int, value: y } });
  return r.recordset.map(h => ({ historyKey: h.HistoryKey, deductionKey: h.DeductionKey, changedAt: h.ChangedAt, changedByName: h.ChangedByName, cancelled: Boolean(h.Cancelled), ...JSON.parse(h.AfterJson) }));
}

export async function cancelPermanentOmission({ year, historyKey, user }, deps = {}) {
  if (!omissionSupport(user)) throw Object.assign(Error('영업지원 권한이 필요합니다.'), { statusCode: 403 });
  const y = normalizeYear(year), key = Number(historyKey); if (!y || !Number.isSafeInteger(key) || key <= 0) throw Error('누락 이력을 선택하세요.');
  return (deps.transaction || withTransaction)(async q => {
    const r = await q(`SELECT * FROM WebSalesDefectDeductionHistory WITH(UPDLOCK,HOLDLOCK) WHERE HistoryKey=@key AND ActionType=N'PERMANENT_OMIT'`, { key: { type: sql.Int, value: key } });
    const h = r.recordset[0]; if (!h || Number(JSON.parse(h.AfterJson).orderYear) !== y) throw Error('같은 연도의 누락 이력이 아닙니다.');
    const cancelled = await q(`SELECT HistoryKey FROM WebSalesDefectDeductionHistory WITH(UPDLOCK,HOLDLOCK) WHERE ActionType=N'PERMANENT_OMIT_CANCEL' AND TRY_CONVERT(INT,JSON_VALUE(CASE WHEN ISJSON(AfterJson)=1 THEN AfterJson ELSE N'{}' END,N'$.omissionHistoryKey'))=@key`, { key: { type: sql.Int, value: key } });
    if (cancelled.recordset.length) return { cancelled: true, alreadyCancelled: true };
    await q(`INSERT INTO WebSalesDefectDeductionHistory(DeductionKey,ActionType,ChangedBy,ChangedByName,ChangeSummary,BeforeJson,AfterJson) VALUES(@deduction,N'PERMANENT_OMIT_CANCEL',@by,@name,N'누락 처리 취소: 정상 등록 검사 재적용',@before,@after)`, { deduction: { type: sql.Int, value: h.DeductionKey }, by: { type: sql.NVarChar, value: text(user.userId, 100) }, name: { type: sql.NVarChar, value: text(user.userName, 100) }, before: { type: sql.NVarChar, value: h.AfterJson }, after: { type: sql.NVarChar, value: JSON.stringify({ omissionHistoryKey: key }) } });
    return { cancelled: true };
  });
}

export async function setSupportManualHold({ year, week, rows, hold, user, preview = false }, deps = {}) {
  if (!omissionSupport(user)) throw Object.assign(Error('영업지원 권한이 필요합니다.'), { statusCode: 403 });
  const y = normalizeYear(year), w = normalizeParentWeek(week);
  if (!y || !w || typeof hold !== 'boolean' || !Array.isArray(rows) || !rows.length || rows.length > 500
    || rows.some(r => !Number.isSafeInteger(Number(r.deductionKey)) || Number(r.deductionKey) <= 0)
    || new Set(rows.map(r => Number(r.deductionKey))).size !== rows.length) throw Error('보류 처리할 연도·차수와 항목을 확인하세요.');
  return (deps.transaction || withTransaction)(async q => {
    const plans = [];
    for (const selected of [...rows].sort((a, b) => Number(a.deductionKey) - Number(b.deductionKey))) {
      const row = await getStoredRow(q, Number(selected.deductionKey), true);
      if (!row || row.IsDeleted || Number(row.OrderYear) !== Number(selected.sourceYear) || String(row.OrderWeek) !== String(selected.sourceWeek)
        || Number(row.RowVersionNo) !== Number(selected.expectedRowVersionNo)
        || !Number.isSafeInteger(selected.expectedHoldHistoryKey)) throw Error('원장 또는 보류 상태가 변경됐습니다. 다시 조회하세요.');
      if (Number(row.ManualHoldHistoryKey || 0) !== selected.expectedHoldHistoryKey) {
        const requestKey = deps.registrationRequestKey;
        if (!requestKey || !hold || !row.ManualHeld) throw Error('보류 상태가 변경됐습니다. 다시 조회하세요.');
        const prior = await q(`SELECT AfterJson FROM WebSalesDefectDeductionHistory
          WHERE HistoryKey=@historyKey AND DeductionKey=@key AND ActionType=N'SUPPORT_HOLD'`, {
          historyKey: { type: sql.Int, value: Number(row.ManualHoldHistoryKey) },
          key: { type: sql.Int, value: Number(row.DeductionKey) },
        });
        if (JSON.parse(prior.recordset[0]?.AfterJson || '{}').registrationRequestKey !== requestKey) {
          throw Error('보류 상태가 변경됐습니다. 다시 조회하세요.');
        }
      }
      if (!isEarlierOrSameScope(row.OrderYear, row.OrderWeek, y, w)) throw Error('선택 차수 이후의 불량은 처리할 수 없습니다.');
      if (hold && ((!row.MissingLinkedEstimate && (row.EstimateKey || ['REGISTERED', 'COMPLETED', 'MANUAL_COMPLETED'].includes(row.Status))) || row.Status === 'MANUAL_COMPLETED')) throw Error('이미 처리된 행은 보류로 이동할 수 없습니다.');
      plans.push({ row, changed: Boolean(row.ManualHeld) !== hold });
    }
    if (preview === true) return { preview: true, changed: plans.filter(p => p.changed).length, ids: plans.map(p => p.row.DeductionKey), held: hold };
    for (const { row, changed } of plans) if (changed) {
      const before = snapshot(row);
      await writeHistory(q, { key: row.DeductionKey, action: hold ? 'SUPPORT_HOLD' : 'SUPPORT_RESUME', user, before, after: {
        ...before, manualHeld: hold,
        ...(deps.registrationRequestKey && { registrationRequestKey: deps.registrationRequestKey }),
      } });
    }
    return { changed: plans.filter(p => p.changed).length, ids: plans.map(p => p.row.DeductionKey), held: hold };
  });
}
