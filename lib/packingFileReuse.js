const hashPattern=/^[a-f0-9]{64}$/;
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const nameKey=value=>String(value??'').normalize('NFKC').trim().toLowerCase();
/** Existing endpoint guarantees cacheOnly never admits a job or reserves quota. */
export async function readCompletedPackingAnalysis({country,pdfBase64,request=globalThis.fetch}){
  const response=await request('/api/import/tools/parse-pdf',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({country,pdfBase64,cacheOnly:true}),signal:AbortSignal.timeout(45000)});
  if(response.status===404)return null;
  const data=await response.json();
  if(!response.ok||data?.error)throw Error(data?.error?.message||'저장 분석 조회에 실패했습니다. 새 AI 분석은 실행하지 않았습니다.');
  if(!Array.isArray(data?.content))throw Error('저장 분석 응답을 확인할 수 없습니다. 자동 재분석하지 않습니다.');
  return data;
}
/** Filename is a candidate hint, never proof of equal contents or year/week. */
export function analyzedPackingUploads(rows,country){
  if(!Array.isArray(rows))throw Error('업로드 이력을 확인할 수 없습니다.');
  const seen=new Set();
  return rows.filter(r=>r?.country===country&&r.hasAnalysis===true&&typeof r.fileName==='string'&&r.fileName.trim()&&idPattern.test(r.id||'')&&hashPattern.test(r.sourceHash||''))
    .sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')))
    .filter(r=>{if(seen.has(r.sourceHash))return false;seen.add(r.sourceHash);return true;});
}
export function packingFileReuse(rows,{country,sourceHash,fileName}){
  if(!hashPattern.test(sourceHash||''))throw Error('원본 해시를 확인할 수 없습니다.');
  const analyzed=analyzedPackingUploads(rows,country);
  return {exact:analyzed.find(r=>r.sourceHash===sourceHash)||null,
    previous:analyzed.find(r=>nameKey(r.fileName)===nameKey(fileName)&&r.sourceHash!==sourceHash)||null,
    analyzed};
}
