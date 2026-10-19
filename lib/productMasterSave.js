import {PRODUCT_EDIT_FIELDS,PRODUCT_EXPECTED_FIELDS,validateProductValues,assertProductSnapshot,nativeCountryFlower,productSaveError} from './productMasterPolicy.js';
import {appendProductInputHistory} from './productInputHistory.js';

// Caller owns transaction. Product master only; no historical quantities/SP/stock writes.
export async function saveProductMaster(q,sql,body,actor) {
  const editing=body.prodKey!=null;
  if(editing&&(!Number.isSafeInteger(body.prodKey)||body.prodKey<=0))throw productSaveError('품목 번호를 확인하세요.');
  const values=validateProductValues(body.values);
  const pk={pk:{type:sql.Int,value:body.prodKey}};
  const columns=['ProdKey',...PRODUCT_EXPECTED_FIELDS,'Stock','ProdGroup','Descr','isDeleted'].join(',');
  const before=editing?(await q(`SELECT ${columns} FROM Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk AND isDeleted=0`,pk)).recordset[0]:null;
  if(editing)assertProductSnapshot(before,body.expected);
  const after={...(before||{ProdCode:'',DisplayName:null,Cost:0,BunchOf1Box:0,SteamOf1Bunch:0,SteamOf1Box:0,BoxWeight:null,BoxCBM:null,TariffRate:null}),...values};
  for(const key of ['ProdName','CounName','FlowerName','OutUnit','EstUnit'])if((!editing||Object.hasOwn(values,key))&&!after[key])throw productSaveError(`${key}: 필수값입니다.`);
  for(const key of ['OutUnit','EstUnit'])if((!editing||Object.hasOwn(values,key))&&!['박스','단','송이'].includes(after[key]))throw productSaveError('단위를 확인하세요.');
  if(editing&&['OutUnit','EstUnit'].some(k=>after[k]!==before[k])&&body.confirmUnitChange!==true)throw productSaveError('단위 변경은 기존 주문·출고·재고 수량을 환산하지 않습니다. 변경 확인이 필요합니다.');
  const classificationChanged=!editing||['CounName','FlowerName'].some(k=>after[k]!==before[k]);
  if(classificationChanged) {
    const codes=await q(`SELECT c.CounName,c.isSelectFlower,f.FlowerName FROM Country c WITH (HOLDLOCK) CROSS JOIN Flower f WITH (HOLDLOCK) WHERE c.CounName=@country AND f.FlowerName=@flower AND c.isDeleted=0 AND f.isDeleted=0`,{country:{type:sql.NVarChar,value:after.CounName},flower:{type:sql.NVarChar,value:after.FlowerName}});
    if(codes.recordset.length!==1)throw productSaveError('국가·품종 기준정보를 확인하세요.');
    after.CountryFlower=nativeCountryFlower(after.CounName,after.FlowerName,codes.recordset[0].isSelectFlower);
  }
  const keys=editing?Object.keys(values).filter(k=>after[k]!==before[k]):[...PRODUCT_EDIT_FIELDS];
  if(classificationChanged)keys.push('CountryFlower');
  if(editing&&!keys.length)return before;
  const params={...(editing?pk:{}),actor:{type:sql.NVarChar(50),value:String(actor).slice(0,50)}};
  for(const key of keys)params[key]={type:key==='TariffRate'?sql.Decimal(10,4):['BoxWeight','BoxCBM'].includes(key)?sql.Decimal(10,3):['Cost','BunchOf1Box','SteamOf1Bunch','SteamOf1Box'].includes(key)?sql.Float:sql.NVarChar,value:after[key]};
  let savedKey=body.prodKey;
  if(editing)await q(`UPDATE Product SET ${keys.map(k=>`${k}=@${k}`).join(',')},LastUpdateID=@actor,LastUpdateDtm=GETDATE() WHERE ProdKey=@pk AND isDeleted=0`,params);
  else {
    const r=await q(`INSERT INTO Product (${keys.join(',')},Stock,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm) VALUES (${keys.map(k=>`@${k}`).join(',')},0,0,@actor,GETDATE(),@actor,GETDATE()); SELECT CAST(SCOPE_IDENTITY() AS int) AS ProdKey;`,params);
    savedKey=r.recordset[0].ProdKey;
  }
  const saved=(await q(`SELECT ${columns} FROM Product WHERE ProdKey=@pk AND isDeleted=0`,{pk:{type:sql.Int,value:savedKey}})).recordset[0];
  const preserved=editing?['Stock','ProdGroup','Descr']:[];
  if(!saved||[...PRODUCT_EXPECTED_FIELDS,...preserved].some(k=>(saved[k]??null)!==(after[k]??null)))throw productSaveError('저장 후 대조에 실패했습니다. 전체 저장을 취소합니다.',500);
  await appendProductInputHistory(q,sql,actor,before,saved);
  return saved;
}
