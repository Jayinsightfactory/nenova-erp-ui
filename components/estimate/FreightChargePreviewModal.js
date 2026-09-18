import { useEffect, useMemo, useState } from 'react';
import { buildFreightPreview, freightKind, isFreightRow, FREIGHT_ROUNDING } from '../../lib/estimateFreightPolicy';

const fmt = value => Number(value || 0).toLocaleString('ko-KR');

export default function FreightChargePreviewModal({ open, onClose, items = [], selectedShip, onApply, applyBusy = false }) {
  const [rounding, setRounding] = useState(FREIGHT_ROUNDING.CEIL);
  // 세부차수별 분리가 안전한 기본값이다. 37차 인터넷공판장처럼 1차/2차
  // 운임이 별도 ShipmentDetail 행으로 존재하는 업체가 있기 때문이다.
  const [aggregate, setAggregate] = useState(false);
  const [loadingUnitPrice, setLoadingUnitPrice] = useState(2000);
  const [transportUnitPrice, setTransportUnitPrice] = useState(1500);
  const existingRates = useMemo(() => {
    const rows = items.filter(isFreightRow);
    const latest = kind => rows
      .filter(row => freightKind(row) === kind && Number(row.Cost) > 0)
      .sort((a, b) => String(b.OrderWeek || b.week || '').localeCompare(String(a.OrderWeek || a.week || '')))[0];
    return {
      loading: Number(latest('LOADING')?.Cost || 0),
      transport: Number(latest('TRANSPORT')?.Cost || 0),
    };
  }, [items]);

  useEffect(() => {
    if (!open) return;
    if (existingRates.loading > 0) setLoadingUnitPrice(existingRates.loading);
    if (existingRates.transport > 0) setTransportUnitPrice(existingRates.transport);
    setAggregate(false);
  }, [open, existingRates.loading, existingRates.transport]);
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
            현재는 안전한 읽기 전용 미리보기입니다. 기존 `운송료`·`현지상차운임` 행과 단가를 우선 표시하고, 세부차수별로 중복 여부를 점검합니다. 주문·출고·재고·견적 원장은 변경하지 않습니다.
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:8 }}>
            <label style={{ fontSize:12 }}>단 잔량 처리<select value={rounding} onChange={e=>setRounding(e.target.value)} style={{ width:'100%', marginTop:4 }}><option value={FREIGHT_ROUNDING.CEIL}>올림 (4.5→5)</option><option value={FREIGHT_ROUNDING.FLOOR}>버림 (4.5→4)</option><option value={FREIGHT_ROUNDING.EXACT}>실수량 유지 (4.5)</option></select></label>
            <label style={{ fontSize:12 }}>세부차수 처리<select value={aggregate ? 'aggregate' : 'separate'} onChange={e=>setAggregate(e.target.value === 'aggregate')} style={{ width:'100%', marginTop:4 }}><option value="separate">세부차수별 분리 (기본)</option><option value="aggregate">1·2차 합산 (사용자 선택)</option></select></label>
            <label style={{ fontSize:12 }}>상차운임/박스<input type="number" min="0" value={loadingUnitPrice} onChange={e=>setLoadingUnitPrice(Number(e.target.value))} style={{ width:'100%', marginTop:4 }} /></label>
            <label style={{ fontSize:12 }}>운송료/박스<input type="number" min="0" value={transportUnitPrice} onChange={e=>setTransportUnitPrice(Number(e.target.value))} style={{ width:'100%', marginTop:4 }} /></label>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', fontSize:13 }}><span style={{ padding:'4px 8px', background:'#f1f5f9', borderRadius:12 }}>원시 박스환산 {fmt(preview.totalRawBoxes)}박스</span><span style={{ padding:'4px 8px', background:'#dcfce7', borderRadius:12 }}>적용 박스 {fmt(preview.totalBoxes)}박스</span><span style={{ padding:'4px 8px', background:'#fef3c7', borderRadius:12 }}>상차운임 {fmt(preview.totalLoadingAmount)}원</span><span style={{ padding:'4px 8px', background:'#fef3c7', borderRadius:12 }}>운송료 {fmt(preview.totalTransportAmount)}원</span></div>
          {preview.existing.length > 0 && <div style={{ padding:10, border:'1px solid #fbbf24', background:'#fffbeb', borderRadius:8, fontSize:12 }}><b>기존 운임 행 {preview.existing.length}건 · 신규 계산에서 중복 제외</b><div style={{ marginTop:5, display:'grid', gap:3 }}>{preview.existing.map((row, i) => <div key={`${row.name}-${i}`}>이미 입력됨 · {row.name} · {row.week || '합산'} · {fmt(row.quantity)}박스 × {fmt(row.unitPrice)}원</div>)}</div></div>}
          <table className="tbl" style={{ fontSize:12 }}><thead><tr><th>적용 범위</th><th>품종/국가</th><th>원시 박스</th><th>적용 박스</th><th>상차운임</th><th>운송료</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.key}><td>{row.key}</td><td>{row.categories.map(category => `${category.category} ${fmt(category.boxes)}박스`).join(' · ') || '-'}</td><td>{fmt(row.rawBoxes)}</td><td>{fmt(row.boxes)}</td><td>{fmt(row.loadingAmount)}원</td><td>{fmt(row.transportAmount)}원</td></tr>)}{preview.rows.length===0&&<tr><td colSpan="6">계산 가능한 정상 출고 품목이 없습니다.</td></tr>}</tbody></table>
          <div style={{ padding:10, border:'1px solid #cbd5e1', background:'#f8fafc', borderRadius:8, fontSize:12, color:'#475569' }}>
            적용 시 세부차수별 기존 출고마스터·확정상태·운임 품목·ShipmentDate를 서버에서 다시 잠그고 확인합니다. 기존 운임행은 건너뛰며, 한 건이라도 검증에 실패하면 전체를 롤백합니다. 합산 미리보기는 저장 대상이 아니므로 적용 전 세부차수별 분리로 바꿔주세요.
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}><button type="button" className="btn btn-sm" onClick={onClose}>닫기</button><button type="button" className="btn btn-sm" disabled={applyBusy || aggregate || preview.rows.length === 0} onClick={()=>onApply?.({ rounding, aggregate, loadingUnitPrice, transportUnitPrice })} title={aggregate ? '합산은 미리보기 전용입니다. 세부차수별 분리로 바꾸세요.' : '검증 후 운임 원장에 추가합니다.'}>{applyBusy ? '운송비 적용 중…' : '운송비 적용'}</button></div>
        </div>
      </div>
    </div>
  );
}
