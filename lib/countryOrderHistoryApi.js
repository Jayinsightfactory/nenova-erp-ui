import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {countryOrderHistoryScope,countryOrderHistoryScopeKey,reconcileCountryOrderEvidence} from './countryOrderReconciliation.js';
import {latestCompleteCountryOrderDelivery} from './countryOrderHistoryStore.js';
import {reviewCountryOrderQuantities,applyCountryOrderManualQuantities} from './countryOrderSource.js';
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure=(message,statusCode=409)=>Object.assign(Error(message),{statusCode});
const withoutBytes=({bytes,...record})=>record;
export const countryOrderMatrixCells=matrix=>matrix.rows.flatMap(row=>matrix.customers.map(customer=>({custKey:customer.key,customer:customer.name,customerCode:customer.code,prodKey:row.prodKey,product:row.name,unit:row.unit,quantity:row.quantities[customer.key]??0})));
export function applyCountryOrderEvidence(matrix,result) {
  return {...matrix,rows:matrix.rows.map(row=>{
    const quantities={...row.quantities};
    for(const cell of result.rows)if(String(cell.prodKey)===String(row.prodKey)&&cell.unit===row.unit)quantities[String(cell.custKey)]=cell.quantity;
    return {...row,quantities,total:Object.values(quantities).reduce((sum,n)=>sum+n,0)};
  })};
}
export function createCountryOrderHistoryHandler({store,readCurrent,readMessages,generate,canAccess,secret}) {
  const key=()=>typeof secret==='function'?secret():secret;
  const sign=value=>{const data=Buffer.from(JSON.stringify(value)).toString('base64url');return data+'.'+createHmac('sha256',key()).update(data).digest('base64url');};
  const verify=token=>{const [data,mac,...extra]=String(token??'').split('.');if(!data||!mac||extra.length)throw failure('미리보기를 다시 생성하세요.');const actual=Buffer.from(mac,'base64url'),expected=createHmac('sha256',key()).update(data).digest();if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw failure('미리보기 확인값이 다릅니다.');const payload=JSON.parse(Buffer.from(data,'base64url'));if(Date.now()-payload.createdAt>30*60000||payload.createdAt>Date.now())throw failure('미리보기 유효시간이 지났습니다. 다시 생성하세요.');return payload;};
  const requestIdentity=body=>fingerprint({scope:countryOrderHistoryScope(body.scope),selections:body.selections,decisions:body.decisions??{},options:body.options??{},changes:body.changes??{},manual:body.manual??{}});
  async function prepare(input) {
    const scope=countryOrderHistoryScope(input.scope),source=await readCurrent(scope);
    const history=await store.list(scope),baseline=latestCompleteCountryOrderDelivery(history);
    if(baseline)await store.read(scope,baseline.id); // Verify the actual preserved bytes before using their snapshot.
    const current={scope,queriedAt:source.queriedAt,rows:countryOrderMatrixCells(source.matrix)};
    const digest=fingerprint({scope,rows:current.rows,events:source.events,baseline:baseline?.id??null});
    if(input.expectedFingerprint!==undefined&&input.expectedFingerprint!==digest)throw failure('전산 또는 전달 기준본이 바뀌었습니다. 원문 대조를 다시 조회하세요.');
    return {scope,source,history,baseline,current,digest};
  }
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!canAccess(req.user))return res.status(403).json({error:'활성 수입부 또는 관리자만 발주 원본 이력을 열 수 있습니다.'});
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).end();}
    try{
      if(req.method==='GET'){
        const scope=countryOrderHistoryScope(req.query);
        if(req.query.historyOnly==='1')return res.status(200).json({history:await store.list(scope)});
        if(req.query.id){const record=await store.read(scope,req.query.id);
          if(req.query.file==='1'){res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(record.filename)}`);res.setHeader('X-Content-SHA256',record.sha256);return res.status(200).send(record.bytes);}
          return res.status(200).json({record:withoutBytes(record)});
        }
        const data=await prepare({scope});
        // Reading shared history never marks it downloaded or delivered.
        const messages=await readMessages(scope);
        return res.status(200).json({scope,current:data.current,details:data.source.details,events:data.source.events,matrix:data.source.matrix,messages,history:data.history,baseline:data.baseline,fingerprint:data.digest});
      }
      const body=req.body??{},scope=countryOrderHistoryScope(body.scope);
      return await store.withScopeLock(scope,async()=>{
      if(body.action==='delivered'){
        const record=await store.markDelivered({scope,id:body.id,sha256:body.sha256,actor:req.user.userId,confirmed:body.confirmed});
        return res.status(200).json({record:withoutBytes(record)});
      }
      if(!['preview','download'].includes(body.action))throw failure('작업을 확인하세요.',400);
      const requestDigest=fingerprint({identity:requestIdentity(body),filename:body.filename,eta:body.eta,token:body.previewToken});
      if(body.action==='download'){
        try{const existing=await store.read(scope,body.id);if(existing.requestDigest!==requestDigest)throw failure('같은 다운로드 작업 번호의 내용이 다릅니다.');return res.status(200).json({record:withoutBytes(existing),file:existing.bytes.toString('base64')});}catch(e){if(e.code!=='HISTORY_NOT_FOUND')throw e;}
      }
      const data=await prepare(body),feed=await readMessages(scope);
      const sourceItems=new Map(feed.flatMap(message=>message.items.map(item=>[item.sourceKey,{...item,messageId:message.id,sourceText:message.text}])));
      for(const pending of data.baseline?.pendingSources??[])if(!sourceItems.has(pending.sourceKey))sourceItems.set(pending.sourceKey,pending);
      if(!Array.isArray(body.selections)||body.selections.length>1000)throw failure('선택한 원문 행을 확인하세요.',400);
      const messages=body.selections.map(choice=>{
        const original=sourceItems.get(choice.sourceKey);if(!original)throw failure('선택한 카톡 원문이 현재 조회 근거에 없습니다. 다시 조회하세요.');
        const customer=data.source.matrix.customers.find(row=>String(row.key)===String(choice.custKey));
        const product=data.source.matrix.rows.find(row=>String(row.prodKey)===String(choice.prodKey));
        if(!customer||!product)throw failure('업체·품목 연결이 현재 전체 주문에 없습니다. 별도 검토가 필요합니다.');
        return {...original,selected:true,custKey:customer.key,prodKey:product.prodKey};
      });
      const result=reconcileCountryOrderEvidence({scope,current:data.current,baseline:data.baseline,messages,decisions:body.decisions??{},events:data.source.events});
      if(!result.canExport) return res.status(409).json({error:'등록·미등록·부분 일치 근거를 확인하세요.',reconciliation:result});
      if(messages.length&&(Object.keys(body.changes??{}).length||Object.keys(body.manual??{}).length))throw failure('카톡 합산과 전산 수량 직접 수정은 함께 확정할 수 없습니다. 수량 수정 근거를 먼저 정리하세요.');
      let matrix=reviewCountryOrderQuantities(applyCountryOrderEvidence(data.source.matrix,result),body.changes??{});
      if(matrix.blockers.length)matrix=applyCountryOrderManualQuantities(matrix,body.manual??{});
      const exportedRows=countryOrderMatrixCells(matrix);
      let outputs;try{outputs=generate(matrix,body.options??{},body.eta);}catch(e){throw failure(e.message,400);}
      if(body.action==='preview'){
        const batchId=randomUUID(),outputIds=Object.fromEntries(outputs.map(output=>[output.filename,randomUUID()]));
        const previewToken=sign({scopeKey:countryOrderHistoryScopeKey(scope),identity:requestIdentity(body),fingerprint:data.digest,queriedAt:data.current.queriedAt,batchId,outputIds,createdAt:Date.now()});
        return res.status(200).json({outputs:outputs.map(({bytes,...output})=>output),reconciliation:result,fingerprint:data.digest,queriedAt:data.current.queriedAt,previewToken,outputIds});
      }
      const signed=verify(body.previewToken);
      if(signed.scopeKey!==countryOrderHistoryScopeKey(scope)||signed.identity!==requestIdentity(body)||signed.fingerprint!==data.digest||signed.outputIds[body.filename]!==body.id)throw failure('선택 또는 전산·전달 기준이 바뀌었습니다. 미리보기를 다시 생성하세요.');
      const output=outputs.find(output=>output.filename===body.filename);
      if(!output)throw failure('선택한 발주 파일이 현재 미리보기와 다릅니다.');
      const record=await store.save({scope,id:body.id,filename:output.filename,bytes:output.bytes,rows:exportedRows,erpRows:data.current.rows,pendingSources:result.pendingSources,sourceKeys:result.sourceKeys,queriedAt:signed.queriedAt,actor:req.user.userId,evidence:result.findings,requestDigest,batchId:signed.batchId,expectedFiles:Object.keys(signed.outputIds)});
      return res.status(200).json({record:withoutBytes(record),file:record.bytes.toString('base64')});
      });
    }catch(e){return res.status(e.statusCode??500).json({error:e.statusCode?e.message:'원천 조회 또는 보관 처리에 실패했습니다. 자동으로 다시 실행하지 말고 연결 상태를 확인하세요.',code:e.statusCode?(e.code??'COUNTRY_ORDER_HISTORY_ERROR'):'COUNTRY_ORDER_HISTORY_UNAVAILABLE'});}
  };
}
