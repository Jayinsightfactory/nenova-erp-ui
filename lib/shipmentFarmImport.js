import { query, sql } from './db';
import { FARM_CANDIDATE_SCOPE_SQL } from './shipmentFarmCandidates.js';
import { normalizeFarmAssignments, assertFarmAssignmentTotal } from './shipmentFarmAssignments.js';
import { toOrderUnits } from './shipmentImportQty.js';
import { parseFarmText, readFarmSheet, matchFarmEntry, farmNameMatches, assignmentsKey, assertFarmSnapshot } from './shipmentFarmText.js';

const reject = message => Object.assign(new Error(message),{statusCode:409,code:'FARM_IMPORT_INVALID'});
export async function loadImportFarmCandidates(prodKey, q=query) {
  const result = await q(`SELECT DISTINCT f.FarmKey, f.FarmName, ISNULL(f.FarmCode,'') AS FarmCode
    FROM ViewWarehouse vw JOIN Farm f ON f.FarmName=vw.FarmName
    WHERE ${FARM_CANDIDATE_SCOPE_SQL} AND ISNULL(f.isDeleted,0)=0`,{pk:{type:sql.Int,value:Number(prodKey)}});
  return result.recordset || [];
}
export async function loadImportFarmState(rows, year, week, q=query) {
  const keys=[...new Set(rows.map(r=>Number(r.prodKey)).filter(Number.isSafeInteger))];
  if (!keys.length) return new Map();
  const result=await q(`SELECT sm.CustKey,sd.ProdKey,sd.SdetailKey,sf.FarmKey,sf.ShipmentQuantity,f.FarmName
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    LEFT JOIN ShipmentFarm sf ON sf.SdetailKey=sd.SdetailKey LEFT JOIN Farm f ON f.FarmKey=sf.FarmKey
    WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0 AND sd.ProdKey IN (${keys.join(',')})`,{
    yr:{type:sql.NVarChar,value:String(year)},wk:{type:sql.NVarChar,value:week},
  });
  const map=new Map();
  for(const item of result.recordset || []) {
    const key=`${item.CustKey}|${item.ProdKey}`;
    if(!map.has(key)) map.set(key,{details:new Set(),farms:[]});
    map.get(key).details.add(item.SdetailKey);
    if(item.FarmKey!=null) map.get(key).farms.push({farmKey:Number(item.FarmKey),shipmentQuantity:Number(item.ShipmentQuantity),farmName:item.FarmName});
  }
  return map;
}
export async function buildFarmImportPreview({XLSX,workbook,preview,text='',overrides={},queryFn=query}) {
  const parsed=parseFarmText(text);
  const saved=readFarmSheet(XLSX,workbook);
  const errors=parsed.errors.map(message=>({message})), reviews=[];
  const state=await loadImportFarmState(preview.rows,preview.orderYear,preview.week,queryFn);
  for(const row of preview.rows) {
    const before=state.get(row.key);
    row.farmBefore=before?.farms || [];
    row.farmBeforeText=row.farmBefore.map(f=>`${f.farmName || f.farmKey} ${f.shipmentQuantity}`).join(' / ');
    if(before?.details.size>1) errors.push({message:`${row.custName} / ${row.prodName}: 중복 출고 상세를 먼저 확인하세요.`});
  }
  const cache=new Map(), resolved=new Map();
  const candidatesFor=async row=>{
    if(!cache.has(row.prodKey)) cache.set(row.prodKey,await loadImportFarmCandidates(row.prodKey,queryFn));
    return cache.get(row.prodKey);
  };
  async function resolve(entry,fromText) {
    const row=matchFarmEntry(entry,preview.rows,overrides.targets?.[entry.id]);
    const review={...entry,rowKey:row?.key || '',farmOptions:[],message:''};
    reviews.push(review);
    if(!row) {review.message='업체·품목·규격을 하나로 찾지 못했습니다. 적용할 행을 선택하세요.';errors.push(review);return;}
    if(resolved.has(row.key) && resolved.get(row.key).fromText===fromText) {
      review.message='같은 업체·품목의 농장분배가 중복되었습니다.';errors.push(review);return;
    }
    const options=await candidatesFor(row);
    review.farmOptions=options;
    const productResult=await queryFn(`SELECT OutUnit,BunchOf1Box,SteamOf1Box FROM Product WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,{pk:{type:sql.Int,value:Number(row.prodKey)}});
    const product=productResult.recordset?.[0];
    if(!product) throw reject('농장분배 대상 품목이 삭제되었습니다.');
    // No explicit unit: use the same raw-Excel to ERP conversion ratio as the verified row.
    const factor=Number(row.excelQty)>0 ? Number(row.originalTotal ?? row.uploadQty)/Number(row.excelQty) : 1;
    const convert=(quantity,unit)=>unit ? toOrderUnits(quantity,unit,product).outQty : quantity*factor;
    const total=convert(entry.quantity,entry.unit);
    if(!(entry.quantity>0) || !(total>0) || Math.abs(total-Number(row.uploadQty))>0.0001) {
      review.message=`카톡/농장시트 총수량 ${entry.quantity}${entry.unit}과 엑셀 최종수량 ${row.uploadQty}${row.outUnit}이 다릅니다.`;
      errors.push(review);return;
    }
    const assignments=[];
    for(const farm of entry.farms) {
      const choice=Number(overrides.farms?.[`${entry.id}|${farm.name}`] || 0);
      const matches=choice ? options.filter(f=>Number(f.FarmKey)===choice) : options.filter(f=>farmNameMatches(farm.name,f));
      const quantity=convert(farm.quantity,farm.unit);
      if(matches.length!==1 || !(quantity>0) || !Number.isFinite(quantity)) {
        review.message=`농장 '${farm.name}'의 입고농장 또는 수량을 확인하고 선택하세요.`;errors.push({...review});continue;
      }
      assignments.push({farmKey:Number(matches[0].FarmKey),shipmentQuantity:quantity,farmName:matches[0].FarmName,farmCode:matches[0].FarmCode});
    }
    try {assertFarmAssignmentTotal(assignments,row.uploadQty,0.0001);} catch(e) {review.message ||= e.message;errors.push({...review});return;}
    resolved.set(row.key,{row,entry,assignments,fromText});
  }
  // Saved annotation is a replaceable baseline. A new chat entry replaces the same business pair.
  const textRows=new Set(parsed.entries.map(e=>matchFarmEntry(e,preview.rows,overrides.targets?.[e.id])?.key).filter(Boolean));
  for(const entry of saved) {
    const target=matchFarmEntry(entry,preview.rows,overrides.targets?.[entry.id]);
    if(target && textRows.has(target.key)) continue;
    if(target && Number(target.uploadQty)===0) {
      target.farmChanged=target.farmBefore.length>0;
      target.farmText='분배 취소와 함께 농장배정 해제';
      continue;
    }
    await resolve(entry,false);
  }
  for(const entry of parsed.entries) await resolve(entry,true);
  for(const {row,entry,assignments} of resolved.values()) {
    row.farmAssignments=assignments;
    row.farmChanged=assignmentsKey(row.farmBefore)!==assignmentsKey(assignments);
    row.farmText=assignments.map(f=>`${f.farmName} ${f.shipmentQuantity}`).join(' / ');
    row.farmSource={customer:row.custName,product:row.displayName || row.productLabel || row.prodName,quantity:row.uploadQty,unit:row.outUnit,family:row.productFamily || entry.family,farms:assignments.map(f=>({name:f.farmName,quantity:f.shipmentQuantity,unit:row.outUnit}))};
    row.farmSource.roundTrip={customer:row.custName,product:row.productLabel || row.displayName || row.prodName,quantity:row.uploadQty,unit:row.outUnit,family:row.productFamily || '',farms:assignments.map(f=>({name:f.farmName,quantity:f.shipmentQuantity,unit:row.outUnit}))};
    if(row.farmChanged) row.needsShipmentApply=true;
  }
  for(const row of preview.rows) {
    if(row.farmBefore.length && row.farmAssignments==null && row.uploadQty>0) {
      try {assertFarmAssignmentTotal(row.farmBefore,row.uploadQty,0.0001);} catch {
        errors.push({message:`${row.custName} / ${row.prodName}: 기존 농장배정과 수정 수량이 다릅니다. 새 농장분배를 입력하세요.`});
      }
    }
  }
  preview.farmImport={errors,reviews,changedCount:preview.rows.filter(r=>r.farmChanged).length};
  return preview;
}

export async function validateImportFarmRow(q,row,beforeSnapshot,targetQty) {
  const current=beforeSnapshot.shipmentFarmRows || [];
  if(row.farmBefore!=null) assertFarmSnapshot(current,row.farmBefore,row.farmAssignments ?? row.farmBefore);
  const assignments=row.farmAssignments==null ? null : normalizeFarmAssignments(row.farmAssignments);
  if(assignments) {
    assertFarmAssignmentTotal(assignments,targetQty,0.0001);
    const candidates=await loadImportFarmCandidates(row.prodKey,q);
    if(assignments.some(a=>!candidates.some(c=>Number(c.FarmKey)===a.farmKey))) throw reject('입고 농장 후보가 변경됐습니다. 다시 검증하세요.');
  } else if(current.length && targetQty>0) {
    assertFarmAssignmentTotal(current.map(f=>({shipmentQuantity:Number(f.ShipmentQuantity)})),targetQty,0.0001);
  }
  return assignments;
}
export async function saveImportFarmRow(q,detailKey,assignments) {
  await q('DELETE FROM ShipmentFarm WHERE SdetailKey=@dk',{dk:{type:sql.Int,value:detailKey}});
  for(const farm of assignments) await q(`INSERT INTO ShipmentFarm (FarmKey,ShipmentQuantity,SdetailKey) VALUES (@fk,@qty,@dk)`,{
    fk:{type:sql.Int,value:farm.farmKey},qty:{type:sql.Float,value:farm.shipmentQuantity},dk:{type:sql.Int,value:detailKey},
  });
  const candidates=await q(`SELECT f.FarmKey, f.FarmCode FROM Farm f WHERE ISNULL(f.isDeleted,0)=0`);
  const codes=new Map((candidates.recordset || []).map(f=>[Number(f.FarmKey),f.FarmCode]));
  const descr=assignments.map(f=>`${codes.get(f.farmKey) || f.farmKey}:${f.shipmentQuantity}`).join('/');
  await q('UPDATE ShipmentDetail SET Descr=@descr WHERE SdetailKey=@dk',{descr:{type:sql.NVarChar,value:descr},dk:{type:sql.Int,value:detailKey}});
  const readback=await q('SELECT FarmKey,ShipmentQuantity FROM ShipmentFarm WITH (HOLDLOCK) WHERE SdetailKey=@dk',{dk:{type:sql.Int,value:detailKey}});
  if(assignmentsKey(readback.recordset)!==assignmentsKey(assignments)) throw reject('농장분배 저장 결과가 달라 전체 롤백합니다.');
}
