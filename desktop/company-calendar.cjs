'use strict';
const {ORIGIN}=require('./policy.cjs');
const {requestOptions:personalOptions}=require('./home-workspace.cjs');
const fail=message=>{throw Error(message);};
function requestOptions(payload,owner){
  if(!owner||typeof owner!=='string'||!payload||typeof payload!=='object'||Array.isArray(payload)||!['GET','POST'].includes(payload.method))fail('공통 일정 요청을 확인하세요.');
  const query=payload.query||{},validated=personalOptions({method:'GET',calendarMonth:query.month,calendarWeek:query.week,date:query.date},owner),parsed=new URL(validated.url);
  if(!['month','week','date'].some(key=>query[key]!==undefined))fail('조회할 날짜를 선택하세요.');
  const cleanQuery={};for(const [a,b] of [['month','calendarMonth'],['week','calendarWeek'],['date','date']])if(parsed.searchParams.has(b))cleanQuery[a]=parsed.searchParams.get(b);
  const url=new URL('/api/desktop/company-calendar',ORIGIN),options={method:payload.method,credentials:'include',cache:'no-store',redirect:'error',headers:{Origin:ORIGIN}};
  if(payload.method==='GET'){url.searchParams.set('expectedOwnerId',owner);for(const [key,value]of Object.entries(cleanQuery))url.searchParams.set(key,value);}
  else{const c=payload.command;if(!c||!['create','update','delete'].includes(c.action)||!Number.isSafeInteger(c.expectedRevision)||c.expectedRevision<0||typeof c.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(c.requestId))fail('공통 일정 저장 요청을 확인하세요.');
    const command={action:c.action,requestId:c.requestId,expectedRevision:c.expectedRevision};
    for(const [key,max] of [['id',36],['title',120],['date',10],['startTime',5],['endTime',5],['note',2000]])if(c[key]!==undefined){if(typeof c[key]!=='string'||c[key].length>max)fail('공통 일정 입력을 확인하세요.');command[key]=c[key];}
    options.headers['Content-Type']='application/json';options.body=JSON.stringify({expectedOwnerId:owner,query:cleanQuery,command});
  }
  return {url:url.href,options};
}
async function companyCalendarRequest({payload,owner,fetch,isCurrent,onUnauthorized}){
  if(!isCurrent())fail('로그인이 필요합니다.');const request=requestOptions(payload,owner);request.options.signal=AbortSignal.timeout(15000);
  const response=await fetch(request.url,request.options);if(!isCurrent())fail('계정이 변경되었습니다.');
  if(response.status===401){onUnauthorized();fail('로그인을 다시 확인하세요.');}
  if(Number(response.headers.get('content-length'))>2*1024*1024)fail('공통 일정 응답이 너무 큽니다.');const raw=await response.text();if(!isCurrent())fail('계정이 변경되었습니다.');if(raw.length>2*1024*1024)fail('공통 일정 응답이 너무 큽니다.');
  let data;try{data=JSON.parse(raw);}catch{fail('공통 일정 응답을 확인하세요.');}
  if(response.status===403&&['ACCOUNT_CHANGED','ACCOUNT_INACTIVE'].includes(data?.code)){onUnauthorized();fail('로그인을 다시 확인하세요.');}
  if(!response.ok||data?.success!==true)return {success:false,status:response.status,error:typeof data?.error==='string'?data.error.slice(0,300):'공통 일정을 저장하지 못했습니다.'};
  if(data.ownerId!==owner||data.schemaVersion!==1||!Number.isSafeInteger(data.revision)||!Array.isArray(data.events)||data.events.length>1000)fail('공통 일정 계정과 형식을 확인하세요.');return data;
}
module.exports={requestOptions,companyCalendarRequest};
