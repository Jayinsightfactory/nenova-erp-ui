import { useState } from 'react';
import { shillaReviewStatus } from '../lib/shillaCheck';
const fmt=v=>v==null?'미확인':Number(v).toLocaleString('ko-KR');
export default function ShillaCheckSummary({result,from,to}) {
  const [filter,setFilter]=useState('추가 확인');
  const known=result.knownReviews||[];
  const lines=(result.periodAnalysis?.lines||[]).map(r=>({...r,review:shillaReviewStatus(r,known)}));
  const statuses=['수정 필요','수정 대기','추가 확인','판매요청 정상','일치 후보','확인 기준 일치'];
  const visible=lines.filter(r=>filter==='전체'||r.review===filter);
  function download() {
    const blob=new Blob([JSON.stringify({from,to,...result},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`신라-입고대조-${from}-${to}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section aria-label="작업 확인 요약">
    <h2>이번 작업 확인사항</h2>
    <p>{result.sourceMode==='stored'?'저장손익 기준 · 원본 엑셀 미첨부':'원본 엑셀 · 저장손익 · 실제 전산 분배 · 신라 입고 대조'}<br/>
      {from} ~ {to} · 입고 {result.counts.srm}행 · 자동 수치 일치와 실제 오류를 구분합니다.</p>
    <button onClick={download}>근거 포함 결과 내려받기</button>
    <p>결과와 첨부파일은 현재 탭에만 유지됩니다. 다시 작업을 시작하면 최신 자료를 조회합니다.</p>
    {!!result.unmatched?.length&&<p role="status">신라 미연결 {result.unmatched.length}개: {result.unmatched.map(r=>`${r.name} [${r.unit}]`).join(', ')}. 아래 품목 연결에서 확인하세요.</p>}
    {!![...result.issues,...result.sourceWarnings].length&&<details><summary>원본·조회 확인 사항</summary><ul>{[...result.issues,...result.sourceWarnings].map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
    {known.map(k=><article key={k.id}><strong>{k.status} · {k.period}차 {k.name}</strong><p>{k.note}</p>
      <p>저장손익 {fmt(k.savedQty)} / 신라 조회 {fmt(k.receiptQty)} / 확인 기준 {fmt(k.expected)}<br/>
      {k.from} ~ {k.to} · 금액 차이 {fmt(k.amountDifference)}원{!k.covered?' · 해당 입고기간 전체 조회 필요':''}</p>
      <details><summary>입고 근거 {k.sources.length}행</summary>{k.sources.map((s,i)=><p key={i}>{s}</p>)}</details></article>)}
    <div className="filters">{[...statuses,'전체'].map(s=><button key={s} aria-pressed={filter===s} onClick={()=>setFilter(s)}>{s} {s==='전체'?lines.length:lines.filter(r=>r.review===s).length}</button>)}</div>
    <p>추가 확인에는 미연결·단위 미확인·차수/기간 후보 중복·차감 확인이 포함됩니다. 금액 차이만으로 실제 오류라고 판정하지 않습니다.</p>
    <div className="wide"><table><thead><tr><th>차수 / 품목</th><th>구분</th><th>비교 기준</th><th>전산 분배 후보</th><th>입고 후보 / 근거</th></tr></thead><tbody>{visible.map(r=><tr key={r.key}>
      <th>{r.period}차 · {r.name}<br/>#{r.prodKey||'미연결'} [{r.unit}]</th><td>{r.review}<br/>{r.status}</td>
      <td>{fmt(r.excel.qty)} / {fmt(r.excel.amount)}원</td><td>{r.erp?.week||'미확인'}<br/>{fmt(r.erp?.qty)} / {fmt(r.erp?.amount)}원</td>
      <td>{r.receipt?.label||'기간·단위 확인 필요'}<br/>{fmt(r.receipt?.qty)} / {fmt(r.receipt?.amount)}원{r.salesExplained&&<p>판매요청 +{fmt(r.sales.qty)} 포함 일치</p>}</td>
    </tr>)}</tbody></table></div>{!visible.length&&<p>해당 항목이 없습니다.</p>}
    <style jsx>{`article{border:1px solid #cbd5e1;border-left:4px solid #d97706;border-radius:6px;padding:14px;margin:12px 0}article p{margin:6px 0}.filters{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}button{font:inherit;padding:9px 12px;border:1px solid #94a3b8;border-radius:6px;background:white;cursor:pointer}button[aria-pressed=true]{background:#115e59;color:white}:focus-visible{outline:3px solid #2563eb;outline-offset:2px}.wide{overflow-x:auto}table{border-collapse:collapse;width:auto;min-width:900px}th,td{width:220px;max-width:320px;overflow-wrap:anywhere;border:1px solid #dce4e9;padding:10px;text-align:left;vertical-align:top}thead{background:#edf3f6}p{line-height:1.6}`}</style>
  </section>;
}
