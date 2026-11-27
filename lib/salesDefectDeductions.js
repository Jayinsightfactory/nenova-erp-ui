import { defectCostScope, defectRecentCostSql } from './defectCostCandidates.js';
import { omissionSql } from './defectPermanentOmission.js';
import { defectCarryoverAllowed } from './defectCarryoverChoice.js';
import { query, sql, withTransaction } from './db.js';
import { acquireEstimateDuplicateWriteLock } from './estimateDuplicateWriteGuard.js';
import {
  normalizeDeductionRow,
  isEarlierOrSameScope,
  normalizeDefectUnit,
  normalizeParentWeek,
  normalizeUnit,
  normalizeYear,
  previousParentScope,
} from './salesDefectDeductionCore.js';
import {
  assertDeductionMutationOwnership,
  collectDeductionEstimateKeys,
  explainDefectLedgerRegisterMiss,
  planManualProcessingComplete,
  runIsolatedRegistrationTransaction,
  shouldResetIncomingConfirmation,
} from './salesDefectDeductionState.js';
import { isSupportPendingRow, deriveSupportProcessingStatus, getSupportLinkedEstimate } from './salesDefectSupportStatus.js';
import { planReviewedSourceRelease } from './defectSourceRelease.js';
import { resolveDefectRowSourceFile } from './defectSourceProvenance.js';
import { applyManualCostContext, canEditManualCost, getManualCostOverride, resolveManualCostContext } from './salesDefectManualCost.js';
import {
  buildDefectEstimateTargetCandidatesSql,
  evaluateDefectRegistrationEligibility,
  selectExeEstimateTargetCandidate,
} from './defectEstimateTargetScope.js';
import {
  AUTO_SOURCE_ESTIMATE_CONFLICT,
  AUTO_SOURCE_ESTIMATE_CONFLICT_MESSAGE,
  assertNotDefectAutoSource,
  assertDefectSourceReviewed,
} from './salesDefectAutoSource.js';
import {
  text,
  matchSalesDefectRows,
  loadLookupData,
  loadMatchContext,
} from './salesDefect/lookupAndMatching.js';
import {
  loadManagerOptions,
  saveManagerOption,
  loadDefectCostCandidates,
} from './salesDefect/managerAndCostCandidates.js';
import {
  registrationQuantity,
  buildBaseDefectSnapshot,
  changeSummary,
  rowParams,
  queryEstimateTypeCode,
  queryEstimatePreview,
  loadProductPreview,
} from './salesDefect/snapshotAndSummary.js';
import {
  AUTO_SOURCE_D,
  AUTO_SOURCE_WD,
  assertRegisterable,
  assertRemainingForRegistration,
  assertConfirmedForRegistration,
  assertRegistrationScope,
} from './salesDefect/ledgerRowStore.js';
import {
  correctDraftPeriod,
  syncLinkedEstimate,
  assertIdempotentApplicationEstimateLive,
  manageDeductions,
  permanentlyOmitDeductions,
  filterPermanentlyOmittedRows,
  listOmissionHistory,
  cancelPermanentOmission,
  setSupportManualHold,
} from './salesDefect/ledgerAdminAndHold.js';

export {
  matchSalesDefectRows,
  loadLookupData,
  loadMatchContext,
  saveManagerOption,
  loadDefectCostCandidates,
  correctDraftPeriod,
  syncLinkedEstimate,
  assertIdempotentApplicationEstimateLive,
  manageDeductions,
  permanentlyOmitDeductions,
  filterPermanentlyOmittedRows,
  listOmissionHistory,
  cancelPermanentOmission,
  setSupportManualHold,
};

let ensurePromise = null;

export async function releaseReviewedSources(input, deps = {}) {
  const transact = deps.withTransaction || withTransaction;
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 100
    || new Set(input.rows.map(r => Number(r.deductionKey))).size !== input.rows.length
    || (input.preview !== true && input.preview !== false)) throw new Error('원문 재검토 대상과 미리보기 여부를 확인하세요.');
  return transact(async (tQuery) => {
    const plans = [];
    for (const selection of input.rows) {
      const row = await getStoredRow(tQuery, Number(selection.deductionKey), true);
      const apps = await tQuery('SELECT DeductionKey FROM WebSalesCarryoverApplication WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key', { key: { type: sql.Int, value: Number(selection.deductionKey) } });
      const linked = row?.EstimateKey ? await tQuery('SELECT e.EstimateKey,e.ProdKey,e.Quantity,e.Unit,sm.CustKey,sm.OrderYear,sm.OrderWeek,sm.isDeleted AS MasterDeleted FROM Estimate e WITH (UPDLOCK,HOLDLOCK) LEFT JOIN ShipmentMaster sm WITH (UPDLOCK,HOLDLOCK) ON sm.ShipmentKey=e.ShipmentKey WHERE e.EstimateKey=@ek', { ek: { type: sql.Int, value: Number(row.EstimateKey) } }) : { recordset: [] };
      const plan = planReviewedSourceRelease({ ...input, selection: { ...selection, linkedEstimateExists: linked.recordset.length > 0, linkedEstimate: linked.recordset[0] }, row, applications: apps.recordset });
      plans.push({ selection, row, plan });
    }
    if (input.preview) return { preview: true, rows: plans.map(({ row, plan }) => ({ deductionKey: Number(row.DeductionKey), action: plan.manualProvenance ? 'MANUAL_SOURCE_CONFIRM' : plan.retainLinked ? 'SOURCE_REVIEW_CONFIRM' : 'SOURCE_REVIEW_RELEASE' })) };
    for (const { selection, row, plan } of plans) {
      const reset = plan.retainLinked ? '' : `EstimateKey=NULL,EstimateCost=NULL,EstimateDtm=NULL,
        AppliedOrderYear=NULL,AppliedOrderWeek=NULL,AppliedShipmentKey=NULL,AppliedCostSourceYear=NULL,AppliedCostSourceWeek=NULL,
        Status=N'DRAFT',`;
      const result = plan.manualProvenance ? { rowsAffected: [1] } : await tQuery(`UPDATE WebSalesDefectDeduction SET ${reset}RowVersionNo=RowVersionNo+1,UpdatedAt=GETDATE(),UpdatedBy=@by,UpdatedByName=@name
        WHERE DeductionKey=@key AND OrderYear=@year AND RowVersionNo=@version AND IsDeleted=0`, {
        key: { type: sql.Int, value: Number(row.DeductionKey) }, year: { type: sql.Int, value: Number(input.year) },
        version: { type: sql.Int, value: Number(selection.expectedRowVersionNo) },
        by: { type: sql.NVarChar, value: text(input.user?.userId, 100) }, name: { type: sql.NVarChar, value: text(input.user?.userName, 100) },
      });
      if (result.rowsAffected?.[0] !== 1) throw new Error('원문 검토 저장 중 버전이 변경됐습니다.');
      const resetSnapshot = plan.retainLinked ? {} : {
        status: 'DRAFT', estimateKey: null, estimateCost: null, estimateDtm: null,
        appliedOrderYear: null, appliedOrderWeek: '', appliedShipmentKey: null, appliedCostSourceYear: null, appliedCostSourceWeek: '',
      };
      const after = {
        ...snapshot(row), ...resetSnapshot, incompleteAutoSource: false, manualSourceConfirmed: plan.manualProvenance,
        ...(plan.manualProvenance ? { autoSourceExcluded: false, autoSourceEvidence: 'MANUAL_SOURCE_CONFIRMED' } : {}),
        rowVersionNo: plan.reviewedRowVersionNo, rejectedAutoSource: false, missingLinkedEstimate: false, reviewedRowVersionNo: plan.reviewedRowVersionNo,
        reviewedSourceFileName: row.SourceFileName || '', sourceReviewEvidence: plan.evidence,
      };
      await writeHistory(tQuery, { key: Number(row.DeductionKey), action: plan.manualProvenance ? 'MANUAL_SOURCE_CONFIRM' : plan.retainLinked ? 'SOURCE_REVIEW_CONFIRM' : 'SOURCE_REVIEW_RELEASE', user: input.user, before: snapshot(row), after });
    }
    return { preview: false, released: plans.length, rows: plans.map(({ row }) => ({ deductionKey: Number(row.DeductionKey) })) };
  });
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function assertMutationOwner(row, user) {
  try { assertDeductionMutationOwnership(row, user); }
  catch (error) { throw forbidden(error.message); }
}

