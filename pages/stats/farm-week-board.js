import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWeek } from '../../lib/useWeekInput';
import { moveFarmWeek, summarizeFarmRows, varietyKey } from '../../lib/farmWeekBoard';
import styles from '../../components/FarmWeekBoard.module.css';

const tabs = [['farm','농장별 입고'],['order','주문·입고 비교'],['distribution','분배·입고 비교']];
const fmt = value => value === 0 ? '' : Number(value).toLocaleString('ko-KR',{maximumFractionDigits:3});
export default function FarmWeekBoard() {
  const [week,setWeek] = useState('');
  const [tab,setTab] = useState('farm');
  const [selected,setSelected] = useState('');
  const [data,setData] = useState(null);
  const [busy,setBusy] = useState(true);
  const [error,setError] = useState('');
  const [refresh,setRefresh] = useState(0);
  const [widths,setWidths] = useState({});
  const sequence = useRef(0);
  useEffect(()=>setWeek(moveFarmWeek(getCurrentWeek(),1)),[]);
  useEffect(()=>{
    if (!week) return;
    const id = ++sequence.current, controller = new AbortController();
    setBusy(true); setError(''); setData(null);
    const [year,...parts] = week.split('-');
    fetch(`/api/stats/farm-week-board?orderYear=${year}&orderWeek=${parts.join('-')}`,{signal:controller.signal})
      .then(async response=>{
        if (response.status===401) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
        const body=await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || '조회 실패');
        if (id!==sequence.current) return;
        setData(body);
        setSelected(previous=>previous || (body.rows[0] ? varietyKey(body.rows[0]) : body.varieties[0] ? varietyKey(body.varieties[0]) : ''));
      }).catch(err=>{if(err.name!=='AbortError' && id===sequence.current) setError(err.message);})
      .finally(()=>{if(id===sequence.current) setBusy(false);});
    return ()=>{controller.abort();sequence.current++;};
  },[week,refresh]);
  const rows = useMemo(()=>(data?.rows || []).filter(row=>varietyKey(row)===selected && (tab!=='farm' || Object.values(row.incoming).some(q=>q!==0) || row.adjustment!==0)),[data,selected,tab]);
  const farms = useMemo(()=>[...new Set(rows.flatMap(row=>Object.entries(row.incoming).filter(([,qty])=>qty!==0).map(([farm])=>farm)))].sort((a,b)=>a.localeCompare(b,'ko')),[rows]);
  const totals = useMemo(()=>summarizeFarmRows(rows),[rows]);
  const countries = useMemo(()=>{
    const groups = new Map();
    for (const row of data?.varieties || []) {
      const country = row.country || '';
      if (!groups.has(country)) groups.set(country, []);
      groups.get(country).push(row);
    }
    return [...groups.entries()];
  },[data]);
  const activeCountry = selected ? JSON.parse(selected)[0] : null;
  const activeVarieties = countries.find(([country])=>country===activeCountry)?.[1] || [];
  function selectCountry(country,items) {
    if (country===activeCountry) return;
    const first = items.find(item=>(data?.rows || []).some(row=>varietyKey(row)===varietyKey(item))) || items[0];
    if (first) setSelected(varietyKey(first));
  }
  const columns = [ ['name','품목',300],['unit','단위',65], ...farms.map(f=>['farm:'+f,f,75]), ['received','입고 합계',110], ...(tab==='farm'?[]:[[tab,tab==='order'?'주문수량':'분배수량',110],['difference',tab==='order'?'입고 − 주문':'입고 − 분배',120]]),['adjustment','재고조정 참고',110] ];
  const nearby = week ? [-2,-1,0,1,2].map(delta=>moveFarmWeek(week,delta)).filter(Boolean) : [];
  function cell(row,key) {
    if (key==='name') return row.prodName;
    if (key==='unit') return row.unit;
    if (key.startsWith('farm:')) return row.incoming[key.slice(5)] || 0;
    if (key==='difference') return Math.round((row.received-row[tab])*1000)/1000;
    return row[key];
  }
  function resize(event,key,initial) {
    const start=event.clientX, target=event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove=e=>setWidths(prev=>({...prev,[key]:Math.max(key==='name'?160:65,Math.min(600,initial+e.clientX-start))}));
    const finish=()=>{target.removeEventListener('pointermove',onMove);target.removeEventListener('pointerup',finish);target.removeEventListener('pointercancel',finish);};
    target.addEventListener('pointermove',onMove);target.addEventListener('pointerup',finish);target.addEventListener('pointercancel',finish);
  }
  function resizeKey(event,key,width) {
    if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setWidths(v=>({...v,[key]:Math.max(key==='name'?160:65,Math.min(600,(v[key]||width)+(event.key==='ArrowLeft'?-10:10)))}));
  }
  return <section className={styles.root}>
    <Head><title>차수별 농장표 · 네노바</title></Head>
    <header className={styles.title}><h1 data-desktop-chrome data-ui-page-title>차수별 농장표</h1><span>조회 전용</span><button onClick={()=>setRefresh(v=>v+1)} disabled={busy}>새로고침</button></header>
    <nav className={styles.tabs} aria-label="보기 선택">{tabs.map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</nav>
    <div className={styles.week} aria-label="세부차수 선택"><b>차수</b><button aria-label="이전 세부차수" disabled={!week || !moveFarmWeek(week,-1)} onClick={()=>setWeek(moveFarmWeek(week,-1))}>◀</button>{nearby.map(value=><button key={value} aria-pressed={week===value} onClick={()=>setWeek(value)}>{value}</button>)}<button aria-label="다음 세부차수" disabled={!week || !moveFarmWeek(week,1)} onClick={()=>setWeek(moveFarmWeek(week,1))}>▶</button></div>
    <div className={styles.selectionPanel}>
      <div className={styles.selectionRow} role="group" aria-label="국가 선택"><strong>국가</strong><div>{countries.map(([country,items])=><button key={country} aria-pressed={activeCountry===country} onClick={()=>selectCountry(country,items)}>{country || '국가 미지정'}</button>)}</div></div>
      <div className={styles.selectionRow} role="group" aria-label="품종 선택"><strong>품종</strong><div>{activeVarieties.map(row=><button key={varietyKey(row)} aria-label={`${row.country || '국가 미지정'} · ${row.flower || '미분류'}`} aria-pressed={selected===varietyKey(row)} onClick={()=>setSelected(varietyKey(row))}>{row.flower || '미분류'}</button>)}</div></div>
    </div>
    <div className={styles.note}>입고: 실제 농장 입고 · 분배: 확정/미확정 포함 · 재고조정은 입고와 별도 표시 · 차이는 당차수 비교이며 가용재고가 아닙니다.</div>
    {busy ? <p role="status">차수별 물량을 불러오는 중…</p> : error ? <p role="alert" className={styles.error}>{error}</p> : <>
      <div className={styles.caption}><strong>{week} · {selected ? JSON.parse(selected).filter(Boolean).join(' · ') : '품종 선택'} · {rows.length}품목</strong><span>열 경계를 끌어 너비 조절 · {data?.loadedAt && new Date(data.loadedAt).toLocaleTimeString('ko-KR')} 조회</span></div>
      <div className={styles.scroller} tabIndex={0} aria-label="농장별 수량표 가로·세로 스크롤">
        <table style={{width:columns.reduce((sum,[key,,width])=>sum+(widths[key]||width),0)}}><colgroup>{columns.map(([key,,width])=><col key={key} style={{width:widths[key]||width}}/>)}</colgroup>
          <thead><tr>{columns.map(([key,label,width],index)=><th key={key} className={index===0?styles.frozen:''} scope="col" title={label}>{label}<span role="separator" aria-label={`${label} 열 너비`} aria-orientation="vertical" tabIndex={0} className={styles.resize} onPointerDown={e=>resize(e,key,widths[key]||width)} onKeyDown={e=>resizeKey(e,key,width)}/></th>)}</tr></thead>
          <tbody>{rows.map(row=><tr key={row.prodKey}>{columns.map(([key],index)=>{const value=cell(row,key);return <td key={key} className={`${index===0?styles.frozen:''} ${key==='difference'&&value<0?styles.shortage:''}`} title={index===0?row.prodName:undefined}>{typeof value==='number'?fmt(value):value}</td>;})}</tr>)}{!rows.length&&<tr><td colSpan={columns.length}>선택한 차수·품종의 자료가 없습니다.</td></tr>}</tbody>
          <tfoot>{totals.map(row=><tr key={row.unit}>{columns.map(([key],index)=><td key={key} className={index===0?styles.frozen:''}>{key==='name'?`${row.unit} 합계`:key==='unit'?row.unit:fmt(cell(row,key))}</td>)}</tr>)}</tfoot>
        </table>
      </div>
    </>}
  </section>;
}
