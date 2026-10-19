import {PRODUCT_BULK_SNAPSHOT,productSnapshot,productAfterValues,validateProductChanges} from './productBulkEdit.js';

// Caller owns one transaction: no intermediate commit and no stock/recalculation SP.
export async function saveProductBulk(tQuery,sql,rawChanges,actor) {
  const changes=validateProductChanges(rawChanges),saved=[];
  const columns=PRODUCT_BULK_SNAPSHOT.join(', ');
  for(const change of changes){
    const pk={pk:{type:sql.Int,value:change.prodKey}};
    const current=(await tQuery(`SELECT ProdKey, ProdName, ${columns}, Stock, Cost, OutUnit, EstUnit, CounName, FlowerName FROM Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk AND isDeleted=0`,pk)).recordset[0];
    if(!current || PRODUCT_BULK_SNAPSHOT.some(k=>(current[k]??null)!==change.expected[k])){
      const err=Error(`${current?.ProdName||change.prodKey}: 다른 작업에서 값이 바뀌었거나 삭제됐습니다. 전체 저장을 중단했습니다. 다시 조회 후 입력하세요.`);err.status=409;throw err;
    }
    const after=productAfterValues(current,change.values);
    const keys=Object.keys(change.values);
    if(Object.hasOwn(change.values,'BunchOf1Box')||Object.hasOwn(change.values,'SteamOf1Bunch'))keys.push('SteamOf1Box');
    const params={...pk,actor:{type:sql.NVarChar(50),value:String(actor).slice(0,50)}};
    for(const key of keys)params[key]={type:key==='TariffRate'?sql.Decimal(10,4):['BoxWeight','BoxCBM'].includes(key)?sql.Decimal(10,3):sql.Float,value:after[key]};
    await tQuery(`UPDATE Product SET ${keys.map(k=>`${k}=@${k}`).join(', ')}, LastUpdateID=@actor, LastUpdateDtm=GETDATE() WHERE ProdKey=@pk AND isDeleted=0`,params);
    const readback=(await tQuery(`SELECT ProdKey, ${columns}, Stock, Cost, OutUnit, EstUnit, CounName, FlowerName FROM Product WHERE ProdKey=@pk AND isDeleted=0`,pk)).recordset[0];
    if(!readback||PRODUCT_BULK_SNAPSHOT.some(k=>(readback[k]??null)!==after[k])||['Stock','Cost','OutUnit','EstUnit','CounName','FlowerName'].some(k=>readback[k]!==current[k]))throw Error('저장 후 품목 대조에 실패했습니다. 전체 저장이 취소됩니다.');
    saved.push({prodKey:change.prodKey,prodName:current.ProdName,before:productSnapshot(current),after});
  }
  // Existing audit table only; no automatic schema changes. Audit failure rolls back master edits.
  await tQuery(`INSERT INTO SystemActionLog (Actor,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel) VALUES (@actor,'PRODUCT_BULK_EDIT','POST','/api/master/products-bulk','Product',@count,@payload,'SUCCESS',N'품목 기본값 저장 후 대조 완료 · 주문/입고/출고/재고 원장 보존','HIGH')`,{
    actor:{type:sql.NVarChar(100),value:String(actor).slice(0,100)},count:{type:sql.Int,value:saved.length},payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify({changes:saved})}
  });
  return saved;
}
