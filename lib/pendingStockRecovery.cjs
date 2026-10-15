'use strict';

const { randomUUID } = require('node:crypto');

const EXPECTED_CALC_SHA256 = '24a415fa16e5fd4fcf2a1b342cc05b3e081142e9bd358ab11f010836907a7edd';
const DEFAULT_MIN_PENDING_AGE_SECONDS = 60;
const NULL_GATE_FIELDS = ['Mode', 'LockedAt', 'Action', 'OrderYear', 'OrderWeek',
  'OwnerSessionID', 'OwnerToken', 'CalcProdKey'];
const SIGNATURE = [
  ['@OrderYear', 231, 40, false], ['@OrderWeek', 231, 40, false],
  ['@ProdKey', 56, 4, false], ['@iUserID', 231, 40, false],
  ['@oResult', 56, 4, true], ['@oMessage', 231, -1, true],
];
const IDLE_SQL = `GateKey='1' AND ProtocolVersion=2 AND Mode IS NULL
  AND LockedAt IS NULL AND Action IS NULL AND OrderYear IS NULL AND OrderWeek IS NULL
  AND OwnerSessionID IS NULL AND OwnerToken IS NULL AND PendingCalc=0 AND CalcProdKey IS NULL`;
const TRANSACTION_SQL = `IF @@SPID<>@spid OR @@TRANCOUNT<>@trancount OR XACT_STATE()<>1
  OR ISNULL(APPLOCK_MODE(N'public',@marker,N'Transaction'),N'NoLock')<>N'Exclusive'
  THROW 51072, 'PENDING_STOCK_ORIGINAL_TRANSACTION_REQUIRED', 1;`;

const LOCK_SQL = `SET NOCOUNT ON;
  IF @@TRANCOUNT<=0 OR XACT_STATE()<>1
    THROW 51072, 'PENDING_STOCK_ORIGINAL_TRANSACTION_REQUIRED', 1;
  DECLARE @markerResult int;
  EXEC @markerResult=sys.sp_getapplock @Resource=@marker,@LockMode=N'Exclusive',
    @LockOwner=N'Transaction',@LockTimeout=0;
  IF @markerResult IS NULL OR @markerResult<0
    THROW 51072, 'PENDING_STOCK_TRANSACTION_MARKER_REQUIRED', 1;
  SELECT GateKey,Mode,LockedAt,Action,OrderYear,OrderWeek,
    OwnerSessionID,OwnerToken,PendingCalc,CalcProdKey,ProtocolVersion,
    CASE WHEN LockedAt<=DATEADD(SECOND,-@minPendingAgeSeconds,GETDATE()) THEN 1 ELSE 0 END AS PendingMature,
    @@SPID AS SessionID,@@TRANCOUNT AS TransactionCount,XACT_STATE() AS TransactionState,
    APPLOCK_MODE(N'public',@marker,N'Transaction') AS MarkerMode
  FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT) WHERE GateKey='1';`;

const CAPABILITY_SQL = `SET NOCOUNT ON;
  EXEC dbo.usp_NenovaStockWeekGateCapability;
  SELECT parameter_id,name,system_type_id,max_length,is_output,is_readonly
    FROM sys.parameters WHERE object_id=OBJECT_ID(N'dbo.usp_StockCalculation',N'P')
    ORDER BY parameter_id;
  SELECT LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',definition),2)) AS CalcSha256
    FROM sys.sql_modules WHERE object_id=OBJECT_ID(N'dbo.usp_StockCalculation',N'P');`;

// There is deliberately no gate UPDATE/clear or FIX/CANCEL here. Ordinary native
// full CALC consumes the exact pending scope and owns its existing business SQL.
const RECOVERY_SQL = `SET NOCOUNT ON;
  ${TRANSACTION_SQL}
  IF NOT EXISTS(SELECT 1 FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE GateKey='1' AND ProtocolVersion=2 AND Mode=N'WAIT_CALC' AND PendingCalc=1
      AND Action=@action AND OrderYear=@year AND OrderWeek=@week
      AND OwnerSessionID=@ownerSpid AND OwnerToken=CONVERT(uniqueidentifier,@ownerToken)
      AND CalcProdKey IS NULL AND LockedAt IS NOT NULL
      AND LockedAt<=DATEADD(SECOND,-@minPendingAgeSeconds,GETDATE()))
    THROW 51073, 'PENDING_STOCK_GATE_CHANGED', 1;
  IF NOT EXISTS(SELECT 1 FROM sys.sql_modules
    WHERE object_id=OBJECT_ID(N'dbo.usp_StockCalculation',N'P')
      AND LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',definition),2))=@expectedCalcSha256)
    THROW 51074, 'PENDING_STOCK_CALC_HASH_REQUIRED', 1;
  DECLARE @r int=NULL,@rc int=NULL,@m nvarchar(max)=NULL;
  ${TRANSACTION_SQL}
  EXEC @rc=dbo.usp_StockCalculation @OrderYear=@year,@OrderWeek=@week,
    @ProdKey=0,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;
  -- Native CATCH can roll back the entire outer transaction. Do not query a
  -- gate, retry, or begin another transaction before proving the original one.
  ${TRANSACTION_SQL}
  IF @r IS NULL OR @rc IS NULL OR @r<>0 OR @rc<>0
    THROW 51075, 'PENDING_STOCK_NATIVE_FAILED', 1;
  IF NOT EXISTS(SELECT 1 FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE ${IDLE_SQL})
    THROW 51076, 'PENDING_STOCK_FINAL_IDLE_REQUIRED', 1;
  ${TRANSACTION_SQL}
  SELECT @r AS result,@rc AS returnCode,@year AS OrderYear,@week AS OrderWeek,
    @@SPID AS SessionID,@@TRANCOUNT AS TransactionCount,XACT_STATE() AS TransactionState,
    APPLOCK_MODE(N'public',@marker,N'Transaction') AS MarkerMode,
    GateKey,Mode,LockedAt,Action,OwnerSessionID,OwnerToken,PendingCalc,CalcProdKey,ProtocolVersion,
    OrderYear AS GateOrderYear,OrderWeek AS GateOrderWeek
  FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT) WHERE GateKey='1';`;

