export default function DistributionDateFilter({value,onChange,dates,loading,error,label}){
 return <div style={{padding:'6px 5px',borderBottom:'1px solid var(--border)',fontSize:12}}>
  <label>{label} 출고일 <select aria-label={`${label} 출고일 분류`} value={value} disabled={loading||!!error} onChange={e=>onChange(e.target.value)}>
   <option value="">전체 출고일</option><option value="undated">미지정·미분배</option>{dates.map(date=><option key={date} value={date}>{date}</option>)}
  </select></label>
  <div style={{fontSize:11,color:'var(--text3)',marginTop:3}}>저장된 날짜로 분류 · 수량은 차수 합계 · 날짜별 수량은 행의 출고일 분배·수정</div>
  {loading&&<span role="status">출고일 조회 중…</span>}{error&&<span role="alert" style={{color:'var(--red)'}}>출고일 조회 실패: {error}</span>}
 </div>;
}
