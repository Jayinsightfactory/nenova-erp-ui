// 엑셀 물량표 적용 감사 원장
//
// SystemActionLog 는 요청 본문을 4,000자로 제한하므로 행 단위의 수량·변경·검증
// 결과를 별도 테이블에 남긴다. 감사 기록 실패가 주문/분배 저장을 되돌리지는 않는다.
import { query, sql } from './db.js';

const MAX_TEXT = 1000;

function text(value, max = MAX_TEXT) {
  return String(value ?? '').slice(0, max);
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function shipmentImportAuditMode({ shipmentOnly = false } = {}) {
  return shipmentOnly ? 'SHIPMENT_ONLY' : 'ORDER_AND_SHIPMENT';
}

/**
 * 적용 결과를 감사 원장에 저장할 요약으로 정규화한다.
 * DB 연결 없이 테스트할 수 있도록 순수 함수로 유지한다.
 */
export function summarizeShipmentImportResult(result = {}, auditRows = []) {
  const rows = Array.isArray(auditRows) ? auditRows : [];
  const countAction = (action) => rows.filter((row) => row.shipmentAction === action).length;
  const verification = result.verification || {};
  return {
    inputRowCount: Number(result.inputRowCount || 0),
    targetRowCount: Number(result.targetRowCount || rows.length),
    appliedCount: Number(result.appliedCount || 0),
    skippedNoChangeCount: Number(result.skippedNoChangeCount || 0),
    skippedFixedCount: Number(result.skippedFixedCount || 0),
    orderCreatedCount: Number(result.orderCreatedCount || 0),
    orderUpdatedCount: Number(result.orderUpdatedCount || 0),
    orderDeletedCount: Number(result.orderDeletedCount || 0),
    shipmentCreatedCount: countAction('분배신규'),
    shipmentUpdatedCount: countAction('분배수정'),
    shipmentDeletedCount: countAction('분배삭제') + countAction('유령삭제'),
    verificationChecked: Number(verification.checked || 0),
    verificationMatched: Number(verification.matched || 0),
    verificationMismatchCount: Number(verification.mismatchCount || 0),
  };
}

/** 검증 결과를 행 원장에 연결한다. (같은 업체·품목은 dedupeVerifyTargets 기준) */
export function attachShipmentImportVerification(auditRows = [], verification = {}) {
  const mismatches = new Map();
  for (const mismatch of verification?.mismatches || []) {
    const key = `${Number(mismatch.custKey)}|${Number(mismatch.prodKey)}`;
    mismatches.set(key, mismatch);
  }
  for (const row of auditRows) {
    if (row.rowStatus === 'FIXED_BLOCKED') {
      row.verificationStatus = 'SKIPPED';
      row.verificationReason = row.verificationReason || '확정 차수/범위 차단';
      continue;
    }
    if (verification?.error) {
      row.verificationStatus = 'ERROR';
      row.verificationReason = text(verification.error, 200);
      continue;
    }
    const mismatch = mismatches.get(`${Number(row.custKey)}|${Number(row.prodKey)}`);
    row.verificationStatus = mismatch ? 'MISMATCH' : 'MATCHED';
    row.verificationReason = mismatch ? text(mismatch.reason, 200) : '';
  }
  return auditRows;
}

async function ensureAuditTables() {
  await query(`
    IF OBJECT_ID(N'dbo.ShipmentImportAudit', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ShipmentImportAudit (
        AuditKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        CreatedDtm DATETIME NOT NULL CONSTRAINT DF_ShipmentImportAudit_CreatedDtm DEFAULT GETDATE(),
        CompletedDtm DATETIME NULL,
        ActorUserId NVARCHAR(100) NULL,
        ActorName NVARCHAR(100) NULL,
        OrderYear NVARCHAR(4) NOT NULL,
        OrderWeek NVARCHAR(20) NOT NULL,
        ApplyMode NVARCHAR(30) NOT NULL,
        AuditStatus NVARCHAR(30) NOT NULL,
        InputRowCount INT NOT NULL DEFAULT 0,
        TargetRowCount INT NOT NULL DEFAULT 0,
        AppliedCount INT NOT NULL DEFAULT 0,
        SkippedNoChangeCount INT NOT NULL DEFAULT 0,
        SkippedFixedCount INT NOT NULL DEFAULT 0,
        OrderCreatedCount INT NOT NULL DEFAULT 0,
        OrderUpdatedCount INT NOT NULL DEFAULT 0,
        OrderDeletedCount INT NOT NULL DEFAULT 0,
        ShipmentCreatedCount INT NOT NULL DEFAULT 0,
        ShipmentUpdatedCount INT NOT NULL DEFAULT 0,
        ShipmentDeletedCount INT NOT NULL DEFAULT 0,
        VerificationChecked INT NOT NULL DEFAULT 0,
        VerificationMatched INT NOT NULL DEFAULT 0,
        VerificationMismatchCount INT NOT NULL DEFAULT 0,
        ErrorCode NVARCHAR(80) NULL,
        ErrorMessage NVARCHAR(1000) NULL
      );
    END;
    IF OBJECT_ID(N'dbo.ShipmentImportAuditRow', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ShipmentImportAuditRow (
        AuditRowKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        AuditKey INT NOT NULL,
        RowNo INT NULL,
        CustKey INT NULL,
        ProdKey INT NULL,
        CustomerName NVARCHAR(200) NULL,
        ProductName NVARCHAR(300) NULL,
        SourceType NVARCHAR(50) NULL,
        SourceCells NVARCHAR(1000) NULL,
        ExcelQty FLOAT NULL,
        ExcelOrderQty FLOAT NULL,
        ExcelIncomingQty FLOAT NULL,
        ExcelStockQty FLOAT NULL,
        ExcelRemainingQty FLOAT NULL,
        NormalizedQty FLOAT NULL,
        OrderBeforeQty FLOAT NULL,
        OrderAfterQty FLOAT NULL,
        ShipmentBeforeQty FLOAT NULL,
        ShipmentAfterQty FLOAT NULL,
        OrderAction NVARCHAR(50) NULL,
        ShipmentAction NVARCHAR(50) NULL,
        RowStatus NVARCHAR(30) NULL,
        VerificationStatus NVARCHAR(30) NULL,
        VerificationReason NVARCHAR(200) NULL
      );
    END;
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
       WHERE name=N'IX_ShipmentImportAuditRow_AuditKey'
         AND object_id=OBJECT_ID(N'dbo.ShipmentImportAuditRow')
    )
      CREATE INDEX IX_ShipmentImportAuditRow_AuditKey ON dbo.ShipmentImportAuditRow(AuditKey);
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
       WHERE name=N'IX_ShipmentImportAudit_Week'
         AND object_id=OBJECT_ID(N'dbo.ShipmentImportAudit')
    )
      CREATE INDEX IX_ShipmentImportAudit_Week ON dbo.ShipmentImportAudit(OrderYear, OrderWeek, CreatedDtm);
  `);
}

export async function createShipmentImportAuditBatch({
  orderYear,
  week,
  rows = [],
  targetRowCount = 0,
  user,
  shipmentOnly = false,
} = {}) {
  await ensureAuditTables();
  const result = await query(
    `INSERT INTO dbo.ShipmentImportAudit
       (ActorUserId, ActorName, OrderYear, OrderWeek, ApplyMode, AuditStatus, InputRowCount, TargetRowCount)
     OUTPUT INSERTED.AuditKey
     VALUES (@uid, @name, @year, @week, @mode, 'STARTED', @inputRows, @targetRows)`,
    {
      uid: { type: sql.NVarChar, value: text(user?.userId || 'system', 100) },
      name: { type: sql.NVarChar, value: text(user?.userName || user?.userId || 'system', 100) },
      year: { type: sql.NVarChar, value: text(orderYear, 4) },
      week: { type: sql.NVarChar, value: text(week, 20) },
      mode: { type: sql.NVarChar, value: shipmentImportAuditMode({ shipmentOnly }) },
      inputRows: { type: sql.Int, value: Number(rows.length || 0) },
      targetRows: { type: sql.Int, value: Number(targetRowCount || 0) },
    },
  );
  return result.recordset[0]?.AuditKey || null;
}

function auditRowParams(auditKey, row, index) {
  const prefix = `r${index}_`;
  const p = (name, type, value) => ({ name: `${prefix}${name}`, type, value });
  return {
    params: [
      p('audit', sql.Int, Number(auditKey)),
      p('rowNo', sql.Int, numberOrNull(row.rowNo)),
      p('cust', sql.Int, numberOrNull(row.custKey)),
      p('prod', sql.Int, numberOrNull(row.prodKey)),
      p('customer', sql.NVarChar, text(row.customerName || row.custName, 200)),
      p('product', sql.NVarChar, text(row.productName || row.prodName, 300)),
      p('sourceType', sql.NVarChar, text(row.sourceType, 50)),
      p('sourceCells', sql.NVarChar, text(Array.isArray(row.sourceCells) ? row.sourceCells.join(', ') : row.sourceCells, 1000)),
      p('excelQty', sql.Float, numberOrNull(row.excelQty)),
      p('excelOrderQty', sql.Float, numberOrNull(row.excelOrderQty)),
      p('excelIncomingQty', sql.Float, numberOrNull(row.excelIncomingQty)),
      p('excelStockQty', sql.Float, numberOrNull(row.excelStockQty)),
      p('excelRemainingQty', sql.Float, numberOrNull(row.excelRemainingQty)),
      p('normalizedQty', sql.Float, numberOrNull(row.normalizedQty)),
      p('orderBeforeQty', sql.Float, numberOrNull(row.orderBeforeQty)),
      p('orderAfterQty', sql.Float, numberOrNull(row.orderAfterQty)),
      p('shipmentBeforeQty', sql.Float, numberOrNull(row.shipmentBeforeQty)),
      p('shipmentAfterQty', sql.Float, numberOrNull(row.shipmentAfterQty)),
      p('orderAction', sql.NVarChar, text(row.orderAction, 50)),
      p('shipmentAction', sql.NVarChar, text(row.shipmentAction, 50)),
      p('rowStatus', sql.NVarChar, text(row.rowStatus, 30)),
      p('verificationStatus', sql.NVarChar, text(row.verificationStatus, 30)),
      p('verificationReason', sql.NVarChar, text(row.verificationReason, 200)),
    ],
    values: [
      `@${prefix}audit`, `@${prefix}rowNo`, `@${prefix}cust`, `@${prefix}prod`,
      `@${prefix}customer`, `@${prefix}product`, `@${prefix}sourceType`, `@${prefix}sourceCells`,
      `@${prefix}excelQty`, `@${prefix}excelOrderQty`, `@${prefix}excelIncomingQty`,
      `@${prefix}excelStockQty`, `@${prefix}excelRemainingQty`, `@${prefix}normalizedQty`,
      `@${prefix}orderBeforeQty`, `@${prefix}orderAfterQty`, `@${prefix}shipmentBeforeQty`,
      `@${prefix}shipmentAfterQty`, `@${prefix}orderAction`, `@${prefix}shipmentAction`,
      `@${prefix}rowStatus`, `@${prefix}verificationStatus`, `@${prefix}verificationReason`,
    ],
  };
}

export async function finishShipmentImportAuditBatch({ auditKey, status = 'SUCCESS', summary = {}, rows = [], error } = {}) {
  if (!auditKey) return;
  await ensureAuditTables();
  await query(
    `UPDATE dbo.ShipmentImportAudit
        SET CompletedDtm=GETDATE(), AuditStatus=@status,
            AppliedCount=@applied, SkippedNoChangeCount=@skipNoChange, SkippedFixedCount=@skipFixed,
            OrderCreatedCount=@orderCreated, OrderUpdatedCount=@orderUpdated, OrderDeletedCount=@orderDeleted,
            ShipmentCreatedCount=@shipmentCreated, ShipmentUpdatedCount=@shipmentUpdated, ShipmentDeletedCount=@shipmentDeleted,
            VerificationChecked=@verifyChecked, VerificationMatched=@verifyMatched,
            VerificationMismatchCount=@verifyMismatch, ErrorCode=@errorCode, ErrorMessage=@errorMessage
      WHERE AuditKey=@auditKey`,
    {
      auditKey: { type: sql.Int, value: Number(auditKey) },
      status: { type: sql.NVarChar, value: text(status, 30) },
      applied: { type: sql.Int, value: Number(summary.appliedCount || 0) },
      skipNoChange: { type: sql.Int, value: Number(summary.skippedNoChangeCount || 0) },
      skipFixed: { type: sql.Int, value: Number(summary.skippedFixedCount || 0) },
      orderCreated: { type: sql.Int, value: Number(summary.orderCreatedCount || 0) },
      orderUpdated: { type: sql.Int, value: Number(summary.orderUpdatedCount || 0) },
      orderDeleted: { type: sql.Int, value: Number(summary.orderDeletedCount || 0) },
      shipmentCreated: { type: sql.Int, value: Number(summary.shipmentCreatedCount || 0) },
      shipmentUpdated: { type: sql.Int, value: Number(summary.shipmentUpdatedCount || 0) },
      shipmentDeleted: { type: sql.Int, value: Number(summary.shipmentDeletedCount || 0) },
      verifyChecked: { type: sql.Int, value: Number(summary.verificationChecked || 0) },
      verifyMatched: { type: sql.Int, value: Number(summary.verificationMatched || 0) },
      verifyMismatch: { type: sql.Int, value: Number(summary.verificationMismatchCount || 0) },
      errorCode: { type: sql.NVarChar, value: text(error?.code, 80) || null },
      errorMessage: { type: sql.NVarChar, value: text(error?.message, 1000) || null },
    },
  );

  const auditRows = Array.isArray(rows) ? rows : [];
  // 24개 컬럼 × 80행 = 1,920개 파라미터로 SQL Server 2,100개 제한 아래에서 저장한다.
  for (let start = 0; start < auditRows.length; start += 80) {
    const chunk = auditRows.slice(start, start + 80);
    const params = {};
    const values = [];
    chunk.forEach((row, index) => {
      const built = auditRowParams(auditKey, row, index);
      for (const param of built.params) params[param.name] = { type: param.type, value: param.value };
      values.push(`(${built.values.join(',')})`);
    });
    if (!values.length) continue;
    await query(
      `INSERT INTO dbo.ShipmentImportAuditRow
        (AuditKey,RowNo,CustKey,ProdKey,CustomerName,ProductName,SourceType,SourceCells,
         ExcelQty,ExcelOrderQty,ExcelIncomingQty,ExcelStockQty,ExcelRemainingQty,NormalizedQty,
         OrderBeforeQty,OrderAfterQty,ShipmentBeforeQty,ShipmentAfterQty,OrderAction,ShipmentAction,
         RowStatus,VerificationStatus,VerificationReason)
       VALUES ${values.join(',')}`,
      params,
    );
  }
}

export async function failShipmentImportAuditBatch(auditKey, error) {
  if (!auditKey) return;
  try {
    await finishShipmentImportAuditBatch({
      auditKey,
      status: 'FAILED',
      error,
      summary: {},
      rows: [],
    });
  } catch (auditError) {
    console.error('[shipmentImportAudit] 실패 상태 기록 실패:', auditError.message);
  }
}

