import {useEffect,useRef,useState} from 'react';
import {PERIODS,previewReports,filterReports} from '../../lib/mobileExecutiveReportPreview';
import s from './ExecutiveReports.module.css';
import WeeklyDemoReport from './WeeklyDemoReport';
import {weeklyDemoWorkbook} from '../../lib/mobileWeeklyDemo';

const money = value => `${Math.round(value/10000).toLocaleString('ko-KR')}만원`;
export default function ExecutiveReports({preview=false}) {
  const [locked,setLocked]=useState(!preview),[period,setPeriod]=useState('2026-39');
  const [category,setCategory]=useState('전체'),[search,setSearch]=useState(''),[expanded,setExpanded]=useState(false);
  const [selected,setSelected]=useState(null),[view,setView]=useState('reports');
  const [downloadBusy,setDownloadBusy]=useState(false),[downloadStatus,setDownloadStatus]=useState(null);
  const downloadLock=useRef(false);
  const heading=useRef(null), restoreFocus=useRef(false);
  useEffect(()=>{if(restoreFocus.current){heading.current?.focus();restoreFocus.current=false;}},[selected,locked,view]);
  function changeScreen(action){restoreFocus.current=true;action();window.scrollTo({top:0,behavior:'instant'});}
  function changePeriod(value){setPeriod(value);setSelected(null);setCategory('전체');setSearch('');setDownloadStatus(null);}
  async function downloadWeekly(value){
    if(downloadLock.current)return;
    downloadLock.current=true;setDownloadBusy(true);setDownloadStatus({message:'예시 엑셀을 생성하고 있습니다.'});
    try{
      const ExcelJS=(await import('exceljs')).default;
      const bytes=await weeklyDemoWorkbook(ExcelJS,value).xlsx.writeBuffer();
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const link=document.createElement('a');link.href=url;link.download=`예시_주차별매출이익_${value}.xlsx`;
      document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      setDownloadStatus({message:`${value} 예시 엑셀 다운로드를 요청했습니다. 기기의 다운로드 목록을 확인하세요.`});
    }catch{setDownloadStatus({error:true,message:'예시 엑셀 생성에 실패했습니다. 다시 눌러 주세요.'});}
    finally{downloadLock.current=false;setDownloadBusy(false);}
  }
  const current=PERIODS.find(row=>row.id===period),rows=previewReports(period,expanded);
  const visible=filterReports(rows,category,search);
  return <main className={s.root} data-executive-ui>
    <div className={s.shell}>
      {preview&&<aside className={s.preview}><span>화면 미리보기 · 실제 자료 아님</span><button onClick={()=>changeScreen(()=>{setLocked(!locked);setSelected(null);})}>{locked?'보고서 화면':'접속 화면'}</button></aside>}
      <header className={s.header}><a href="/m/executive" aria-label="경영 보고서 첫 화면" className={s.brand}>NENOVA<span>EXECUTIVE REPORTS</span></a><span className={s.private}>전용 보고실</span></header>
      {locked?<section className={s.login}>
        <div className={s.emblem} aria-hidden="true">N</div><p className={s.eyebrow}>PRIVATE ACCESS</p>
        <h1 ref={heading} tabIndex={-1}>한 주의 성과를,<br/>한눈에.</h1><p className={s.intro}>마감된 매출·이익과 호텔별 손익 자료를<br/>모바일에서 간편하게 확인하세요.</p>
        <form onSubmit={event=>event.preventDefault()}><label htmlFor="executive-password">공용 비밀번호</label><input id="executive-password" type="password" autoComplete="off" placeholder="비밀번호 설정 후 이용할 수 있습니다" disabled/><button className={s.primary} disabled>보고실 접속 준비 중</button><p className={s.setup} role="status">비밀번호 및 보고서 연결을 준비하고 있습니다.<br/>아이디 없이 공용 비밀번호로 이용할 예정입니다.</p></form>
        <div className={s.loginFooter}>대표님 · 이사님 전용<span>권한을 받은 분만 이용해 주세요.</span></div>
      </section>:<>
        <nav className={s.navigation} aria-label="보고서 메뉴"><button aria-pressed={view==='reports'} onClick={()=>changeScreen(()=>{setView('reports');setSelected(null);})}>보고서</button><button aria-pressed={view==='archive'} onClick={()=>changeScreen(()=>{setView('archive');setSelected(null);})}>지난 차수</button><button className={s.lockButton} onClick={()=>changeScreen(()=>setLocked(true))}>잠금</button></nav>
        {downloadStatus&&<p className={s.downloadStatus} role={downloadStatus.error?'alert':'status'}>{downloadStatus.message}</p>}
        {selected?.id==='weekly-profit'?<WeeklyDemoReport report={selected} periods={PERIODS} headingRef={heading} busy={downloadBusy} onDownload={()=>downloadWeekly(period)} onBack={()=>changeScreen(()=>setSelected(null))} onPeriodChange={value=>{setPeriod(value);setSelected(previewReports(value).find(r=>r.id==='weekly-profit'));setDownloadStatus(null);}}/>:selected?<section className={s.detail}>
          <button className={s.back} onClick={()=>changeScreen(()=>setSelected(null))}>← 보고서 목록</button>
          <div className={s.titleRow}><span className={s.eyebrow}>{current.label} · 예시 보고서</span><span className={s.badge}>{selected.badge}</span></div>
          <h1 ref={heading} tabIndex={-1}>{selected.title}</h1><p className={s.subtle}>예시 갱신 {selected.updated} · 단위: 원</p>
          <div className={s.detailSummary}><span>이익 {selected.category==='호텔'?'합계':'요약'}</span><strong>{money(selected.profit)}</strong><small>화면 구성 확인용 예시 금액</small></div>
          <h2>손익 요약</h2><dl className={s.breakdown}><div><dt>매출액</dt><dd>{selected.revenue.toLocaleString('ko-KR')}원</dd></div><div><dt>매입 및 비용</dt><dd>{selected.cost.toLocaleString('ko-KR')}원</dd></div><div><dt>이익</dt><dd>{selected.profit.toLocaleString('ko-KR')}원</dd></div><div><dt>이익률</dt><dd>{(selected.profit/selected.revenue*100).toFixed(1)}%</dd></div></dl>
          <aside className={s.notice}>실제 보고서는 마감 자료 연결 후 제공됩니다. 이 화면의 수치는 예시이며, 원장이나 기존 손익계산서를 변경하지 않습니다.</aside>
          <button className={s.primary} disabled>↓ 엑셀 받기 · 연결 대기</button>
        </section>:view==='archive'?<section className={s.content}>
          <p className={s.eyebrow}>REPORT ARCHIVE</p><h1 ref={heading} tabIndex={-1}>지난 차수</h1><p className={s.subtle}>확정된 자료를 차수별로 모아봅니다.</p>
          <div className={s.archive}>{PERIODS.map(item=><button key={item.id} onClick={()=>changeScreen(()=>{changePeriod(item.id);setView('reports');})}><span><strong>{item.label}</strong><small>{item.range}</small></span><span>{item.id.startsWith('2025')?'자료 없음':'예시 3개'} →</span></button>)}</div>
        </section>:<section className={s.content}>
          <div className={s.titleRow}><div><p className={s.eyebrow}>WEEKLY BRIEFING</p><h1 ref={heading} tabIndex={-1}>경영 보고서</h1></div><span className={s.sample}>UI 예시</span></div>
          <div className={s.period}><label htmlFor="report-period">조회 차수</label><select id="report-period" value={period} onChange={event=>changePeriod(event.target.value)}>{PERIODS.map(item=><option key={item.id} value={item.id}>{item.label}{item.id==='2026-39'?' · 최신 예시':''}</option>)}</select></div>
          {rows.length>0&&<section className={s.hero} aria-label="예시 차수 요약"><div className={s.heroTop}><span>{current.range}</span><span>마감 완료 · 예시</span></div><h2>{current.label} 실적 요약</h2><div className={s.metrics}><div><span>매출액</span><strong>{money(rows[0].revenue)}</strong></div><div><span>이익액</span><strong>{money(rows[0].profit)}</strong></div></div><div className={s.heroFoot}><span>예시 갱신 {rows[0].updated}</span><span>실제 금액 아님</span></div></section>}
          <div className={s.listTitle}><h2>보고서 <span>{rows.length}</span></h2><label className={s.expand}><input type="checkbox" checked={expanded} onChange={event=>{setExpanded(event.target.checked);if(!event.target.checked&&category==='기타')setCategory('전체');}}/>10개 확장 보기</label></div>
          <div className={s.filters} aria-label="보고서 분류">{['전체','매출·이익','호텔',...(expanded?['기타']:[])].map(item=><button key={item} aria-pressed={category===item} onClick={()=>setCategory(item)}>{item}</button>)}</div>
          <input className={s.search} type="search" aria-label="보고서 검색" placeholder="보고서 이름으로 찾기" value={search} onChange={event=>setSearch(event.target.value)}/>
          <div className={s.reports} aria-live="polite">{visible.map((report,index)=><article className={s.report} key={report.id}>
            <div className={s.reportTop}><span className={s.number}>{String(index+1).padStart(2,'0')}</span><span className={s.category}>{report.category}</span><span className={`${s.badge} ${report.planned?s.planned:report.badge==='수정본'?s.revised:''}`}>{report.badge}</span></div>
            <h3>{report.title}</h3><p>{report.description}</p><div className={s.fileMeta}><span>{report.format}</span><span>{report.updated?`${report.updated} 갱신 · 예시`:'자료 연결 예정'}</span></div>
            <div className={s.reportActions}><button disabled={report.planned} onClick={()=>changeScreen(()=>setSelected(report))}>보고서 보기 <span aria-hidden="true">↗</span></button><button disabled={report.id!=='weekly-profit'||downloadBusy} onClick={()=>downloadWeekly(report.period)} aria-label={`${report.title} ${report.id==='weekly-profit'?'예시 엑셀 받기':'엑셀 연결 대기'}`}>{report.id==='weekly-profit'?(downloadBusy?'생성 중…':'↓ 예시 엑셀 받기'):'↓ 엑셀 연결 대기'}</button></div>
          </article>)}</div>
          {!visible.length&&<div className={s.empty} role="status"><strong>{rows.length?'찾는 보고서가 없습니다.':'이 차수의 자료가 없습니다.'}</strong><p>{rows.length?'검색어나 분류를 변경해 주세요.':'다른 차수를 선택해 주세요.'}</p>{rows.length>0&&<button onClick={()=>{setSearch('');setCategory('전체');}}>필터 초기화</button>}</div>}
          <p className={s.releaseNote}>금요일 이후, 실제 차수 마감이 완료된 자료를 게시할 예정입니다. 미마감 자료와 준비 중인 파일은 공개하지 않습니다.</p>
        </section>}
        <footer className={s.footer}><strong>NENOVA</strong><span>경영진 전용 · 외부 공유 금지</span><small>현재는 UI 검토용 화면입니다.</small></footer>
      </>}
    </div>
  </main>;
}
