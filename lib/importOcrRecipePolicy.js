// OCR text is source evidence, never an ERP write or human confirmation.
// Equal monetary values do NOT establish duplication. Only an explicit,
// same-page recipe->parent relationship may suppress a repeated charge.
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const amount=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const close=(a,b)=>Math.abs(a-b)<=0.011;

export function resolveOcrRecipeRows(rows){
 if(!Array.isArray(rows)||rows.length>20000)fail('OCR_ROWS','OCR 상품행 형식이 올바르지 않습니다.');
 const ids=new Map(),parents=new Map(),children=new Map();
 for(const row of rows){
  if(!row||typeof row.sourceId!=='string'||!row.sourceId||ids.has(row.sourceId))fail('OCR_SOURCE_ID','원본 행 위치가 없거나 중복됩니다.');
  if(!Number.isInteger(row.page)||row.page<1||!['product','recipe'].includes(row.role))fail('OCR_ROW_ROLE','상품행과 Recipe 하위행 구분을 확인하세요.');
  if(!amount(row.totalStems)||!amount(row.unitPrice)||!amount(row.amount)||!close(row.totalStems*row.unitPrice,row.amount))fail('OCR_LINE_AMOUNT','원본 수량×단가와 금액이 다릅니다.');
  ids.set(row.sourceId,row);
  if(row.role==='product')parents.set(row.sourceId,row);
  else{
   if(typeof row.parentSourceId!=='string'||!row.parentSourceId)fail('OCR_RECIPE_PARENT','Recipe의 상위 상품행을 확인하세요.');
   const list=children.get(row.parentSourceId)||[];list.push(row);children.set(row.parentSourceId,list);
  }
 }
 const evidence=[];
 for(const [id,list] of children){
  const parent=parents.get(id);
  if(!parent||list.some(x=>x.page!==parent.page))fail('OCR_RECIPE_PARENT','같은 페이지의 상위 상품행을 찾을 수 없습니다.');
  const stems=list.reduce((n,x)=>n+x.totalStems,0),money=list.reduce((n,x)=>n+x.amount,0);
  // Do not silently drop an inconsistent child, even at high OCR confidence.
  if(!close(stems,parent.totalStems)||!close(money,parent.amount))fail('OCR_RECIPE_TOTAL','Recipe 하위행 합계와 상위 상품행이 다릅니다.');
  evidence.push({parentSourceId:id,recipeSourceIds:list.map(x=>x.sourceId),excludedRepeatedAmount:money});
 }
 return {products:rows.filter(x=>x.role==='product').map(x=>structuredClone(x)),recipeEvidence:evidence,providerCalls:0,erpWrites:0};
}

export function mergeFreeOcrWithCompleted({sourceHash,completedChunks,freeChunks,pageCount}){
 if(typeof sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(sourceHash)||!Array.isArray(completedChunks)||!Array.isArray(freeChunks)||!Number.isInteger(pageCount)||pageCount<1||pageCount>72)fail('OCR_SOURCE','원본 파일 식별값을 확인하세요.');
 const indexes=new Set(),pages=[],ordered=[...completedChunks,...freeChunks].sort((a,b)=>a.index-b.index);
 for(const chunk of ordered){
  if(!chunk||chunk.sourceHash!==sourceHash||!Number.isInteger(chunk.index)||chunk.index<0||indexes.has(chunk.index)||chunk.status!=='SUCCEEDED'||!Array.isArray(chunk.pages)||!chunk.pages.length||!chunk.result)fail('OCR_CHUNK','완료 구간의 원본·순서·상태가 일치하지 않습니다.');
  indexes.add(chunk.index);pages.push(...chunk.pages);
 }
 if(pages.length!==pageCount||pages.some((n,i)=>n!==i+1))fail('OCR_PAGE_COVERAGE','원본 페이지가 누락·중복되거나 순서가 다릅니다.');
 // Keep the exact original completed result objects. No merge, rewrite, or
 // best-effort normalization is performed on already completed chunks here.
 return {chunks:ordered.map(x=>({pages:[...x.pages],result:x.result})),preservedCount:completedChunks.length,providerCalls:0,erpWrites:0};
}
