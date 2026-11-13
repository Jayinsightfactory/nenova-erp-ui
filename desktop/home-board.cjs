'use strict';
const {ORIGIN}=require('./policy.cjs');
const STATUS={received:'접수',triaged:'분류됨',working:'처리중',pr:'PR 올라감',deployed:'배포됨',answered:'답변완료','needs-human':'사람 확인 필요',rejected:'반려'};
const CATEGORY={error:'오류',feature:'기능요청',data:'데이터 이상',etc:'기타'};
const clean=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
function projectRequests(rows){
  if(!Array.isArray(rows)||rows.length>200)throw Error('개발요청 목록 형식을 확인하세요.');
  return rows.filter(r=>/^[a-f0-9]{12}$/i.test(r?.id)&&typeof r.title==='string'&&r.title.trim()).map(r=>({
    id:r.id.toLowerCase(),title:clean(r.title,120),status:Object.hasOwn(STATUS,r.status)?r.status:'unknown',statusLabel:STATUS[r.status]||'상태 확인',categoryLabel:CATEGORY[r.category]||'기타',
    updatedAt:Number.isFinite(Date.parse(r.updatedAt||r.at))?new Date(r.updatedAt||r.at).toISOString():null,
  })).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))).slice(0,12);
}
async function homeRequests({owner,fetch,isCurrent,onUnauthorized}) {
  if(!owner||!isCurrent())throw Error('로그인이 필요합니다.');
  const response=await fetch(ORIGIN+'/api/pm/staff-requests',{method:'GET',credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!isCurrent())throw Error('계정이 변경되었습니다.');
  if([401,403].includes(response.status)){onUnauthorized?.();throw Error('로그인을 다시 확인하세요.');}
  if(!response.ok)throw Error('개발요청을 불러오지 못했습니다.');
  const raw=await response.text();if(!isCurrent())throw Error('계정이 변경되었습니다.');if(raw.length>4*1024*1024)throw Error('개발요청 목록이 너무 큽니다. 전체 게시판에서 확인하세요.');
  let data;try{data=JSON.parse(raw);}catch{throw Error('개발요청 응답을 확인하세요.');}if(data.success!==true)throw Error('개발요청을 불러오지 못했습니다.');
  return {success:true,ownerId:owner,requests:projectRequests(data.requests)};
}
module.exports={homeRequests,projectRequests};
