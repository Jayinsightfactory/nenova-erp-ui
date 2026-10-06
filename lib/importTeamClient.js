import {useState,useEffect,useCallback,useRef} from 'react';
async function request(key,body) {
  const response=await fetch('/api/import/tools/state?key='+encodeURIComponent(key),body===undefined?{cache:'no-store'}:{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok||!data.success) throw Object.assign(new Error(data.error||'공동 자료를 처리하지 못했습니다.'),{status:response.status});
  return data;
}
export function useImportTeamRecord(key,initialValue) {
  // A key visit is an independent scope, even for A -> B -> A. Old requests
  // may finish on the server, but must not publish state or release new locks.
  const current=useRef(null);
  if(!current.current || current.current.key!==key) {
    current.current={key,active:true,generation:0,version:null,saveToken:null};
  }
  const scope=current.current;
  const empty=()=>({scope,value:null,revision:0,history:[],taskActors:{},loading:true,saving:false,error:''});
  const [state,setState]=useState(empty);
  const isCurrent=token=>current.current===scope && scope.active && scope.generation===token;
  const reload=useCallback(async()=>{
    // A GET during a PUT can observe its pre-write snapshot. Wait for save to
    // settle before allowing another reload; do not invalidate its revision.
    if(current.current!==scope || !scope.active || scope.saveToken!==null) return;
    const token=++scope.generation;
    scope.version=null;
    setState(previous=>({... (previous.scope===scope?previous:empty()),scope,loading:true,saving:false,error:''}));
    try {
      const data=await request(key);
      if(isCurrent(token)) {
        scope.version=data.revision;
        setState({scope,value:data.value,revision:data.revision,history:data.history||[],taskActors:data.taskActors||{},loading:false,saving:false,error:''});
      }
    } catch(e) {
      if(isCurrent(token)) setState(previous=>({...previous,scope,error:e.message}));
    } finally {
      if(isCurrent(token)) setState(previous=>({...previous,scope,loading:false}));
    }
  },[key,scope]);
  useEffect(()=>{
    scope.active=true;
    reload();
    return ()=>{
      scope.active=false;
      scope.generation+=1;
      scope.version=null;
      scope.saveToken=null;
    };
  },[scope,reload]);
  const save=useCallback(async(value)=>{
    if(current.current!==scope || !scope.active || scope.saveToken!==null || scope.version===null) throw new Error('자료 조회 또는 저장이 진행 중입니다.');
    const token=++scope.generation;
    const expectedRevision=scope.version;
    scope.saveToken=token;
    setState(previous=>({...previous,scope,loading:false,saving:true,error:''}));
    try {
      const data=await request(key,{expectedRevision,value});
      if(isCurrent(token)) {
        scope.version=data.revision;
        setState({scope,value:data.value,revision:data.revision,history:data.history||[],taskActors:data.taskActors||{},loading:false,saving:false,error:''});
      }
      return data;
    } catch(e) {
      if(isCurrent(token)) setState(previous=>({...previous,scope,error:e.message}));
      throw e;
    } finally {
      if(isCurrent(token) && scope.saveToken===token) {
        scope.saveToken=null;
        setState(previous=>({...previous,scope,saving:false}));
      }
    }
  },[key,scope]);
  const record=state.scope===scope?state:empty();
  return {value:record.value!==null?record.value:initialValue,revision:record.revision,history:record.history,taskActors:record.taskActors,loading:record.loading,saving:record.saving,error:record.error,reload,save};
}
export function createImportTeamStorage(onError=()=>{}) {
  const versions=new Map();
  const map={nenova_catalog:'packing.catalog',nenova_aliases:'packing.aliases'};
  const resolve=key=>{if(!map[key])throw new Error('지원하지 않는 저장 항목입니다.');return map[key];};
  const report=e=>{onError(e.message);throw e;};
  return {
    async get(key){try{const data=await request(resolve(key));versions.set(key,data.revision);return data.value===null?null:{value:typeof data.value==='string'?data.value:JSON.stringify(data.value)};}catch(e){return report(e);}},
    async set(key,value){try{if(!versions.has(key))throw new Error('공동 자료를 먼저 다시 조회하세요.');const data=await request(resolve(key),{expectedRevision:versions.get(key),value:JSON.parse(value)});versions.set(key,data.revision);return data;}catch(e){return report(e);}},
    async delete(key){try{if(!versions.has(key))throw new Error('공동 자료를 먼저 다시 조회하세요.');const data=await request(resolve(key),{expectedRevision:versions.get(key),value:null});versions.set(key,data.revision);return data;}catch(e){return report(e);}},
  };
}
