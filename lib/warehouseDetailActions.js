import { correctionError, correctionScope, nativeQuantityWriteFields } from './warehouseCorrectionPolicy.js';

const param=(type,value)=>({type,value});
const labelAction='WAREHOUSE_ROUND_LABEL';
const labelCode=/^[AB]?$/;
const scopeKey=scope=>`warehouse-round:${scope.orderYear}:${scope.orderWeek}:${scope.warehouseKey}`;
const val=(payload)=>{
  const suffix=JSON.parse(payload).after;
  if (typeof suffix!=='string' || !labelCode.test(suffix))
    throw correctionError('CORRECTION_ROUND_HISTORY','저장된 차수 표시 이력을 확인하지 못했습니다.',503);
  return suffix;
};

export async function attachWarehouseRoundLabels(query,types,masters) {
  if(!masters.length) return masters;
  const scopes=new Map(masters.filter(row=>/^\d{2}-\d{2}$/.test(row.OrderWeek)).map(row=>[
    scopeKey({warehouseKey:row.WarehouseKey,orderYear:row.OrderYear,orderWeek:row.OrderWeek}),row,
  ]));
  if(!scopes.size)return masters;
  const {recordset}=await query(`/* correction:round-list */
    SELECT log.SessionId,log.Payload FROM dbo.SystemActionLog log JOIN (
      SELECT l.SessionId, MAX(l.LogKey) LogKey FROM dbo.SystemActionLog l
      JOIN OPENJSON(@keys) k ON l.SessionId=k.value
      WHERE l.ActionType=@kind AND l.Result=N'SUCCESS' GROUP BY l.SessionId
    ) latest ON log.LogKey=latest.LogKey`,{
    keys:param(types.NVarChar,JSON.stringify([...scopes.keys()])),kind:param(types.NVarChar,labelAction),
  });
  const latest=new Map(recordset.map(row=>[row.SessionId,val(row.Payload)]));
  return masters.map(row=>({...row,RoundSuffix:latest.get(scopeKey({
    warehouseKey:row.WarehouseKey,orderYear:row.OrderYear,orderWeek:row.OrderWeek,
  }))??''}));
}

export async function recordWarehouseRoundLabel(query,types,scope,{previous='',suffix,actor,source}) {
  const payload={...scope,before:previous,after:suffix,source};
  await query(`/* correction:round-audit */ INSERT dbo.SystemActionLog
    (Actor,SessionId,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel)
    VALUES(@actor,@target,@kind,N'POST',N'/api/warehouse/detail-actions',N'SystemActionLog',1,@payload,N'SUCCESS',N'입고 차수 표시',N'LOW')`,{
    actor:param(types.NVarChar,actor),target:param(types.NVarChar,scopeKey(scope)),
    kind:param(types.NVarChar,labelAction),payload:param(types.NVarChar,JSON.stringify(payload)),
  });
}

function headerParams(types,scope) {
  return {wk:param(types.Int,scope.warehouseKey),year:param(types.NVarChar,scope.orderYear),week:param(types.NVarChar,scope.orderWeek)};
}
async function assertRoundReceipt(query,types,scope,lock='') {
  const {recordset}=await query(`/* correction:round-header */ SELECT WarehouseKey FROM dbo.WarehouseMaster ${lock}
    WHERE WarehouseKey=@wk AND OrderYear=@year AND OrderWeek=@week AND isDeleted=0`,headerParams(types,scope));
  if(recordset?.length!==1)throw correctionError('CORRECTION_NOT_FOUND','해당 연도·차수의 입고가 변경되었거나 삭제되었습니다.',404);
}

export async function changeWarehouseRoundLabel(query,types,input,actor) {
  const scope=correctionScope(input), {suffix,expectedSuffix}=input;
  if(typeof suffix!=='string'||typeof expectedSuffix!=='string'||!labelCode.test(suffix)||!labelCode.test(expectedSuffix))
    throw correctionError('CORRECTION_ROUND_VALUE','차수 표시 없음, A 또는 B를 선택하세요.',400);
  await assertRoundReceipt(query,types,scope,'WITH (UPDLOCK,HOLDLOCK)');
  const {recordset}=await query(`/* correction:round-current */ SELECT TOP(1) Payload FROM dbo.SystemActionLog WITH (UPDLOCK,HOLDLOCK)
    WHERE ActionType=@kind AND SessionId=@target AND Result=N'SUCCESS' ORDER BY LogKey DESC`,{
    kind:param(types.NVarChar,labelAction),target:param(types.NVarChar,scopeKey(scope)),
  });
  const previous=recordset.length?val(recordset[0].Payload):'';
  if(previous!==expectedSuffix)throw correctionError('CORRECTION_ROUND_STALE','다른 사용자가 차수 표시를 변경했습니다. 목록을 새로고침하세요.');
  if(previous!==suffix)await recordWarehouseRoundLabel(query,types,scope,{actor,previous,suffix,source:'INLINE'});
  return {warehouseKey:scope.warehouseKey,suffix};
}

export async function readWarehouseDetailActions(query,types,input) {
  const scope=correctionScope(input);
  await assertRoundReceipt(query,types,scope);
  const {recordset}=await query(`/* correction:detail-history */ SELECT TOP(50) LogKey,ActionType,Actor,ActionDtm,Payload
    FROM dbo.SystemActionLog
    WHERE Result=N'SUCCESS' AND (
      (ActionType=@kind AND SessionId=@target) OR
      (ActionType=N'WAREHOUSE_CORRECTION'
       AND JSON_VALUE(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE N'{}' END,N'$.mode')=N'NATIVE_QUANTITY'
       AND JSON_VALUE(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE N'{}' END,N'$.warehouseKey')=@key
       AND JSON_VALUE(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE N'{}' END,N'$.orderYear')=@year
       AND JSON_VALUE(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE N'{}' END,N'$.orderWeek')=@week))
    ORDER BY LogKey DESC`,{
    ...headerParams(types,scope),kind:param(types.NVarChar,labelAction),target:param(types.NVarChar,scopeKey(scope)),
    key:param(types.NVarChar,String(scope.warehouseKey)),
  });
  return recordset.map(entry=>{
    const audit=JSON.parse(entry.Payload);
    const common={id:entry.LogKey,kind:entry.ActionType,actor:entry.Actor,at:entry.ActionDtm};
    if(entry.ActionType===labelAction)return {...common,before:audit.before,after:val(entry.Payload)};
    const snapshot=row=>Object.fromEntries(nativeQuantityWriteFields.map(field=>[field,row[field]]));
    return {...common,reason:audit.reason,detailKey:audit.nativeQuantity.after.WdetailKey,product:audit.nativeQuantity.prodName,
      before:snapshot(audit.nativeQuantity.before),after:snapshot(audit.nativeQuantity.after)};
  });
}
