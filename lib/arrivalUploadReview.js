import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {REVIEW_COUNTRIES} from './arrivalReviewCountries.js';
export {REVIEW_COUNTRIES};
const rules = [/netherlands|holland|네덜란드|\bnl\b|holex/i,/colombia|콜롬비아/i,/ecuador|에콰도르/i,/china|중국|melody|cloud/i,/thailand|태국/i,/vietnam|베트남|\bvt\b/i];
export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function namedCountry(fileName, sheetName) {
  const found=REVIEW_COUNTRIES.filter((_,i)=>rules[i].test(`${fileName} ${sheetName}`));
  return found.length===1 ? found[0] : '';
}
export function prepareSheetReviews(input, fileName) {
  if(!Array.isArray(input)||input.length>300||new Set(input.map(s=>s.sheetName)).size!==input.length) throw Error('시트 선택 정보를 다시 확인하세요.');
  return input.map(s=>{
    const result={sheetName:String(s.sheetName),selected:s.selected===true,country:String(s.country||''),orderWeek:String(s.orderWeek||''),confirmYear:s.confirmYear===true};
    if(!result.selected)return result;
    if(!REVIEW_COUNTRIES.includes(result.country)) throw Error(`${result.sheetName}: 국가를 명시하세요.`);
    const evidence=namedCountry(fileName,result.sheetName);
    const evidenceSet=REVIEW_COUNTRIES.filter((_,i)=>rules[i].test(`${fileName} ${result.sheetName}`));
    if(evidenceSet.length>1)throw Error(`${result.sheetName}: 국가 근거가 충돌합니다.`);
    if(evidence&&evidence!==result.country)throw Error(`${result.sheetName}: 파일·시트의 국가와 선택 국가가 다릅니다.`);
    const m=result.orderWeek.match(/^(\d{1,2})-(\d{1,2})$/);
    if(!m||+m[1]<1||+m[1]>53||+m[2]<1||+m[2]>4)throw Error(`${result.sheetName}: 세부차수를 확인하세요.`);
    result.orderWeek=`${+m[1]}-${+m[2]}`;
    const named=result.sheetName.match(/^(\d{1,2})-0?(\d{1,2})(?:[A-Za-z])?(?=$|\s|\()/);
    if(named&&result.orderWeek!==`${+named[1]}-${+named[2]}`)throw Error(`${result.sheetName}: 시트 차수와 선택 차수가 다릅니다.`);
    return result;
  });
}
export function summarizeReview(parsed, reviews, year) {
  const sheets=reviews.map(s=>{
    const rows=parsed.rows.filter(r=>r.sheetName===s.sheetName),rejected=(parsed.rejectedRows||[]).filter(r=>r.sheetName===s.sheetName);
    const issues=[];
    if(s.selected){
      if(rows.some(r=>r.countryConflict))issues.push('원본 제목의 국가와 선택 국가가 다릅니다.');
      if(!rows.length)issues.push('저장 가능한 원가 행이 없습니다.');
      if(rejected.length)issues.push(`원가 누락 ${rejected.length}행: 원본 수정 또는 시트 제외 필요`);
      if(rows.some(r=>r.yearEvidence?.status==='conflict'||r.orderYear!==year))issues.push('원본과 선택 연도 충돌: 원본 연도 확인 필요');
      if(rows.some(r=>r.yearEvidence?.status!=='verified')&&!s.confirmYear)issues.push('원본 연도 미확인: 선택 연도 확인에 체크하세요.');
    }
    return {...s,rows:rows.length,rejected:rejected.length,quantity:rows.reduce((n,r)=>n+r.quantity,0),totalCost:rows.reduce((n,r)=>n+r.quantity*r.selectedArrivalCostKRW,0),units:[...new Set(rows.map(r=>r.unit))],unmatched:rows.filter(r=>r.matchStatus!=='MATCHED').length,highCost:rows.filter(r=>r.selectedArrivalCostKRW>100000).length,issues,samples:rows.slice(0,3).map(r=>({name:r.productNameRaw,quantity:r.quantity,unit:r.unit,cost:r.selectedArrivalCostKRW}))};
  });
  return {sheets,canCommit:sheets.some(s=>s.selected)&&sheets.every(s=>!s.selected||!s.issues.length),digest:digest({year,reviews,rows:parsed.rows,rejected:parsed.rejectedRows})};
}
const root=()=>path.join(process.cwd(),'data','arrival-upload-review');
export function writeReview(record){fs.mkdirSync(root(),{recursive:true});const file=path.join(root(),`${record.id}.json`),tmp=`${file}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(record));fs.renameSync(tmp,file);}
export function readReview(id,user){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('검토번호가 잘못됐습니다.');const r=JSON.parse(fs.readFileSync(path.join(root(),`${id}.json`),'utf8'));if(r.owner!==String(user.userId))throw Error('본인의 업로드만 확인할 수 있습니다.');return r;}
export function retainUpload(bytes,fileName,user){const id=crypto.randomUUID();fs.mkdirSync(root(),{recursive:true});fs.writeFileSync(path.join(root(),`${id}.xlsx`),bytes,{flag:'wx'});const r={id,fileName,owner:String(user.userId),sha:digest(bytes),createdAt:new Date().toISOString(),stage:'RECEIVED',attempts:[]};writeReview(r);return r;}
export function originalBytes(record){const b=fs.readFileSync(path.join(root(),`${record.id}.xlsx`));if(digest(b)!==record.sha)throw Error('보관된 원본이 변경됐습니다.');return b;}
