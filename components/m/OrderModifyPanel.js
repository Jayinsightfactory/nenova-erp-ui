// components/m/OrderModifyPanel.js
// 네노바 챗봇 — "주문수정" 패널.
//  붙여넣기 주문등록과 동일하게: 텍스트 입력 → 매칭(parse-paste) → 등록(주문 delta) → 실제 수정 결과(전→후) 확인.
//  - 매칭: POST /api/orders/parse-paste { text } → { orders:[{custMatch, items:[{inputName,prodKey,prodName,qty,unit,action}]}] }
//  - 등록: POST /api/orders { custKey, week, year, items(부호=추가/취소), delta:true } → OrderDetail 가감
//  - 결과: 등록 전/후 /api/orders 스냅샷으로 품목별 수량 변화 표시
import { useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { findLocalMapping, findCustomerLocalMapping } from '../../lib/pasteLocalMapping';
import PasteHighlight from '../orders/PasteHighlight';

const yearOf = (week) => {
  const m = String(week || '').match(/^(\d{4})-/);
  return m ? m[1] : String(new Date().getFullYear());
};

const fmtWeek = (w) => {
  const m = String(w || '').match(/^(\d{2})-(\d{2})$/);
  return m ? `${Number(m[1])}-${Number(m[2])}차` : (w ? `${w}차` : '');
};

async function snapshotQty(custName, week) {
  const map = {};
  try {
    const d = await apiGet('/api/orders', { custName, week });
    const o = d.orders?.find(x => x.custName === custName) || d.orders?.[0];
    (o?.items || []).forEach(it => { map[it.prodKey] = Number(it.qty || 0); });
  } catch { /* 스냅샷 실패해도 진행 */ }
  return map;
}

export default function OrderModifyPanel({ open, setOpen, week, weeks, customers }) {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [orders, setOrders] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState('');
  const [detectedWeek, setDetectedWeek] = useState(''); // 텍스트에서 감지한 차수 (WW-SS) — 최우선
  const [pickedWeek, setPickedWeek] = useState('');      // 패널에서 직접 선택한 차수
  const [showHighlight, setShowHighlight] = useState(false);

  // 우선순위: 텍스트 차수("25-1") > 패널 선택 차수 > 기준차수(빠른조회).
  const baseWeek = pickedWeek || week;
  const effectiveWeek = detectedWeek || baseWeek;
  const weekOpts = (() => {
    const list = (weeks || []).slice();
    if (baseWeek && !list.includes(baseWeek)) list.unshift(baseWeek);
    return list;
  })();

  const runMatch = async () => {
    if (!text.trim()) { setErr('수정할 주문 텍스트를 입력하세요.'); return; }
    setParsing(true); setErr(''); setOrders(null); setResults(null); setDetectedWeek('');
    try {
      const d = await apiPost('/api/orders/parse-paste', { text });
      if (!d.success) throw new Error(d.error || '매칭 실패');
      let orders = d.orders || [];

      // 텍스트에 차수가 있으면("25-1" 등) 기준차수 대신 그 차수로 등록 (웹 붙여넣기와 동일)
      if (d.detectedWeek) {
        const m = String(d.detectedWeek).match(/^(\d{1,2})-(\d{1,2})$/);
        if (m) setDetectedWeek(`${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`);
      }

      // 저장된 매핑 폴백 (웹 붙여넣기의 applyCache 동등) — parse-paste 미매칭 보완
      try {
        const [pm, cm] = await Promise.all([
          apiGet('/api/orders/mappings').catch(() => ({ mappings: {} })),
          apiGet('/api/orders/customer-mappings').catch(() => ({ mappings: {} })),
        ]);
        const prodMap = pm.mappings || {};
        const custMap = cm.mappings || {};
        orders = orders.map(o => {
          let custMatch = o.custMatch;
          if (!custMatch) {
            const ch = findCustomerLocalMapping(o.custName, custMap);
            if (ch?.custKey) custMatch = { CustKey: Number(ch.custKey), CustName: ch.custName || o.custName, CustArea: ch.custArea || '' };
          }
          const items = (o.items || []).map(it => {
            if (it.prodKey) return it;
            const hit = findLocalMapping(it.inputName, prodMap);
            if (!hit?.prodKey) return it;
            return { ...it, prodKey: Number(hit.prodKey), prodName: hit.prodName || it.prodName, displayName: hit.displayName || hit.prodName || it.prodName, fromMapping: true };
          });
          return { ...o, custMatch, items };
        });
      } catch { /* 폴백 실패해도 parse-paste 결과는 표시 */ }

      setOrders(orders);
      if (!orders.length) setErr('인식된 주문이 없습니다.');
    } catch (e) { setErr(e.message || String(e)); }
    finally { setParsing(false); }
  };

  const runRegister = async () => {
    const wk = effectiveWeek;
    if (!wk) { setErr('차수를 선택하세요.'); return; }
    if (!orders?.length) { setErr('먼저 매칭하세요.'); return; }
    setRegistering(true); setErr(''); setResults(null);
    const out = [];
    try {
      for (const order of orders) {
        const cust = order.custMatch;
        if (!cust) { out.push({ custName: order.custName, skip: '업체 미매칭 — 건너뜀' }); continue; }
        const matched = (order.items || []).filter(it => it.prodKey && Math.abs(parseFloat(it.qty) || 0) > 0);
        const unmatched = (order.items || []).filter(it => !it.prodKey);
        if (!matched.length) { out.push({ custName: cust.CustName, skip: '매칭된 품목 없음', unmatched: unmatched.map(u => u.inputName) }); continue; }

        const before = await snapshotQty(cust.CustName, wk);
        const items = matched.map(it => ({
          prodKey: it.prodKey,
          prodName: it.prodName,
          qty: (it.action === '취소' ? -1 : 1) * Math.abs(parseFloat(it.qty) || 0),
          unit: it.unit || '단',
        }));
        let okMsg = '', okFlag = false;
        try {
          const d = await apiPost('/api/orders', { custKey: cust.CustKey, week: wk, year: yearOf(wk), items, delta: true, source: 'chat-modify' });
          okFlag = !!d.success; okMsg = d.error || '';
        } catch (e) { okMsg = e.message || String(e); }
        const after = await snapshotQty(cust.CustName, wk);

        out.push({
          custName: cust.CustName,
          ok: okFlag, error: okMsg,
          unmatched: unmatched.map(u => u.inputName),
          rows: matched.map(it => {
            const b = before[it.prodKey] || 0;
            const a = (it.prodKey in after) ? after[it.prodKey] : b;
            return { prodName: it.displayName || it.prodName, action: it.action || '추가', qty: it.qty, unit: it.unit, before: b, after: a };
          }),
        });
      }
      setResults(out);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setRegistering(false); }
  };

  const reset = () => { setText(''); setOrders(null); setResults(null); setErr(''); setDetectedWeek(''); };

  const matchedCount = (orders || []).reduce((s, o) => s + (o.items || []).filter(i => i.prodKey).length, 0);
  const unmatchedCount = (orders || []).reduce((s, o) => s + (o.items || []).filter(i => !i.prodKey).length, 0);

  return (
    <div className="m-mod">
      <button type="button" className="m-mod-toggle" onClick={() => setOpen(!open)}>
        <span>✏️ 주문수정</span>
        <span className="m-mod-status">{effectiveWeek ? `${effectiveWeek}차${detectedWeek ? '(텍스트)' : ''}` : '차수 미선택'}{orders ? ` · 매칭 ${matchedCount}/${matchedCount + unmatchedCount}` : ''}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="m-mod-body">
          <div className="m-mod-field">
            <span>등록 차수</span>
            <div className="m-mod-wkpick">
              <select
                value={baseWeek || ''}
                onChange={e => setPickedWeek(e.target.value)}
                disabled={!!detectedWeek}
                title={detectedWeek ? '텍스트에 차수가 있어 그 차수로 등록됩니다' : '등록할 차수를 선택하세요'}
              >
                {!baseWeek && <option value="">차수 선택</option>}
                {weekOpts.map(w => <option key={w} value={w}>{fmtWeek(w)}</option>)}
              </select>
              {detectedWeek
                ? <span className="m-mod-badge">📅 텍스트 {fmtWeek(detectedWeek)} 우선{baseWeek && baseWeek !== detectedWeek ? ` (선택 ${fmtWeek(baseWeek)} 무시)` : ''}</span>
                : <span className="m-mod-badge base">→ {effectiveWeek ? `${fmtWeek(effectiveWeek)} 등록` : '⚠️ 차수 선택'}</span>}
            </div>
          </div>

          <textarea
            className="m-mod-text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'수정할 주문을 붙여넣으세요.\n예)\n25-1 미카엘\n프라우드 2단 추가\n장미 화이트 1박스 취소\n(첫 줄에 25-1 처럼 차수를 적으면 그 차수로 등록됩니다)'}
            rows={4}
          />

          <button type="button" className="m-mod-hl-toggle" onClick={() => setShowHighlight(v => !v)}>
            🖍 입력 감지 하이라이트 {showHighlight ? 'ON ▲' : 'OFF ▼'}
          </button>
          {showHighlight && text.trim() && (
            <PasteHighlight text={text} customers={customers} />
          )}

          <div className="m-mod-actions">
            <button type="button" onClick={runMatch} disabled={parsing || !text.trim()} className="m-mod-btn primary">
              {parsing ? '매칭 중…' : '🔍 매칭'}
            </button>
            <button type="button" onClick={runRegister} disabled={registering || !orders?.length || !effectiveWeek} className="m-mod-btn ok">
              {registering ? '등록 중…' : '✅ 등록'}
            </button>
            <button type="button" onClick={reset} disabled={parsing || registering} className="m-mod-btn">초기화</button>
          </div>

          {err && <div className="m-mod-err">{err}</div>}

          {/* 매칭 미리보기 */}
          {orders && !results && (
            <div className="m-mod-preview">
              {orders.map((o, oi) => (
                <div key={oi} className="m-mod-order">
                  <div className="m-mod-cust">
                    {o.custMatch ? '🏢 ' + o.custMatch.CustName : '⚠️ ' + (o.custName || '업체?') + ' (미매칭)'}
                  </div>
                  {(o.items || []).map((it, ii) => (
                    <div key={ii} className={`m-mod-item ${it.prodKey ? '' : 'no'}`}>
                      <span className={`tag ${it.action === '취소' ? 'cancel' : 'add'}`}>{it.action === '취소' ? '취소' : '추가'}</span>
                      <span className="qty">{it.qty}{it.unit}</span>
                      <span className="nm">{it.prodKey ? (it.displayName || it.prodName) : `${it.inputName} ⚠️미매칭`}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="m-mod-hint">⚠️ 미매칭 품목은 등록에서 제외됩니다. ({matchedCount}건 등록 대상)</div>
            </div>
          )}

          {/* 등록 결과: 실제 수정 전→후 */}
          {results && (
            <div className="m-mod-result">
              <div className="m-mod-rtitle">📋 수정 결과</div>
              {results.map((r, ri) => (
                <div key={ri} className="m-mod-rcust">
                  <div className="m-mod-cust">
                    {r.ok ? '✅ ' : (r.skip ? '⏭ ' : '❌ ')}{r.custName}{r.skip ? ` — ${r.skip}` : ''}{r.error ? ` — ${r.error}` : ''}
                  </div>
                  {(r.rows || []).map((row, rj) => (
                    <div key={rj} className="m-mod-rrow">
                      <span className={`tag ${row.action === '취소' ? 'cancel' : 'add'}`}>{row.action === '취소' ? '−' : '+'}{row.qty}{row.unit}</span>
                      <span className="nm">{row.prodName}</span>
                      <span className="ba">{row.before} → <b>{row.after}</b></span>
                    </div>
                  ))}
                  {r.unmatched?.length > 0 && <div className="m-mod-un">미매칭 제외: {r.unmatched.join(', ')}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .m-mod { flex-shrink: 0; background: #fff; border-bottom: 1px solid #dbe3ea; }
        .m-mod-toggle { width: 100%; min-height: 40px; border: 0; background: #fff7ed; display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; padding: 8px 12px; color: #9a3412; font-size: 12px; font-weight: 800; cursor: pointer; text-align: left; }
        .m-mod-status { min-width: 0; color: #b45309; font-weight: 700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .m-mod-body { display: grid; gap: 8px; padding: 10px 12px 12px; }
        .m-mod-field { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: center; font-size: 12px; font-weight: 800; color: #475569; }
        .m-mod-field select { min-height: 34px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0 8px; font-size: 13px; }
        .m-mod-wkpick { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .m-mod-wkpick select { min-height: 34px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0 8px; font-size: 13px; font-weight: 800; color: #9a3412; background: #fff; }
        .m-mod-wkpick select:disabled { opacity: 0.6; background: #f1f5f9; }
        .m-mod-badge { margin-left: 6px; font-size: 10px; font-weight: 800; color: #fff; background: #1565c0; padding: 2px 7px; border-radius: 10px; vertical-align: middle; }
        .m-mod-badge.base { background: #94a3b8; }
        .m-mod-hl-toggle { width: 100%; min-height: 32px; border: 1px solid #d8b4fe; border-radius: 8px; background: #faf5ff; color: #7e22ce; font-size: 12px; font-weight: 800; cursor: pointer; }
        .m-mod-text { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; font-size: 13px; resize: vertical; font-family: inherit; }
        .m-mod-actions { display: flex; gap: 6px; }
        .m-mod-btn { flex: 1; min-height: 38px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font-size: 13px; font-weight: 800; cursor: pointer; }
        .m-mod-btn.primary { background: #1d4ed8; color: #fff; border: 0; }
        .m-mod-btn.ok { background: #16a34a; color: #fff; border: 0; }
        .m-mod-btn:disabled { opacity: 0.5; }
        .m-mod-err { color: #b91c1c; font-size: 12px; font-weight: 700; }
        .m-mod-preview, .m-mod-result { display: grid; gap: 8px; }
        .m-mod-order, .m-mod-rcust { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; background: #f8fafc; }
        .m-mod-cust { font-size: 13px; font-weight: 800; color: #0f172a; margin-bottom: 4px; }
        .m-mod-item, .m-mod-rrow { display: flex; gap: 6px; align-items: center; font-size: 12px; padding: 2px 0; }
        .m-mod-item.no .nm { color: #b91c1c; }
        .m-mod-item .qty { font-weight: 800; color: #334155; min-width: 44px; }
        .m-mod-item .nm, .m-mod-rrow .nm { flex: 1; min-width: 0; color: #1e293b; }
        .tag { font-size: 11px; font-weight: 800; border-radius: 5px; padding: 1px 6px; white-space: nowrap; }
        .tag.add { background: #dcfce7; color: #166534; }
        .tag.cancel { background: #fee2e2; color: #991b1b; }
        .m-mod-rrow .ba { font-size: 12px; color: #475569; white-space: nowrap; }
        .m-mod-rrow .ba b { color: #166534; }
        .m-mod-hint, .m-mod-un { font-size: 11px; color: #b45309; }
        .m-mod-rtitle { font-size: 13px; font-weight: 800; color: #166534; }
      `}</style>
    </div>
  );
}
