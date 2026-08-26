import { randomUUID } from 'node:crypto';

// No pool, environment, authentication, runtime DDL or global GateClear dependency.
// Caller owns one outer transaction. Take this lock BEFORE lease/business locks.
const operations = new WeakMap();

function gateError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  if (cause) error.cause = cause;
  return error;
}
function busy(error) {
  return Number(error?.number || error?.originalError?.number || error?.precedingErrors?.[0]?.number) === 1222;
}
function isNull(value) { return value === null || value === undefined; }
function scopeOf(input = {}) {
  const orderYear = String(input.orderYear ?? '');
  const orderWeek = String(input.orderWeek ?? '');
  const action = String(input.action ?? '');
  if (!/^\d{4}$/.test(orderYear) || !/^\d{2}-\d{2}$/.test(orderWeek) || !['FIX', 'CANCEL'].includes(action)) {
    throw gateError('STOCK_GATE_SCOPE_INVALID', '재고 게이트의 연도·차수·FIX/CANCEL 동작을 확인하세요.');
  }
  return { orderYear, orderWeek, action, requireV2: input.requireV2 === true };
}
function scopeParams(types, scope) {
  return { yr: { type: types.NVarChar, value: scope.orderYear }, wk: { type: types.NVarChar, value: scope.orderWeek },
    action: { type: types.NVarChar, value: scope.action } };
}

/**
 * Returns a transaction-bound context, not a native gate acquisition token.
 * V1 is compatibility ONLY: it cannot repair native V1's post-rollback global Leave.
 * New physical-quantity writers must require V2 and use their atomic quantity path.
 */
export async function lockStockGateOperation(tQ, types, input) {
  if (typeof tQ !== 'function' || !types?.Int || !types?.NVarChar) throw new TypeError('tQ and SQL types are required');
  const scope = scopeOf(input);
  let row;
  try {
    const result = await tQ(`SELECT GateKey, Mode, LockedAt, Action, OrderYear, OrderWeek,
        @@SPID AS SessionID, @@TRANCOUNT AS TransactionCount, XACT_STATE() AS TransactionState
      FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT)
      WHERE GateKey='1'`);
    row = result.recordset?.[0];
    if (result.recordset?.length !== 1) throw gateError('STOCK_GATE_CAPABILITY_REQUIRED', '재고 게이트 단일 행을 확인하지 못했습니다.');
  } catch (error) {
    if (busy(error)) throw gateError('STOCK_GATE_BUSY', '다른 전산 재고 작업이 진행 중입니다. 저장하지 않았습니다.', error);
    if (Number(error?.number) === 208) throw gateError('STOCK_GATE_CAPABILITY_REQUIRED', '재고 게이트 설치를 확인해야 합니다.', error);
    throw error;
  }
  if (!(Number(row.TransactionCount) > 0) || Number(row.TransactionState) !== 1 || !(Number(row.SessionID) > 0)) {
    throw gateError('STOCK_GATE_TRANSACTION_REQUIRED', '재고 게이트는 같은 SQL 트랜잭션 안에서만 사용할 수 있습니다.');
  }
  if (!['Mode', 'LockedAt', 'Action', 'OrderYear', 'OrderWeek'].every(key => isNull(row[key]))) {
    throw gateError('STOCK_GATE_BUSY', '재고 작업 또는 미완료 재계산이 있습니다. 기존 작업을 확인하세요.');
  }

  // This metadata check occurs AFTER the row lock: a concurrent migration cannot
  // switch protocols between classification and this operation's native call.
  const metadata = (await tQ(`SELECT
      COUNT(CASE WHEN c.name IN(N'OwnerSessionID',N'OwnerToken',N'PendingCalc',N'CalcProdKey',N'ProtocolVersion') THEN 1 END) AS OwnerColumnCount,
      COUNT(CASE WHEN (c.name=N'OwnerSessionID' AND c.system_type_id=56)
        OR (c.name=N'OwnerToken' AND c.system_type_id=36)
        OR (c.name=N'PendingCalc' AND c.system_type_id=104)
        OR (c.name=N'CalcProdKey' AND c.system_type_id=56)
        OR (c.name=N'ProtocolVersion' AND c.system_type_id=52) THEN 1 END) AS TypedColumnCount,
      OBJECT_ID(N'dbo.usp_NenovaStockWeekGateCapability',N'P') AS CapabilityObjectID
    FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'dbo.NenovaStockWeekGate',N'U')`)).recordset?.[0];
  let protocolVersion;
  if (Number(metadata?.OwnerColumnCount) === 0 && isNull(metadata.CapabilityObjectID)) protocolVersion = 1;
  else if (Number(metadata?.OwnerColumnCount) === 5 && Number(metadata?.TypedColumnCount) === 5 && Number(metadata?.CapabilityObjectID) > 0) protocolVersion = 2;
  else throw gateError('STOCK_GATE_CAPABILITY_REQUIRED', '재고 게이트 스키마가 불완전합니다. 저장을 중단했습니다.');
  if (scope.requireV2 && protocolVersion !== 2) {
    throw gateError('STOCK_GATE_CAPABILITY_REQUIRED', '이 수량 저장에는 재고 게이트 V2 설치가 필요합니다.');
  }
  if (protocolVersion === 2) {
    const capability = (await tQ('EXEC dbo.usp_NenovaStockWeekGateCapability')).recordset?.[0];
    if (Number(capability?.ProtocolVersion) !== 2 || Number(capability?.IsReady) !== 1) {
      throw gateError('STOCK_GATE_CAPABILITY_REQUIRED', '재고 게이트 V2 정의·상태 제약 검증에 실패했습니다.');
    }
    const owner = (await tQ(`SELECT OwnerSessionID,OwnerToken,PendingCalc,CalcProdKey,ProtocolVersion
      FROM dbo.NenovaStockWeekGate WHERE GateKey='1'`)).recordset?.[0];
    if (!owner || !isNull(owner.OwnerSessionID) || !isNull(owner.OwnerToken) || Number(owner.PendingCalc) !== 0
      || !isNull(owner.CalcProdKey) || Number(owner.ProtocolVersion) !== 2) {
      throw gateError('STOCK_GATE_CAPABILITY_REQUIRED', '비어 있는 재고 게이트의 소유권 정보가 일치하지 않습니다.');
    }
  }
  const marker = `NenovaStockGateOperation:${randomUUID()}`;
  // A transaction-owned marker detects ROLLBACK + new transaction on the SAME
  // pooled SPID. It is NOT used to serialize EXE callers; the real gate row does that.
  const marked = (await tQ(`DECLARE @r int;
    EXEC @r=sys.sp_getapplock @Resource=@marker,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=0;
    SELECT @r AS MarkerResult`, { marker: { type: types.NVarChar, value: marker } })).recordset?.[0];
  if (!Number.isInteger(marked?.MarkerResult) || marked.MarkerResult < 0) throw gateError('STOCK_GATE_TRANSACTION_REQUIRED', '재고 작업 트랜잭션 표식을 확보하지 못했습니다.');
  const operation = Object.freeze({ ...scope, protocolVersion, ownerSessionId: Number(row.SessionID),
    transactionCount: Number(row.TransactionCount) });
  operations.set(operation, { tQ, marker, cleared: false });
  return operation;
}

