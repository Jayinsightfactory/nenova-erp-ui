export default function InvoiceFarmChoices({farms,selected,onSelect,searching=false}){
 return <div role="group" aria-label="농장 검색 결과" onKeyDown={event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const buttons=[...event.currentTarget.querySelectorAll('button')],index=buttons.indexOf(event.target);if(index<0)return;
  event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowRight'?1:-1)))]?.focus();
 }}>{farms.slice(0,searching?50:8).map(farm=><button type="button" key={farm.FarmKey?`farm:${farm.FarmKey}`:`receipt:${farm.WarehouseKey}`}
  aria-pressed={farm.FarmKey?Number(selected?.farmKey)===Number(farm.FarmKey):selected?.reviewedMetadata?.farmSourceWarehouseKey===farm.WarehouseKey}
  onClick={()=>onSelect(farm)}>{farm.FarmName} · {farm.FarmKey?'농장 마스터':'기존 입고 농장'} · 사용 {farm.UsageCount??'미확인'}건 · 선택·변경</button>)}</div>;
}
