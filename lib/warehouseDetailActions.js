import { createHash } from 'node:crypto';
import nativeCostCatalog from '../data/native-cost-source-evidence.json' with { type: 'json' };
import { correctionError, correctionScope, nativeQuantityWriteFields } from './warehouseCorrectionPolicy.js';
import { isOrphanWeightDetailRow } from './warehouseWeightRows.js';

const param=(type,value)=>({type,value});
const labelAction='WAREHOUSE_ROUND_LABEL';
const costAction='WAREHOUSE_RECEIPT_COSTS';
const labelCode=/^[AB]?$/;
const scopeKey=scope=>`warehouse-round:${scope.orderYear}:${scope.orderWeek}:${scope.warehouseKey}`;
const sha256=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
  const {recordset}=await query(`/* correction:round-header */ SELECT WarehouseKey,GrossWeight,ChargeableWeight FROM dbo.WarehouseMaster ${lock}
    WHERE WarehouseKey=@wk AND OrderYear=@year AND OrderWeek=@week AND isDeleted=0`,headerParams(types,scope));
  if(recordset?.length!==1)throw correctionError('CORRECTION_NOT_FOUND','해당 연도·차수의 입고가 변경되었거나 삭제되었습니다.',404);
  return recordset[0];
}

function normalizeOptionalNumber(value, label, { allowNegative = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') throw correctionError('CORRECTION_COST_INVALID', `${label}에 올바른 숫자를 입력하세요.`, 400);
  const number = Number(value);
  if (!Number.isFinite(number) || (!allowNegative && number < 0) || Math.abs(number) > 1e10)
    throw correctionError('CORRECTION_COST_INVALID', `${label}에 올바른 숫자를 입력하세요.`, 400);
  return Math.round(number * 1e4) / 1e4;
}

export async function saveWarehouseReceiptCosts(query,types,input,actor) {
  const scope=correctionScope(input);
  const gw=normalizeOptionalNumber(input.gw,'GW 실중량');
  const cw=normalizeOptionalNumber(input.cw,'CW 과금중량');
  const freight=normalizeOptionalNumber(input.freight,'운송료',{allowNegative:true});
  const reason=String(input.reason??'').trim();
  if(!reason||reason.length>500)throw correctionError('CORRECTION_REASON_REQUIRED','운송료·중량 저장 사유를 1~500자로 입력하세요.',400);
  if(gw!==null&&cw!==null&&cw>0&&gw>0&&cw<gw)
    throw correctionError('CORRECTION_COST_INVALID','과금중량(CW)은 실중량(GW) 이상이어야 합니다.',400);
  const master=await assertRoundReceipt(query,types,scope,'WITH (UPDLOCK,HOLDLOCK)');
  const detailsRes=await query(`/* correction:cost-details */ SELECT WdetailKey,ProdKey,BoxQuantity,BunchQuantity,
    SteamQuantity,SteamOf1Box,SteamOf1Bunch,OutQuantity,EstQuantity,UPrice,TPrice
    FROM dbo.WarehouseDetail WITH (UPDLOCK,HOLDLOCK) WHERE WarehouseKey=@wk ORDER BY WdetailKey`,headerParams(types,scope));
  const details=detailsRes.recordset||[];
  const existingFreightRows=details.filter(r=>Number(r.ProdKey)===2182);
  const beforeFreight=existingFreightRows.length?existingFreightRows.reduce((s,r)=>s+(Number(r.TPrice)||0),0):null;
  const existingGwRow=details.find(r=>Number(r.ProdKey)===3100);
  const existingCwRow=details.find(r=>Number(r.ProdKey)===3101);
  const before={
    gw:master.GrossWeight??existingGwRow?.SteamQuantity??null,
    cw:master.ChargeableWeight??existingCwRow?.SteamQuantity??null,
    freight:beforeFreight,
  };
  await query(`/* correction:cost-master */ UPDATE dbo.WarehouseMaster
    SET GrossWeight=@gw,ChargeableWeight=@cw,LastUpdateID=@actor,LastUpdateDtm=GETDATE()
    WHERE WarehouseKey=@wk AND OrderYear=@year AND OrderWeek=@week AND isDeleted=0`,{
    ...headerParams(types,scope),
    gw:param(types.Float,gw),cw:param(types.Float,cw),actor:param(types.NVarChar,actor),
  });
  const prodsRes=await query(`SELECT ProdKey FROM dbo.Product WHERE ProdKey IN (2182,3100,3101) AND isDeleted=0`,{});
  const activeProds=new Set((prodsRes.recordset||[]).map(r=>Number(r.ProdKey)));
  const lockedOrphanReceipt=(nativeCostCatalog.records||[]).some(e=>e.scope?.warehouseKey===scope.warehouseKey&&e.scope?.orderYear===scope.orderYear&&e.scope?.orderWeek===scope.orderWeek);
  const orphanRows=lockedOrphanReceipt?[]:details.filter(isOrphanWeightDetailRow);

  const upsertWeight=async(prodKey,kg,orphanCandidate)=>{
    if(!activeProds.has(prodKey))return;
    const existing=details.find(r=>Number(r.ProdKey)===prodKey);
    if(kg!==null&&kg>0){
      const targetKey=existing?.WdetailKey??orphanCandidate?.WdetailKey??null;
      const p={wk:param(types.Int,scope.warehouseKey),pk:param(types.Int,prodKey),kg:param(types.Float,kg)};
      if(targetKey){
        await query(`UPDATE dbo.WarehouseDetail SET ProdKey=@pk,BoxQuantity=1,BunchQuantity=1,SteamOf1Box=1,SteamOf1Bunch=1,
          SteamQuantity=@kg,OutQuantity=@kg,EstQuantity=@kg,UPrice=0,TPrice=0 WHERE WdetailKey=@dk AND WarehouseKey=@wk`,{...p,dk:param(types.Int,targetKey)});
      }else{
        await query(`INSERT INTO dbo.WarehouseDetail (WarehouseKey,ProdKey,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,SteamOf1Box,SteamOf1Bunch,OutQuantity,EstQuantity,UPrice,TPrice)
          VALUES(@wk,@pk,N'',1,1,@kg,1,1,@kg,@kg,0,0)`,p);
      }
    }else if(existing){
      await query(`DELETE FROM dbo.WarehouseDetail WHERE WdetailKey=@dk AND WarehouseKey=@wk AND ProdKey=@pk`,{
        dk:param(types.Int,existing.WdetailKey),wk:param(types.Int,scope.warehouseKey),pk:param(types.Int,prodKey),
      });
    }
  };
  await upsertWeight(3100,gw,orphanRows[0]);
  await upsertWeight(3101,cw,orphanRows[1]);

  if(activeProds.has(2182)&&freight!==null){
    if(existingFreightRows.length===1){
      await query(`UPDATE dbo.WarehouseDetail SET BoxQuantity=1,BunchQuantity=1,SteamOf1Box=1,SteamOf1Bunch=1,
        SteamQuantity=1,OutQuantity=1,EstQuantity=1,UPrice=@amt,TPrice=@amt WHERE WdetailKey=@dk AND WarehouseKey=@wk AND ProdKey=2182`,{
        amt:param(types.Float,freight),dk:param(types.Int,existingFreightRows[0].WdetailKey),wk:param(types.Int,scope.warehouseKey),
      });
    }else if(existingFreightRows.length===0){
      await query(`INSERT INTO dbo.WarehouseDetail (WarehouseKey,ProdKey,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,SteamOf1Box,SteamOf1Bunch,OutQuantity,EstQuantity,UPrice,TPrice)
        VALUES(@wk,2182,N'',1,1,1,1,1,1,1,@amt,@amt)`,{wk:param(types.Int,scope.warehouseKey),amt:param(types.Float,freight)});
    }
  }

  // Keep committed WebInvoiceOperation header snapshot synchronized when GW/CW changes.
  const opsRes=await query(`/* correction:cost-sync-op */ SELECT OperationId,ResultJson FROM dbo.WebInvoiceOperation WITH (UPDLOCK,HOLDLOCK)
    WHERE WarehouseKey=@wk AND Status=N'COMMITTED' AND ResultJson IS NOT NULL`,{wk:param(types.Int,scope.warehouseKey)});
  for(const op of opsRes.recordset||[]){
    try{
      const parsed=JSON.parse(op.ResultJson);
      if(parsed?.receiptSnapshot?.header&&Array.isArray(parsed.receiptSnapshot.details)){
        parsed.receiptSnapshot.header={...parsed.receiptSnapshot.header,GrossWeight:gw,ChargeableWeight:cw};
        parsed.receiptDigest=sha256({header:parsed.receiptSnapshot.header,details:parsed.receiptSnapshot.details});
        await query(`UPDATE dbo.WebInvoiceOperation SET ResultJson=@json WHERE OperationId=@op`,{
          json:param(types.NVarChar,JSON.stringify(parsed)),op:param(types.NVarChar,String(op.OperationId)),
        });
      }
    }catch{}
  }

  const after={gw,cw,freight};
  const payload={...scope,reason,before,after};
  await query(`/* correction:cost-audit */ INSERT dbo.SystemActionLog
    (Actor,SessionId,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel)
    VALUES(@actor,@target,@kind,N'POST',N'/api/warehouse/detail-actions',N'WarehouseMaster,WarehouseDetail',1,@payload,N'SUCCESS',N'입고 운송료·중량 반영',N'LOW')`,{
    actor:param(types.NVarChar,actor),target:param(types.NVarChar,scopeKey(scope)),
    kind:param(types.NVarChar,costAction),payload:param(types.NVarChar,JSON.stringify(payload)),
  });
  return {warehouseKey:scope.warehouseKey,gw,cw,freight};
}

export async function batchSaveWarehouseReceiptCosts(query,types,input,actor) {
  const reason=String(input?.reason??'').trim();
  if(!reason||reason.length>500)throw correctionError('CORRECTION_REASON_REQUIRED','운송료·중량 일괄 저장 사유를 1~500자로 입력하세요.',400);
  const items=Array.isArray(input?.items)?input.items:[];
  if(!items.length||items.length>100)throw correctionError('CORRECTION_COST_INVALID','한 번에 1~100건의 입고 원장만 일괄 반영할 수 있습니다.',400);
  const saved=[];
  const seen=new Set();
  for(const item of items){
    const key=Number(item?.warehouseKey);
    if(seen.has(key))continue;
    seen.add(key);
    saved.push(await saveWarehouseReceiptCosts(query,types,{...item,reason},actor));
  }
  return {savedCount:saved.length,items:saved};
}

export async function changeWarehouseRoundLabel(query,types,input,actor) {
  if(input?.action==='SAVE_RECEIPT_COSTS')return saveWarehouseReceiptCosts(query,types,input,actor);
  if(input?.action==='BATCH_SAVE_RECEIPT_COSTS')return batchSaveWarehouseReceiptCosts(query,types,input,actor);
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
      (ActionType IN (@kind,@costKind) AND SessionId=@target) OR
      (ActionType=N'WAREHOUSE_CORRECTION'
       AND JSON_VALUE(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE N'{}' END,N'$.mode')=N'NATIVE_QUANTITY'
       AND JSON_VALUE(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE N'{}' END,N'$.warehouseKey')=@key
       AND JSON_VALUE(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE N'{}' END,N'$.orderYear')=@year
       AND JSON_VALUE(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE N'{}' END,N'$.orderWeek')=@week))
    ORDER BY LogKey DESC`,{
    ...headerParams(types,scope),kind:param(types.NVarChar,labelAction),costKind:param(types.NVarChar,costAction),
    target:param(types.NVarChar,scopeKey(scope)),key:param(types.NVarChar,String(scope.warehouseKey)),
  });
  return recordset.map(entry=>{
    const audit=JSON.parse(entry.Payload);
    const common={id:entry.LogKey,kind:entry.ActionType,actor:entry.Actor,at:entry.ActionDtm};
    if(entry.ActionType===labelAction)return {...common,before:audit.before,after:val(entry.Payload)};
    if(entry.ActionType===costAction)return {...common,reason:audit.reason,product:'운송료·중량',
      before:{GW:audit.before?.gw??null,CW:audit.before?.cw??null,TPrice:audit.before?.freight??null},
      after:{GW:audit.after?.gw??null,CW:audit.after?.cw??null,TPrice:audit.after?.freight??null}};
    const snapshot=row=>Object.fromEntries(nativeQuantityWriteFields.map(field=>[field,row[field]]));
    return {...common,reason:audit.reason,detailKey:audit.nativeQuantity.after.WdetailKey,product:audit.nativeQuantity.prodName,
      before:snapshot(audit.nativeQuantity.before),after:snapshot(audit.nativeQuantity.after)};
  });
}
