(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NenovaTaskSettings=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function normalize(input={},prior={}) {
    const value=key=>Object.prototype.hasOwnProperty.call(input,key)?input[key]:prior[key];
    const time=key=>{const v=value(key)??'';if(typeof v!=='string'||v!==''&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v))throw Error('업무 시간을 확인하세요.');return v;};
    const startTime=time('startTime'),endTime=time('endTime');
    if(endTime&&(!startTime||endTime<=startTime))throw Error('종료 시간은 시작 시간보다 늦게 입력하세요.');
    const raw=value('shortcut');let shortcut=null;
    if(raw!==undefined&&raw!==null){
      if(typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['kind','target','label'].includes(k))||!['desktop','web'].includes(raw.kind))throw Error('바로가기 종류를 확인하세요.');
      if(typeof raw.label!=='string'||!raw.label.trim()||raw.label.trim().length>24||/[\x00-\x1f\x7f]/.test(raw.label))throw Error('바로가기 이름은 1~24자로 입력하세요.');
      if(typeof raw.target!=='string'||raw.target.length>2048||/[\x00-\x20\x7f\\]/.test(raw.target))throw Error('바로가기 주소를 확인하세요.');
      const url=new URL(raw.target,'https://nenovaweb.com');
      if(url.username||url.password)throw Error('로그인 정보가 포함된 주소는 연결할 수 없습니다.');
      if(raw.kind==='desktop'&&(!raw.target.startsWith('/')||raw.target.startsWith('//')||url.origin!=='https://nenovaweb.com'||url.pathname==='/api'||url.pathname.startsWith('/api/')||url.pathname==='/login'||url.hash||url.search))throw Error('목록에서 데스크톱 메뉴를 선택하세요.');
      if(raw.kind==='web'&&(!/^https?:\/\//i.test(raw.target)||!['http:','https:'].includes(url.protocol)))throw Error('http 또는 https 웹 주소를 입력하세요.');
      shortcut={kind:raw.kind,target:raw.kind==='desktop'?url.pathname:url.href,label:raw.label.trim()};
    }
    return {startTime,endTime,shortcut};
  }
  function compare(a,b){return String(a.occurrenceDate||'').localeCompare(String(b.occurrenceDate||''))||(a.startTime||'99:99').localeCompare(b.startTime||'99:99')||String(a.id).localeCompare(String(b.id));}
  return {normalize,compare};
});
