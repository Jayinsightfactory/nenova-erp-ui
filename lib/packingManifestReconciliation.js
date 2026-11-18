import {invoiceSupplierKey} from './invoiceReceiptAutoFill.js';
const norm=v=>String(v??'').normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ');
const hawb=v=>norm(v).replace(/[ -]/g,'');
export const farmChoiceId=f=>f?.FarmKey?`farm:${f.FarmKey}`:f?.WarehouseKey?`receipt:${f.WarehouseKey}`:'';
export const FARM_COUNTRIES={CO:'콜롬비아',NL:'네덜란드',EC:'에콰도르',CN:'중국',AU:'호주',TH:'태국',US:'미국',VN:'베트남'};
const invoiceHawb=i=>hawb(i.hawb||i.house_awb||i.metadata_evidence?.hawb?.value);
export function manifestCompatible(entry,invoice){
 if(norm(entry.invoice)&&norm(entry.invoice)!==norm(invoice.invoice))return false;
 const a=hawb(entry.hawb),b=invoiceHawb(invoice);
 return !(a&&b&&a!==b);
}
export function packingManifestReview(invoices,entries){
 const unique=[...new Map(entries.map(e=>[JSON.stringify([norm(e.invoice),norm(e.supplier),hawb(e.hawb)]),e])).values()];
 if(unique.length!==invoices.length)throw new Error(`명세서와 추출 송장 목록의 건수가 다릅니다. 명세서 ${unique.length}건 / 추출 ${invoices.length}건. 누락·중복을 확인하세요. 이름 매칭만으로 건수 차이를 무시할 수 없습니다.`);
 const used=new Set(),rows=unique.map((entry,index)=>{
  const candidates=invoices.map((invoice,invoiceIndex)=>({invoice,invoiceIndex})).filter(({invoice})=>manifestCompatible(entry,invoice));
  if(!candidates.length)throw new Error('명세서와 추출 송장 목록의 송장번호·HAWB가 다릅니다. 원본 번호를 확인하세요.');
  const exact=candidates.filter(({invoice})=>norm(entry.invoice)?norm(entry.invoice)===norm(invoice.invoice):hawb(entry.hawb)&&invoiceHawb(invoice)?hawb(entry.hawb)===invoiceHawb(invoice):invoiceSupplierKey(entry.supplier)&&invoiceSupplierKey(entry.supplier)===invoiceSupplierKey(invoice.supplier));
  const invoiceIndex=exact.length===1&&!used.has(exact[0].invoiceIndex)?exact[0].invoiceIndex:null;
  if(invoiceIndex!=null)used.add(invoiceIndex);
  return {id:`manifest:${index}`,entry:{...entry},invoiceIndex,method:invoiceIndex==null?'REVIEW_REQUIRED':norm(entry.invoice)?'INVOICE_NUMBER':hawb(entry.hawb)&&invoiceHawb(invoices[invoiceIndex])?'HAWB':'EQUIVALENT_NAME'};
 });
 return {version:1,rows,status:rows.every(r=>r.invoiceIndex!=null)?'MATCHED':'REVIEW_REQUIRED'};
}
export function pendingManifestIssues(result){
 return result?.manifest_review?.status==='REVIEW_REQUIRED'?[{code:'MANIFEST_FARM_MATCH_REQUIRED',message:'명세서·송장·DB 농장을 연결해 주세요.'}]:[];
}
// Re-validate every explicit pair and current DB candidate; never edit source numbers/names.
export function applyManifestFarmChoices(result,choices,farms,country){
 const review=result?.manifest_review;
 if(!review||review.version!==1||!Array.isArray(review.rows))throw Error('명세서 대조 자료를 다시 불러오세요.');
 const seen=new Set(),invoices=result.invoices.map(i=>({...i})),rows=review.rows.map(row=>{
  const choice=choices[row.id],index=choice?.invoiceIndex;
  if(!Number.isInteger(index)||index<0||index>=invoices.length||seen.has(index)||!manifestCompatible(row.entry,invoices[index]))throw Error('누락·중복 또는 송장번호·HAWB가 다른 연결이 있습니다. 각 송장을 한 번씩 선택하세요.');
  const farm=farms.find(f=>farmChoiceId(f)===choice.farmId&&f.CounName===(FARM_COUNTRIES[country]||country));
  if(!farm||!farmChoiceId(farm))throw Error('현재 DB의 같은 국가 농장을 선택하세요. 신규 등록 후 후보를 새로고침할 수 있습니다.');
  seen.add(index);
  const match={farmKey:farm.FarmKey??null,farmSourceWarehouseKey:farm.WarehouseKey??null,farmName:farm.FarmName,country,manifestName:row.entry.supplier,invoiceName:invoices[index].supplier,method:'USER_CONFIRMED_DB_FARM'};
  invoices[index]={...invoices[index],manifest_review_required:false,manifestFarmMatch:match};
  return {...row,invoiceIndex:index,dbFarm:match,method:match.method};
 });
 if(seen.size!==invoices.length)throw Error('모든 송장이 연결되지 않았습니다.');
 return {...result,invoices,manifest_review:{...review,rows,status:'MATCHED'}};
}
