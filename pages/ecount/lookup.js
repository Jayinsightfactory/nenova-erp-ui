import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { OrderAggregateLookup } from '../../components/ecount/OrderStatusPageControls';
import { PoAggregateLookup } from '../../components/ecount/PoStatusPageControls';
import { validContext,createSelection,canReturn } from '../../lib/ecountLookupWindow.cjs';
import styles from '../../styles/ecount-workbench.module.css';
export default function LookupPage() {
  const [context,setContext]=useState(null),[error,setError]=useState('');
  const timer=useRef(null);
  useEffect(()=>{
    const query=new URLSearchParams(window.location.search);
    const next={dataset:query.get('dataset'),nonce:query.get('nonce')};
    if(validContext(next))setContext(next);else setError('유효하지 않은 조회창 요청입니다. 원래 화면에서 다시 열어 주세요.');
    return ()=>window.clearTimeout(timer.current);
  },[]);
  function selectDaily(){
    if(!validContext(context)||!canReturn(window.opener)){setError('원래 화면이 닫혀 있어 선택을 반영할 수 없습니다.');return;}
    try {
      window.opener.postMessage(createSelection(context),window.location.origin);
      window.clearTimeout(timer.current);
      timer.current=window.setTimeout(()=>setError('원래 화면에서 선택을 확인하지 못했습니다. 원래 화면에서 조회창을 다시 열어 주세요.'),2500);
    }catch{setError('원래 화면에 선택을 전달하지 못했습니다. 다시 열어 주세요.');}
  }
  const Lookup=context?.dataset==='orderStat'?OrderAggregateLookup:PoAggregateLookup;
  return <main className={styles.page}><Head><title>{context?.dataset==='orderStat'?'항목추가':'집계조건검색'}</title><meta name="referrer" content="no-referrer"/></Head>{context&&<Lookup standalone onClose={()=>window.close()} onDaily={selectDaily}/>} {error&&<p role="alert" className={styles.lookupWindowError}>{error}</p>}</main>;
}