function bit(value, expected) { return value === expected || value === Number(expected); }
function isIdle(row) {
  return row && NULL_GATE_FIELDS.every(key => row[key] === null)
    && bit(row.PendingCalc, false) && row.ProtocolVersion === 2;
}
function isPending(row) {
  return row.ProtocolVersion === 2 && row.Mode === 'WAIT_CALC' && bit(row.PendingCalc, true)
    && ['FIX', 'CANCEL', 'CALC'].includes(row.Action)
    && typeof row.OrderYear === 'string' && /^\d{4}$/.test(row.OrderYear) && Number(row.OrderYear) >= 2026
    && typeof row.OrderWeek === 'string' && /^\d{2}-\d{2}$/.test(row.OrderWeek)
    && Number.isInteger(row.OwnerSessionID) && row.OwnerSessionID > 0
    && typeof row.OwnerToken === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.OwnerToken)
    && row.CalcProdKey === null && row.LockedAt instanceof Date && Number.isFinite(row.LockedAt.getTime())
    && (bit(row.PendingMature, false) || bit(row.PendingMature, true));
}
function healthy(row) {
  return Number.isInteger(row?.SessionID) && row.SessionID > 0
    && Number.isInteger(row.TransactionCount) && row.TransactionCount > 0 && row.TransactionState === 1
    && row.MarkerMode === 'Exclusive';
}
function hasSqlNumber(error, number) {
  return [error, error?.originalError, error?.originalError?.info, error?.cause,
    ...(error?.precedingErrors || [])].some(item => Number(item?.number) === number);
}
function fail(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}
function resultRows(result) {
  return Array.isArray(result?.recordsets) ? result.recordsets.at(-1) : result?.recordset;
}
function capabilityValid(result) {
  const [readyRows, parameters, hashes] = result?.recordsets || [];
  return readyRows?.length === 1 && readyRows[0].ProtocolVersion === 2 && bit(readyRows[0].IsReady, true)
    && hashes?.length === 1 && hashes[0].CalcSha256 === EXPECTED_CALC_SHA256
    && parameters?.length === SIGNATURE.length
    && SIGNATURE.every(([name, type, length, output], i) => {
      const p = parameters[i];
      return p?.parameter_id === i + 1 && p.name === name && p.system_type_id === type
        && p.max_length === length && bit(p.is_output, output) && bit(p.is_readonly, false);
    });
}

/**
 * Recover committed V2 WAIT_CALC through ordinary native same-year/week CALC0.
 * tQuery must remain pinned to one active outer transaction. The caller alone
 * commits/rolls back and must discard the dedicated connection on timeout/error.
 * Grace only schedules pending work; RUN is never reclaimed, regardless of age.
 * onCandidate may persist the fingerprint/cooldown; false skips without CALC.
 */
