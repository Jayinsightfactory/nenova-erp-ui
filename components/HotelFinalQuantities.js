import HotelQuantityInput from './HotelQuantityInput';
import {hotelQuantityLabel,hotelAdjustmentLabel} from '../lib/hotelOrderEdits';
const fmt=n=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:6});
export default function HotelFinalQuantities({rows,blocked,onEdit,onOmit,onReset,onSave,history=[]}) {
 const quantity=(row,value)=>hotelQuantityLabel(value,row.unit,row.product,row.displayUnit);
 return <section className="final-quantities" aria-label="최종 주문수량 조절">
  <header><h3>최종 주문수량 · 품목 누락</h3><button data-tone="save" disabled={blocked||!rows.length} onClick={onSave}>작업 저장</button></header>
  <p>수량을 조절한 뒤 업체 분류를 확인하세요. 누락은 화면에 남고 주문에서 제외됩니다. 특수매칭은 합산용입니다.</p>
  <div className="scroll"><table><colgroup><col className="name"/><col className="final"/><col className="sum"/><col className="sum"/><col className="action"/></colgroup>
   <thead><tr><th>품목 / 주문단위</th><th>최종 요청수량 · 올림/반올림/내림</th><th>원본 요청 합계</th><th>발주 합계</th><th>처리</th></tr></thead>
   <tbody>{rows.map(r=><tr key={r.key} className={r.excluded?'excluded':''}>
    <td className="name-cell">{r.name} ({r.unit}){r.special&&<small>특수매칭 · 합산 전용</small>}{!r.special&&!r.key.startsWith('p:')&&<small>DB 품목 매칭 필요</small>}</td>
    <td>{r.excluded?'0 · 누락':r.registration&&!r.error?<><div className="quantity-line"><HotelQuantityInput inlineRounding value={r.finalQty} disabled={blocked} label={`${r.name} 최종 요청수량`} onCommit={(v,meta)=>onEdit(r,v,meta)}/><span>{quantity(r,r.finalQty)}</span>{r.adjusted&&<span className="adjustment" title={r.adjustment?`${fmt(r.adjustment.before)} → ${fmt(r.finalQty)} ${r.unit}`:undefined}>{hotelAdjustmentLabel(r.adjustment?.method)}</span>}</div></>:quantity(r,r.sourceQty)}</td>
    <td>{quantity(r,r.sourceQty)}</td><td>{r.excluded?'0 · 누락':quantity(r,r.purchase)}</td>
    <td><button data-tone={r.excluded?'load':'danger'} disabled={blocked} aria-pressed={r.excluded} onClick={()=>onOmit(r.key,!r.excluded)}>{r.excluded?'복원':'누락'}</button>{r.adjusted&&!r.excluded&&<button disabled={blocked} onClick={()=>onReset(r)}>원본 복원</button>}</td>
   </tr>)}</tbody>
  </table></div>
  {history.length>0&&<details><summary>수량 조절 히스토리 · {history.length}건</summary><p>작업 당시 기록입니다. 현재 수량은 위 표에서 확인하세요.</p><div className="scroll"><table className="history"><thead><tr><th>시각</th><th>품목</th><th>조절</th><th>변경 전 → 후</th></tr></thead><tbody>{[...history].reverse().map((h,i)=><tr key={`${h.time}-${i}`}><td>{new Date(h.time).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</td><td>{h.name}</td><td>{hotelAdjustmentLabel(h.method)}</td><td>{fmt(h.before)} → {fmt(h.after)} {h.unit}</td></tr>)}</tbody></table></div></details>}
  <style jsx>{`
   .final-quantities{margin:8px 0;min-width:0}header{display:flex;align-items:center;gap:12px}h3{margin:0}p{margin:3px 0 5px;font-size:13px;color:#52637b}.scroll{overflow-x:auto}table{width:1250px;table-layout:fixed;border-collapse:collapse;margin:0}col.name{width:280px}col.final{width:470px}col.sum{width:180px}col.action{width:140px}th,td{padding:3px 5px;border-bottom:1px solid #dfe5ed;text-align:left;vertical-align:middle}th{background:#edf3fa}.name-cell{overflow-wrap:anywhere}.quantity-line{display:flex;align-items:center;gap:6px;white-space:nowrap}.quantity-line>span{font-size:13px}.excluded{color:#687789;background:#f0f2f5}small{display:block}.final-quantities button{margin:0 2px 0 0!important;min-height:26px!important;padding:2px 6px!important}.adjustment{display:inline;font-size:12px;color:#195e56}.adjustment button{min-height:22px!important;padding:0 4px!important}details{margin-top:6px}summary{cursor:pointer;font-weight:600}.history{width:950px;table-layout:auto}
  `}</style>
 </section>;
}
