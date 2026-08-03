// 수입부 Pivot 농장 결제일 설정 — 메인 Pivot과 분리된 공통 설정 페이지
// 농장별 설정은 차수와 무관하게 공통 적용되며, ERP 입고/주문/출고 원장은 변경하지 않는다.
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import {
  PAYMENT_DAYS, normalizePaymentDay, paymentDayLabel,
} from '../../lib/importPivotPayment';

export default function PivotImportFarmSettings() {
  const [farms, setFarms] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    setLoading(true);
    setErr('');
    apiGet('/api/stats/pivot-import', { farmSettings: '1' })
      .then(data => {
        const list = Array.isArray(data.farms) ? data.farms : [];
        setFarms(list);
        const initial = {};
        list.forEach(farm => { initial[farm.name] = farm.paymentDay || ''; });
        setDrafts(initial);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const save = async (farmName) => {
    const paymentDay = normalizePaymentDay(drafts[farmName]);
    if (!paymentDay) {
      setErr('결제일은 5일, 15일, 25일 중 하나를 선택하세요.');
      return;
    }
    setSaving(prev => ({ ...prev, [farmName]: true }));
    setErr('');
    try {
      await apiPost('/api/stats/pivot-import', {
        type: 'farmPaymentDay', farmName, paymentDay,
      });
      setFarms(prev => prev.map(farm => (
        farm.name === farmName ? { ...farm, paymentDay } : farm
      )));
      setMsg(`${farmName} 결제일 ${paymentDay}일 저장 완료`);
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(prev => ({ ...prev, [farmName]: false }));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>수입부 농장 결제일 설정</h1>
          <p>수입부 Pivot 정산서에서 사용할 농장별 공통 결제일을 관리합니다.</p>
        </div>
        <div className="page-actions">
          <a className="btn btn-secondary" href="/stats/pivot-import">← 수입부 Pivot</a>
          <button className="btn btn-secondary" onClick={load} disabled={loading}>🔄 새로고침</button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 12px', marginBottom: 10, color: 'var(--red)', background: 'var(--red-bg)', borderRadius: 8 }}>{err}</div>}
      {msg && <div style={{ padding: '8px 12px', marginBottom: 10, color: '#1b5e20', background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 8 }}>{msg}</div>}

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700 }}>농장 선택(결제일)</div>
            <div style={{ marginTop: 4, color: 'var(--text2)', fontSize: 12 }}>
              저장한 결제일은 차수와 관계없이 해당 농장에 공통 적용됩니다. 설정하지 않은 농장은 수입부 Pivot에서 미설정으로 분류됩니다.
            </div>
          </div>
          <span style={{ color: 'var(--text3)', fontSize: 12 }}>{farms.length}개 농장</span>
        </div>

        {/* 기본값은 접힘: 농장 목록이 필요할 때만 펼친다. */}
        <details>
          <summary style={{ marginTop: 12, padding: '9px 10px', cursor: 'pointer', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontWeight: 700 }}>
            농장 설정 열기 ({farms.length}개)
          </summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {loading && <div style={{ padding: 18, color: 'var(--text3)' }}>농장 목록을 불러오는 중입니다…</div>}
            {!loading && farms.length === 0 && <div style={{ padding: 18, color: 'var(--text3)' }}>등록된 농장이 없습니다.</div>}
            {!loading && farms.map(farm => (
              <div key={farm.name} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
                <span style={{ minWidth: 220, fontWeight: 600 }}>{farm.name}</span>
                <span style={{ minWidth: 70, color: 'var(--text3)', fontSize: 12 }}>현재 {paymentDayLabel(farm.paymentDay)}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {PAYMENT_DAYS.map(day => (
                    <label key={day} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 12 }}>
                      <input type="radio" name={`payment-day-${farm.name}`} value={day}
                        checked={Number(drafts[farm.name]) === day}
                        onChange={() => setDrafts(prev => ({ ...prev, [farm.name]: day }))} />
                      {day}일
                    </label>
                  ))}
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => save(farm.name)} disabled={saving[farm.name]}>
                  {saving[farm.name] ? '저장 중…' : '저장'}
                </button>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
