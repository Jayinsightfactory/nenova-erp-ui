import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import MobileShell from '../../components/m/MobileShell';
import { isAdminUser } from '../../lib/userAccess';
import { verifyReqUser } from '../../lib/auth';
import { groupExecutiveVolumeByCountry } from '../../lib/executiveVolumeReport';
import styles from '../../styles/executive-volume.module.css';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const user = verifyReqUser(req);
  if (!user) return { redirect: { destination: '/m/login?next=/m/executive-volume', permanent: false } };
  if (!isAdminUser(user)) return { notFound: true };
  return { props: { user: { userId: user.userId || '', userName: user.userName || '' } } };
}

const number = value => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(Number(value) || 0);
const quantity = (value, unit) => `${number(value)} ${unit}`;
const pct = value => value == null ? '비교자료 없음' : `${value > 0 ? '+' : ''}${number(value)}%`;
const escapeXml = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');

function Change({ data }) {
  const tone = data?.delta == null ? '' : data.delta > 0 ? styles.up : data.delta < 0 ? styles.down : styles.same;
  return <span className={tone}>{data?.state === 'new' ? `신규 +${number(data.delta)}` : data?.delta == null ? '비교자료 없음' : `${data.delta > 0 ? '+' : ''}${number(data.delta)} (${pct(data.ratePct)})`}</span>;
}

