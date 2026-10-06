export const PACKING_COUNTRIES=new Set(['NL','CN','CO','EC','TH','AU','US','VN']);
export const MAX_PACKING_PDF_BYTES=20*1024*1024;
export function validatePackingPdf(body) {
  if(!PACKING_COUNTRIES.has(body?.country)) throw Object.assign(new Error('지원 국가를 선택하세요.'),{statusCode:400});
  const data=body.pdfBase64;
  if(typeof data!=='string'||!data||data.length>Math.ceil(MAX_PACKING_PDF_BYTES/3)*4||data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw Object.assign(new Error('20MiB 이하의 PDF 파일을 선택하세요.'),{statusCode:400});
  const bytes=Buffer.from(data,'base64');
  if(bytes.length>MAX_PACKING_PDF_BYTES||bytes.subarray(0,5).toString()!=='%PDF-'||bytes.toString('base64')!==data) throw Object.assign(new Error('올바른 20MiB 이하 PDF 파일이 아닙니다.'),{statusCode:400});
  return {country:body.country,pdfBase64:data};
}
