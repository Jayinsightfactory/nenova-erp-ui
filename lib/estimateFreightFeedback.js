const text = (value, length = 180) => typeof value === 'string' ? value.slice(0, length) : typeof value === 'number' ? String(value) : '';

export function appendFreightProgress(previous, message, time = new Date().toLocaleTimeString('ko-KR')) {
  return [...String(previous || '').split('\n').filter(Boolean), `[${time}] ${message}`].slice(-120).join('\n');
}

export function assertFreightCountReady(sources, drafts, manualConfirmed) {
  if (sources.some(row => row.scopeError)) throw new Error('품목의 연도·차수를 확인하세요. 수기 입력으로 범위 오류를 무시할 수 없습니다.');
  if (!sources.some(row => row.boxes == null)) return;
  if (manualConfirmed !== true || !drafts.length || drafts.some(row => row.manualQty !== true || !(Number(row.qty) > 0) || !Number.isFinite(Number(row.qty)))) {
    throw new Error('환산 미확인 품목이 있습니다. 적용할 모든 운임의 박스수를 직접 입력하고 수기 박스수 확인을 체크하거나, 미확인 품목을 계산에서 제외하세요.');
  }
}

export function freightFailureAudit(body = {}, error = {}, committing = false) {
  const applying = body.mode === 'apply';
  const unknown = applying && (committing || ['ETIMEOUT','ESOCKET','ECONNCLOSED','STOCK_GATE_BUSY'].includes(error.code));
  const outcome = unknown ? 'UNKNOWN' : applying ? 'ROLLED_BACK' : 'NOT_SAVED';
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const audit = {schema:'freight-failure-v1', year:text(body.year,4), week:text(body.parentWeek,8), custKey:text(body.custKey),
    operationId:text(body.operationId,36), mode:text(body.mode,12), outcome, code:text(error.code || 'FREIGHT_SAVE_FAILED'),
    reason:text(error.message || '운임 처리 오류',800), targetCount:rows.length,
    rows:rows.slice(0,40).map(row=>({week:text(row?.weekShort,8),prodKey:text(row?.prodKey),qty:text(row?.qty),cost:text(row?.cost)}))};
  return {audit, outcomeUnknown:unknown, rolledBack:applying&&!unknown,
    description:`${outcome==='UNKNOWN'?'저장 여부 확인 필요':outcome==='ROLLED_BACK'?'이번 요청 전체 롤백':'사전 확인 중단 · 저장 안 함'} · ${audit.reason}`.slice(0,1000)};
}

// Outside the failed ERP transaction: logging must never retry/mutate business data.
export async function persistFreightFailure(query, sql, userId, failure) {
  try {
    await query(`INSERT INTO SystemActionLog (Actor,SessionId,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel)
      VALUES (@actor,@op,N'ESTIMATE_FREIGHT_FAILURE',N'POST',N'/api/estimate/freight-register',N'OrderDetail/ShipmentDetail/ShipmentDate',0,@payload,@result,@description,N'HIGH')`, {
      actor:{type:sql.NVarChar,value:text(userId,100)},op:{type:sql.NVarChar,value:failure.audit.operationId},
      payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(failure.audit)},
      result:{type:sql.NVarChar,value:failure.outcomeUnknown?'ERROR':'FAIL'},description:{type:sql.NVarChar,value:failure.description},
    });
    return true;
  } catch { return false; }
}
