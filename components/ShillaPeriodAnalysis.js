import { useState } from 'react';
const fmt=v=>v==null?'미확인':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:3});
export default function ShillaPeriodAnalysis({data}) {
  const [search,setSearch]=useState('');
  const visible=data.lines.filter(r=>`${r.period} ${r.name} ${r.prodKey||''}`.includes(search.trim()));
  return <section aria-label="전산 출고·손익·입고 기간 대조">
    <h2>실제 전산 분배 ↔ 엑셀 손익 ↔ 신라 입고</h2>
    <p>전산 신라호텔 분배 원장 {data.distributionCount}행을 읽었습니다. 출고 차수, 엑셀 집계기간, 신라 입고일을 각각 유지합니다. 원본 날짜 전후 {data.lookaroundDays}일에서 같은 품목·단위의 일별 및 월~금 수치 일치를 탐색합니다.</p>
    <p>{data.warning} 전산 금액은 저장된 공급가액이며, 단가는 공급가액 ÷ 견적수량입니다. 미확정 분배도 상태를 표시합니다.</p>
    <p>판매요청 원장 {data.salesRequestCount||0}행을 함께 확인했습니다. 정상 추가분은 같은 전산 대차수의 판매요청을 포함해 수량·단가·금액이 맞는 경우입니다. 판매요청일과 신라 입고일은 각각 표시하며, 창고 분배값은 변경하지 않습니다.</p>
    <details open><summary>월별 신라 입고 공급가액 · 세금계산서 귀속 기준</summary>
      <p>{data.rule}. 실제 발행된 세금계산서와 일치 검증한 금액은 아닙니다.</p>
      <div className="wide"><table><thead><tr><th>귀속월</th><th>입고 원본행</th><th>공급가액</th><th>조회 범위</th></tr></thead>
      <tbody>{data.months.map(m=><tr key={m.month}><th>{m.month}</th><td>{m.count}</td><td>{fmt(m.amount)}원</td><td>{m.partial?'부분월 — 월 전체 조회 필요':'월 전체 조회'}</td></tr>)}</tbody></table></div>
    </details>
    <details open><summary>차수·일별·월~금 집계 자동 판정 후보 ({data.lines.length}개)</summary>
      <label>전산 대조 검색 <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="품목명 또는 차수"/></label>
      <div className="wide"><table><thead><tr><th>엑셀 차수 / 품목</th><th>실제 전산 분배 후보</th><th>엑셀 손익</th><th>신라 입고 일치 후보</th><th>판정 / 전산−엑셀</th></tr></thead>
      <tbody>{visible.map(r=><tr key={r.key}>
        <th>{r.period}차 · {r.name}<br/>#{r.prodKey||'미연결'} [{r.unit||'단위 미확인'}]<br/>원본 날짜 {r.anchor||'없음'}</th>
        <td>{r.erp?<><b>{r.erp.week}차</b><br/>{fmt(r.erp.qty)} [{r.unit}]<br/>{fmt(r.erp.amount)}원
          <details><summary>출고 원본 {r.erp.rows.length}행</summary>{r.erp.rows.map(e=><p key={e.id}>#{e.id} · 기준출고일 {e.date}<br/>분배 {fmt(e.outQty)} [{e.outUnit}] · 견적 {fmt(e.qty)} [{e.unit}]<br/>공급단가 {fmt(e.price)} · 공급가액 {fmt(e.amount)}<br/>확정: 상위 {e.masterFixed?'예':'아니오'} / 상세 {e.detailFixed?'예':'아니오'}{e.dates.map(d=><span key={d.id}><br/>일자 지정 {d.date}: 출고 {fmt(d.qty)} / 견적 {fmt(d.estimateQty)}</span>)}</p>)}</details></>:'하나로 판단할 수 없음'}
          <details><summary>가능한 전산 차수 {r.candidates.length}개</summary>{r.candidates.map(c=><p key={c.week}>{c.week} · {fmt(c.qty)} · {fmt(c.amount)}원</p>)}</details></td>
        <td>{fmt(r.excel.qty)} [{r.unit}]<br/>{fmt(r.excel.amount)}원<br/>단가 {r.excel.buckets?.map(b=>fmt(b[0])).join(' / ')||'미확인'}</td>
        <td>{r.receipt?<>{r.receipt.label}<br/>{fmt(r.receipt.qty)} [{r.unit}]<br/>{fmt(r.receipt.amount)}원
          <details><summary>입고 원본 {r.receipt.rows.length}행</summary>{r.receipt.rows.map((s,i)=><p key={i}>{s.date} · {s.receiptNo}/{s.receiptItem}<br/>{fmt(s.qty)} × {fmt(s.price)} = {fmt(s.amount)}</p>)}</details></>:r.receiptCandidateCount?`같은 수치의 기간 ${r.receiptCandidateCount}개 — 확인 필요`:'일치하는 기간 미확인'}</td>
        <td><b>{r.status}</b><br/>분배 원본 차이: 수량 {fmt(r.qtyDifference)} / 금액 {fmt(r.amountDifference)}
          {r.sales&&<><p>판매요청 +{fmt(r.sales.qty)} [{r.unit}] / {fmt(r.sales.amount)}원<br/>
            포함 합계 {fmt(r.combined.qty)} / {fmt(r.combined.amount)}원<br/>
            포함 후 차이: 수량 {fmt(r.combined.qty==null?null:r.combined.qty-r.excel.qty)} / 금액 {fmt(r.combined.amount==null?null:r.combined.amount-r.excel.amount)}</p>
            <details><summary>판매요청 근거 {r.sales.rows.length}행</summary>{r.sales.rows.map(s=><p key={s.id}>견적 #{s.id} · {s.week}차<br/>판매요청일 {s.date||'미확인'}<br/>{fmt(s.qty)} [{s.unit}] × 공급단가 {fmt(s.price)} = {fmt(s.amount)}원<br/>상위 확정 {s.masterFixed?'예':'아니오'}</p>)}</details></>}
        </td>
      </tr>)}</tbody></table></div>
    </details>
    <style jsx>{`.wide{overflow-x:auto}table{width:100%;min-width:950px;border-collapse:collapse}th,td{padding:12px;border:1px solid #dce4e9;text-align:left;vertical-align:top;line-height:1.6}thead{background:#edf3f6}details{margin:14px 0}summary{cursor:pointer;font-weight:600}p{line-height:1.6}`}</style>
  </section>;
}
