import { randomUUID } from 'node:crypto';

// CALC only. No pool/env/DDL, FIX/CANCEL handoff, gate clear or recovery.
const NULL_GATE_FIELDS = ['Mode', 'LockedAt', 'Action', 'OrderYear', 'OrderWeek',
  'OwnerSessionID', 'OwnerToken', 'CalcProdKey'];

function calculationError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function isIdle(row) {
  return row && NULL_GATE_FIELDS.every(key => row[key] === null)
    && (row.PendingCalc === false || row.PendingCalc === 0) && row.ProtocolVersion === 2;
}

function isLockTimeout(error) {
  return [error, error?.originalError, error?.originalError?.info, error?.cause,
    ...(error?.precedingErrors || [])].some(item => Number(item?.number) === 1222);
}

const IDLE_SQL = `GateKey='1' AND ProtocolVersion=2 AND Mode IS NULL
  AND LockedAt IS NULL AND Action IS NULL AND OrderYear IS NULL AND OrderWeek IS NULL
  AND OwnerSessionID IS NULL AND OwnerToken IS NULL AND PendingCalc=0 AND CalcProdKey IS NULL`;

const TRANSACTION_SQL = `IF @@SPID<>@spid OR @@TRANCOUNT<>@trancount OR XACT_STATE()<>1
  OR ISNULL(APPLOCK_MODE(N'public',@marker,N'Transaction'),N'NoLock')<>N'Exclusive'
  THROW 51062, 'STOCK_CALC_ORIGINAL_TRANSACTION_REQUIRED', 1;`;

function nativeBatchSql(keys) {
  // Only validated positive SQL Int literals are interpolated. Scope/user stay bound.
  const values = keys.map((key, index) => `(${index},${key})`).join(',');
  return `SET NOCOUNT ON;
    IF @@SPID<>@spid OR @@TRANCOUNT<>@trancount OR XACT_STATE()<>1
      THROW 51062, 'STOCK_CALC_OUTER_TRANSACTION_REQUIRED', 1;
    IF NOT EXISTS(SELECT 1 FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT) WHERE ${IDLE_SQL})
      THROW 51063, 'STOCK_CALC_IDLE_GATE_REQUIRED', 1;
    DECLARE @markerResult int;
    EXEC @markerResult=sys.sp_getapplock @Resource=@marker,@LockMode=N'Exclusive',
      @LockOwner=N'Transaction',@LockTimeout=0;
    IF @markerResult IS NULL OR @markerResult<0
      THROW 51062, 'STOCK_CALC_TRANSACTION_MARKER_REQUIRED', 1;
    DECLARE @products TABLE (Ordinal int PRIMARY KEY,ProdKey int NOT NULL);
    INSERT INTO @products SELECT Ordinal,ProdKey FROM (VALUES ${values}) p(Ordinal,ProdKey);
    DECLARE @results TABLE (ProdKey int,result int,returnCode int,message nvarchar(max),
      SessionID int,TransactionCount int,TransactionState int,GateIdle bit,MarkerHeld bit);
    DECLARE @ordinal int=0,@pk int,@r int,@rc int,@m nvarchar(max),@failure nvarchar(2048);
    WHILE @ordinal<${keys.length}
    BEGIN
      ${TRANSACTION_SQL}
      IF NOT EXISTS(SELECT 1 FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT) WHERE ${IDLE_SQL})
        THROW 51063, 'STOCK_CALC_IDLE_GATE_REQUIRED', 1;
      SELECT @pk=ProdKey FROM @products WHERE Ordinal=@ordinal;
      SELECT @r=NULL,@rc=NULL,@m=NULL;
      EXEC @rc=dbo.usp_StockCalculation @OrderYear=@year,@OrderWeek=@week,
        @ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;
      -- A native CATCH may ROLLBACK the entire outer transaction; never continue.
      ${TRANSACTION_SQL}
      IF @r IS NULL OR @rc IS NULL OR @r<>0 OR @rc<>0
      BEGIN
        SET @failure=LEFT(CONCAT(N'STOCK_CALC_NATIVE_FAILED ProdKey=',@pk,
          N' result=',COALESCE(CONVERT(nvarchar(20),@r),N'NULL'),
          N' returnCode=',COALESCE(CONVERT(nvarchar(20),@rc),N'NULL'),N' ',@m),2048);
        THROW 51064,@failure,1;
      END;
      IF NOT EXISTS(SELECT 1 FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT) WHERE ${IDLE_SQL})
        THROW 51063, 'STOCK_CALC_IDLE_GATE_REQUIRED', 1;
      INSERT @results VALUES(@pk,@r,@rc,@m,@@SPID,@@TRANCOUNT,XACT_STATE(),1,1);
      SET @ordinal+=1;
    END;
    ${TRANSACTION_SQL}
    SELECT ProdKey,result,returnCode,message,SessionID,TransactionCount,TransactionState,GateIdle,MarkerHeld
      FROM @results r ORDER BY (SELECT Ordinal FROM @products WHERE ProdKey=r.ProdKey);`;
}

/**
 * One calculation-only outer transaction, after the order has already committed.
 * All product calls share one SQL request (existing db requestTimeout: 60000ms),
 * so increasing product count does not multiply native timeout budgets.
 * Success returns validated product rows; failure throws and the owner rolls back.
 */
