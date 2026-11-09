import {resolveOcrRecipeRows} from './importOcrRecipePolicy.js';
export function readTibaOcrTable(page){
 if(!page?.items||!Number.isFinite(page.width))throw Error('Tiba OCR 원본 좌표가 없습니다.');
 const detail=page.items.find(x=>/^Detail by Category$/i.test(x.str));
 if(!detail)throw Error('Tiba 상품표와 종류별 합계의 경계를 확인하세요.');
 const number=s=>{const t=s.replace(/[$\s]/g,'');return Number(t.includes(',')&&!t.includes('.')?t.replace(',','.'):t.replace(/,/g,''));};
 function cell(anchor,left,right){
  const list=page.items.filter(x=>x.x/page.width>=left&&x.x/page.width<right&&Math.abs(x.y-anchor.y)<3&&/^\$?\d+(?:[.,]\d+)?$/.test(x.str));
  if(list.length!==1)throw Error('Tiba 원본의 수량·단가·금액 열이 불명확합니다.');return number(list[0].str);
 }
 const labels=page.items.filter(x=>x.y>detail.y&&x.x<page.width*.4&&/^(?:\*ROSES|ROSES\s|SPRAY ROSES\s)/.test(x.str)).sort((a,b)=>b.y-a.y);
 const rows=[];let parent=null;
 for(const [index,anchor] of labels.entries()){
  const recipe=anchor.str.startsWith('*'),sourceId=`${page.page}:${index}:${anchor.x.toFixed(2)}:${anchor.y.toFixed(2)}`;
  if(!recipe)parent=sourceId;
  const raw_quote=page.items.filter(x=>Math.abs(x.y-anchor.y)<3).sort((a,b)=>a.x-b.x).map(x=>x.str).join(' ');
  rows.push({sourceId,page:page.page,raw_quote,role:recipe?'recipe':'product',...(recipe?{parentSourceId:parent}:{}),description:anchor.str,totalStems:cell(anchor,.75,.79),bunches:cell(anchor,.80,.83),unitPrice:cell(anchor,.83,.867),amount:cell(anchor,.867,.94)});
 }
 const resolved=resolveOcrRecipeRows(rows);
 if(!resolved.products.length||resolved.recipeEvidence.length!==resolved.products.length)throw Error('Tiba 상위 상품행과 Recipe 대조가 완료되지 않았습니다.');
 return resolved;
}