/**
 * Explicit deferred-calc handoff ONLY after successful native FIX/CANCEL, on the
 * same still-live outer transaction. This does not claim final stock consistency.
 * For normal legacy fix/unfix, prefer the native full-product CALC before commit.
 */
export async function clearStockGateOperation(tQ, types, operation, { nativeResult, nativeReturnCode } = {}) {
  const state = operations.get(operation);
  if (!state || state.tQ !== tQ || state.cleared) throw gateError('STOCK_GATE_OPERATION_INVALID', '같은 재고 작업의 트랜잭션 정보가 필요합니다.');
  if (nativeResult !== 0 || nativeReturnCode !== 0) {
    throw gateError('STOCK_GATE_NATIVE_NOT_SUCCESSFUL', '전산 확정/취소 성공을 확인하지 못해 게이트를 해제하지 않았습니다.');
  }
  const params = { ...scopeParams(types, operation), spid: { type: types.Int, value: operation.ownerSessionId },
    trancount: { type: types.Int, value: operation.transactionCount }, marker: { type: types.NVarChar, value: state.marker } };
  const txGuard = `IF @@SPID<>@spid OR @@TRANCOUNT<>@trancount OR XACT_STATE()<>1
      OR ISNULL(APPLOCK_MODE(N'public',@marker,N'Transaction'),N'NoLock')<>N'Exclusive'
    THROW 51062, 'STOCK_GATE_ORIGINAL_TRANSACTION_REQUIRED', 1;`;
  const statement = operation.protocolVersion === 2 ? `${txGuard}
    DECLARE @ownedToken uniqueidentifier;
    SELECT @ownedToken=OwnerToken FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT)
      WHERE GateKey='1' AND ProtocolVersion=2 AND Mode=N'WAIT_CALC' AND PendingCalc=1
        AND OwnerSessionID=@@SPID AND OrderYear=@yr AND OrderWeek=@wk AND Action=@action;
    IF @ownedToken IS NULL THROW 51062, 'STOCK_GATE_OWNED_WAIT_CALC_REQUIRED', 1;
    UPDATE dbo.NenovaStockWeekGate
      SET Mode=NULL,LockedAt=NULL,Action=NULL,OrderYear=NULL,OrderWeek=NULL,
          OwnerSessionID=NULL,OwnerToken=NULL,PendingCalc=0,CalcProdKey=NULL
      WHERE GateKey='1' AND ProtocolVersion=2 AND Mode=N'WAIT_CALC' AND PendingCalc=1
        AND OwnerSessionID=@@SPID AND OwnerToken=@ownedToken
        AND OrderYear=@yr AND OrderWeek=@wk AND Action=@action;
    DECLARE @cleared int=@@ROWCOUNT;
    IF @cleared<>1 THROW 51062, 'STOCK_GATE_CLEAR_ROWCOUNT_MISMATCH', 1;
    SELECT @cleared AS Cleared,@ownedToken AS OwnerToken;` : `${txGuard}
    UPDATE dbo.NenovaStockWeekGate
      SET Mode=NULL,LockedAt=NULL,Action=NULL,OrderYear=NULL,OrderWeek=NULL
      WHERE GateKey='1' AND Mode=N'WAIT_CALC' AND OrderYear=@yr AND OrderWeek=@wk AND Action=@action;
    DECLARE @cleared int=@@ROWCOUNT;
    IF @cleared<>1 THROW 51062, 'STOCK_GATE_CLEAR_ROWCOUNT_MISMATCH', 1;
    SELECT @cleared AS Cleared;`;
  try {
    const result = (await tQ(statement, params)).recordset?.[0];
    if (Number(result?.Cleared) !== 1) throw gateError('STOCK_GATE_CLEAR_ROWCOUNT_MISMATCH', '재고 게이트 해제 결과가 일치하지 않습니다. 전체 저장을 취소하세요.');
    state.cleared = true;
    return { cleared: true, protocolVersion: operation.protocolVersion, ownerToken: result.OwnerToken || null };
  } catch (error) {
    if (busy(error)) throw gateError('STOCK_GATE_BUSY', '재고 게이트 잠금이 일치하지 않습니다. 전체 저장을 취소하세요.', error);
    throw error;
  }
}
