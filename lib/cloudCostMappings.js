import {cloudCategory,cloudLineCategory} from './chinaCloudCost.js';

export const CLOUD_MAPPING_KEY='packing.cloud-cost';
export function cloudMappingFarm(value){
  return /^CLOUD(?:\s*LAND)?$/i.test(String(value??'').trim())?'CLOUDLAND':null;
}
const fail=message=>{throw Object.assign(Error(message),{statusCode:400});};
export function validateCloudMappingEntry(entry){
  if(!entry||Array.isArray(entry)||Object.keys(entry).some(k=>!['country','farm','prodKey','categoryCode','categoryOverride'].includes(k)))fail('카테고리 저장 필드를 확인하세요.');
  if(entry.country!=='CN'||entry.farm!=='CLOUDLAND'||!Number.isSafeInteger(entry.prodKey)||entry.prodKey<=0)fail('중국 CLOUD 농장·품목 범위를 확인하세요.');
  if(entry.categoryCode===null&&entry.categoryOverride==null)return entry;
  if(entry.categoryCode!=null&&(!Number.isSafeInteger(entry.categoryCode)||!cloudCategory(entry.categoryCode)))fail('기존 카테고리 번호를 확인하세요.');
  if(!cloudLineCategory(entry))fail('직접 카테고리 이름·박스 규격·단수·관세율을 모두 확인하세요.');
  return entry;
}
export function validateCloudMappingValue(value){
  if(!value||value.version!==1||!Array.isArray(value.entries)||value.entries.length>10000)fail('카테고리 공유 자료 형식을 확인하세요.');
  const keys=new Set();
  for(const entry of value.entries){validateCloudMappingEntry(entry);const key=`${entry.country}/${entry.farm}/${entry.prodKey}`;if(keys.has(key))fail('같은 범위·품목의 카테고리가 중복되었습니다.');keys.add(key);}
  return value;
}
export function applyCloudMappings(document,value){
  if(document?.reviewedMetadata?.country!=='CN'||!cloudMappingFarm(document.reviewedMetadata.farmName))return document;
  const entries=value?.entries??[];
  return {...document,reviewedMetadata:{...document.reviewedMetadata,invoiceCostInput:{...document.reviewedMetadata.invoiceCostInput,
    lineInputs:(document.reviewedMetadata.invoiceCostInput?.lineInputs??[]).map(input=>{
      const line=document.lines.find(l=>l.lineId===input.lineId),entry=entries.find(e=>e.country==='CN'&&e.farm==='CLOUDLAND'&&e.prodKey===line?.prodKey);
      return entry?{...input,categoryCode:entry.categoryCode,categoryOverride:entry.categoryOverride??null}:input;
    })}}};
}
