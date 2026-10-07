export function assertKnowledgeOrigin(req) {
  if(req.headers?.['sec-fetch-site']==='cross-site')throw Object.assign(Error('같은 사이트에서 요청하세요.'),{statusCode:403,code:'ORIGIN_MISMATCH'});
  const origin=req.headers?.origin;
  const first=value=>String(Array.isArray(value)?value[0]:value||'').split(',')[0].trim();
  const host=first(req.headers?.['x-forwarded-host']||req.headers?.host);
  const proto=first(req.headers?.['x-forwarded-proto']||((req.socket?.encrypted)?'https':'http'));
  try {
    if(!origin||!host||!['http','https'].includes(proto)||Array.isArray(origin)||new URL(origin).origin!==`${proto}://${host}`||new URL(origin).origin!==origin)throw Error();
  } catch {throw Object.assign(Error('같은 사이트에서 요청하세요.'),{statusCode:403,code:'ORIGIN_MISMATCH'});}
}
export function knowledgeApiError(res,error) {
  return res.status(error.statusCode||500).json({success:false,code:error.code||'KNOWLEDGE_FAILED',error:error.statusCode?error.message:'지침 자료를 처리하지 못했습니다.'});
}