export async function ensureSalesDefectTables() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = query(`
    IF OBJECT_ID(N'dbo.WebSalesDefectDeduction', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebSalesDefectDeduction (
        DeductionKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        OrderYear INT NOT NULL,
        OrderWeek NVARCHAR(10) NOT NULL,
        AppliedOrderYear INT NULL,
        AppliedOrderWeek NVARCHAR(10) NULL,
        AppliedShipmentKey INT NULL,
        AppliedCostSourceYear INT NULL,
        AppliedCostSourceWeek NVARCHAR(10) NULL,
        CustKey INT NULL,
        CustName NVARCHAR(200) NOT NULL DEFAULT N'',
        ProdKey INT NULL,
        ProdName NVARCHAR(300) NOT NULL DEFAULT N'',
        ColorName NVARCHAR(200) NOT NULL DEFAULT N'',
        Quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
        SourceUnit NVARCHAR(30) NOT NULL DEFAULT N'',
        CreditApplied BIT NOT NULL DEFAULT 0,
        FarmKey INT NULL,
        FarmName NVARCHAR(200) NOT NULL DEFAULT N'',
        ImportConfirmed BIT NOT NULL DEFAULT 0,
        ImportConfirmedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        ImportConfirmedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        ImportConfirmedAt DATETIME NULL,
        ImportReviewRequired BIT NOT NULL DEFAULT 0,
        Note NVARCHAR(1000) NOT NULL DEFAULT N'',
        DeductionType NVARCHAR(50) NOT NULL DEFAULT N'불량차감',
        EstimateKey INT NULL,
        EstimateCost DECIMAL(18,4) NULL,
        EstimateDtm DATETIME NULL,
        Status NVARCHAR(20) NOT NULL DEFAULT N'DRAFT',
        SourceFileName NVARCHAR(300) NOT NULL DEFAULT N'',
        CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        CreatedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        UpdatedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        IsDeleted BIT NOT NULL DEFAULT 0,
        DeletedBy NVARCHAR(100) NULL,
        DeletedAt DATETIME NULL,
        RowVersionNo INT NOT NULL DEFAULT 1
      );
      CREATE INDEX IX_WebSalesDefectDeduction_Week
        ON dbo.WebSalesDefectDeduction(OrderYear, OrderWeek, IsDeleted, CustKey);
      CREATE INDEX IX_WebSalesDefectDeduction_Estimate
        ON dbo.WebSalesDefectDeduction(EstimateKey) WHERE EstimateKey IS NOT NULL;
    END;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'ImportConfirmed') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD ImportConfirmed BIT NOT NULL CONSTRAINT DF_WebSalesDefectDeduction_ImportConfirmed DEFAULT 0;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'ImportConfirmedBy') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD ImportConfirmedBy NVARCHAR(100) NOT NULL CONSTRAINT DF_WebSalesDefectDeduction_ImportConfirmedBy DEFAULT N'';
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'ImportConfirmedByName') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD ImportConfirmedByName NVARCHAR(100) NOT NULL CONSTRAINT DF_WebSalesDefectDeduction_ImportConfirmedByName DEFAULT N'';
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'ImportConfirmedAt') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD ImportConfirmedAt DATETIME NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'ImportReviewRequired') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD ImportReviewRequired BIT NOT NULL CONSTRAINT DF_WebSalesDefectDeduction_ImportReviewRequired DEFAULT 0;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'AppliedOrderYear') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD AppliedOrderYear INT NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'AppliedOrderWeek') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD AppliedOrderWeek NVARCHAR(10) NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'AppliedShipmentKey') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD AppliedShipmentKey INT NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'AppliedCostSourceYear') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD AppliedCostSourceYear INT NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'AppliedCostSourceWeek') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD AppliedCostSourceWeek NVARCHAR(10) NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'IsCarryoverLedger') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD IsCarryoverLedger BIT NOT NULL CONSTRAINT DF_WebSalesDefectDeduction_IsCarryoverLedger DEFAULT 0;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'OriginalQuantity') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD OriginalQuantity DECIMAL(18,4) NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'RemainingQuantity') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD RemainingQuantity DECIMAL(18,4) NULL;
    IF OBJECT_ID(N'dbo.WebSalesCarryoverApplication', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebSalesCarryoverApplication (
        ApplicationKey BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        DeductionKey INT NOT NULL,
        EstimateKey INT NOT NULL,
        AppliedOrderYear INT NOT NULL,
        AppliedOrderWeek NVARCHAR(10) NOT NULL,
        AppliedShipmentKey INT NOT NULL,
        AppliedQuantity DECIMAL(18,4) NOT NULL,
        AppliedCost DECIMAL(18,4) NOT NULL,
        AppliedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        AppliedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        RequestKey NVARCHAR(100) NULL,
        AppliedAt DATETIME NOT NULL DEFAULT GETDATE()
      );
      CREATE INDEX IX_WebSalesCarryoverApplication_Deduction
        ON dbo.WebSalesCarryoverApplication(DeductionKey, AppliedAt DESC);
    END;
    IF COL_LENGTH(N'dbo.WebSalesCarryoverApplication', N'RequestKey') IS NULL
      ALTER TABLE dbo.WebSalesCarryoverApplication ADD RequestKey NVARCHAR(100) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebSalesCarryoverApplication') AND name=N'UX_WebSalesCarryoverApplication_Request')
      EXEC(N'CREATE UNIQUE INDEX UX_WebSalesCarryoverApplication_Request
        ON dbo.WebSalesCarryoverApplication(DeductionKey, RequestKey) WHERE RequestKey IS NOT NULL');
    IF OBJECT_ID(N'dbo.WebSalesDefectDeductionHistory', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebSalesDefectDeductionHistory (
        HistoryKey BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        DeductionKey INT NOT NULL,
        ActionType NVARCHAR(30) NOT NULL,
        ChangedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        ChangedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        ChangedAt DATETIME NOT NULL DEFAULT GETDATE(),
        ChangeSummary NVARCHAR(1000) NOT NULL DEFAULT N'',
        BeforeJson NVARCHAR(MAX) NULL,
        AfterJson NVARCHAR(MAX) NULL
      );
      CREATE INDEX IX_WebSalesDefectDeductionHistory_Row
        ON dbo.WebSalesDefectDeductionHistory(DeductionKey, ChangedAt DESC);
    END;
    IF OBJECT_ID(N'dbo.WebSalesDefectManager', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebSalesDefectManager (
        ManagerKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ManagerId NVARCHAR(100) NOT NULL,
        ManagerName NVARCHAR(100) NOT NULL,
        SortOrder INT NOT NULL DEFAULT 0,
        IsDeleted BIT NOT NULL DEFAULT 0,
        CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        UpdatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE()
      );
      CREATE UNIQUE INDEX UX_WebSalesDefectManager_ActiveId
        ON dbo.WebSalesDefectManager(ManagerId) WHERE IsDeleted=0;
    END;
    INSERT INTO dbo.WebSalesDefectManager (ManagerId, ManagerName, SortOrder)
    SELECT N'김원영', N'김원영', 10
    WHERE NOT EXISTS (SELECT 1 FROM dbo.WebSalesDefectManager WHERE ManagerId=N'김원영' AND IsDeleted=0);
    INSERT INTO dbo.WebSalesDefectManager (ManagerId, ManagerName, SortOrder)
    SELECT N'박성수', N'박성수', 20
    WHERE NOT EXISTS (SELECT 1 FROM dbo.WebSalesDefectManager WHERE ManagerId=N'박성수' AND IsDeleted=0);
    INSERT INTO dbo.WebSalesDefectManager (ManagerId, ManagerName, SortOrder)
    SELECT N'정재훈', N'정재훈', 30
    WHERE NOT EXISTS (SELECT 1 FROM dbo.WebSalesDefectManager WHERE ManagerId=N'정재훈' AND IsDeleted=0);
    INSERT INTO dbo.WebSalesDefectManager (ManagerId, ManagerName, SortOrder)
    SELECT N'조현욱', N'조현욱', 40
    WHERE NOT EXISTS (SELECT 1 FROM dbo.WebSalesDefectManager WHERE ManagerId=N'조현욱' AND IsDeleted=0);
  `, {}).catch((error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
}

export async function resolveEstimateContext({ year, week, custKey, prodKey }, q = query) {
  const scope = defectCostScope(year, week);
  const parentWeek = normalizeParentWeek(week);
  const target = await q(
    buildDefectEstimateTargetCandidatesSql({ customerOnly: true }),
    {
      yr: { type: sql.Int, value: Number(year) },
      ck: { type: sql.Int, value: Number(custKey) },
      week: { type: sql.Int, value: Number(parentWeek) },
    },
  );
  let previousRow = null;
  try {
    const previous = await q(
      defectRecentCostSql(),
      {
        ck: { type: sql.Int, value: Number(custKey) },
        pk: { type: sql.Int, value: Number(prodKey) },
        scopeYear: { type: sql.Int, value: scope.year },
        scopeWeek: { type: sql.Int, value: scope.maxWeek },
        minWeek: { type: sql.Int, value: scope.minWeek },
      },
    );
    previousRow = previous.recordset[0] || null;
  } catch (cause) {
    const error = new Error('출고단가 조회에 실패했습니다. 단가가 없는 것으로 처리하지 않았습니다. 다시 조회하세요.', { cause });
    error.code = 'COST_LOOKUP_FAILED';
    throw error;
  }
  let rawUnit = '';
  try {
    const product = await q(
      `SELECT TOP 1 EstUnit, OutUnit FROM Product WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
      { pk: { type: sql.Int, value: Number(prodKey) } },
    );
    rawUnit = product.recordset[0]?.EstUnit || product.recordset[0]?.OutUnit || '';
  } catch {
    rawUnit = '';
  }
  const targetRow = selectExeEstimateTargetCandidate(target.recordset || []);
  return {
    shipmentKey: targetRow?.ShipmentKey ? Number(targetRow.ShipmentKey) : null,
    shipmentOrderWeek: targetRow?.OrderWeek || '',
    shipmentProductKey: targetRow?.ShipmentProdKey ? Number(targetRow.ShipmentProdKey) : null,
    estimateDate: targetRow?.ShipmentDtm || null,
    targetIsFix: Number(targetRow?.MasterFix || 0) === 1
      && Number(targetRow?.ShipmentDetailFix || 0) === 1,
    cost: Number(previousRow?.Cost || 0),
    costSource: previousRow?.CostSource || '',
    costOrderWeek: previousRow?.SourceOrderWeek || `${scope.maxWeek}차`,
    costShipmentKey: previousRow?.SourceShipmentKey ? Number(previousRow.SourceShipmentKey) : null,
    unit: rawUnit,
    displayUnit: normalizeDefectUnit(rawUnit),
    costSourceYear: previousRow?.SourceOrderYear ? Number(previousRow.SourceOrderYear) : null,
    costSourceWeek: previousRow?.SourceOrderWeek || '',
    costSourceCustomer: previousRow?.SourceCustName || '',
  };
}

async function enrichSupportDistributionCosts(rows, { year, week } = {}) {
  const pairs = [...new Map((rows || [])
    .filter((row) => Number(row.custKey || 0) > 0 && Number(row.prodKey || 0) > 0)
    .map((row) => {
      const custKey = Number(row.custKey);
      const prodKey = Number(row.prodKey);
      return [`${custKey}:${prodKey}`, { custKey, prodKey }];
    })).values()];
  if (!pairs.length) return rows;

  const contexts = new Map(await Promise.all(pairs.map(async (pair) => {
    try {
      const context = await resolveEstimateContext({ year, week, ...pair });
      return [`${pair.custKey}:${pair.prodKey}`, context];
    } catch (error) {
      return [`${pair.custKey}:${pair.prodKey}`, { lookupError: error.code || 'CONTEXT_LOOKUP_FAILED' }];
    }
  })));
  const existingEstimates = await loadExistingEstimateDeductions({ year, week });
  const existingByPair = new Map();
  const existingByCustomer = new Map();
  for (const estimate of existingEstimates) {
    const pairKey = `${estimate.custKey}:${estimate.prodKey}`;
    const bucket = existingByPair.get(pairKey) || [];
    bucket.push(estimate);
    existingByPair.set(pairKey, bucket);
    const customerBucket = existingByCustomer.get(estimate.custKey) || [];
    customerBucket.push(estimate);
    existingByCustomer.set(estimate.custKey, customerBucket);
  }
  const rowOverrides = new Map(await Promise.all((rows || []).map(async (row) => [
    Number(row.deductionKey || 0),
    !row.estimateKey && !['REGISTERED', 'COMPLETED', 'MANUAL_COMPLETED'].includes(row.status) ? await getManualCostOverride({
      row: { DeductionKey: row.deductionKey, CustKey: row.custKey, ProdKey: row.prodKey, SourceUnit: row.sourceUnit },
      targetYear: year, targetWeek: week, estimateUnit: contexts.get(`${Number(row.custKey)}:${Number(row.prodKey)}`)?.unit,
    }) : null,
  ])));
  return (rows || []).map((row) => {
    const storedCost = row.estimateKey ? Number(row.estimateCost || 0) : 0;
    const context = contexts.get(`${Number(row.custKey || 0)}:${Number(row.prodKey || 0)}`);
    const manualOverride = rowOverrides.get(Number(row.deductionKey || 0));
    const effectiveContext = applyManualCostContext(context, manualOverride);
    const cost = storedCost > 0 ? storedCost : Number(effectiveContext?.cost || 0);
    const pairRecords = existingByPair.get(`${Number(row.custKey || 0)}:${Number(row.prodKey || 0)}`) || [];
    const records = existingByCustomer.get(Number(row.custKey || 0)) || [];
    const targetQuantity = Math.abs(registrationQuantity(row));
    const targetUnit = normalizeDefectUnit(context?.unit || row.sourceUnit || row.unit);
    const ownEstimateKey = Number(row.estimateKey || 0);
    const exactExistingRecords = pairRecords.filter((record) => record.estimateKey !== ownEstimateKey
      && Math.abs(Math.abs(Number(record.quantity || 0)) - targetQuantity) < 0.0001
      && normalizeDefectUnit(record.unit) === targetUnit);
    const exactExisting = exactExistingRecords.find((record) => record.autoSourceLinked) || exactExistingRecords[0];
    const exactExistingAutoSource = Boolean(exactExisting?.autoSourceLinked);
    const enriched = {
      ...row,
      distributionCost: cost > 0 ? cost : null,
      distributionCostCustomer: effectiveContext?.costSourceCustomer || '',
      distributionCostSource: storedCost > 0 ? 'Estimate' : (effectiveContext?.costSource || ''),
      distributionCostOrderWeek: row.appliedCostSourceWeek || effectiveContext?.costOrderWeek || '',
      manualCost: manualOverride?.cost > 0 ? manualOverride.cost : null,
      distributionCostUnit: effectiveContext?.unit || '',
      manualCostEditable: !exactExisting && canEditManualCost({
        ...row,
        DeductionKey: row.deductionKey, CustKey: row.custKey, ProdKey: row.prodKey,
        EstimateKey: row.estimateKey, Status: row.status, Quantity: row.quantity,
        RemainingQuantity: row.remainingQuantity,
      }),
      rowVersionNo: Number(row.rowVersionNo || row.RowVersionNo || 0),
      customerTargetRegistered: Boolean(effectiveContext?.shipmentKey),
      carryoverClassification: effectiveContext?.shipmentKey ? 'REGISTERED_CUSTOMER' : 'SURPLUS',
      existingEstimateRecords: records,
      existingEstimateCount: records.length,
      exactExistingEstimate: Boolean(exactExisting),
      exactExistingEstimateKey: exactExisting?.estimateKey || null,
      exactExistingAutoSource,
    };
    const eligibility = evaluateDefectRegistrationEligibility({
      row: enriched, context: effectiveContext, exactExistingEstimate: Boolean(exactExisting), exactExistingAutoSource,
    });
    const withEligibility = {
      ...enriched,
      registrationEligible: eligibility.eligible,
      registrationEligibilityCode: eligibility.code,
      registrationError: eligibility.error,
      targetShipmentKey: effectiveContext?.shipmentKey || null,
      targetOrderWeek: context?.shipmentOrderWeek || '',
    };
    return { ...withEligibility, ...deriveSupportProcessingStatus(withEligibility) };
  });
}

async function loadExistingEstimateDeductions({ year, week, custKey = 0, prodKey = 0, lock = false } = {}, q = query) {
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) return [];
  const result = await q(
    `SELECT e.EstimateKey, e.EstimateType, e.EstimateDtm, e.ProdKey, e.Unit,
            e.Quantity, e.Cost, e.Amount, e.Vat, e.Descr, e.ShipmentKey,
            sm.OrderYear, sm.OrderWeek, sm.CustKey, p.ProdName, p.DisplayName,
            COALESCE(NULLIF(ci.Descr2,N''),NULLIF(ci.Descr,N''),e.EstimateType) AS EstimateTypeLabel,
            CASE WHEN EXISTS (
              SELECT 1 FROM WebSalesDefectDeduction wd
               WHERE wd.EstimateKey=e.EstimateKey AND ISNULL(wd.IsDeleted,0)=0
            ) THEN 1 ELSE 0 END AS WebLinked,
            CASE WHEN EXISTS (
              SELECT 1 FROM WebSalesDefectDeduction wd
               WHERE wd.EstimateKey=e.EstimateKey
                 AND ${AUTO_SOURCE_WD.predicate}
            ) THEN 1 ELSE 0 END AS AutoSourceLinked
       FROM Estimate e ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
       JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
       LEFT JOIN Product p ON p.ProdKey=e.ProdKey
       LEFT JOIN CodeInfo ci ON ci.Category=N'EstimateType' AND ci.DetailCode=e.EstimateType
      WHERE sm.OrderYear=@year
        AND TRY_CONVERT(INT,LEFT(sm.OrderWeek,CHARINDEX(N'-',sm.OrderWeek+N'-')-1))=@week
        AND ISNULL(sm.isDeleted,0)=0 AND e.Quantity<0
        AND (@custKey=0 OR sm.CustKey=@custKey)
        AND (@prodKey=0 OR e.ProdKey=@prodKey)
      ORDER BY sm.CustKey,e.ProdKey,e.EstimateDtm DESC,e.EstimateKey DESC`,
    {
      year: { type: sql.Int, value: y },
      week: { type: sql.Int, value: Number(w) },
      custKey: { type: sql.Int, value: Number(custKey || 0) },
      prodKey: { type: sql.Int, value: Number(prodKey || 0) },
    },
  );
  return result.recordset.map((row) => ({
    estimateKey: Number(row.EstimateKey), estimateType: row.EstimateType || '',
    estimateTypeLabel: row.EstimateTypeLabel || row.EstimateType || '', estimateDtm: row.EstimateDtm,
    prodKey: Number(row.ProdKey), productName: row.DisplayName || row.ProdName || '', unit: row.Unit || '', quantity: Number(row.Quantity || 0),
    cost: Number(row.Cost || 0), amount: Number(row.Amount || 0), vat: Number(row.Vat || 0),
    descr: row.Descr || '', shipmentKey: Number(row.ShipmentKey), orderYear: Number(row.OrderYear),
    orderWeek: String(row.OrderWeek || ''), custKey: Number(row.CustKey), webLinked: Boolean(row.WebLinked),
    autoSourceLinked: Boolean(row.AutoSourceLinked),
  }));
}

async function assertNoExactUnlinkedEstimate(tQuery, { year, week, row, quantity, unit, lock = false }) {
  if (lock) {
    await acquireEstimateDuplicateWriteLock(tQuery, {
      year,
      parentWeek: week,
      custKey: row.CustKey,
      prodKey: row.ProdKey,
    });
  }
  const records = await loadExistingEstimateDeductions({
    year, week, custKey: row.CustKey, prodKey: row.ProdKey, lock,
  }, tQuery);
  const targetQuantity = Math.abs(Number(quantity ?? registrationQuantity(row)));
  const targetUnit = normalizeDefectUnit(unit || row.SourceUnit || row.Unit);
  const ownEstimateKey = Number(row.EstimateKey || 0);
  const duplicates = records.filter((record) => record.estimateKey !== ownEstimateKey
    && Math.abs(Math.abs(record.quantity) - targetQuantity) < 0.0001
    && normalizeDefectUnit(record.unit) === targetUnit);
  const duplicate = duplicates.find((record) => record.autoSourceLinked) || duplicates[0];
  if (duplicate) {
    if (duplicate.autoSourceLinked) {
      const error = new Error(`${row.CustName || row.CustomerName || `업체 #${row.CustKey}`} / ${row.ProdName || duplicate.productName || `품목 #${row.ProdKey}`} / ${targetQuantity}${targetUnit}: ${AUTO_SOURCE_ESTIMATE_CONFLICT_MESSAGE} (견적 #${duplicate.estimateKey})`);
      error.code = AUTO_SOURCE_ESTIMATE_CONFLICT;
      throw error;
    }
    const error = new Error(`${row.CustName || row.CustomerName || `업체 #${row.CustKey}`} / ${duplicate.productName || row.ProdName || `품목 #${row.ProdKey}`} / ${targetQuantity}${targetUnit}: ${year}년 ${week}차 기존 차감 견적 #${duplicate.estimateKey}과 중복됩니다.`);
    error.code = 'EXISTING_ESTIMATE';
    throw error;
  }
}

async function resolveEstimateTypeCode(typeText, q = query) {
  return queryEstimateTypeCode(typeText, q);
}

function snapshot(row) {
  const item = buildBaseDefectSnapshot(row);
  item.verifiedLinkedEstimate = getSupportLinkedEstimate(item);
  return item;
}

async function writeHistory(tQuery, { key, action, user, before, after }) {
  const summary = action === 'SUPPORT_HOLD' ? '담당자 선택 보류: 원장·견적 보존' : action === 'SUPPORT_RESUME' ? '담당자 보류 해제: 기존 등록조건 재검사' : action === 'MANUAL_SOURCE_CONFIRM' ? '사용자 수기입력 확인: 원천 표식 오분류 정정 (입력값·견적 보존)' : ['SOURCE_REVIEW_RELEASE', 'SOURCE_REVIEW_CONFIRM'].includes(action) ? '원문 대조 완료: 검토 해제 (실제 견적·ERP 보존)' : changeSummary(before, after, action);
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

async function getStoredSnapshot(q, key, { lock = false } = {}) {
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

function hasMatchingChange(before, after) {
  if (!before || !after) return false;
  return Number(before.custKey || 0) !== Number(after.custKey || 0)
    || Number(before.prodKey || 0) !== Number(after.prodKey || 0);
}

export async function listDeductions({ year, week, manager = '', includeDeleted = false, history = false, includeCarryover = false, carryoverOnly = false, importConfirmedOnly = false, pendingSupportOnly = false, includeAppliedSales = false } = {}) {
  const carryoverSchema = await query(
    `SELECT CASE WHEN COL_LENGTH(N'dbo.WebSalesDefectDeduction',N'IsCarryoverLedger') IS NOT NULL
                       AND COL_LENGTH(N'dbo.WebSalesDefectDeduction',N'RemainingQuantity') IS NOT NULL
                  THEN 1 ELSE 0 END AS IsReady`, {},
  );
  const carryoverReady = Number(carryoverSchema.recordset[0]?.IsReady || 0) === 1;
  const openCarryoverStatus = `ISNULL(d.Status,N'') NOT IN (N'MANUAL_COMPLETED', N'REGISTERED', N'COMPLETED', N'DELETED')`;
  const managerFilter = text(manager, 100);
  const params = {
    year: { type: sql.Int, value: Number(year) },
    week: { type: sql.NVarChar, value: String(Number(week)) },
    manager: { type: sql.NVarChar, value: managerFilter },
  };
  const scopeWhere = carryoverOnly && !carryoverReady
    ? '1=0'
    : carryoverOnly
    ? `(d.ImportConfirmed=1
        AND ((d.IsCarryoverLedger=1 AND ISNULL(d.RemainingQuantity,d.Quantity)>0 AND ${openCarryoverStatus})
             OR (d.IsCarryoverLedger=0 AND d.EstimateKey IS NULL AND ${openCarryoverStatus}))
        AND (d.OrderYear < @year
             OR (d.OrderYear=@year AND TRY_CONVERT(INT,d.OrderWeek)<=TRY_CONVERT(INT,@week))))`
    : includeCarryover && carryoverReady
    ? `(d.OrderYear=@year AND d.OrderWeek=@week
        OR (d.IsCarryoverLedger=1 AND ISNULL(d.RemainingQuantity,d.Quantity)>0
            AND ${openCarryoverStatus}
            AND (d.OrderYear < @year OR (d.OrderYear=@year AND TRY_CONVERT(INT,d.OrderWeek)<=TRY_CONVERT(INT,@week))))
        OR (d.IsCarryoverLedger=0 AND d.EstimateKey IS NULL AND ${openCarryoverStatus}
            AND (d.OrderYear < @year
            OR (d.OrderYear=@year AND TRY_CONVERT(INT, d.OrderWeek) < TRY_CONVERT(INT, @week))))
        OR (${AUTO_SOURCE_D.predicate}
            AND d.AppliedOrderYear=@year
            AND TRY_CONVERT(INT,d.AppliedOrderWeek)=TRY_CONVERT(INT,@week)))`
    : includeCarryover
    ? `(d.OrderYear=@year AND d.OrderWeek=@week
        OR (d.EstimateKey IS NULL AND ${openCarryoverStatus} AND (d.OrderYear < @year
            OR (d.OrderYear=@year AND TRY_CONVERT(INT,d.OrderWeek)<TRY_CONVERT(INT,@week)))))`
    : includeAppliedSales
    ? `((d.OrderYear=@year AND d.OrderWeek=@week)
        OR (d.IsDeleted=0 AND linkedSm.OrderYear=@year
            AND TRY_CONVERT(INT,LEFT(linkedSm.OrderWeek,2))=TRY_CONVERT(INT,@week))
        ${carryoverReady ? `OR (d.IsDeleted=0 AND EXISTS (
          SELECT 1 FROM WebSalesCarryoverApplication applied
          JOIN Estimate appliedEstimate ON appliedEstimate.EstimateKey=applied.EstimateKey
            AND appliedEstimate.ProdKey=d.ProdKey AND appliedEstimate.Quantity<0
          JOIN ShipmentMaster appliedShipment ON appliedShipment.ShipmentKey=appliedEstimate.ShipmentKey
            AND appliedShipment.CustKey=d.CustKey AND ISNULL(appliedShipment.isDeleted,0)=0
          WHERE applied.DeductionKey=d.DeductionKey AND applied.AppliedOrderYear=@year
            AND applied.AppliedOrderWeek=@week AND appliedShipment.OrderYear=@year
            AND TRY_CONVERT(INT,LEFT(appliedShipment.OrderWeek,2))=TRY_CONVERT(INT,@week)
        ))` : ''})`
    : `d.OrderYear=@year AND d.OrderWeek=@week`;
  const where = `${scopeWhere}
                ${includeDeleted ? '' : 'AND d.IsDeleted=0'}
                ${importConfirmedOnly ? 'AND d.ImportConfirmed=1' : ''}
                AND (@manager=N'' OR d.CreatedBy=@manager OR d.CreatedByName=@manager
                     OR ((NULLIF(LTRIM(RTRIM(d.CreatedBy)),N'') IS NULL
                          AND NULLIF(LTRIM(RTRIM(d.CreatedByName)),N'') IS NULL)
                         AND (d.UpdatedBy=@manager OR d.UpdatedByName=@manager)))`;
  const rows = await query(
    `SELECT d.*,
            ${AUTO_SOURCE_D.projection},
            CASE WHEN linkedSm.ShipmentKey IS NOT NULL THEN linkedE.EstimateKey END AS LinkedEstimateKey,
            CASE WHEN linkedSm.ShipmentKey IS NOT NULL THEN linkedSm.OrderYear END AS LinkedEstimateYear,
            CASE WHEN linkedSm.ShipmentKey IS NOT NULL THEN linkedSm.OrderWeek END AS LinkedEstimateWeek,
            CASE WHEN linkedSm.ShipmentKey IS NOT NULL THEN linkedSm.CustKey END AS LinkedEstimateCustKey,
            CASE WHEN linkedSm.ShipmentKey IS NOT NULL THEN linkedE.ProdKey END AS LinkedEstimateProdKey,
            CASE WHEN linkedSm.ShipmentKey IS NOT NULL THEN linkedE.Quantity END AS LinkedEstimateQuantity,
            c.CustName AS CurrentCustName,
            c.Descr AS CurrentCustomerDescr,
            p.ProdName AS CurrentProdName,
            p.DisplayName AS CurrentDisplayName,
            p.FlowerName AS CurrentFlowerName,
            p.CounName AS CurrentCounName,
            p.CountryFlower AS CurrentCountryFlower,
            p.EstUnit AS CurrentEstUnit,
            f.FarmName AS CurrentFarmName
       FROM WebSalesDefectDeduction d
       LEFT JOIN Customer c ON c.CustKey=d.CustKey
       LEFT JOIN Product p ON p.ProdKey=d.ProdKey
       LEFT JOIN Farm f ON f.FarmKey=d.FarmKey
       LEFT JOIN Estimate linkedE ON linkedE.EstimateKey=d.EstimateKey
         AND linkedE.ProdKey=d.ProdKey AND linkedE.Quantity<0
       LEFT JOIN ShipmentMaster linkedSm ON linkedSm.ShipmentKey=linkedE.ShipmentKey
         AND linkedSm.CustKey=d.CustKey AND ISNULL(linkedSm.isDeleted,0)=0
      WHERE ${where}
      ORDER BY d.DeductionKey`, params,
  );
  const managerOptions = await loadManagerOptions();
  const normalizedRows = rows.recordset.map((row) => {
    const item = snapshot(row);
    const sourceBeforeTarget = isEarlierOrSameScope(item.orderYear, item.orderWeek, year, week)
      && (Number(item.orderYear) !== Number(year) || String(item.orderWeek) !== String(week));
    return { ...item, isCarryover: item.isCarryover || sourceBeforeTarget };
  });
  const result = {
    rows: includeCarryover
      ? await enrichSupportDistributionCosts(normalizedRows, { year, week })
      : normalizedRows,
    managerOptions,
  };
  if (pendingSupportOnly) result.rows = result.rows.filter(isSupportPendingRow);
  if (history) {
    const hr = await query(
      `SELECT TOP 1000 h.*, d.OrderYear, d.OrderWeek
         FROM WebSalesDefectDeductionHistory h
         LEFT JOIN WebSalesDefectDeduction d ON d.DeductionKey=h.DeductionKey
        WHERE ${includeAppliedSales ? 'd.OrderYear=@year AND d.OrderWeek=@week' : scopeWhere}
           AND (@manager=N'' OR d.CreatedBy=@manager OR d.CreatedByName=@manager
                OR ((NULLIF(LTRIM(RTRIM(d.CreatedBy)),N'') IS NULL
                     AND NULLIF(LTRIM(RTRIM(d.CreatedByName)),N'') IS NULL)
                    AND (d.UpdatedBy=@manager OR d.UpdatedByName=@manager)))
        ORDER BY h.ChangedAt DESC, h.HistoryKey DESC`, params,
    );
    result.history = hr.recordset;
  }
  return result;
}

export async function markCarryoverDeductions({ ids, user } = {}) {
  await ensureSalesDefectTables();
  const keys = [...new Set((ids || []).map(Number).filter((key) => key > 0))];
  if (!keys.length || keys.length > 500) throw new Error('이월업체로 등록할 행을 선택하세요.');
  const updated = [];
  await withTransaction(async (tQuery) => {
    for (const key of keys) {
      const before = await getStoredRow(tQuery, key, true);
      if (!before || Number(before.IsDeleted) === 1) throw new Error(`이월 원장 ${key}를 찾을 수 없습니다.`);
      if (!(Number(before.CustKey) > 0) || !(Number(before.ProdKey) > 0) || !(Number(before.Quantity) > 0)) {
        throw new Error(`${before.CustName || '해당 행'}의 업체·품목·수량을 먼저 저장하세요.`);
      }
      if (before.EstimateKey && !Number(before.IsCarryoverLedger)) throw new Error(`${before.CustName || '해당 행'}은 이미 견적서에 등록되었습니다.`);
      await tQuery(
        `UPDATE WebSalesDefectDeduction
            SET IsCarryoverLedger=1,
                OriginalQuantity=COALESCE(OriginalQuantity,Quantity),
                RemainingQuantity=COALESCE(RemainingQuantity,Quantity),
                Status=CASE WHEN ISNULL(RemainingQuantity,Quantity)>0 THEN N'CARRYOVER' ELSE N'COMPLETED' END,
                UpdatedBy=@by, UpdatedByName=@name, UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
          WHERE DeductionKey=@key`,
        { key: { type: sql.Int, value: key }, by: { type: sql.NVarChar, value: text(user?.userId, 100) }, name: { type: sql.NVarChar, value: text(user?.userName, 100) } },
      );
      const after = await getStoredRow(tQuery, key);
      await writeHistory(tQuery, { key, action: 'CARRYOVER_REGISTER', user, before: snapshot(before), after: snapshot(after) });
      updated.push(snapshot(after));
    }
  });
  return updated;
}

export async function saveDraftRows(
  { year, week, rows, user, managerId = '', managerName = '', sourceFileName = '' } = {},
  { ensure = ensureSalesDefectTables, transaction = withTransaction } = {},
) {
  await ensure();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('저장 행은 1~500건까지 가능합니다.');
  const owner = {
    id: text(managerId, 100) || text(user?.userId || user?.userName, 100),
    name: text(managerName, 100) || text(user?.userName || managerId || user?.userId, 100),
  };
  assertMutationOwner({ CreatedBy: owner.id, CreatedByName: owner.name }, user);
  const saved = [];
  await transaction(async (tQuery) => {
    for (const raw of rows) {
      const item = normalizeDeductionRow(raw);
      if (!item.customerName && !item.productName && !item.quantity) continue;
      if (item.quantity <= 0) throw new Error(`${item.customerName || '(거래처 미입력)'} 행의 차감수량을 입력하세요.`);
      const params = rowParams({ ...item, sourceFileName: resolveDefectRowSourceFile(raw, sourceFileName) }, { year: y, week: w, user, owner, sourceFileName: '' });
      const omitted = item.deductionKey ? { recordset: [] } : await tQuery(`SELECT 1 AS Omitted FROM (SELECT @year AS OrderYear,@week AS OrderWeek,@ck AS CustKey,@pk AS ProdKey,@qty AS Quantity,@unit AS SourceUnit)d WHERE ${omissionSql('d')}`, params);
      if (omitted.recordset.length) continue;
      let before = null;
      let key = item.deductionKey;
      if (key) {
        const oldRow = await getStoredRow(tQuery, key, true);
        if (!oldRow || Number(oldRow.IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
        assertMutationOwner(oldRow, user);
        if (Number(oldRow.OrderYear) !== y || String(oldRow.OrderWeek) !== String(w)) {
          throw new Error(`차감 행 ${key}는 선택한 ${y}년 ${w}차 원장이 아닙니다.`);
        }
        before = await getStoredSnapshot(tQuery, key, { lock: true });
        if (before?.estimateKey) {
          assertNotDefectAutoSource(before);
          assertNotDefectAutoSource({ ...before, Note: item.note });
        }
        if (before?.isCarryoverLedger) {
          const alreadyApplied = Math.max(0, Number(before.originalQuantity || 0) - Number(before.remainingQuantity || 0));
          if (Number(item.quantity) + 0.0001 < alreadyApplied) {
            throw new Error(`이미 처리한 수량 ${alreadyApplied}보다 원수량을 작게 변경할 수 없습니다.`);
          }
        }
        const importReset = before && shouldResetIncomingConfirmation(before, item);
        await tQuery(
          `UPDATE WebSalesDefectDeduction
              SET OrderYear=@year, OrderWeek=@week, CustKey=@ck, CustName=@cn,
                  ProdKey=@pk, ProdName=@pn, ColorName=@color, Quantity=@qty,
                  EstimateQuantity=COALESCE(@estimateQty,EstimateQuantity),
                  SourceUnit=@unit, CreditApplied=@credit, FarmKey=@fk, FarmName=@fn,
                  Note=CASE WHEN ImportConfirmed=1 AND NULLIF(@note,N'') IS NULL AND NULLIF(Note,N'') IS NOT NULL THEN Note ELSE @note END,
                  ImportReviewRequired=CASE WHEN ImportReviewRequired=1 THEN 1 ELSE @reviewRequired END,
                  DeductionType=@dtype,
                  ImportConfirmed=CASE WHEN @importReset=1 THEN 0 ELSE ImportConfirmed END,
                  ImportConfirmedBy=CASE WHEN @importReset=1 THEN N'' ELSE ImportConfirmedBy END,
                  ImportConfirmedByName=CASE WHEN @importReset=1 THEN N'' ELSE ImportConfirmedByName END,
                  ImportConfirmedAt=CASE WHEN @importReset=1 THEN NULL ELSE ImportConfirmedAt END,
                  OriginalQuantity=CASE WHEN IsCarryoverLedger=1 THEN @qty ELSE OriginalQuantity END,
                  RemainingQuantity=CASE WHEN IsCarryoverLedger=1 THEN
                    @qty-(ISNULL(OriginalQuantity,Quantity)-ISNULL(RemainingQuantity,Quantity)) ELSE RemainingQuantity END,
                  Status=CASE WHEN IsCarryoverLedger=1 THEN
                    CASE WHEN @qty-(ISNULL(OriginalQuantity,Quantity)-ISNULL(RemainingQuantity,Quantity))>0 THEN N'CARRYOVER' ELSE N'COMPLETED' END
                    ELSE Status END,
                  UpdatedBy=@by, UpdatedByName=@byName, UpdatedAt=GETDATE(),
                  RowVersionNo=RowVersionNo+1
            WHERE DeductionKey=@key`, {
            ...params,
            importReset: { type: sql.Bit, value: Boolean(importReset) },
            key: { type: sql.Int, value: key },
          },
        );
      } else {
        const inserted = await tQuery(
          `INSERT INTO WebSalesDefectDeduction
             (OrderYear,OrderWeek,CustKey,CustName,ProdKey,ProdName,ColorName,Quantity,EstimateQuantity,SourceUnit,
              CreditApplied,FarmKey,FarmName,Note,DeductionType,SourceFileName,CreatedBy,CreatedByName,
              UpdatedBy,UpdatedByName)
           OUTPUT INSERTED.DeductionKey
           VALUES (@year,@week,@ck,@cn,@pk,@pn,@color,@qty,@estimateQty,@unit,@credit,@fk,@fn,@note,@dtype,@file,@owner,@ownerName,@by,@byName)`, params,
        );
        key = Number(inserted.recordset[0].DeductionKey);
      }
      if (before?.estimateKey && !before?.isCarryoverLedger) {
        const linked = await syncLinkedEstimate(tQuery, {
          year: before.appliedOrderYear || y,
          week: before.appliedOrderWeek || w,
          item: { ...item, quantity: item.estimateQuantity ?? before.estimateQuantity ?? item.quantity },
          estimateKey: before.estimateKey,
          autoSourceRow: before,
        });
        await tQuery(
          `UPDATE WebSalesDefectDeduction
              SET EstimateCost=@cost, EstimateDtm=@dt,
                  AppliedOrderYear=@appliedYear, AppliedOrderWeek=@appliedWeek,
                  AppliedShipmentKey=@appliedShipmentKey,
                  AppliedCostSourceYear=@costSourceYear, AppliedCostSourceWeek=@costSourceWeek,
                  Status=N'REGISTERED'
            WHERE DeductionKey=@key`,
          {
            cost: { type: sql.Decimal(18, 4), value: linked.cost },
            dt: { type: sql.DateTime, value: linked.estimateDate },
            appliedYear: { type: sql.Int, value: before.appliedOrderYear || y },
            appliedWeek: { type: sql.NVarChar, value: String(before.appliedOrderWeek || w) },
            appliedShipmentKey: { type: sql.Int, value: Number(linked.targetShipmentKey) },
            costSourceYear: { type: sql.Int, value: linked.costSourceYear },
            costSourceWeek: { type: sql.NVarChar, value: linked.costSourceWeek || '' },
            key: { type: sql.Int, value: key },
          },
        );
      }
      const after = await getStoredSnapshot(tQuery, key);
      if (!after) throw new Error(`저장된 차감 행 ${key}를 다시 읽을 수 없습니다.`);
      const action = before ? (hasMatchingChange(before, after) ? 'MATCH' : 'UPDATE') : 'CREATE';
      await writeHistory(tQuery, { key, action, user, before, after });
      saved.push(after);
    }
  });
  return saved;
}

export async function confirmIncomingDeductions({ year, week, rows, user } = {}) {
  await ensureSalesDefectTables();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('수입부 확인 행은 1~500건까지 가능합니다.');
  const keys = [...new Set(rows.map((row) => Number(row?.deductionKey)).filter((key) => key > 0))];
  if (!keys.length) throw new Error('수입부 확인 대상 저장행이 없습니다. 영업부 저장을 먼저 확인하세요.');
  const confirmed = [];
  await withTransaction(async (tQuery) => {
    for (const key of keys) {
      const old = await tQuery(
        `SELECT * FROM WebSalesDefectDeduction WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key`,
        { key: { type: sql.Int, value: key } },
      );
      const dbRow = old.recordset[0];
      if (!dbRow || Number(dbRow.IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
      if (Number(dbRow.OrderYear) !== y || String(dbRow.OrderWeek) !== String(w)) {
        throw new Error(`차감 행 ${key}는 선택한 ${y}년 ${w}차 원장이 아닙니다.`);
      }
      const input = rows.find((row) => Number(row?.deductionKey) === key) || {};
      const farmKey = Number(input.farmKey || 0);
      const inputNote = input.note == null ? text(dbRow.Note, 1000) : text(input.note, 1000);
      const reviewRequired = Boolean(dbRow.ImportReviewRequired) || input.importReviewRequired === true;
      const hasReviewDetails = reviewRequired || inputNote.trim() !== '';
      let farm = farmKey > 0 ? await tQuery(
        `SELECT TOP 1 FarmKey, FarmName
           FROM Farm
          WHERE FarmKey=@farmKey AND ISNULL(isDeleted,0)=0`,
        { farmKey: { type: sql.Int, value: farmKey } },
      ) : { recordset: [] };
      if (!farm.recordset[0] && text(input.farmName, 200)) {
        farm = await tQuery(
          `SELECT TOP 1 NULL AS FarmKey, FarmName
             FROM ViewWarehouse
            WHERE NULLIF(FarmName,N'') IS NOT NULL AND FarmName=@farmName`,
          { farmName: { type: sql.NVarChar, value: text(input.farmName, 200) } },
        );
      }
      if (!farm.recordset[0] && farmKey > 0) {
        throw new Error(`선택한 농장(${input.farmName || farmKey})을 입고농장 목록에서 찾을 수 없습니다.`);
      }
      if (!farm.recordset[0] && text(input.farmName, 200)) {
        throw new Error(`선택한 농장(${input.farmName})을 입고농장 목록에서 찾을 수 없습니다.`);
      }
      if (!farm.recordset[0] && !hasReviewDetails) {
        throw new Error(`${dbRow.CustName || '거래처'} / ${dbRow.ColorName || dbRow.ProdName || '품목'} 행의 농장을 선택하세요.`);
      }
      // 보완 필요 또는 비고를 먼저 확정하는 경우에는 농장이 아직 미정이어도
      // 입력부의 검토 상태를 잃지 않도록 기존 농장값을 유지하고 확정 이력을 남긴다.
      if (!farm.recordset[0]) {
        farm = {
          recordset: [{
            FarmKey: dbRow.FarmKey == null ? null : Number(dbRow.FarmKey),
            FarmName: text(dbRow.FarmName, 200),
          }],
        };
      }
      const before = await getStoredSnapshot(tQuery, key, { lock: true });
      await tQuery(
        `UPDATE WebSalesDefectDeduction
            SET CreditApplied=@credit, FarmKey=@farmKey, FarmName=@farmName,
                Note=@note, ImportReviewRequired=@reviewRequired,
                ImportConfirmed=1, ImportConfirmedBy=@by, ImportConfirmedByName=@byName,
                ImportConfirmedAt=GETDATE(), UpdatedBy=@by, UpdatedByName=@byName,
                IsCarryoverLedger=1,
                OriginalQuantity=COALESCE(OriginalQuantity,Quantity),
                RemainingQuantity=COALESCE(RemainingQuantity,Quantity),
                Status=CASE WHEN ISNULL(RemainingQuantity,Quantity)>0 THEN N'CARRYOVER' ELSE N'COMPLETED' END,
                UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
          WHERE DeductionKey=@key`,
        {
          credit: { type: sql.Bit, value: Boolean(input.creditApplied) },
          farmKey: { type: sql.Int, value: farm.recordset[0].FarmKey ? Number(farm.recordset[0].FarmKey) : null },
          farmName: { type: sql.NVarChar, value: text(farm.recordset[0].FarmName, 200) },
          note: { type: sql.NVarChar, value: inputNote },
          reviewRequired: { type: sql.Bit, value: reviewRequired },
          by: { type: sql.NVarChar, value: text(user?.userId || user?.userName, 100) },
          byName: { type: sql.NVarChar, value: text(user?.userName || user?.userId, 100) },
          key: { type: sql.Int, value: key },
        },
      );
      const after = await getStoredSnapshot(tQuery, key);
      await writeHistory(tQuery, { key, action: 'INCOMING_CONFIRM', user, before, after });
      confirmed.push(after);
    }
  });
  return confirmed;
}

export async function cancelIncomingDeductions({ year, week, rows, user } = {}) {
  await ensureSalesDefectTables();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('확정 취소 행은 1~500건까지 가능합니다.');
  const keys = [...new Set(rows.map((row) => Number(row?.deductionKey)).filter((key) => key > 0))];
  if (!keys.length) throw new Error('확정 취소 대상 저장행이 없습니다.');
  const cancelled = [];
  await withTransaction(async (tQuery) => {
    for (const key of keys) {
      const old = await tQuery(
        `SELECT * FROM WebSalesDefectDeduction WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key`,
        { key: { type: sql.Int, value: key } },
      );
      const dbRow = old.recordset[0];
      if (!dbRow || Number(dbRow.IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
      if (Number(dbRow.OrderYear) !== y || String(dbRow.OrderWeek) !== String(w)) {
        throw new Error(`차감 행 ${key}는 선택한 ${y}년 ${w}차 원장이 아닙니다.`);
      }
      const before = await getStoredSnapshot(tQuery, key, { lock: true });
      if (!before?.importConfirmed) {
        cancelled.push(before);
        continue;
      }
      await tQuery(
        `UPDATE WebSalesDefectDeduction
            SET ImportConfirmed=0, ImportConfirmedBy=N'', ImportConfirmedByName=N'',
                ImportConfirmedAt=NULL, UpdatedBy=@by, UpdatedByName=@byName,
                UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
          WHERE DeductionKey=@key`,
        {
          by: { type: sql.NVarChar, value: text(user?.userId || user?.userName, 100) },
          byName: { type: sql.NVarChar, value: text(user?.userName || user?.userId, 100) },
          key: { type: sql.Int, value: key },
        },
      );
      const after = await getStoredSnapshot(tQuery, key);
      await writeHistory(tQuery, { key, action: 'INCOMING_CONFIRM_CANCEL', user, before, after });
      cancelled.push(after);
    }
  });
  return cancelled;
}

export async function resolveIncomingReview({ year, week, deductionKey, user } = {}) {
  await ensureSalesDefectTables();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  const key = Number(deductionKey);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  if (!(key > 0)) throw new Error('보완 완료 처리할 저장 행이 없습니다.');
  let resolved = null;
  await withTransaction(async (tQuery) => {
    const old = await tQuery(
      `SELECT * FROM WebSalesDefectDeduction WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key`,
      { key: { type: sql.Int, value: key } },
    );
    const dbRow = old.recordset[0];
    if (!dbRow || Number(dbRow.IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
    assertMutationOwner(dbRow, user);
    if (Number(dbRow.OrderYear) !== y || String(dbRow.OrderWeek) !== String(w)) {
      throw new Error(`차감 행 ${key}는 선택한 ${y}년 ${w}차 원장이 아닙니다.`);
    }
    const before = await getStoredSnapshot(tQuery, key, { lock: true });
    if (!before?.importReviewRequired) {
      resolved = before;
      return;
    }
    await tQuery(
      `UPDATE WebSalesDefectDeduction
          SET ImportReviewRequired=0,
              UpdatedBy=@by, UpdatedByName=@byName, UpdatedAt=GETDATE(),
              RowVersionNo=RowVersionNo+1
        WHERE DeductionKey=@key`,
      {
        by: { type: sql.NVarChar, value: text(user?.userId || user?.userName, 100) },
        byName: { type: sql.NVarChar, value: text(user?.userName || user?.userId, 100) },
        key: { type: sql.Int, value: key },
      },
    );
    resolved = await getStoredSnapshot(tQuery, key);
    await writeHistory(tQuery, { key, action: 'INCOMING_REVIEW_RESOLVE', user, before, after: resolved });
  });
  return resolved;
}

export async function markManualProcessingComplete({ year, week, ids, user } = {}) {
  await ensureSalesDefectTables();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  const keys = [...new Set((ids || []).map(Number).filter((key) => key > 0))];
  if (!keys.length) throw new Error('수동처리완료할 행을 선택하세요.');
  if (keys.length > 500) throw new Error('수동처리완료는 한 번에 500건까지 가능합니다.');
  const completed = [];
  const skipped = [];
  await withTransaction(async (tQuery) => {
    for (const key of keys) {
      const dbRow = await getStoredRow(tQuery, key, true);
      if (!dbRow || Number(dbRow.IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
      const plan = planManualProcessingComplete({ row: dbRow, targetYear: y, targetWeek: w });
      if (plan.action !== 'MANUAL_COMPLETE') {
        skipped.push({ deductionKey: key, status: plan.status, action: plan.action });
        continue;
      }
      const before = await getStoredSnapshot(tQuery, key, { lock: true });
      await tQuery(
        `UPDATE WebSalesDefectDeduction
            SET Status=N'MANUAL_COMPLETED',
                RemainingQuantity=0,
                AppliedOrderYear=@ay,
                AppliedOrderWeek=@aw,
                UpdatedBy=@by, UpdatedByName=@byName, UpdatedAt=GETDATE(),
                RowVersionNo=RowVersionNo+1
          WHERE DeductionKey=@key
            AND OrderYear=@oy
            AND OrderWeek=@ow
            AND IsDeleted=0
            AND ISNULL(EstimateKey,0)=0
            AND Status NOT IN (N'REGISTERED', N'MANUAL_COMPLETED')`,
        {
          ay: { type: sql.Int, value: y },
          aw: { type: sql.NVarChar, value: String(w) },
          oy: { type: sql.Int, value: Number(dbRow.OrderYear) },
          ow: { type: sql.NVarChar, value: String(dbRow.OrderWeek) },
          by: { type: sql.NVarChar, value: text(user?.userId || user?.userName, 100) },
          byName: { type: sql.NVarChar, value: text(user?.userName || user?.userId, 100) },
          key: { type: sql.Int, value: key },
        },
      );
      const after = await getStoredSnapshot(tQuery, key);
      if (String(after?.status || '').toUpperCase() !== 'MANUAL_COMPLETED') {
        throw new Error(`차감 행 ${key}를 수동처리완료로 바꾸지 못했습니다.`);
      }
      await writeHistory(tQuery, { key, action: 'MANUAL_COMPLETE', user, before, after });
      completed.push(after);
    }
  });
  if (!completed.length) {
    throw new Error('이미 처리된 행만 선택되어 수동처리완료할 항목이 없습니다.');
  }
  return { completed, skipped };
}

async function getStoredRow(tQuery, key, lock = false) {
  const result = await tQuery(`SELECT d.*, ${AUTO_SOURCE_D.projection}
    FROM WebSalesDefectDeduction d ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE d.DeductionKey=@key`, { key: { type: sql.Int, value: Number(key) } });
  return result.recordset[0] || null;
}

export async function preflightRegistration({ year, week, rows } = {}, q = query) {
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  const output = [];
  for (let i = 0; i < (rows || []).length; i += 1) {
    const item = normalizeDeductionRow(rows[i]);
    const result = {
      index: i, deductionKey: item.deductionKey, sourceOrderYear: item.orderYear,
      sourceOrderWeek: item.orderWeek, cost: 0, costSource: '', shipmentKey: null,
      estimateDate: null, error: '',
    };
    try {
      if (!(item.deductionKey > 0)) throw new Error('저장된 차감 행만 사전검증할 수 있습니다.');
      const dbRow = await getStoredRow(q, item.deductionKey);
      if (!dbRow || Number(dbRow.IsDeleted) === 1) throw new Error(`차감 행 ${item.deductionKey}를 찾을 수 없습니다.`);
      assertRegistrationScope(dbRow, y, w);
      assertRegisterable(dbRow);
      assertConfirmedForRegistration(dbRow);
      result.sourceOrderYear = Number(dbRow.OrderYear);
      result.sourceOrderWeek = String(dbRow.OrderWeek || '');
      const ctx = await resolveManualCostContext({ row: dbRow, targetYear: y, targetWeek: w, q, resolveContext: () => resolveEstimateContext({ year: y, week: w, custKey: dbRow.CustKey, prodKey: dbRow.ProdKey }, q) });
      await assertNoExactUnlinkedEstimate(q, { year: y, week: w, row: dbRow, unit: ctx.unit });
      Object.assign(result, ctx);
      if (!ctx.shipmentKey) result.error = `${dbRow.CustName || '거래처'} ${w}차 출고가 없어 견적서 등록 대상을 찾을 수 없습니다.`;
      else if (!(ctx.cost > 0)) result.error = `${dbRow.CustName || '거래처'} / ${dbRow.ProdName || '품목'}의 ${previousParentScope(y, w).week}차 분배 단가가 없습니다.`;
    } catch (error) {
      result.error = error.message;
      result.errorCode = error.code || '';
    }
    output.push(result);
  }
  return output;
}

async function loadEstimatePreview(q, estimateKey) {
  return queryEstimatePreview(q, estimateKey);
}

export async function registrationPreview({ year, week, ids, deductionType = '불량차감' } = {}, q = query) {
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  const keys = [...new Set((ids || []).map((x) => Number(x)).filter((x) => x > 0))];
  if (!keys.length || keys.length > 500) throw new Error('검토할 행을 선택하세요.');
  const typeCode = await resolveEstimateTypeCode(deductionType, q);
  const output = [];
  for (const key of keys) {
    const dbRow = await getStoredRow(q, key);
    if (!dbRow || Number(dbRow.IsDeleted) === 1) {
      output.push({ deductionKey: key, error: `차감 행 ${key}를 찾을 수 없습니다.` });
      continue;
    }
    const item = normalizeDeductionRow(dbRow);
    const before = await loadEstimatePreview(q, dbRow.EstimateKey);
    const product = await loadProductPreview(q, dbRow.ProdKey);
    const result = {
      deductionKey: key,
      customerName: item.customerName,
      custKey: Number(dbRow.CustKey || 0),
      productName: item.productName,
      colorName: item.colorName,
      countryName: product?.CounName || '',
      flowerName: product?.FlowerName || item.productName,
      productDbName: product?.ProdName || '',
      productDisplayName: product?.DisplayName || '',
      estimateTypeLabel: deductionType,
      quantity: registrationQuantity(dbRow),
      isCarryoverLedger: Boolean(dbRow.IsCarryoverLedger),
      remainingQuantity: Number(dbRow.RemainingQuantity ?? dbRow.Quantity ?? 0),
      sourceUnit: item.sourceUnit || item.unit || '',
      displayUnit: normalizeDefectUnit(item.sourceUnit || item.unit || ''),
      sourceOrderYear: Number(dbRow.OrderYear || 0),
      sourceOrderWeek: String(dbRow.OrderWeek || ''),
      rowVersionNo: Number(dbRow.RowVersionNo),
      manualHoldHistoryKey: Number(dbRow.ManualHoldHistoryKey || 0),
      appliedOrderYear: dbRow.AppliedOrderYear == null ? null : Number(dbRow.AppliedOrderYear),
      appliedOrderWeek: dbRow.AppliedOrderWeek == null ? '' : String(dbRow.AppliedOrderWeek),
      note: item.note || '',
      estimateKey: Number(dbRow.EstimateKey || 0) || null,
      before,
      after: null,
      error: '',
    };
    try {
      assertRegistrationScope(dbRow, y, w);
      assertRegisterable(dbRow);
      assertConfirmedForRegistration(dbRow);
      const existingEstimateRecords = await loadExistingEstimateDeductions({
        year: y, week: w, custKey: dbRow.CustKey, prodKey: dbRow.ProdKey,
      }, q);
      result.existingEstimateRecords = existingEstimateRecords;
      const ctx = await resolveManualCostContext({ row: dbRow, targetYear: y, targetWeek: w, q, resolveContext: () => resolveEstimateContext({ year: y, week: w, custKey: dbRow.CustKey, prodKey: dbRow.ProdKey }, q) });
      await assertNoExactUnlinkedEstimate(q, { year: y, week: w, row: dbRow, unit: ctx.unit });
      if (!ctx.shipmentKey) throw new Error(`${item.customerName || '거래처'} ${w}차 출고가 없어 견적서 등록 대상을 찾을 수 없습니다.`);
      if (!(ctx.cost > 0)) throw new Error(`${item.customerName || '거래처'} / ${item.productName || '품종'}의 ${previousParentScope(y, w).week}차 분배 단가가 없습니다.`);
      const availableQuantity = registrationQuantity(dbRow);
      const quantity = -Math.abs(availableQuantity || 0);
      const cost = Number(ctx.cost) || 0;
      const amount = Math.round(quantity * cost / 1.1);
      const vat = quantity * cost - amount;
      result.after = {
        EstimateKey: result.estimateKey,
        EstimateType: typeCode,
        EstimateDtm: ctx.estimateDate || null,
        ProdKey: Number(dbRow.ProdKey),
        ProdName: product?.ProdName || item.productName,
        DisplayName: product?.DisplayName || item.matchedProductName || '',
        FlowerName: product?.FlowerName || item.productName,
        CountryName: product?.CounName || '',
        EstimateTypeLabel: deductionType,
        Unit: ctx.unit || item.sourceUnit || '단',
        DisplayUnit: ctx.displayUnit || normalizeDefectUnit(item.sourceUnit || item.unit || ''),
        Quantity: quantity,
        Cost: cost,
        Amount: amount,
        Vat: vat,
        Descr: '',
        ShipmentKey: Number(ctx.shipmentKey),
        CostSource: ctx.costSource,
        CostOrderWeek: ctx.costOrderWeek,
        CostSourceYear: ctx.costSourceYear,
        CostSourceWeek: ctx.costSourceWeek,
        AppliedOrderYear: y,
        AppliedOrderWeek: String(w),
      };
    } catch (error) {
      result.error = error.message;
      result.errorCode = error.code || '';
    }
    output.push(result);
  }
  return output;
}

export async function registerDeductions({ year, week, ids, deductionType = '불량차감', user, overrides = {}, requestKey = '', carryoverApprovals, excludedCarryovers = [] } = {}, dependencies = {}) {
  await (dependencies.ensureTables || ensureSalesDefectTables)();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  const keys = [...new Set((ids || []).map((x) => Number(x)).filter((x) => x > 0))];
  if (!keys.length || keys.length > 500) throw new Error('등록할 행을 선택하세요.');
  if (!Array.isArray(excludedCarryovers) || excludedCarryovers.length > 500
      || excludedCarryovers.some(row => !row || typeof row !== 'object')) throw new Error('이월 보류 대상을 확인하세요.');
  const normalizedRequestKey = text(requestKey, 100);
  if (excludedCarryovers.length && !normalizedRequestKey) throw new Error('이월 보류 등록 요청키가 필요합니다.');
  if (normalizedRequestKey && !/^[A-Za-z0-9._:-]{8,100}$/.test(normalizedRequestKey)) {
    throw new Error('등록 요청키 형식이 올바르지 않습니다.');
  }

  let operationStage = 'DB 트랜잭션 시작';
  const transaction = dependencies.withTransaction || withTransaction;
  const withTrackedTransaction = (callback, options) => transaction(async (tQuery, meta) => {
    const trackedQuery = async (statement, params = {}) => {
      const sqlText = String(statement || '');
      if (/\bEstimate\b/i.test(sqlText)) operationStage = /\bINSERT\s+INTO\s+Estimate\b/i.test(sqlText) ? 'Estimate 신규 등록' : /\bUPDATE\s+Estimate\b/i.test(sqlText) ? 'Estimate 수정' : 'Estimate 조회';
      else if (/\bWebSalesCarryoverApplication\b/i.test(sqlText)) operationStage = '이월 처리 이력 저장/조회';
      else if (/\bWebSalesDefectDeductionHistory\b/i.test(sqlText)) operationStage = '불량 원장 작업이력 저장';
      else if (/\bWebSalesDefectDeduction\b/i.test(sqlText)) operationStage = '불량 원장 상태 저장/조회';
      else if (/\b(?:ShipmentMaster|ShipmentDetail|ShipmentDate|PeriodDay)\b/i.test(sqlText)) operationStage = '적용 출고·단가 재검증';
      else operationStage = '등록 대상·중복 사전검증';
      return tQuery(statement, params);
    };
    const result = await callback(trackedQuery, meta);
    operationStage = 'DB 트랜잭션 커밋';
    return result;
  }, options);

  try {
    return await runIsolatedRegistrationTransaction(withTrackedTransaction, async (tQuery, attemptResult) => {
      const { registered, skipped } = attemptResult;
      const preflight = [];
      const typeCode = await resolveEstimateTypeCode(deductionType, tQuery);
      for (const key of keys) {
        try {
          let dbRow = await getStoredRow(tQuery, key, true);
          if (!dbRow || Number(dbRow.IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
          assertRegistrationScope(dbRow, y, w);
          if (!defectCarryoverAllowed(dbRow, y, w, carryoverApprovals?.[key])) {
            throw new Error(`${dbRow.CustName} · ${dbRow.OrderYear}년 ${dbRow.OrderWeek}차: 이월 포함 선택이 없거나 조회 후 원차수·거래처가 바뀌었습니다. 다시 조회해 등록 대상을 확인하세요.`);
          }
          if (dbRow.IsCarryoverLedger) {
            if (!normalizedRequestKey) throw new Error('이월 처리 중복 방지를 위한 등록 요청키가 필요합니다.');
            const existingApplication = await tQuery(
              `SELECT TOP 1 ApplicationKey, DeductionKey, EstimateKey, AppliedOrderYear, AppliedOrderWeek,
                      AppliedShipmentKey, AppliedQuantity, AppliedCost, RequestKey
                 FROM WebSalesCarryoverApplication WITH (UPDLOCK,HOLDLOCK)
                WHERE DeductionKey=@key AND RequestKey=@requestKey
                ORDER BY ApplicationKey DESC`,
              {
                key: { type: sql.Int, value: key },
                requestKey: { type: sql.NVarChar, value: normalizedRequestKey },
              },
            );
            if (existingApplication.recordset[0]) {
              preflight.push({ key, dbRow, typeCode, idempotentApplication: existingApplication.recordset[0] });
              continue;
            }
          }
          assertRemainingForRegistration(dbRow);
          const override = overrides?.[String(key)] || overrides?.[key] || null;
          let overridePayload = null;
          if (override && (override.quantity != null || override.note != null || override.sourceUnit != null)) {
            const availableQuantity = Number(dbRow.IsCarryoverLedger ? (dbRow.RemainingQuantity ?? dbRow.Quantity) : dbRow.Quantity);
            const quantity = Number(override.quantity ?? registrationQuantity(dbRow));
            if ((!Number.isFinite(quantity) || quantity < 0.0001 || quantity >= 1e14 || Number(quantity.toFixed(4)) !== quantity)) throw new Error(`차감 행 ${key}의 수량은 0보다 커야 합니다.`);
            if (dbRow.IsCarryoverLedger && quantity > availableQuantity + 0.0001) throw new Error(`차감 행 ${key}의 처리수량이 잔여수량 ${availableQuantity}보다 큽니다.`);
            overridePayload = {
              quantity,
              note: text(override.note ?? dbRow.Note, 1000),
              sourceUnit: normalizeDefectUnit(override.sourceUnit ?? dbRow.SourceUnit)
                || normalizeDefectUnit(dbRow.SourceUnit) || '단',
            };
            dbRow = {
              ...dbRow,
              EstimateQuantity: overridePayload.quantity,
              Note: overridePayload.note,
              SourceUnit: overridePayload.sourceUnit,
            };
          }
          assertRegisterable(dbRow);
          const ctx = await resolveManualCostContext({ row: dbRow, targetYear: y, targetWeek: w, q: tQuery, resolveContext: () => resolveEstimateContext({ year: y, week: w, custKey: dbRow.CustKey, prodKey: dbRow.ProdKey }, tQuery) });
          await assertNoExactUnlinkedEstimate(tQuery, {
            year: y, week: w, row: dbRow, unit: ctx.unit, lock: true,
            quantity: overridePayload?.quantity ?? registrationQuantity(dbRow),
          });
          if (!ctx.shipmentKey) throw new Error(`${dbRow.CustName || '거래처'} ${w}차에 EXE 판매 출고행이 없어 이월 대기합니다.`);
          if (!(ctx.cost > 0)) throw new Error(`${dbRow.CustName || '거래처'} / ${dbRow.ProdName || '품목'}의 이전 차수 분배 단가가 없습니다.`);
          preflight.push({ key, dbRow, ctx, typeCode, overridePayload });
        } catch (error) {
          skipped.push({ deductionKey: key, error: error.message, errorCode: error.code || '' });
        }
      }

      for (const { key, dbRow: plannedRow, typeCode, overridePayload, idempotentApplication } of preflight) {
        if (idempotentApplication) {
          await assertIdempotentApplicationEstimateLive(tQuery, idempotentApplication);
          const appliedQuantity = Number(idempotentApplication.AppliedQuantity || 0);
          const appliedCost = Number(idempotentApplication.AppliedCost || 0);
          const quantity = -Math.abs(appliedQuantity);
          const amount = Math.round(quantity * appliedCost / 1.1);
          registered.push({
            deductionKey: key,
            estimateKey: Number(idempotentApplication.EstimateKey),
            estimateAction: 'IDEMPOTENT',
            idempotent: true,
            quantity,
            cost: appliedCost,
            amount,
            vat: quantity * appliedCost - amount,
            targetShipmentKey: Number(idempotentApplication.AppliedShipmentKey),
            sourceOrderYear: Number(plannedRow.OrderYear),
            sourceOrderWeek: String(plannedRow.OrderWeek || ''),
            appliedOrderYear: Number(idempotentApplication.AppliedOrderYear),
            appliedOrderWeek: String(idempotentApplication.AppliedOrderWeek || ''),
          });
          continue;
        }
        let dbRow = await getStoredRow(tQuery, key, true);
        assertDefectSourceReviewed(dbRow);
        const beforeOverrideRow = dbRow;
        if (overridePayload && !dbRow.IsCarryoverLedger) dbRow = { ...dbRow, EstimateQuantity: overridePayload.quantity, Note: overridePayload.note, SourceUnit: overridePayload.sourceUnit };
        assertRegisterable(dbRow);
        assertConfirmedForRegistration(dbRow);
        const ctx = await resolveManualCostContext({ row: dbRow, targetYear: y, targetWeek: w, q: tQuery, resolveContext: () => resolveEstimateContext({ year: y, week: w, custKey: dbRow.CustKey, prodKey: dbRow.ProdKey }, tQuery) });
        if (!ctx.shipmentKey) throw new Error(`${dbRow.CustName || '거래처'} ${w}차에 EXE 판매 출고행이 없어 이월 대기합니다.`);
        if (!(ctx.cost > 0)) throw new Error(`${dbRow.CustName || '거래처'} / ${dbRow.ProdName || '품목'}의 이전 차수 분배 단가가 없습니다.`);
        const applyQuantity = Number(overridePayload?.quantity ?? registrationQuantity(dbRow)) || 0;
        if (dbRow.IsCarryoverLedger && applyQuantity > Number(dbRow.RemainingQuantity ?? dbRow.Quantity) + 0.0001) {
          throw new Error(`차감 행 ${key}의 잔여수량이 부족합니다. 현재 잔여 ${Number(dbRow.RemainingQuantity ?? dbRow.Quantity)}`);
        }
        try {
          await assertNoExactUnlinkedEstimate(tQuery, { year: y, week: w, row: dbRow, quantity: applyQuantity, unit: ctx.unit, lock: true });
        } catch (error) {
          if (!['EXISTING_ESTIMATE', AUTO_SOURCE_ESTIMATE_CONFLICT].includes(error.code)) throw error;
          skipped.push({ deductionKey: key, error: error.message, errorCode: error.code });
          continue;
        }
        if (overridePayload && !dbRow.IsCarryoverLedger) {
          const beforeReview = snapshot(beforeOverrideRow);
          await tQuery(
            `UPDATE WebSalesDefectDeduction
                SET EstimateQuantity=@qty, Note=@note, SourceUnit=@unit,
                    UpdatedBy=@by, UpdatedByName=@name, UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
              WHERE DeductionKey=@key`,
            {
              qty: { type: sql.Decimal(18, 4), value: overridePayload.quantity },
              note: { type: sql.NVarChar, value: overridePayload.note },
              unit: { type: sql.NVarChar, value: overridePayload.sourceUnit },
              by: { type: sql.NVarChar, value: text(user?.userId, 100) },
              name: { type: sql.NVarChar, value: text(user?.userName, 100) },
              key: { type: sql.Int, value: key },
            },
          );
          dbRow = await getStoredRow(tQuery, key, true);
          await writeHistory(tQuery, { key, action: 'REVIEW_UPDATE', user, before: beforeReview, after: snapshot(dbRow) });
        }

        const qty = -Math.abs(applyQuantity);
        const cost = Number(ctx.cost) || 0;
        const amount = Math.round(qty * cost / 1.1);
        const vat = qty * cost - amount;
        const estimateDescr = '';
        let estimateKey = dbRow.IsCarryoverLedger ? 0 : Number(dbRow.EstimateKey || 0);
        const estimateAction = estimateKey ? 'UPDATE' : 'INSERT';
        if (estimateKey) {
          await tQuery(
            `UPDATE Estimate
                SET EstimateType=@type, EstimateDtm=@dt, ProdKey=@pk, Unit=@unit,
                    Quantity=@qty, Cost=@cost, Amount=@amount, Vat=@vat, Descr=@descr,
                    ShipmentKey=@sk
              WHERE EstimateKey=@ek`,
            {
              type: { type: sql.NVarChar, value: typeCode },
              dt: { type: sql.DateTime, value: ctx.estimateDate || new Date() },
              pk: { type: sql.Int, value: Number(dbRow.ProdKey) },
              unit: { type: sql.NVarChar, value: ctx.unit || normalizeUnit(dbRow.SourceUnit) || '단' },
              qty: { type: sql.Float, value: qty },
              cost: { type: sql.Float, value: cost },
              amount: { type: sql.Float, value: amount },
              vat: { type: sql.Float, value: vat },
              descr: { type: sql.NVarChar, value: estimateDescr },
              sk: { type: sql.Int, value: Number(ctx.shipmentKey) },
              ek: { type: sql.Int, value: estimateKey },
            },
          );
        } else {
          const inserted = await tQuery(
            `DECLARE @EstimateInserted TABLE (EstimateKey INT);
             INSERT INTO Estimate
               (EstimateType,EstimateDtm,ProdKey,Unit,Quantity,Cost,Amount,Vat,Descr,ShipmentKey)
             OUTPUT INSERTED.EstimateKey INTO @EstimateInserted(EstimateKey)
             VALUES (@type,@dt,@pk,@unit,@qty,@cost,@amount,@vat,@descr,@sk);
             SELECT TOP (1) EstimateKey FROM @EstimateInserted;`,
            {
              type: { type: sql.NVarChar, value: typeCode },
              dt: { type: sql.DateTime, value: ctx.estimateDate || new Date() },
              pk: { type: sql.Int, value: Number(dbRow.ProdKey) },
              unit: { type: sql.NVarChar, value: ctx.unit || normalizeUnit(dbRow.SourceUnit) || '단' },
              qty: { type: sql.Float, value: qty },
              cost: { type: sql.Float, value: cost },
              amount: { type: sql.Float, value: amount },
              vat: { type: sql.Float, value: vat },
              descr: { type: sql.NVarChar, value: estimateDescr },
              sk: { type: sql.Int, value: Number(ctx.shipmentKey) },
            },
          );
          estimateKey = Number(inserted.recordset[0].EstimateKey);
        }
        const before = snapshot(dbRow);
        if (dbRow.IsCarryoverLedger) {
          await tQuery(
            `INSERT INTO WebSalesCarryoverApplication
               (DeductionKey,EstimateKey,AppliedOrderYear,AppliedOrderWeek,AppliedShipmentKey,AppliedQuantity,AppliedCost,AppliedBy,AppliedByName,RequestKey)
             VALUES (@key,@ek,@year,@week,@shipment,@quantity,@cost,@by,@name,@requestKey)`,
            {
              key: { type: sql.Int, value: key }, ek: { type: sql.Int, value: estimateKey },
              year: { type: sql.Int, value: y }, week: { type: sql.NVarChar, value: String(w) },
              shipment: { type: sql.Int, value: Number(ctx.shipmentKey) }, quantity: { type: sql.Decimal(18, 4), value: applyQuantity },
              cost: { type: sql.Decimal(18, 4), value: cost }, by: { type: sql.NVarChar, value: text(user?.userId, 100) },
              name: { type: sql.NVarChar, value: text(user?.userName, 100) },
              requestKey: { type: sql.NVarChar, value: normalizedRequestKey },
            },
          );
        }
        await tQuery(
          `UPDATE WebSalesDefectDeduction
              SET DeductionType=@type, EstimateKey=@ek, EstimateCost=@cost, EstimateDtm=@dt,
                  AppliedOrderYear=@appliedYear, AppliedOrderWeek=@appliedWeek,
                  AppliedShipmentKey=@appliedShipmentKey,
                  AppliedCostSourceYear=@costSourceYear, AppliedCostSourceWeek=@costSourceWeek,
                  RemainingQuantity=CASE WHEN IsCarryoverLedger=1 THEN
                    CASE WHEN ISNULL(RemainingQuantity,Quantity)-@applyQty < 0.0001 THEN 0 ELSE ISNULL(RemainingQuantity,Quantity)-@applyQty END
                    ELSE RemainingQuantity END,
                  Status=CASE WHEN IsCarryoverLedger=1 AND ISNULL(RemainingQuantity,Quantity)-@applyQty >= 0.0001 THEN N'CARRYOVER'
                              WHEN IsCarryoverLedger=1 THEN N'COMPLETED' ELSE N'REGISTERED' END,
                  UpdatedBy=@by, UpdatedByName=@name,
                  UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
            WHERE DeductionKey=@key
              AND IsDeleted=0
              AND (IsCarryoverLedger=0 OR ISNULL(RemainingQuantity,Quantity) >= @applyQty)`,
          {
            type: { type: sql.NVarChar, value: text(deductionType, 50) || '불량차감' },
            ek: { type: sql.Int, value: estimateKey },
            cost: { type: sql.Decimal(18, 4), value: cost },
            dt: { type: sql.DateTime, value: ctx.estimateDate || new Date() },
            appliedYear: { type: sql.Int, value: y },
            appliedWeek: { type: sql.NVarChar, value: String(w) },
            appliedShipmentKey: { type: sql.Int, value: Number(ctx.shipmentKey) },
            applyQty: { type: sql.Decimal(18, 4), value: applyQuantity },
            costSourceYear: { type: sql.Int, value: ctx.costSourceYear },
            costSourceWeek: { type: sql.NVarChar, value: ctx.costSourceWeek || '' },
            by: { type: sql.NVarChar, value: text(user?.userId, 100) },
            name: { type: sql.NVarChar, value: text(user?.userName, 100) },
            key: { type: sql.Int, value: key },
          },
        );
        const current = await getStoredRow(tQuery, key);
        const miss = explainDefectLedgerRegisterMiss(current, { key, estimateKey, applyQuantity });
        if (miss) throw new Error(miss);
        const after = snapshot(current);
        await writeHistory(tQuery, { key, action: 'REGISTER_ESTIMATE', user, before, after });
        registered.push({
          deductionKey: key, estimateKey, estimateAction, quantity: qty,
          unit: ctx.unit || normalizeUnit(dbRow.SourceUnit) || '단',
          displayUnit: ctx.displayUnit || normalizeDefectUnit(dbRow.SourceUnit) || '단',
          cost, amount, vat, costSource: ctx.costSource, targetShipmentKey: ctx.shipmentKey,
          sourceOrderYear: Number(dbRow.OrderYear), sourceOrderWeek: String(dbRow.OrderWeek || ''),
          appliedOrderYear: y, appliedOrderWeek: String(w),
        });
      }
      if (excludedCarryovers.length) {
        if (skipped.length || registered.length !== keys.length) {
          throw new Error('일부 항목을 등록할 수 없어 견적 등록과 이월 보류를 모두 취소했습니다. 다시 조회하세요.');
        }
        if (registered.some(row => Number(row.sourceOrderYear) !== y || Number(row.sourceOrderWeek) !== Number(w))
            || excludedCarryovers.some(row => keys.includes(Number(row.deductionKey))
              || (Number(row.sourceYear) === y && Number(row.sourceWeek) === Number(w)))) {
          throw new Error('이번 차수 등록 항목과 이월 보류 항목을 확인하세요.');
        }
        await setSupportManualHold({ year: y, week: w, rows: excludedCarryovers, hold: true, user },
          { transaction: callback => callback(tQuery), registrationRequestKey: normalizedRequestKey });
      }
    });
  } catch (error) {
    error.operationStage = operationStage;
    throw error;
  }
}

export async function deleteDeductions({ year, week, ids, user } = {}) {
  await ensureSalesDefectTables();
  const scopedYear = year == null ? null : normalizeYear(year);
  const scopedWeek = week == null ? null : normalizeParentWeek(week);
  if ((year != null || week != null) && (!scopedYear || !scopedWeek)) throw new Error('삭제 연도와 차수를 확인하세요.');
  const keys = [...new Set((ids || []).map((x) => Number(x)).filter((x) => x > 0))];
  if (!keys.length) throw new Error('삭제할 행을 선택하세요.');
  await withTransaction(async (tQuery) => {
    for (const key of keys) {
      const row = await getStoredRow(tQuery, key, true);
      if (!row || Number(row.IsDeleted) === 1) continue;
      assertMutationOwner(row, user);
      if (scopedYear != null && (Number(row.OrderYear) !== scopedYear || String(row.OrderWeek) !== String(scopedWeek))) {
        throw new Error(`차감 행 ${key}는 선택한 ${scopedYear}년 ${scopedWeek}차 원장이 아닙니다.`);
      }
      const before = snapshot(row);
      const applicationRows = await tQuery(
        `SELECT ApplicationKey, EstimateKey
           FROM WebSalesCarryoverApplication WITH (UPDLOCK,HOLDLOCK)
          WHERE DeductionKey=@key`,
        { key: { type: sql.Int, value: key } },
      );
      const estimateKeys = collectDeductionEstimateKeys(row, applicationRows.recordset || []);
      for (const estimateKey of estimateKeys) {
        await tQuery(`DELETE FROM Estimate WHERE EstimateKey=@ek`, { ek: { type: sql.Int, value: estimateKey } });
      }
      await tQuery(
        `UPDATE WebSalesDefectDeduction
            SET IsDeleted=1, Status=N'DELETED', DeletedBy=@by, DeletedAt=GETDATE(),
                UpdatedBy=@by, UpdatedByName=@name, UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
          WHERE DeductionKey=@key`,
        {
          by: { type: sql.NVarChar, value: text(user?.userId, 100) },
          name: { type: sql.NVarChar, value: text(user?.userName, 100) },
          key: { type: sql.Int, value: key },
        },
      );
      const current = await getStoredRow(tQuery, key);
      await writeHistory(tQuery, { key, action: 'DELETE', user, before, after: snapshot(current) });
    }
  });
}
