import { useMemo, useState } from 'react';
import { buildFreightPreview, FREIGHT_ROUNDING } from '../../lib/estimateFreightPolicy';

const fmt = value => Number(value || 0).toLocaleString('ko-KR');

export default function FreightChargePreviewModal({ open, onClose, items = [], selectedShip }) {
  const [rounding, setRounding] = useState(FREIGHT_ROUNDING.CEIL);
  const [aggregate, setAggregate] = useState(true);
  const [loadingUnitPrice, setLoadingUnitPrice] = useState(2000);
  const [transportUnitPrice, setTransportUnitPrice] = useState(1500);
  const preview = useMemo(() => buildFreightPreview(items, {
    rounding, aggregate, loadingUnitPrice, transportUnitPrice,
  }), [items, rounding, aggregate, loadingUnitPrice, transportUnitPrice]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" style={{ position:'fixed', inset:0, zIndex:1400, background:'rgba(15,23,42,.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ width:'min(900px,100%)', maxHeight:'90vh', overflow:'auto', background:'#fff', borderRadius:12, boxShadow:'0 16px 48px rgba(15,23,42,.25)' }}>
        <div style={{ padding:'14px 18px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ flex:1 }}><b style={{ fontSize:17 }}>🚚 운임비 계산 미리보기</b><div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>{selectedShip?.CustName || '선택 업체'} · {selectedShip?.ParentWeek || ''}차</div></div>
          <button type="button" className="btn btn-sm" onClick={onClose}>닫기</button>
        </div>
        <div style={{ padding:18, display:'grid', gap:12 }}>
          <div style={{ padding:10, background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, fontSize:12, color:'#1e3a8a' }}>
            현재는 읽기 전용 미리보기입니다. 기존 `운송료`·`현지상차운임` 행을 먼저 보여 중복 입력을 막고, 주문·출고·재고·견적 원장은 변경하지 않습니다.
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:8 }}>
            <label style={{ fontSize:12 }}>단 처리<select value={rounding} onChange={e=>setRounding(e.target.value)} style={{ width:'100%', marginTop:4 }}><option value={FREIGHT_ROUNDING.CEIL}>반올림/올림 (4.5→5)</option><option value={FREIGHT_ROUNDING.FLOOR}>단 잔량 버림 (4.5→4)</option><option value={FREIGHT_ROUNDING.EXACT}>실수량 유지 (4.5)</option></select></label>
            <label style={{ fontSize:12 }}>차수 처리<select value={aggregate ? 'aggregate' : 'separate'} onChange={e=>setAggregate(e.target.value === 'aggregate')} style={{ width:'100%', marginTop:4 }}><option value="aggregate">1·2차 합산</option><option value="separate">세부차수별 분리</option></select></label>
            <label style={{ fontSize:12 }}>상차운임/박스<input type="number" min="0" value={loadingUnitPrice} onChange={e=>setLoadingUnitPrice(Number(e.target.value))} style={{ width:'100%', marginTop:4 }} /></label>
            <label style={{ fontSize:12 }}>운송료/박스<input type="number" min="0" value={transportUnitPrice} onChange={e=>setTransportUnitPrice(Number(e.target.value))} style={{ width:'100%', marginTop:4 }} /></label>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', fontSize:13 }}><span style={{ padding:'4px 8px', background:'#f1f5f9', borderRadius:12 }}>원시 박스환산 {fmt(preview.totalRawBoxes)}박스</span><span style={{ padding:'4px 8px', background:'#dcfce7', borderRadius:12 }}>적용 박스 {fmt(preview.totalBoxes)}박스</span><span style={{ padding:'4px 8px', background:'#fef3c7', borderRadius:12 }}>상차운임 {fmt(preview.totalLoadingAmount)}원</span><span style={{ padding:'4px 8px', background:'#fef3c7', borderRadius:12 }}>운송료 {fmt(preview.totalTransportAmount)}원</span></div>
          {preview.existing.length > 0 && <div style={{ padding:10, border:'1px solid #fbbf24', background:'#fffbeb', borderRadius:8, fontSize:12 }}><b>기존 운임 행 {preview.existing.length}건</b><div style={{ marginTop:5, display:'grid', gap:3 }}>{preview.existing.map((row, i) => <div key={`${row.name}-${i}`}>이미 입력됨 · {row.name} · {row.week || '합산'} · {fmt(row.quantity)}박스 × {fmt(row.unitPrice)}원</div>)}</div></div>}
          <table className="tbl" style={{ fontSize:12 }}><thead><tr><th>적용 범위</th><th>원시 박스</th><th>적용 박스</th><th>상차운임</th><th>운송료</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.key}><td>{row.key}</td><td>{fmt(row.rawBoxes)}</td><td>{fmt(row.boxes)}</td><td>{fmt(row.loadingAmount)}원</td><td>{fmt(row.transportAmount)}원</td></tr>)}{preview.rows.length===0&&<tr><td colSpan="5">계산 가능한 정상 출고 품목이 없습니다.</td></tr>}</tbody></table>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}><button type="button" className="btn btn-sm" onClick={onClose}>확인</button><button type="button" className="btn btn-sm" disabled title="기존 운임행과 ERP 저장 계약 검토 후 제공 예정">견적에 적용 (검토 중)</button></div>
        </div>
      </div>
    </div>
  );
}

