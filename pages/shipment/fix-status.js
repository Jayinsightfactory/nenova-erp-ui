// pages/shipment/fix-status.js — 차수 확정 현황 / 구간 확정취소

import { useCallback, useMemo, useState } from 'react';
import { apiGet } from '../../lib/useApi';
import { useWeekInput, WeekInput, getCurrentWeek } from '../../lib/useWeekInput';

const fmt = n => Number(n || 0).toLocaleString();
const fixedLabel = {
  FIXED: { text: '확정', bg: '#d1fae5', color: '#065f46' },
  PARTIAL: { text: '부분확정', bg: '#fef3c7', color: '#92400e' },
  UNFIXED: { text: '미확정', bg: '#fee2e2', color: '#991b1b' },
  NO_SHIPMENT: { text: '출고없음', bg: '#e5e7eb', color: '#374151' },
};

function StatusBadge({ status }) {
  const s = fixedLabel[status] || fixedLabel.NO_SHIPMENT;
  return (
    <span style={{
      display: 'inline-block',
      minWidth: 58,
      padding: '3px 8px',
      borderRadius: 10,
      background: s.bg,
      color: s.color,
      fontSize: 11,
      fontWeight: 800,
      textAlign: 'center',
    }}>
      {s.text}
    </span>
  );
}

