// components/orders/DirectPricePivot.js
// 업로드 주문등록 「직접 수정」 탭 — 업체×품목 분배단가(ShipmentDetail.Cost) 피벗 편집.
// 저장은 기존 /api/estimate/update-cost (확정 상태 유지, 단가·금액만 변경) 만 사용한다.
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { getCurrentWeek, formatWeekDisplay } from '../../lib/useWeekInput';
import {
  nearbyWeeks, splitFullWeek, indexCells, rectSelection, parsePrice,
  changedCells, buildCostRequests, summarizeChanges, cellKey,
} from '../../lib/orderImportPricePivot';

const ALL = '__ALL__';
const S = {
  card: { background: '#fff', border: '1px solid #dbe3ef', borderRadius: 8, padding: 16, marginBottom: 14 },
  label: { fontSize: 12, fontWeight: 700, color: '#334155' },
  input: { padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 },
  btn: { padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  th: { padding: '6px 8px', border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 12, whiteSpace: 'nowrap', position: 'sticky', top: 0 },
  td: { padding: 2, border: '1px solid #e2e8f0', textAlign: 'right', minWidth: 78 },
};

export default function DirectPricePivot() {
  const [week, setWeek] = useState(getCurrentWeek());
  const [manager, setManager] = useState(ALL);
  const [counName, setCounName] = useState('중국');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [edits, setEdits] = useState({});
  const [selectMode, setSelectMode] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [hover, setHover] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState([]);
  const [bulk, setBulk] = useState('');
  const [logs, setLogs] = useState([]);
  const [managers, setManagers] = useState([]);
  const [countries, setCountries] = useState(['중국']);
  const draggingRef = useRef(false);

  const log = useCallback((message, type = 'info') => {
    const t = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    setLogs(prev => [...prev, { t, message, type }]);
  }, []);

  const weekParts = splitFullWeek(week);
  const customers = data?.customers || [];
  const products = data?.products || [];
  const cellMap = useMemo(() => indexCells(data?.cells), [data]);
  const changed = useMemo(() => changedCells(cellMap, edits), [cellMap, edits]);
  const changedSet = useMemo(() => new Set(changed.map(c => c.key)), [changed]);
  const selSet = useMemo(() => new Set(selected), [selected]);

  const clearSelection = useCallback(() => {
    setSelected([]); setAnchor(null); setHover(null); setDragging(false); draggingRef.current = false;
  }, []);

  const load = async ({ silent = false } = {}) => {
    if (!weekParts) { alert('차수를 2026-44-01 형식으로 선택하세요.'); return null; }
    setLoading(true);
    clearSelection();
    setEdits({});
    try {
      const q = new URLSearchParams({ orderYear: weekParts.orderYear, orderWeek: weekParts.orderWeek, counName, manager });
      const d = await apiGet(`/api/orders/import-price-pivot?${q}`);
      if (!d?.success) throw new Error(d?.error || '조회 실패');
      setData(d);
      setManagers(d.managers || []);
      if (d.countries?.length) setCountries(prev => [...new Set([...prev, ...d.countries])]);
      if (!silent) log(`조회 ${week} / ${counName || '전체 국가'} / ${manager === ALL ? '전체 업체' : manager} — ${d.customers.length}업체 ${d.products.length}품목 (분배 ${d.cells.length}칸)`, 'ok');
      return d;
    } catch (e) {
      setData(null);
      log(`조회 실패: ${e.message}`, 'err');
      return null;
    } finally {
      setLoading(false);
    }
  };

  // 최초 1회: 담당자·국가 목록을 채우기 위한 조회
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // 표 밖에서 마우스를 놓아도 드래그 종료
  useEffect(() => {
    const up = () => { if (draggingRef.current) { draggingRef.current = false; setDragging(false); } };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const liveRect = useMemo(() => {
    if (!dragging || !anchor || !hover) return new Set();
    return new Set(rectSelection(customers, products, cellMap, anchor, hover));
  }, [dragging, anchor, hover, customers, products, cellMap]);

  const onCellDown = (row, col, e) => {
    if (!selectMode) return;
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    setAnchor({ row, col });
    setHover({ row, col });
  };
  const onCellEnter = (row, col) => { if (selectMode && draggingRef.current) setHover({ row, col }); };
  const onCellUp = (row, col) => {
    if (!selectMode || !draggingRef.current || !anchor) return;
    draggingRef.current = false;
    setDragging(false);
    const keys = rectSelection(customers, products, cellMap, anchor, { row, col });
    setSelected(keys);
    log(`영역 선택 ${keys.length}칸`);
  };

  const applyBulk = () => {
    const price = parsePrice(bulk);
    if (price == null) { alert('선택 영역 단가에 0 이상의 숫자를 입력하세요.'); return; }
    if (!selected.length) { alert('먼저 선택 모드에서 영역을 드래그해 선택하세요.'); return; }
    setEdits(prev => { const next = { ...prev }; for (const k of selected) next[k] = price; return next; });
    log(`선택 영역 ${selected.length}칸을 ${price.toLocaleString()}원으로 채움 (미저장)`);
  };

  const revert = () => { setEdits({}); log('미저장 변경을 모두 되돌림'); };

  const onCellInput = (k, v) => setEdits(prev => {
    const next = { ...prev };
    if (v === '') delete next[k]; else next[k] = v;
    return next;
  });

  const apply = async () => {
    if (!changed.length) { alert('변경된 단가가 없습니다.'); return; }
    const reqs = buildCostRequests(changed, weekParts.orderYear);
    const sum = summarizeChanges(changed, customers, products);
    const msg = `${week} 분배단가 수정\n업체 ${sum.custCount}곳 · 변경 ${sum.cellCount}칸\n\n${sum.lines.join('\n')}`
      + (sum.fixedCells ? `\n\n🔒 확정 차수 ${sum.fixedCells}칸 포함 — 확정 상태는 그대로 두고 단가·금액만 수정합니다.` : '')
      + '\n\n진행할까요?';
    if (!confirm(msg)) return;
    setApplying(true);
    log(`변경 ${sum.cellCount}칸 → 업체 ${reqs.length}곳 저장 시작`);
    const custName = new Map(customers.map(c => [c.custKey, c.custName]));
    let okCnt = 0; let failCnt = 0;
    for (const r of reqs) {
      try {
        const d = await apiPost('/api/estimate/update-cost', r.body);
        if (!d?.success) throw new Error(d?.error || d?.code || '저장 실패');
        okCnt += 1;
        log(`✅ ${custName.get(r.custKey)} — ${d.message || '반영'}`, 'ok');
      } catch (e) {
        failCnt += 1;
        log(`❌ ${custName.get(r.custKey)} — ${e.message}`, 'err');
      }
    }
    log(`저장 결과: 성공 ${okCnt}곳 / 실패 ${failCnt}곳 — 다시 조회해 확인합니다`);
    const d = await load({ silent: true });
    if (d) {
      const m = indexCells(d.cells);
      let match = 0; let diff = 0;
      for (const { key, newCost } of changed) {
        const c = m.get(key);
        if (c && c.details.every(x => Math.abs(x.cost - newCost) < 0.005)) match += 1; else diff += 1;
      }
      log(`재조회 확인: 변경 ${changed.length}칸 중 ${match}칸 반영됨 / ${diff}칸 미반영`, diff ? 'err' : 'ok');
    }
    setApplying(false);
  };

  const wBtn = (w) => ({
    padding: '5px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
    border: week === w ? '2px solid #1a237e' : '1px solid #c5cae9',
    background: week === w ? '#1a237e' : '#f3f4ff', color: week === w ? '#fff' : '#1a237e', fontWeight: week === w ? 700 : 500,
  });
  const ghost = { ...S.btn, background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#334155' };

  return (
    <div>
      <div style={S.card}>
        <div style={{ ...S.label, marginBottom: 6 }}>세부차수 <span style={{ fontWeight: 400, color: '#667085' }}>앞뒤 5개 · 직접 입력 가능</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {nearbyWeeks(week, 5).map(w => <button key={w} type="button" style={wBtn(w)} onClick={() => setWeek(w)}>{formatWeekDisplay(w)}</button>)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <input style={{ ...S.input, width: 120 }} value={week} onChange={e => setWeek(e.target.value)} placeholder="2026-44-01" aria-label="세부차수 직접 입력" />
          <label style={S.label}>담당자{' '}
            <select style={S.input} value={manager} onChange={e => setManager(e.target.value)} aria-label="담당자">
              <option value={ALL}>전체 업체</option>
              {managers.map(m => <option key={m.userId} value={m.userId}>{m.userName || m.userId} ({m.custCount})</option>)}
            </select>
          </label>
          <label style={S.label}>국가{' '}
            <select style={S.input} value={counName} onChange={e => setCounName(e.target.value)} aria-label="국가">
              {countries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button type="button" disabled={loading || applying} onClick={() => load()} style={{ ...S.btn, background: '#1565c0', color: '#fff' }}>
            {loading ? '조회 중…' : '조회'}
          </button>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <button type="button" aria-pressed={selectMode} onClick={() => { setSelectMode(v => !v); clearSelection(); }}
            style={{ ...ghost, ...(selectMode ? { background: '#f59e0b', color: '#fff' } : {}) }}>
            {selectMode ? '선택 모드 켜짐' : '선택 모드'}
          </button>
          <span style={{ fontSize: 12, color: '#64748b' }}>선택: {selected.length}칸</span>
          <input style={{ ...S.input, width: 120 }} type="number" min="0" step="any" value={bulk} onChange={e => setBulk(e.target.value)} placeholder="선택 영역 단가" aria-label="선택 영역 단가 입력" />
          <button type="button" onClick={applyBulk} disabled={!selected.length} style={{ ...S.btn, background: '#0d9488', color: '#fff', opacity: selected.length ? 1 : 0.5 }}>적용</button>
          <button type="button" onClick={clearSelection} disabled={!selected.length && !dragging} style={ghost}>선택 취소</button>
          <button type="button" onClick={revert} disabled={!Object.keys(edits).length} style={ghost}>변경 되돌리기</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: '#92400e' }}>변경 {changed.length}칸</span>
          <button type="button" onClick={apply} disabled={!changed.length || applying || loading} style={{ ...S.btn, background: '#c62828', color: '#fff', opacity: changed.length && !applying ? 1 : 0.5 }}>
            {applying ? '저장 중…' : '단가 수정 적용'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
          확정된 차수도 확정 상태는 그대로 두고 단가·금액만 바뀝니다. 수량·출고일·주문 단가는 건드리지 않습니다.
        </div>
        {!data || !customers.length ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>{loading ? '조회 중…' : '해당 차수·국가·담당자에 분배된 품목이 없습니다.'}</div>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: '60vh', userSelect: selectMode ? 'none' : 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...S.th, left: 0, zIndex: 3 }}>업체</th>
                  <th style={S.th}>담당</th>
                  {products.map(p => <th key={p.prodKey} style={S.th} title={p.outUnit}>{p.displayName}</th>)}
                  <th style={S.th}>출고수량 합</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((cu, r) => {
                  let qtySum = 0;
                  const tds = products.map((p, c) => {
                    const k = cellKey(cu.custKey, p.prodKey);
                    const cell = cellMap.get(k);
                    if (!cell) return <td key={p.prodKey} style={{ ...S.td, background: '#f8fafc' }} />;
                    qtySum += cell.outQty;
                    const edited = changedSet.has(k);
                    const inSel = selSet.has(k) || liveRect.has(k);
                    const val = edits[k] ?? cell.cost;
                    return (
                      <td key={p.prodKey}
                        onMouseDown={(e) => onCellDown(r, c, e)} onMouseEnter={() => onCellEnter(r, c)} onMouseUp={() => onCellUp(r, c)}
                        style={{ ...S.td, background: inSel ? '#bfdbfe' : edited ? '#fef08a' : cell.isFix ? '#f1f5f9' : '#fff', cursor: selectMode ? 'cell' : 'text' }}
                        title={`${cell.details.length > 1 ? `분배 ${cell.details.length}건 동일 단가 적용 · ` : ''}출고 ${cell.outQty}${cell.mixedCost ? ' · 조회 시 단가가 서로 달랐음' : ''}${cell.isFix ? ' · 확정' : ''}`}>
                        <input type="number" min="0" step="any" value={val}
                          readOnly={selectMode}
                          onChange={e => onCellInput(k, e.target.value)}
                          style={{ width: 74, border: 'none', background: 'transparent', textAlign: 'right', fontSize: 12, pointerEvents: selectMode ? 'none' : 'auto' }}
                          aria-label={`${cu.custName} ${p.displayName} 단가`} />
                      </td>
                    );
                  });
                  return (
                    <tr key={cu.custKey}>
                      <td style={{ ...S.td, textAlign: 'left', padding: '4px 8px', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: '#fff', fontWeight: 600 }}>{cu.custName}</td>
                      <td style={{ ...S.td, textAlign: 'left', padding: '4px 8px', color: '#64748b' }}>{cu.manager}</td>
                      {tds}
                      <td style={{ ...S.td, padding: '4px 8px' }}>{qtySum.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={{ ...S.label, marginBottom: 6 }}>작업 로그</div>
        {logs.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 12 }}>아직 기록이 없습니다.</div> : (
          <div style={{ fontSize: 12, fontFamily: 'monospace', maxHeight: 220, overflow: 'auto' }}>
            {logs.map((l, i) => (
              <div key={i} style={{ color: l.type === 'err' ? '#b91c1c' : l.type === 'ok' ? '#166534' : '#334155' }}>[{l.t}] {l.message}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
