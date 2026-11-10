// Browser-safe transport errors. Never expose proxy HTML, response bodies, or parse errors.
function transportMessage(status){
  if(status===413)return '업로드 크기가 서버 허용 한도를 넘었습니다(HTTP 413). ZIP이 25MiB 이하인지 확인하고, 계속되면 담당자에게 서버 업로드 한도를 확인해 주세요.';
  if(status===401||status===403)return '로그인 또는 접근 권한을 확인해 주세요. 다시 로그인한 뒤 작업 상태를 확인하세요.';
  if([502,503,504].includes(status))return `서버 연결이 지연되거나 중단되었습니다(HTTP ${status}). 이미 접수됐을 수 있으므로 작업 상태를 확인한 뒤 재시도하세요.`;
  return `정산 서버 응답을 확인하지 못했습니다${status?`(HTTP ${status})`:''}. 원문 응답은 표시하지 않습니다. 작업 상태를 확인한 뒤 다시 시도해 주세요.`;
}
export async function readSettlementResponse(response){
  const status=Number(response?.status)||0;
  let data;try{data=await response.json();}catch{throw Object.assign(Error(transportMessage(status)),{statusCode:status});}
  if(!response.ok||!data||typeof data!=='object'||Array.isArray(data)||data.success!==true){
    const fixed=[401,403,413,502,503,504].includes(status);
    const message=!fixed&&typeof data?.error==='string'&&data.error.length<=500&&!/[<>]/.test(data.error)?data.error:transportMessage(status);
    throw Object.assign(Error(message),{statusCode:status});
  }
  return data;
}
