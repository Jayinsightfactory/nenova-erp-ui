// pages/admin/distribute-repair.js — 출고분배 정합성 진단/보정 (전산 nenova.exe 호환)
//  로그인 세션으로 /api/shipment/distribute-diagnose 를 호출한다(별도 토큰 X).
//  - 진단(읽기): 차수별 중복마스터 / CustKey불일치 / 출고일불일치 / 출고일+오프셋(6일밀림) 건수
//  - 보정(쓰기): 출고일 보정(repairShipmentDateBaseOutDay) / CustKey 보정(repairMissingCustKey)
//  ※ "분배가 전산에 안 보임"의 주원인은 출고일이 전산 기준과 어긋난 행 → 출고일 보정으로 해결.
import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Layout from '../../components/Layout';
import { apiGet, apiPost } from '../../lib/useApi';

export default function DistributeRepair() {
  const [week, setWeek] = useState('23-01');
  const [year, setYear] = useState('2026');
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState('');
  const [diag, setDiag] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const runDiagnose = async () => {
    setLoading(true); setErr(''); setMsg(''); setDiag(null);
    try {
      const d = await apiGet('/api/shipment/distribute-diagnose', { week, year });
      setDiag(d);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setLoading(false); }
  };

  const runRepair = async (action, label) => {
    if (!diag) { alert('먼저 진단을 실행하세요.'); return; }
    if (!confirm(`${week} 차수 — ${label}\n전산 DB(ShipmentDetail/ShipmentDate)를 보정합니다. 진행할까요?`)) return;
    setRepairing(action); setErr(''); setMsg('');
    try {
      const d = await apiPost('/api/shipment/distribute-diagnose', { week, year, action });
      setMsg(d.message || '보정 완료');
      await runDiagnose(); // 보정 후 재진단
    } catch (e) { setErr(e.message || String(e)); }
    finally { setRepairing(''); }
  };

  const s = diag?.summary || {};
  const baseRows = diag?.shipmentDateBaseMismatch || [];
  const custRows = diag?.missingCustKey || [];
  const dateRows = diag?.shipmentDateMismatch || [];

  return (
    <Layout>
      <Head><title>출고분배 진단/보정</title></Head>
      <div style={{ padding: 16, maxWidth: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>출고분배 진단 · 보정</h2>
          <Link href="/orders/paste" style={{ fontSize: 13, color: '#1565c0' }}>← 붙여넣기 주문</Link>
        </div>
        <p style={{ fontSize: 13, color: '#546e7a', marginTop: 0 }}>
          “분배가 전산(nenova.exe)에 안 보임”은 대개 <b>출고일이 전산 기준과 어긋난 행</b> 때문입니다.
          진단으로 건수를 확인하고, <b>출고일 보정</b>을 누르면 업체 기본출고일 기준으로 맞춰집니다.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13 }}>차수
            <input value={week} onChange={e => setWeek(e.target.value.trim())} placeholder="23-01"
              style={inp} />
          </label>
          <label style={{ fontSize: 13 }}>연도
            <input value={year} onChange={e => setYear(e.target.value.trim())} placeholder="2026"
              style={{ ...inp, width: 70 }} />
          </label>
          <button onClick={runDiagnose} disabled={loading} style={btnPrimary}>
            {loading ? '진단 중…' : '🔍 진단'}
          </button>
        </div>

        {err && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>오류: {err}</div>}
        {msg && <div style={{ color: '#1b5e20', fontSize: 13, marginBottom: 10 }}>✅ {msg}</div>}

        {diag && (
          <>
            <div style={cardWrap}>
              <Stat label="출고일 어긋남(6일밀림)" value={s.shipmentDateBaseMismatch} bad={s.shipmentDateBaseMismatch > 0} hint="← 분배 안 보임 주원인" />
              <Stat label="출고일/수량 불일치" value={s.shipmentDateMismatch} bad={s.shipmentDateMismatch > 0} />
              <Stat label="CustKey 불일치" value={s.missingCustKey} bad={s.missingCustKey > 0} />
              <Stat label="중복 마스터" value={s.duplicateMasters} bad={s.duplicateMasters > 0} />
              <Stat label="Est 불일치" value={s.estMismatch} bad={s.estMismatch > 0} />
              <Stat label="키넘버링" value={s.keyNumberingNeedsSync} bad={s.keyNumberingNeedsSync > 0} />
            </div>

            <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
              <button onClick={() => runRepair('repairShipmentDateBaseOutDay', '출고일 보정')}
                disabled={!!repairing || !(s.shipmentDateBaseMismatch > 0)} style={btnRepair}>
                {repairing === 'repairShipmentDateBaseOutDay' ? '보정 중…' : `🛠 출고일 보정 (${s.shipmentDateBaseMismatch || 0}건)`}
              </button>
              <button onClick={() => runRepair('repairMissingCustKey', 'CustKey 보정')}
                disabled={!!repairing || !(s.missingCustKey > 0)} style={btnRepairAlt}>
                {repairing === 'repairMissingCustKey' ? '보정 중…' : `🛠 CustKey 보정 (${s.missingCustKey || 0}건)`}
              </button>
            </div>

            {baseRows.length > 0 && (
              <Section title={`출고일 어긋난 분배 (${baseRows.length})`}>
                <Table head={['업체', '품목', '수량', '저장된 출고일', '정상 출고일']}
                  rows={baseRows.map(r => [r.CustName, r.ProdName, r.OutQuantity, r.ShipmentDtm, r.ExpectedDtm])} hot={4} />
              </Section>
            )}
            {custRows.length > 0 && (
              <Section title={`CustKey 불일치 (${custRows.length})`}>
                <Table head={['마스터CustKey', '상세CustKey', '품목', '수량']}
                  rows={custRows.map(r => [r.MasterCustKey, r.DetailCustKey, r.ProdName, r.OutQuantity])} />
              </Section>
            )}
            {dateRows.length > 0 && (
              <Section title={`출고일/수량 불일치 (${dateRows.length}) — ShipmentDate 합계≠출고수량 또는 출고일 비어있음`}>
                <Table head={['CustKey', '품목', '출고수량', 'ShipmentDate합계', '상세 출고일', 'Date 출고일']}
                  rows={dateRows.map(r => [r.CustKey, r.ProdName, r.OutQuantity, r.ShipmentDateQty, r.ShipmentDtm || '(없음)', r.ShipmentDateDtm || '(없음)'])} hot={3} />
                <div style={{ fontSize: 12, color: '#8a6d3b', marginTop: 4 }}>
                  ※ ShipmentDate 합계가 출고수량과 다르거나 출고일이 비어 있으면 전산 확정(usp_ShipmentFix)에서 막힐 수 있습니다.
                  해당 품목을 붙여넣기 분배로 다시 한 번 저장하면(수량 그대로) ShipmentDate가 재생성되어 맞춰집니다.
                </div>
              </Section>
            )}
            <div style={{ fontSize: 12, color: '#607d8b', marginTop: 10, lineHeight: 1.6 }}>
              ⓘ <b>Est 불일치</b>는 보정 대상이 아닙니다 — 카네이션/수국/루스커스처럼 박스 출고에 단·송이 금액
              기준을 쓰는 품목은 EstQuantity가 정상적으로 다릅니다(규칙 2). 강제로 맞추면 견적 금액이 깨집니다.
            </div>
            {baseRows.length === 0 && custRows.length === 0 && dateRows.length === 0 && (
              <div style={{ fontSize: 13, color: '#1b5e20', padding: '8px 0' }}>이 차수에는 출고일/CustKey/출고일수량 어긋난 분배가 없습니다. ✅</div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function Stat({ label, value, bad, hint }) {
  return (
    <div style={{ ...statBox, borderColor: bad ? '#ef9a9a' : '#c8e6c9', background: bad ? '#fff5f5' : '#f4fbf5' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: bad ? '#c0392b' : '#2e7d32' }}>{value ?? '-'}</div>
      <div style={{ fontSize: 12, color: '#455a64' }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: '#c0392b' }}>{hint}</div>}
    </div>
  );
}
function Section({ title, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}
function Table({ head, rows, hot }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e0e0e0', borderRadius: 6 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => (
              <td key={ci} style={{ ...td, ...(ci === hot ? { color: '#1b5e20', fontWeight: 700 } : {}) }}>{String(c ?? '')}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const inp = { marginLeft: 6, padding: '6px 8px', border: '1px solid #cfd8dc', borderRadius: 5, fontSize: 13, width: 90 };
const btnPrimary = { padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const btnRepair = { padding: '8px 16px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const btnRepairAlt = { padding: '8px 16px', background: '#6a1b9a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const cardWrap = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const statBox = { border: '1px solid', borderRadius: 8, padding: '10px 14px', minWidth: 120, textAlign: 'center' };
const th = { background: '#eceff1', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #cfd8dc', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' };
