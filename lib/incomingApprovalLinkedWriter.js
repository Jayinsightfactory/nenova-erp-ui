import { correctionDetailFields } from './warehouseCorrectionPolicy.js';
import { approvalError } from './incomingApprovalPolicy.js';
import { approvalParam as p, approvalRows as rows } from './incomingApprovalStore.js';

export async function writeApprovalReceiptDetails(q,types,scope,plan) {
  const targetRows=[];
  for(const target of plan.targets){
    const params={wk:p(types.Int,scope.warehouseKey),key:p(types.Int,target.sourceWdetailKey)};
    for(const field of correctionDetailFields)params[field]=p(field==='ProdKey'?types.Int:field==='OrderCode'?types.NVarChar:types.Float,target.row[field]);
    let key=target.sourceWdetailKey;
    if(key)await q(`UPDATE WarehouseDetail SET ${correctionDetailFields.map(k=>`${k}=@${k}`).join(',')}
      WHERE WdetailKey=@key AND WarehouseKey=@wk; IF @@ROWCOUNT<>1 THROW 51104,'INCOMING_RECEIPT_LINE_CHANGED',1;`,params);
    else key=rows(await q(`INSERT WarehouseDetail(WarehouseKey,${correctionDetailFields.join(',')}) OUTPUT inserted.WdetailKey
      VALUES(@wk,${correctionDetailFields.map(k=>`@${k}`).join(',')})`,params))[0].WdetailKey;
    targetRows.push({...target.row,WdetailKey:key,WarehouseKey:scope.warehouseKey,targetRowIndex:target.targetRowIndex});
  }
  for(const removed of plan.removed){
    const params={wk:p(types.Int,scope.warehouseKey),key:p(types.Int,removed.row.WdetailKey)};
    if(removed.preserve)await q(`UPDATE WarehouseDetail SET BoxQuantity=0,BunchQuantity=0,SteamQuantity=0,OutQuantity=0,EstQuantity=0,TPrice=0
      WHERE WdetailKey=@key AND WarehouseKey=@wk; IF @@ROWCOUNT<>1 THROW 51104,'INCOMING_RECEIPT_LINE_CHANGED',1;`,params);
    else await q('DELETE WarehouseDetail WHERE WdetailKey=@key AND WarehouseKey=@wk; IF @@ROWCOUNT<>1 THROW 51104,\'INCOMING_RECEIPT_LINE_CHANGED\',1;',params);
  }
  return targetRows;
}

export async function writeApprovalFarmGroups(q,types,plans,farms) {
  const evidence=[];
  for(const plan of plans){
    const key=plan.group?.resultDetailKey??plan.detailKey;
    if(!key){if(plan.assignments.length)throw approvalError('APPROVAL_FARM_TARGET_MISSING','농장 배정 대상 분배가 없습니다.');continue;}
    const params={key:p(types.Int,key)};
    if(plan.quantity>0){
      const detail=rows(await q('SELECT SdetailKey FROM ShipmentDetail WITH (UPDLOCK,HOLDLOCK) WHERE SdetailKey=@key AND ShipmentKey=@sk AND ProdKey=@pk',{...params,sk:p(types.Int,plan.shipmentKey),pk:p(types.Int,plan.prodKey)}));
      if(detail.length!==1)throw approvalError('APPROVAL_FARM_TARGET_MISSING','농장 배정 대상 분배가 달라졌습니다.');
      await q('DELETE ShipmentFarm WHERE SdetailKey=@key',params);
      for(const a of plan.assignments)await q('INSERT ShipmentFarm(SdetailKey,FarmKey,ShipmentQuantity) VALUES(@key,@farm,@qty)',{...params,farm:p(types.Int,a.farmKey),qty:p(types.Float,a.shipmentQuantity)});
      const descr=plan.assignments.map(a=>`${farms.find(f=>f.FarmKey===a.farmKey)?.FarmCode||a.farmKey}:${a.shipmentQuantity}`).join(', ');
      await q('UPDATE ShipmentDetail SET Descr=@descr WHERE SdetailKey=@key',{...params,descr:p(types.NVarChar,descr)});
    }
    const actual=rows(await q('SELECT FarmKey,ShipmentQuantity FROM ShipmentFarm WHERE SdetailKey=@key ORDER BY FarmKey',params));
    const expected=plan.assignments.map(a=>({FarmKey:a.farmKey,ShipmentQuantity:a.shipmentQuantity})).sort((a,b)=>a.FarmKey-b.FarmKey);
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw approvalError('APPROVAL_FARM_READBACK_FAILED','농장별 최종 배정 저장 검산이 실패했습니다.');
    evidence.push({shipmentKey:plan.shipmentKey,prodKey:plan.prodKey,before:plan.before,after:actual});
  }
  return evidence;
}