export default function ShipmentFixStatus() {
  const current = getCurrentWeek();
  const fromInput = useWeekInput(current);
  const toInput = useWeekInput(current);
  const [weeks, setWeeks] = useState([]);
  const [negative, setNegative] = useState([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [selectedWeek, setSelectedWeek] = useState('');

  const load = useCallback(async () => {
    if (!fromInput.value || !toInput.value) {
      setErr('조회할 시작/끝 차수를 입력하세요.');
      return;
    }
    setLoading(true);
    setErr('');
    setMsg('');
    try {
      const data = await apiGet('/api/shipment/fix-status', {
        fromWeek: fromInput.value,
        toWeek: toInput.value,
      });
      setWeeks(data.weeks || []);
      setNegative(data.negative || []);
      setSelectedWeek('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [fromInput.value, toInput.value]);

  const unfixRange = useCallback(async (force = false) => {
    if (!fromInput.value || !toInput.value) {
      setErr('취소할 시작/끝 차수를 입력하세요.');
      return;
    }
    if (!force && !confirm(`[${fromInput.value} ~ ${toInput.value}] 구간의 확정을 모두 취소할까요?\n\n높은 차수부터 낮은 차수 순서로 처리됩니다.`)) {
      return;
    }

    setWorking(true);
    setErr('');
    setMsg('');
    try {
      const res = await fetch('/api/shipment/fix-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromWeek: fromInput.value, toWeek: toInput.value, force }),
      });
      const data = await res.json();
      if (res.status === 409 && data.warning === 'LATER_FIXED_EXISTS') {
        const later = (data.laterWeeks || []).map(w => `${w.OrderYear}-${w.OrderWeek}`).join(', ');
        if (confirm(`선택 구간 이후 확정 차수가 있습니다.\n${later}\n\n그래도 선택 구간만 확정취소할까요?`)) {
          await unfixRange(true);
        }
        return;
      }
      if (!data.success && (!data.results || data.results.length === 0)) {
        throw new Error(data.error || data.message || '확정취소 실패');
      }
      setMsg(data.message || '구간 확정취소 완료');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setWorking(false);
    }
  }, [fromInput.value, toInput.value, load]);

  const selectedNegative = useMemo(() => {
    if (!selectedWeek) return negative;
    return negative.filter(r => `${r.OrderYear}-${r.OrderWeek}` === selectedWeek);
  }, [negative, selectedWeek]);

  const summary = useMemo(() => ({
    fixed: weeks.filter(w => w.status === 'FIXED').length,
    partial: weeks.filter(w => w.status === 'PARTIAL').length,
    unfixed: weeks.filter(w => w.status === 'UNFIXED').length,
    negative: negative.length,
  }), [weeks, negative]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card" style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <WeekInput weekInput={fromInput} label="시작 차수" />
          <span style={{ color: 'var(--text3)' }}>~</span>
          <WeekInput weekInput={toInput} label="끝 차수" />
          <button className="btn btn-primary btn-sm" onClick={load} disabled={loading}>
            {loading ? '조회중...' : '조회'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => unfixRange(false)} disabled={working || loading}>
            {working ? '취소 처리중...' : '선택 구간 확정취소'}
          </button>
          <button className="btn btn-sm" onClick={() => {
            const cur = getCurrentWeek();
            fromInput.setValue(cur);
            toInput.setValue(cur);
          }}>
            현재차수
          </button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 12px', background: 'var(--red-bg)', color: 'var(--red)', borderLeft: '3px solid var(--red)', fontSize: 13 }}>{err}</div>}
      {msg && <div style={{ padding: '8px 12px', background: 'var(--green-bg)', color: 'var(--green)', borderLeft: '3px solid var(--green)', fontSize: 13 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: 10 }}>
        {[
          ['확정 차수', summary.fixed, '#065f46'],
          ['부분확정', summary.partial, '#92400e'],
          ['미확정', summary.unfixed, '#991b1b'],
          ['음수재고 품목', summary.negative, '#b91c1c'],
        ].map(([label, value, color]) => (
          <div key={label} className="card" style={{ padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color, fontFamily: 'var(--mono)' }}>{fmt(value)}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">차수 확정 현황</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>행을 누르면 해당 차수 음수재고만 봅니다.</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>차수</th>
                <th>상태</th>
                <th style={{ textAlign: 'right' }}>출고거래처</th>
                <th style={{ textAlign: 'right' }}>출고라인</th>
                <th style={{ textAlign: 'right' }}>확정라인</th>
                <th style={{ textAlign: 'right' }}>미확정라인</th>
                <th style={{ textAlign: 'right' }}>카테고리</th>
                <th style={{ textAlign: 'right' }}>음수재고</th>
                <th>StockMaster</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--text3)' }}>조회중...</td></tr>
              ) : weeks.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--text3)' }}>차수 범위를 조회하세요.</td></tr>
              ) : weeks.map(w => {
                const weekLabel = `${w.OrderYear}-${w.OrderWeek}`;
                return (
                  <tr key={w.WeekKey}
                    onClick={() => setSelectedWeek(selectedWeek === weekLabel ? '' : weekLabel)}
                    className={selectedWeek === weekLabel ? 'selected' : ''}
                    style={{ cursor: 'pointer' }}>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 800 }}>{weekLabel}</td>
                    <td><StatusBadge status={w.status} /></td>
                    <td className="num">{fmt(w.masterCount)}</td>
                    <td className="num">{fmt(w.detailCount)}</td>
                    <td className="num" style={{ color: 'var(--green)', fontWeight: 700 }}>{fmt(w.fixedDetailCount)}</td>
                    <td className="num" style={{ color: w.unfixedDetailCount > 0 ? 'var(--red)' : 'var(--text3)' }}>{fmt(w.unfixedDetailCount)}</td>
                    <td className="num">{fmt(w.fixedCategoryCount)} / {fmt(w.categoryCount)}</td>
                    <td className="num" style={{ color: w.negativeCount > 0 ? 'var(--red)' : 'var(--text3)', fontWeight: w.negativeCount > 0 ? 800 : 400 }}>{fmt(w.negativeCount)}</td>
                    <td>{w.stockFixed ? '확정' : w.stockMasterCount ? '미확정' : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">확정 시 오류 예상 품목</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>
            전재고 + 입고 - 출고가 음수인 품목 {selectedWeek ? `(${selectedWeek})` : '(전체 범위)'}
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>차수</th>
                <th>국가</th>
                <th>꽃</th>
                <th>품목</th>
                <th style={{ textAlign: 'right' }}>전재고</th>
                <th style={{ textAlign: 'right' }}>입고</th>
                <th style={{ textAlign: 'right' }}>출고</th>
                <th style={{ textAlign: 'right' }}>부족</th>
              </tr>
            </thead>
            <tbody>
              {selectedNegative.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--text3)' }}>음수재고 예상 품목이 없습니다.</td></tr>
              ) : selectedNegative.map((r, i) => (
                <tr key={`${r.WeekKey || r.OrderWeek}-${r.ProdKey}-${i}`}>
                  <td style={{ fontFamily: 'var(--mono)' }}>{r.OrderYear}-{r.OrderWeek}</td>
                  <td>{r.CounName || ''}</td>
                  <td>{r.FlowerName || ''}</td>
                  <td className="name">{r.ProdName}</td>
                  <td className="num">{Number(r.prevStock || 0).toFixed(2)}</td>
                  <td className="num" style={{ color: 'var(--blue)' }}>{Number(r.inQty || 0).toFixed(2)}</td>
                  <td className="num">{Number(r.outQty || 0).toFixed(2)}</td>
                  <td className="num" style={{ color: 'var(--red)', fontWeight: 900 }}>{Math.abs(Number(r.remain || 0)).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

