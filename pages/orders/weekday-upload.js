import { useState } from 'react';
import Link from 'next/link';
import JugwangWeekdayUpload from '../../components/JugwangWeekdayUpload.js';
import { getCurrentWeek } from '../../lib/useWeekInput.js';
export default function WeekdayUploadPage(){
  const [scope,setScope]=useState(getCurrentWeek());
  const [busy,setBusy]=useState(false);
  const match=String(scope).match(/^(\d{4})-(\d{2}-0[12])$/);
  return <main style={{padding:24}}><Link href="/orders/import">주문 업로드로 돌아가기</Link><h1>주광 엑셀 요일별 수량 업로드</h1>
    <label>연도·차수 <input disabled={busy} aria-label="연도·차수" value={scope} placeholder="2026-44-01" onChange={e=>setScope(e.target.value)}/></label>
    {match?<JugwangWeekdayUpload key={scope} year={match[1]} week={match[2]} onBusy={setBusy}/>:<p>2026-44-01 형식으로 입력하세요.</p>}
  </main>;
}
