export const PACKING_COUNTRIES=new Set(['NL','CN','CO','EC','TH','AU','US','VN']);
export function validatePackingPdf(body) {
  if(!PACKING_COUNTRIES.has(body?.country)) throw Object.assign(new Error('지원 국가를 선택하세요.'),{statusCode:400});
  const data=body.pdfBase64;
  if(typeof data!=='string'||!data||data.length>14*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw Object.assign(new Error('10MB 이하의 PDF 파일을 선택하세요.'),{statusCode:400});
  const bytes=Buffer.from(data,'base64');
  if(bytes.length>10*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-') throw Object.assign(new Error('올바른 PDF 파일이 아닙니다.'),{statusCode:400});
  return {country:body.country,pdfBase64:data};
}