async function recoverPendingStock({ tQuery, types, uid = 'pending-recovery',
  minPendingAgeSeconds = DEFAULT_MIN_PENDING_AGE_SECONDS, onCandidate } = {}) {
  const started = Date.now();
  let scope = null;
  let candidate = null;
  const finish = (status, code) => ({ status, code, scope, candidate, durationMs: Math.max(0, Date.now() - started) });
  if (typeof tQuery !== 'function' || !types?.Int || !types?.NVarChar
    || !Number.isInteger(minPendingAgeSeconds) || minPendingAgeSeconds < 0 || minPendingAgeSeconds > 86400
    || typeof uid !== 'string' || uid.length < 1 || uid.length > 20 || uid.includes('\0')
    || (onCandidate !== undefined && typeof onCandidate !== 'function')) {
    throw fail('PENDING_STOCK_ARGUMENTS_INVALID');
  }
  try {
    const marker = `NenovaPendingStockRecovery:${randomUUID()}`;
    let locked;
    try {
      locked = await tQuery(LOCK_SQL, { minPendingAgeSeconds: { type: types.Int, value: minPendingAgeSeconds },
        marker: { type: types.NVarChar, value: marker } });
    } catch (cause) {
      if (hasSqlNumber(cause, 1222)) return finish('skipped', 'PENDING_STOCK_GATE_LOCKED');
      if (hasSqlNumber(cause, 51072)) throw fail('PENDING_STOCK_TRANSACTION_REQUIRED', cause);
      throw fail('PENDING_STOCK_GATE_READ_FAILED', cause);
    }
    const rows = resultRows(locked);
    const gate = rows?.[0];
    if (rows?.length !== 1 || !['1', 1].includes(gate?.GateKey)) throw fail('PENDING_STOCK_GATE_INVALID');
    if (!healthy(gate)) throw fail('PENDING_STOCK_TRANSACTION_REQUIRED');
    if (gate.Mode === 'RUN') return finish('skipped', 'PENDING_STOCK_ACTIVE_RUN');
    if (isIdle(gate)) return finish('skipped', 'PENDING_STOCK_IDLE');
    if (!isPending(gate)) throw fail('PENDING_STOCK_GATE_INVALID');
    scope = Object.freeze({ orderYear: gate.OrderYear, orderWeek: gate.OrderWeek });
    candidate = Object.freeze({ ...scope, ownerToken: gate.OwnerToken,
      lockedAt: gate.LockedAt.toISOString(), action: gate.Action });
    if (!bit(gate.PendingMature, true)) return finish('skipped', 'PENDING_STOCK_TOO_YOUNG');
    if (onCandidate && await onCandidate(candidate) === false) return finish('skipped', 'PENDING_STOCK_COOLDOWN');

    let capability;
    try { capability = await tQuery(CAPABILITY_SQL); }
    catch (cause) { throw fail('PENDING_STOCK_CAPABILITY_REQUIRED', cause); }
    if (!capabilityValid(capability)) throw fail('PENDING_STOCK_CAPABILITY_REQUIRED');

    const params = {
      year: { type: types.NVarChar, value: scope.orderYear }, week: { type: types.NVarChar, value: scope.orderWeek },
      uid: { type: types.NVarChar, value: uid }, action: { type: types.NVarChar, value: gate.Action },
      ownerSpid: { type: types.Int, value: gate.OwnerSessionID },
      ownerToken: { type: types.NVarChar, value: gate.OwnerToken },
      spid: { type: types.Int, value: gate.SessionID }, trancount: { type: types.Int, value: gate.TransactionCount },
      marker: { type: types.NVarChar, value: marker },
      minPendingAgeSeconds: { type: types.Int, value: minPendingAgeSeconds },
      expectedCalcSha256: { type: types.NVarChar, value: EXPECTED_CALC_SHA256 },
    };
    let native;
    try { native = await tQuery(RECOVERY_SQL, params); }
    catch (cause) {
      const code = [[51072, 'PENDING_STOCK_ORIGINAL_TRANSACTION_REQUIRED'], [51073, 'PENDING_STOCK_GATE_CHANGED'],
        [51074, 'PENDING_STOCK_CALC_HASH_REQUIRED'], [51075, 'PENDING_STOCK_NATIVE_FAILED'],
        [51076, 'PENDING_STOCK_FINAL_IDLE_REQUIRED']].find(([n]) => hasSqlNumber(cause, n))?.[1];
      throw fail(code || 'PENDING_STOCK_CALC_FAILED', cause);
    }
    const nativeRows = resultRows(native);
    const final = nativeRows?.[0];
    if (nativeRows?.length !== 1 || final.result !== 0 || final.returnCode !== 0
      || final.OrderYear !== scope.orderYear || final.OrderWeek !== scope.orderWeek
      || final.SessionID !== gate.SessionID || final.TransactionCount !== gate.TransactionCount
      || final.TransactionState !== 1 || final.MarkerMode !== 'Exclusive'
      || !['1', 1].includes(final.GateKey)
      || !isIdle({ ...final, OrderYear: final.GateOrderYear, OrderWeek: final.GateOrderWeek })) {
      throw fail('PENDING_STOCK_RESULT_INVALID');
    }
    return finish('recovered', 'PENDING_STOCK_RECOVERED');
  } catch (error) {
    if (typeof error?.code !== 'string' || !error.code.startsWith('PENDING_STOCK_')) {
      error = fail('PENDING_STOCK_RECOVERY_FAILED', error);
    }
    error.scope = scope;
    error.candidate = candidate;
    error.durationMs = Math.max(0, Date.now() - started);
    throw error;
  }
}

module.exports = { recoverPendingStock, EXPECTED_CALC_SHA256, DEFAULT_MIN_PENDING_AGE_SECONDS };
