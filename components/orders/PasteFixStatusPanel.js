import { useEffect, useMemo, useState } from 'react';
import { parseJsonResponse } from '../../lib/parseJsonResponse';
import { matchesFullFixStatusWeek, toFullFixStatusWeek } from '../../lib/fixStatusWeek';

const badge = (status) => ({
  FIXED: ['확정', '#e8f5e9', '#2e7d32'],
  FIXED_PENDING_STOCK: ['출고확정·재고미정합', '#fff3e0', '#e65100'],
  PARTIAL: ['부분확정', '#fff8e1', '#ef6c00'],
  UNFIXED: ['미확정', '#e3f2fd', '#1565c0'],
}[status] || ['출고없음', '#f5f5f5', '#777']);

/** 견적서 관리와 같은 확정현황/확정/확정취소/정합복구 API를 재사용한다. */
export default function PasteFixStatusPanel({ week, onChanged }) {
  const fullWeek = useMemo(() => toFullFixStatusWeek(week), [week]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);

  useEffect(() => { setOpen(false); setData(null); setCategories([]); }, [fullWeek]);

  const load = async () => {
    if (!fullWeek) { alert('등록 차수를 선택하세요.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/shipment/fix-status?fromWeek=${encodeURIComponent(fullWeek)}&toWeek=${encodeURIComponent(fullWeek)}`, { credentials: 'same-origin' });
      const result = await parseJsonResponse(res);
      if (!res.ok || !result.success) throw new Error(result.error || '확정 현황 조회 실패');
      setData({
        ...result,
        weeks: (result.weeks || []).filter((item) => matchesFullFixStatusWeek(item, fullWeek)),
        negative: (result.negative || []).filter((item) => matchesFullFixStatusWeek(item, fullWeek)),
      });
      setCategories([]);
      setOpen(true);
    } catch (error) { alert(`확정 현황 확인 오류: ${error.message}`); }
    finally { setLoading(false); }
  };

  const row = data?.weeks?.[0];
  const categoryNames = data?.categories || [];
  const categoryLabel = categories.length ? categories.join(', ') : '전체 카테고리';
  const runFix = async (action, force = false) => {
    const text = action === 'unfix' ? '확정취소' : '확정';
    if (!force && !confirm(`${fullWeek} ${text}을 진행할까요?${categories.length ? `\n카테고리: ${categoryLabel}` : ''}`)) return;
    setWorking(true);
    try {
      const res = await fetch('/api/shipment/fix', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week: fullWeek, action, force, ...(categories.length ? { countryFlowers: categories } : {}) }) });
      const result = await parseJsonResponse(res);
      if (!result.success && result.warning === 'LATER_FIXED_EXISTS' && !force) {
        if (confirm(`후속 차수가 확정 상태입니다: ${(result.laterWeeks || []).join(', ')}\n선택 차수만 ${text}할까요?`)) await runFix(action, true);
        return;
      }
      if (!res.ok || !result.success) throw new Error(result.error || `${text} 실패`);
      alert(result.message || `${text} 완료`);
      await load(); onChanged?.(result);
    } catch (error) { alert(`${text} 오류: ${error.message}`); }
    finally { setWorking(false); }
  };
  const reconcile = async () => {
    if (!confirm(`${fullWeek} 차수 전체 재고 재계산으로 exe 정합을 복구할까요?`)) return;
    setWorking(true);
    try {
      const res = await fetch('/api/shipment/fix-reconcile', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week: fullWeek, forceFullWeekRecalc: true }) });
      const result = await parseJsonResponse(res);
      if (!res.ok || !result.success) throw new Error(result.error || result.message || '재고 정합 복구 실패');
      alert(result.message || '재고 정합 복구 완료');
      await load(); onChanged?.(result);
    } catch (error) { alert(`재고 정합 복구 오류: ${error.message}`); }
    finally { setWorking(false); }
  };
  const status = badge(row?.status);
  const canUnfix = row && ['FIXED', 'PARTIAL', 'FIXED_PENDING_STOCK'].includes(row.status);
  const canFix = row && Number(row.detailCount || 0) > 0 && ['UNFIXED', 'PARTIAL'].includes(row.shipmentStatus || row.status);
  const canReconcile = row && (row.exeAligned === false || row.stockFixStatus === 'OPEN' || Number(row.negativeLiveCount || 0) > 0);

  return <>
    <button type="button" onClick={load} disabled={!fullWeek || loading || working} title={fullWeek ? `${fullWeek} 확정/미확정/음수재고 현황 확인` : '등록 차수를 먼저 선택하세요.'} style={{ padding: '6px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: fullWeek ? 'pointer' : 'not-allowed', opacity: fullWeek ? 1 : .55 }}>{loading ? '⏳ 확인중...' : '🔎 확정 현황 확인'}</button>
    {open && <div className="modal-overlay" onClick={() => !working && setOpen(false)}><div className="modal" style={{ maxWidth: 920, width: 'min(96vw, 920px)', maxHeight: '90vh', overflowY: 'auto' }} onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><span className="modal-title">🔎 확정 현황 — {fullWeek}</span>{!working && <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>닫기</button>}</div>
      <div className="modal-body">
        <p style={{ marginTop: 0, fontSize: 12, color: '#546e7a' }}>붙여넣기 주문등록의 현재 등록차수만 조회합니다. 견적서 관리와 같은 확정 API를 사용하며, 연도는 선택 차수 그대로 전달됩니다.</p>
        {categoryNames.length > 0 && <div style={{ marginBottom: 12, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6 }}><strong style={{ fontSize: 12, marginRight: 10 }}>카테고리</strong><button type="button" className="btn btn-sm" onClick={() => setCategories([])} disabled={working} style={{ marginRight: 8 }}>전체</button>{categoryNames.map((item) => <label key={item} style={{ marginRight: 10, fontSize: 12, whiteSpace: 'nowrap' }}><input type="checkbox" checked={categories.includes(item)} disabled={working} onChange={() => setCategories((old) => old.includes(item) ? old.filter((value) => value !== item) : [...old, item].sort((a, b) => a.localeCompare(b, 'ko')))} /> {item}</label>)}<span style={{ marginLeft: 6, fontSize: 11, color: '#7b1fa2' }}>{categoryLabel}</span></div>}
        <div style={{ overflowX: 'auto' }}><table className="tbl" style={{ minWidth: 740 }}><thead><tr><th>차수</th><th>출고확정</th><th>재고마감</th><th>exe</th><th className="num">출고라인</th><th className="num">미확정</th><th className="num">음수재고</th></tr></thead><tbody>{row ? <tr><td style={{ fontWeight: 800 }}>{fullWeek}</td><td><span style={{ background: status[1], color: status[2], padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>{status[0]}</span></td><td>{row.stockFixStatus === 'FIXED' ? '마감' : row.stockFixStatus === 'OPEN' ? '미마감' : '-'}</td><td>{row.exeAligned === false ? '!' : 'OK'}</td><td className="num">{Number(row.detailCount || 0).toLocaleString()}</td><td className="num">{Number(row.unfixedDetailCount || 0).toLocaleString()}</td><td className="num" style={{ color: Number(row.negativeCount || 0) > 0 ? '#c62828' : undefined }}>{Number(row.negativeCount || 0).toLocaleString()}</td></tr> : <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18 }}>출고 내역이 없습니다.</td></tr>}</tbody></table></div>
        {(data?.negative || []).length > 0 && <div style={{ marginTop: 14, overflowX: 'auto' }}><strong style={{ color: '#c62828', fontSize: 13 }}>확정 시 부족 예상 품목</strong><table className="tbl" style={{ marginTop: 6, minWidth: 650 }}><thead><tr><th>품목</th><th>국가</th><th>꽃</th><th className="num">전재고</th><th className="num">입고</th><th className="num">출고</th><th className="num">부족</th></tr></thead><tbody>{data.negative.map((item, index) => <tr key={`${item.ProdKey}-${index}`}><td>{item.ProdName}</td><td>{item.CounName}</td><td>{item.FlowerName}</td><td className="num">{Number(item.prevStock || 0).toLocaleString()}</td><td className="num">{Number(item.inQty || 0).toLocaleString()}</td><td className="num">{Number(item.outQty || 0).toLocaleString()}</td><td className="num" style={{ color: '#c62828', fontWeight: 700 }}>{Math.abs(Number(item.remain || 0)).toLocaleString()}</td></tr>)}</tbody></table></div>}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: 12, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}><button type="button" className="btn" disabled={working} onClick={() => setOpen(false)}>닫기</button><button type="button" className="btn" disabled={working || !canReconcile} onClick={reconcile} style={{ color: '#283593', fontWeight: 700 }}>재고 정합 복구</button><button type="button" className="btn" disabled={working || !canUnfix} onClick={() => runFix('unfix')} style={{ color: '#bf360c', fontWeight: 700 }}>{working ? '처리중...' : `확정취소 (${categoryLabel})`}</button><button type="button" className="btn" disabled={working || !canFix} onClick={() => runFix('fix')} style={{ background: '#2e7d32', color: '#fff', borderColor: '#2e7d32', fontWeight: 700 }}>{working ? '처리중...' : `차수 확정 (${categoryLabel})`}</button></div>
    </div></div>}
  </>;
}
