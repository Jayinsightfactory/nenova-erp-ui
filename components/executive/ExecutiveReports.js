import {useEffect,useRef,useState} from 'react';
import {PERIODS,previewReports} from '../../lib/mobileExecutiveReportPreview';
import {weeklyDemoWorkbook} from '../../lib/mobileWeeklyDemo';
import WeeklyDemoReport from './WeeklyDemoReport';
import MonthlyDemoReport from './MonthlyDemoReport';
import s from './ExecutiveReports.module.css';
const SECTIONS=[{id:'weekly-profit',name:'매출이익자료',icon:'매출'},{id:'raum-profit',name:'라움',icon:'R'},{id:'shilla-profit',name:'신라호텔',icon:'S'}];

export default function ExecutiveReports({preview=false,weeklyDemoMode=false}) {
  const unlocked=preview||weeklyDemoMode;
  const [period,setPeriod]=useState('2026-39'),[selected,setSelected]=useState(null);
  const [view,setView]=useState('files');
  const [section,setSection]=useState(null);
  const [downloadBusy,setDownloadBusy]=useState(false),[downloadStatus,setDownloadStatus]=useState(null);
  const downloadLock=useRef(false),heading=useRef(null),restoreFocus=useRef(false);
  useEffect(()=>{if(restoreFocus.current){heading.current?.focus();restoreFocus.current=false;}},[selected,section]);
  function openSection(id){restoreFocus.current=true;setSection(id);setSelected(null);setView('months');setPeriod('2026-39');setDownloadStatus(null);window.scrollTo({top:0,behavior:'instant'});}
  function openReport(report){restoreFocus.current=true;setSelected(report);window.scrollTo({top:0,behavior:'instant'});}
  function changePeriod(value){setPeriod(value);setSelected(null);setDownloadStatus(null);}
  async function downloadWeekly(value){
    if(downloadLock.current)return;
    downloadLock.current=true;setDownloadBusy(true);setDownloadStatus({message:'엑셀 생성 중…'});
    try{
      const ExcelJS=(await import('exceljs')).default;
      const bytes=await weeklyDemoWorkbook(ExcelJS,value).xlsx.writeBuffer();
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const link=document.createElement('a');link.href=url;link.download=`예시_주차별매출이익_${value}.xlsx`;
      document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      setDownloadStatus({message:`${value} 예시 엑셀 다운로드 요청 완료`});
    }catch{setDownloadStatus({error:true,message:'엑셀 생성 실패. 다시 눌러 주세요.'});}
    finally{downloadLock.current=false;setDownloadBusy(false);}
  }
  const currentSection=SECTIONS.find(item=>item.id===section);
  const rows=previewReports(period).filter(report=>report.id===section);
  return <main className={`${s.root} ${s.fileRoot}`} data-executive-ui>
    <div className={s.fileShell}>
      <header className={s.fileHeader}>{section&&!selected&&<button className={s.homeBack} onClick={()=>openSection(null)} aria-label="보고서 홈으로">←</button>}<h1 ref={!selected?heading:null} tabIndex={-1}>{currentSection?.name||'NENOVA 보고서'}</h1>{unlocked&&<span className={s.fileSample} title="가상 데이터 · 실제 자료 아님">예시</span>}</header>
      {!unlocked?<section className={s.login}>
        <form onSubmit={event=>event.preventDefault()}><label htmlFor="executive-password">공용 비밀번호</label><input id="executive-password" type="password" autoComplete="off" placeholder="비밀번호 설정 후 이용할 수 있습니다" disabled/><button className={s.primary} disabled>보고실 접속 준비 중</button></form>
      </section>:!section?<nav className={s.appMenu} aria-label="보고서 선택">{SECTIONS.map(item=><button key={item.id} onClick={()=>openSection(item.id)}><span className={s.appIcon} aria-hidden="true">{item.icon}</span><strong>{item.name}</strong><span aria-hidden="true">›</span></button>)}</nav>:<>
        {!selected&&<nav className={s.fileToolbar} aria-label="보고서 보기 방식"><button aria-pressed={view==='files'} onClick={()=>setView('files')}>파일 목록</button><button aria-pressed={view==='months'} onClick={()=>setView('months')}>월별 보기</button></nav>}
        {downloadStatus&&<p className={s.downloadStatus} role={downloadStatus.error?'alert':'status'}>{downloadStatus.message}</p>}
        <div hidden={view!=='months'||Boolean(selected)}><MonthlyDemoReport key={section} reportId={section} title={currentSection.name} onWeek={value=>{setPeriod(value);openReport(previewReports(value).find(r=>r.id===section));}}/></div>
        {selected?.id==='weekly-profit'?<WeeklyDemoReport report={selected} periods={PERIODS} headingRef={heading} busy={downloadBusy} onDownload={()=>downloadWeekly(period)} onBack={()=>openReport(null)} onPeriodChange={value=>{setPeriod(value);setSelected(previewReports(value).find(r=>r.id==='weekly-profit'));setDownloadStatus(null);}}/>:selected?<section className={s.detail}>
          <button className={s.back} onClick={()=>openReport(null)}>← 이전 화면</button>
          <h2 ref={heading} tabIndex={-1}>{selected.title} · 예시</h2>
          <dl className={s.breakdown}><div><dt>매출액</dt><dd>{selected.revenue.toLocaleString('ko-KR')}원</dd></div><div><dt>매입 및 비용</dt><dd>{selected.cost.toLocaleString('ko-KR')}원</dd></div><div><dt>이익</dt><dd>{selected.profit.toLocaleString('ko-KR')}원</dd></div></dl>
        </section>:view==='months'?null:<>
          <div className={s.fileToolbar}><label htmlFor="report-period">차수</label><select id="report-period" value={period} onChange={event=>changePeriod(event.target.value)}>{PERIODS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select><span>{rows.length}개</span></div>
          <table className={s.fileTable} aria-label="보고서 파일 목록"><thead><tr><th scope="col">파일명</th><th scope="col" className={s.desktopDate}>갱신일</th><th scope="col" className={s.fileActionHeading}>열기 / 받기</th></tr></thead><tbody>
            {rows.map(report=><tr key={report.id}>
              <td><span className={s.fileType}>XLSX</span><span className={s.fileName}>{report.title}.xlsx</span><small className={s.mobileDate}>{report.updated}</small></td>
              <td className={s.desktopDate}>{report.updated}</td>
              <td><div className={s.fileActions}><button aria-label={`${report.title} 보기`} onClick={()=>openReport(report)}>보기</button><button disabled={report.id!=='weekly-profit'||downloadBusy} onClick={()=>downloadWeekly(report.period)} aria-label={`${report.title} ${report.id==='weekly-profit'?'예시 엑셀 받기':'엑셀 연결 대기'}`}>{report.id==='weekly-profit'?(downloadBusy?'생성 중':'엑셀'):'준비 중'}</button></div></td>
            </tr>)}
            {!rows.length&&<tr><td colSpan={3} className={s.fileEmpty} role="status">이 차수의 파일이 없습니다.</td></tr>}
          </tbody></table>
        </>}
      </>}
    </div>
  </main>;
}