export default function ExecutiveVolumePage({ user }) {
  const [report, setReport] = useState(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const load = useCallback(async value => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/m/executive-volume${value ? `?${value}` : ''}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '보고서 조회에 실패했습니다.');
      setReport(data);
      setSelected(`${data.selected.year}|${data.selected.week}`);
    } catch (cause) { setError(cause.message || '보고서 조회에 실패했습니다.'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { load(''); }, [load]);
  const rows = report?.rows || [];
  const countries = useMemo(() => groupExecutiveVolumeByCountry(rows), [rows]);
  const topRows = useMemo(() => rows.slice().sort((a, b) => b.ordered - a.ordered).slice(0, 12), [rows]);
  const graphsByUnit = useMemo(() => (report?.unitTotals || []).map(total => ({
    unit: total.unit,
    rows: rows.filter(row => row.unit === total.unit).sort((a,b) => b.ordered-a.ordered).slice(0, 12),
  })), [report, rows]);

  async function downloadWorkbook() {
    if (!report || exportBusy) return;
    setExportBusy(true); setError('');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'NENOVA'; workbook.subject = '차수별 국가·품종 물량 보고서';
      const sheet = workbook.addWorksheet('물량현황', { views: [{ state: 'frozen', ySplit: 4 }] });
      sheet.mergeCells('A1:N1'); sheet.getCell('A1').value = `${report.selected.year}년 ${report.selected.week} 차수 국가·품종 물량 보고서`;
      sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF153B70' } };
      sheet.mergeCells('A2:N2'); sheet.getCell('A2').value = `입고 비교: 직전 ${report.previousCycle ? `${report.previousCycle.year}-${report.previousCycle.week}` : '자료 없음'} / 전년동차 ${report.previousYearCycle ? `${report.previousYearCycle.year}-${report.previousYearCycle.week}` : '자료 없음'} · 출고는 master/detail 확정분만`;
      sheet.getCell('A2').font = { size: 10, color: { argb: 'FF52657A' } };
      sheet.addRow([]);
      const headers = ['국가','품종','단위','주문량','실입고','미입고 현황','미입고 비율','초과입고','실출고','입고 증감(직전)','입고 증감(전년동차)','출고 증감(직전)','출고 증감(전년동차)','기준'];
      sheet.addRow(headers);
      const changeText = data => data.delta == null ? '비교자료 없음' : `${data.delta > 0 ? '+' : ''}${number(data.delta)}${data.ratePct == null ? (data.state === 'new' ? ' (신규)' : '') : ` (${number(data.ratePct)}%)`}`;
      rows.forEach(row => sheet.addRow([row.country,row.flower,row.unit,row.ordered,row.inbound,row.missingQty,row.missingPct == null ? '계산 불가' : row.missingPct/100,row.overInboundQty,row.outbound,changeText(row.inboundVsPrevious),changeText(row.inboundVsPreviousYear),changeText(row.outboundVsPrevious),changeText(row.outboundVsPreviousYear),'단위: Product.OutUnit']));
      const head = sheet.getRow(4); head.height = 32; head.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF225D93' } }; cell.alignment = { vertical: 'middle', wrapText: true }; });
      sheet.autoFilter = { from: 'A4', to: `N${Math.max(4, sheet.rowCount)}` };
      sheet.columns = [{width:16},{width:26},{width:12},{width:14},{width:14},{width:14},{width:13},{width:14},{width:14},{width:24},{width:24},{width:24},{width:24},{width:24}];
      for (let rowIndex=5; rowIndex<=sheet.rowCount; rowIndex++) {
        const row = sheet.getRow(rowIndex); row.alignment = { vertical:'middle' };
        for (const col of [4,5,6,8,9]) row.getCell(col).numFmt = '#,##0.##';
        row.getCell(7).numFmt = '0.0%';
      }
      const chart = workbook.addWorksheet('그래프');
      chart.mergeCells('A1:F1'); chart.getCell('A1').value = '국가·품종별 주문 / 입고 / 확정 출고'; chart.getCell('A1').font = { bold:true, size:15 };
      chart.addRow(['국가 · 품종 · 단위','주문량','실입고','실출고']);
      topRows.forEach(row => chart.addRow([`${row.country} · ${row.flower} (${row.unit})`,row.ordered,row.inbound,row.outbound]));
      chart.columns = [{width:42},{width:16},{width:16},{width:16}];
      let graphY = 28;
      const graphContent = graphsByUnit.map(group => {
        const peak = Math.max(1, ...group.rows.flatMap(row => [row.ordered,row.inbound,row.outbound]));
        const heading = `<text x="8" y="${graphY+15}" font-size="15" font-weight="bold" font-family="sans-serif">${escapeXml(group.unit)} 기준 (동일 단위끼리 비교)</text>`;
        graphY += 25;
        const groupContent = group.rows.map(row => {
          const y=graphY; graphY += 39;
          const vals=[['주문',row.ordered,'#2563eb'],['입고',row.inbound,'#059669'],['출고',row.outbound,'#f59e0b']];
          return `<text x="8" y="${y+12}" font-size="12" font-family="sans-serif">${escapeXml(`${row.country} · ${row.flower}`)}</text>${vals.map(([label,value,color],j)=>{const width=Math.max(value?2:0,Math.round(value/peak*760));return `<rect x="290" y="${y+j*10}" width="${width}" height="7" fill="${color}"/><text x="${298+width}" y="${y+7+j*10}" font-size="9" fill="#334155">${label} ${number(value)} ${escapeXml(row.unit)}</text>`;}).join('')}`;
        }).join('');
        graphY += 8;
        return heading + groupContent;
      }).join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${Math.max(220,graphY+15)}"><rect width="100%" height="100%" fill="#fff"/>${graphContent}</svg>`;
      const image = new Image();
      const svgUrl = URL.createObjectURL(new Blob([svg], { type:'image/svg+xml;charset=utf-8' }));
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=svgUrl;});
      const canvas=document.createElement('canvas'); canvas.width=image.naturalWidth; canvas.height=image.naturalHeight;
      canvas.getContext('2d').drawImage(image,0,0); URL.revokeObjectURL(svgUrl);
      const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if (!png) throw new Error('그래프 이미지 생성에 실패했습니다.');
      const imageId=workbook.addImage({buffer:await png.arrayBuffer(),extension:'png'});
      chart.addImage(imageId,{tl:{col:0,row:rows.length+4},ext:{width:900,height:Math.max(220,graphY*1.15)}});
      const bytes=await workbook.xlsx.writeBuffer();
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const link=document.createElement('a'); link.href=url; link.download=`차수별_국가품종물량_${report.selected.year}_${report.selected.week}.xlsx`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000);
    } catch (cause) { setError(cause.message || '엑셀 생성에 실패했습니다.'); }
    finally { setExportBusy(false); }
  }

  return <MobileShell title="국가별 물량 보고서" user={user}>
    <Head><title>NENOVA | 국가별 물량 보고서</title><meta name="robots" content="noindex,nofollow"/><meta name="viewport" content="width=device-width, initial-scale=1"/></Head>
    <main className={styles.page}>
      <header className={styles.heading}><div><h1>차수별 물량 흐름</h1><p>주문 · 실입고 · 미입고 · 확정 출고를 품종 단위로 비교합니다.</p></div><button disabled={!report||exportBusy} onClick={downloadWorkbook}>{exportBusy?'엑셀 생성 중…':'엑셀 + 그래프 받기'}</button></header>
      <section className={styles.filters}><label>차수<select value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value);const [year,week]=event.target.value.split('|');load(`year=${year}&week=${week}`);}}>{(report?.cycles||[]).map(cycle=><option key={`${cycle.year}|${cycle.week}`} value={`${cycle.year}|${cycle.week}`}>{cycle.year}년 {cycle.week}</option>)}</select></label><button onClick={()=>load(selected?`year=${selected.split('|')[0]}&week=${selected.split('|')[1]}`:'') } disabled={busy}>{busy?'조회 중…':'최신화'}</button><span>갱신 {report?.generatedAt?new Date(report.generatedAt).toLocaleString('ko-KR'):''}</span></section>
      {error&&<p className={styles.error} role="alert">{error}</p>}
      {!report&&!error&&<p className={styles.empty} role="status">{busy?'보고서를 불러오는 중입니다.':'표시할 자료가 없습니다.'}</p>}
      {report&&<>
        <section className={styles.notes}><strong>비교 기준</strong><span>직전 등록 차수: {report.previousCycle?`${report.previousCycle.year}년 ${report.previousCycle.week}`:'없음'}</span><span>전년 동일 차수: {report.previousYearCycle?`${report.previousYearCycle.year}년 ${report.previousYearCycle.week}`:'없음'}</span><small>미입고 현황은 주문량 대비 입고량의 차이이며, 손실이나 폐기를 뜻하지 않습니다. 입고는 차수 귀속 합계 기준입니다. 출고는 출고 master와 상세가 모두 확정된 행만 포함합니다.</small></section>
        {report.unitTotals.map(total=><section className={styles.total} key={total.unit}><h2>단위별 합계 · {total.unit}</h2><div>주문 {quantity(total.ordered,total.unit)} <b>입고 {quantity(total.inbound,total.unit)}</b> <span>미입고 현황 {quantity(total.missing,total.unit)}</span> <strong>확정 출고 {quantity(total.outbound,total.unit)}</strong></div></section>)}
        <section className={styles.countryList} aria-label="국가별 물량 요약">
          <div className={styles.countryListHeading}><h2>국가별 물량</h2><span>국가를 누르면 품종별 상세를 볼 수 있습니다.</span></div>
          {countries.map(group => <details className={styles.countryCard} key={group.country}>
            <summary className={styles.countrySummary}>
              <span className={styles.countryName}>{group.country}<small>{group.rows.length}개 품종 단위</small></span>
              <span className={styles.countryTotals}>{group.unitTotals.map(total => <span key={total.unit} className={styles.countryUnit}>
                <b>{total.unit}</b><span>주문 {number(total.ordered)}</span><span>입고 {number(total.inbound)}</span><span>미입고 {number(total.missing)}</span><span>출고 {number(total.outbound)}</span>
              </span>)}</span>
              <span className={styles.expandHint}>품종 보기 <i aria-hidden="true">⌄</i></span>
            </summary>
            <div className={styles.varietyList}>
              {group.rows.map(row => <article className={styles.varietyCard} key={`${row.flower}|${row.unit}`}>
                <div className={styles.varietyHeading}><strong>{row.flower}</strong><span>{row.unit}</span></div>
                <div className={styles.varietyMetrics}>
                  <span>주문 <b>{number(row.ordered)} {row.unit}</b></span>
                  <span>실입고 <b>{number(row.inbound)} {row.unit}</b></span>
                  <span>미입고 현황 <b>{number(row.missingQty)} {row.unit}</b>{row.missingPct == null ? '' : ` · ${number(row.missingPct)}%`}</span>
                  <span>확정 출고 <b>{number(row.outbound)} {row.unit}</b></span>
                </div>
                <div className={styles.varietyChanges}>
                  <span>입고 · 직전 <Change data={row.inboundVsPrevious}/></span>
                  <span>입고 · 전년동차 <Change data={row.inboundVsPreviousYear}/></span>
                  <span>출고 · 직전 <Change data={row.outboundVsPrevious}/></span>
                  <span>출고 · 전년동차 <Change data={row.outboundVsPreviousYear}/></span>
                </div>
              </article>)}
            </div>
          </details>)}
          {!countries.length&&<p className={styles.empty}>선택 차수에 보고할 물량이 없습니다.</p>}
        </section>
        {graphsByUnit.some(group=>group.rows.length>0)&&<section className={styles.graph}><h2>주문 · 입고 · 확정 출고 상위 품종</h2><div className={styles.legend}><span>주문</span><span>입고</span><span>출고</span></div>{graphsByUnit.map(group=>{const peak=Math.max(1,...group.rows.flatMap(row=>[row.ordered,row.inbound,row.outbound]));return <div key={group.unit}><h3>{group.unit} 기준 · 같은 단위 안에서 비교</h3>{group.rows.map(row=><div className={styles.barRow} key={`${row.country}|${row.flower}|${row.unit}`}><div>{row.country} · {row.flower}<small>{group.unit}</small></div><div className={styles.bars}>{[['ordered','#2563eb'],['inbound','#059669'],['outbound','#f59e0b']].map(([key,color])=><div key={key} style={{width:`${Math.max(row[key]?0.5:0,row[key]/peak*100)}%`,backgroundColor:color}} title={`${key}: ${quantity(row[key],row.unit)}`}/>)}</div></div>)}</div>})}</section>}
      </>}
    </main>
  </MobileShell>;
}
