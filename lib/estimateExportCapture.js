import {apiPost} from './useApi';
import {downloadEcountUploadWorkbook} from './estimateEcountExcel';
export async function captureEstimateExport({year,week,custKeys,weekDays,request=apiPost,download=downloadEcountUploadWorkbook,id=()=>crypto.randomUUID()}){
 const scope={year:String(year),week:Number(week)},created=await request('/api/estimate/change-history',{...scope,action:'capture',id:id(),custKeys,weekDays});
 if(!created?.success||!created.data?.excelRows?.length)throw new Error(created?.error||'다운로드 기준을 기록하지 못했습니다.');
 const capture=created.data;download(capture.excelRows,capture.fileName);
 const pending={...scope,action:'downloadRequested',id:id(),captureId:capture.id};
 try{const saved=await request('/api/estimate/change-history',pending);if(!saved?.success)throw new Error(saved?.error||'요청 이력 확인 실패');return {capture,rowCount:capture.excelRows.length,pending:null};}
 catch(error){return {capture,rowCount:capture.excelRows.length,pending,error:error.message};}
}