export async function runOrderStockCalculationBatch({ withTransactionFn, types,
  orderYear, orderWeek, uid, prodKeys = [] } = {}) {
  if (!Array.isArray(prodKeys)) throw new TypeError('prodKeys must be an array');
  const keys = [...new Set(prodKeys.map(Number))];
  if (!keys.length) return [];
  const year = String(orderYear ?? '');
  const week = String(orderWeek ?? '');
  if (!/^\d{4}$/.test(year) || Number(year) <= 2025 || !/^\d{2}-\d{2}$/.test(week)
    || keys.some(key => !Number.isInteger(key) || key <= 0 || key > 2147483647)) {
    throw calculationError('STOCK_CALC_SCOPE_INVALID', '재고 계산은 2026년 이후의 명시 연도·차수와 양수 품목키가 필요합니다.');
  }
  if (typeof withTransactionFn !== 'function' || !types?.Int || !types?.NVarChar) {
    throw new TypeError('withTransactionFn and SQL types are required');
  }
  return withTransactionFn(async tQuery => {
    let locked;
    try {
      locked = await tQuery(`SELECT GateKey,Mode,LockedAt,Action,OrderYear,OrderWeek,
        OwnerSessionID,OwnerToken,PendingCalc,CalcProdKey,ProtocolVersion,
        @@SPID AS SessionID,@@TRANCOUNT AS TransactionCount,XACT_STATE() AS TransactionState
        FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT) WHERE GateKey='1'`);
    } catch (cause) {
      if (isLockTimeout(cause)) throw calculationError('STOCK_GATE_BUSY', '다른 재고 작업이 진행 중입니다. 기존 게이트를 변경하지 않았습니다.', cause);
      if ([207, 208].includes(Number(cause?.number))) {
        throw calculationError('STOCK_GATE_CAPABILITY_REQUIRED', '재고 게이트 V2 스키마를 확인해야 합니다.', cause);
      }
      throw cause;
    }
    const row = locked?.recordset?.[0];
    if (locked?.recordset?.length !== 1) {
      throw calculationError('STOCK_GATE_CAPABILITY_REQUIRED', '재고 게이트 단일 행을 확인하지 못했습니다.');
    }
    if (!Number.isInteger(row.TransactionCount) || row.TransactionCount <= 0
      || row.TransactionState !== 1 || !Number.isInteger(row.SessionID) || row.SessionID <= 0) {
      throw calculationError('STOCK_CALC_TRANSACTION_REQUIRED', '재고 계산에는 정상 외부 트랜잭션이 필요합니다.');
    }
    if (!isIdle(row)) throw calculationError('STOCK_GATE_BUSY', '재고 작업 또는 미완료 계산이 있습니다. 기존 게이트를 변경하지 않았습니다.');

    let capability;
    try {
      capability = await tQuery(`EXEC dbo.usp_NenovaStockWeekGateCapability;
        SELECT name,system_type_id,is_output FROM sys.parameters
          WHERE object_id=OBJECT_ID(N'dbo.usp_StockCalculation',N'P');`);
    } catch (cause) {
      throw calculationError('STOCK_GATE_CAPABILITY_REQUIRED', '재고 게이트 V2 준비 상태를 확인하지 못했습니다.', cause);
    }
    const readyRows = capability?.recordsets?.[0];
    const ready = readyRows?.[0];
    const parameters = capability?.recordsets?.[1];
    const signature = [['@OrderYear',231,false],['@OrderWeek',231,false],['@ProdKey',56,false],
      ['@iUserID',231,false],['@oResult',56,true],['@oMessage',231,true]];
    if (readyRows?.length !== 1 || ready?.ProtocolVersion !== 2 || !(ready.IsReady === true || ready.IsReady === 1)
      || !Array.isArray(parameters) || parameters.length !== signature.length
      || !signature.every(([name,type,output]) => parameters.some(p => p.name === name
        && p.system_type_id === type && (p.is_output === output || p.is_output === Number(output))))) {
      throw calculationError('STOCK_GATE_CAPABILITY_REQUIRED', '재고 게이트 V2 또는 CALC 출력 계약이 준비되지 않았습니다.');
    }

    const params = {
      year: { type: types.NVarChar, value: year }, week: { type: types.NVarChar, value: week },
      uid: { type: types.NVarChar, value: uid || 'admin' },
      spid: { type: types.Int, value: row.SessionID },
      trancount: { type: types.Int, value: row.TransactionCount },
      marker: { type: types.NVarChar, value: `NenovaOrderStockCalculation:${randomUUID()}` },
    };
    const result = await tQuery(nativeBatchSql(keys), params);
    const sets = result?.recordsets;
    const rows = Array.isArray(sets) ? sets[sets.length - 1] : result?.recordset;
    if (!Array.isArray(rows) || rows.length !== keys.length || !rows.every((item, index) =>
      item.ProdKey === keys[index] && item.result === 0 && item.returnCode === 0
      && item.SessionID === row.SessionID && item.TransactionCount === row.TransactionCount
      && item.TransactionState === 1 && (item.GateIdle === true || item.GateIdle === 1)
      && (item.MarkerHeld === true || item.MarkerHeld === 1))) {
      throw calculationError('STOCK_CALC_RESULT_INVALID', '재고 계산 결과·게이트·원래 트랜잭션의 정상 종료를 확인하지 못했습니다.');
    }
    return rows;
  }, { retries: 0 });
}
