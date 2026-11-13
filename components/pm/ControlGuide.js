import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';
export default function ControlGuide(){
 const player=useRef(null),[chapters,setChapters]=useState([]),[error,setError]=useState(false);
 useEffect(()=>{let active=true;fetch('/guides/pm-control/chapters.json').then(r=>r.json()).then(rows=>{if(active&&Array.isArray(rows))setChapters(rows);}).catch(()=>{});return()=>{active=false;};},[]);
 return <details className="panel pm-control-guide" onToggle={e=>{if(!e.currentTarget.open)player.current?.pause();}}>
  <summary>사용 가이드 영상</summary><h2>PM 진행·오류 관제 · 직원용</h2>
  <p>연습 자료로 촬영한 실제 화면입니다. 재생해도 업무 자료는 변경되지 않습니다.</p>
  <video ref={player} controls preload="none" style={{width:'100%',maxWidth:960}} onError={()=>setError(true)} aria-label="PM 관제 사용 가이드">
   <source src="/guides/pm-control/staff.mp4" type="video/mp4"/><track kind="captions" src="/guides/pm-control/staff.ko.vtt" srcLang="ko" label="한국어" default/>
  </video>
  {error&&<p role="alert">영상을 불러오지 못했습니다. 다운로드하거나 화면을 새로 열어 주세요.</p>}
  <nav aria-label="PM 가이드 목차">{chapters.map(c=><Button key={c.scenario} onClick={()=>{if(player.current){player.current.currentTime=c.seconds;player.current.focus();}}}>{c.title}</Button>)}</nav>
  <a href="/guides/pm-control/staff.mp4" download>영상 다운로드</a> · <a href="/guides/pm-control/staff.ko.vtt" download>한국어 자막 다운로드</a>
 </details>;
}
