import {weeklyDemo} from '../../lib/mobileWeeklyDemo';
import s from './ExecutiveReports.module.css';
const won=n=>`${n.toLocaleString('ko-KR')}원`;
export default function WeeklyDemoReport({report,periods,onPeriodChange,onBack,onDownload,busy,headingRef}) {
  const previous=report.period==='2026-39'?weeklyDemo('2026-38'):null;
  return <section className={s.detail} data-weekly-demo>
    <button className={s.back} onClick={onBack}>← 보고서 목록</button>
    <p className={s.eyebrow}>SAMPLE WEEKLY REPORT</p>
    <h1 ref={headingRef} tabIndex={-1}>주차별 매출·이익보고서</h1>
    <aside className={s.notice}>예시 기능 체험 · 모든 금액은 가상 데이터입니다. 실제 원장과 연결되지 않습니다.</aside>
    <div className={s.period}><label htmlFor="weekly-demo-period">보고 차수</label><select id="weekly-demo-period" value={report.period} disabled={busy} onChange={e=>onPeriodChange(e.target.value)}>{periods.filter(p=>weeklyDemo(p.id)).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
    <div className={s.reportActions}><button onClick={onDownload} disabled={busy}>{busy?'엑셀 생성 중…':'↓ 예시 엑셀 받기'}</button><button onClick={()=>window.print()}>인쇄 / PDF 저장</button></div>
    <div className={s.detailSummary}><span>{report.period} · 이익 합계</span><strong>{won(report.profit)}</strong><small>{previous?`전차수 대비 ${report.profit-previous.profit>=0?'+':''}${won(report.profit-previous.profit)} (${((report.profit/previous.profit-1)*100).toFixed(1)}%)`:'비교할 전차수 예시 자료 없음'}</small></div>
    <h2>손익 요약</h2><dl className={s.breakdown}><div><dt>매출액</dt><dd>{won(report.revenue)}</dd></div><div><dt>매입 및 비용</dt><dd>{won(report.cost)}</dd></div><div><dt>이익</dt><dd>{won(report.profit)}</dd></div><div><dt>이익률</dt><dd>{(report.margin*100).toFixed(1)}%</dd></div></dl>
    <h2>구분별 실적</h2><div className={s.demoItems}>{report.items.map(item=><details key={item.name} className={s.demoItem}><summary><strong>{item.name}</strong><span>이익 {won(item.profit)}</span></summary><dl className={s.breakdown}><div><dt>매출액</dt><dd>{won(item.revenue)}</dd></div><div><dt>매입 및 비용</dt><dd>{won(item.cost)}</dd></div><div><dt>이익률</dt><dd>{(item.margin*100).toFixed(1)}%</dd></div></dl></details>)}</div>
    <p className={s.releaseNote}>항목을 누르면 세부 금액이 펼쳐집니다. 엑셀에는 모든 항목과 합계 수식이 포함됩니다. 인쇄 창에서 PDF로 저장할 수 있습니다.</p>
    <table className={s.printItems}><thead><tr><th>구분</th><th>매출액</th><th>매입 및 비용</th><th>이익</th><th>이익률</th></tr></thead><tbody>{report.items.map(item=><tr key={item.name}><th>{item.name}</th><td>{won(item.revenue)}</td><td>{won(item.cost)}</td><td>{won(item.profit)}</td><td>{(item.margin*100).toFixed(1)}%</td></tr>)}</tbody></table>
  </section>;
}
