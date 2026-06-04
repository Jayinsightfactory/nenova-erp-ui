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

  const [traceQ, setTraceQ] = useState('');
  const [traceRows, setTraceRows] = useState(null);
  const [traceRaw, setTraceRaw] = useState(null);
  const [traceGm, setTraceGm] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [cleaning, setCleaning] = useState(0);

  const runTrace = async () => {
    if (!traceQ.trim()) { alert('업체명 또는 품목 키워드를 입력하세요.'); return; }
    setTraceLoading(true); setErr(''); setMsg(''); setTraceRows(null); setTraceRaw(null); setTraceGm(null);
    try {
      const d = await apiGet('/api/shipment/item-trace', { week, q: traceQ.trim() });
      setTraceRows(d.rows || []);
      setTraceRaw(d.raw || []);
      setTraceGm(d.ghostMasters || []);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setTraceLoading(false); }
  };

  const cleanGhostMaster = async (g) => {
    if (!confirm(`고스트 마스터 정리\n업체: ${g.custName} (${g.custKey})\nShipmentKey: ${g.shipmentKey}\n사유: ${g.reason}\n\n이 빈/숨겨진 분배 마스터를 삭제해 주문 취소가 가능하게 합니다.\n(확정 아님 + 실제 표시분배 0건 확인됨) 진행할까요?`)) return;
    setCleaning(g.shipmentKey); setErr(''); setMsg('');
    try {
      const d = await apiPost('/api/shipment/ghost-master-cleanup', { shipmentKey: g.shipmentKey });
      setMsg(d.message || '정리 완료');
      await runTrace();
    } catch (e) { setErr(e.message || String(e)); }
    finally { setCleaning(0); }
  };

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

        <div style={{ marginTop: 22, borderTop: '1px solid #e0e0e0', paddingTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>주문 vs 분배 대조 (품목/업체로 검색)</div>
          <p style={{ fontSize: 12, color: '#607d8b', marginTop: 0 }}>
            “주문등록엔 나오는데 분배엔 안 나옴”을 품목별로 확인합니다. 예: <code>문라이트</code>, <code>라벤더</code>, <code>아이엠</code>.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <input value={traceQ} onChange={e => setTraceQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runTrace(); }}
              placeholder="업체명 또는 품목 키워드" style={{ ...inp, width: 240, marginLeft: 0 }} />
            <span style={{ fontSize: 12, color: '#90a4ae' }}>차수 {week}</span>
            <button onClick={runTrace} disabled={traceLoading} style={btnPrimary}>
              {traceLoading ? '조회 중…' : '🔎 주문/분배 조회'}
            </button>
          </div>
          {traceRows && traceRows.length === 0 && (
            <div style={{ fontSize: 13, color: '#90a4ae' }}>{week} 차수에 “{traceQ}” 관련 주문이 없습니다.</div>
          )}
          {traceRows && traceRows.length > 0 && (
            <div style={{ overflowX: 'auto', border: '1px solid #e0e0e0', borderRadius: 6 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                <thead><tr>{['업체', '품목', '주문수량', '분배수량', 'ShipDate합계', 'ShipFarm', '출고일', '상태', '사유'].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {traceRows.map((r, i) => {
                    const bad = r.status !== '정상';
                    const hidden = r.viewOrderVisible === false;
                    return (
                      <tr key={i} style={hidden ? { background: '#ffe0e0' } : (bad ? { background: '#fffaf3' } : {})}>
                        <td style={td}>{r.custName}</td>
                        <td style={td}>{r.prodName}</td>
                        <td style={td}>{r.orderQty}</td>
                        <td style={{ ...td, fontWeight: 700, color: r.shipQty == null ? '#c0392b' : '#1b5e20' }}>{r.shipQty == null ? '없음' : r.shipQty}</td>
                        <td style={td}>{r.shipDateQty == null ? '-' : r.shipDateQty}</td>
                        <td style={{ ...td, color: (r.shipFarmCnt === 0 && r.shipQty) ? '#c0392b' : '#607d8b', fontWeight: r.shipFarmCnt === 0 && r.shipQty ? 700 : 400 }}>{r.shipFarmCnt === 0 ? '없음' : r.shipFarmQty}</td>
                        <td style={td}>{r.shipDtm || '-'}</td>
                        <td style={{ ...td, color: hidden ? '#b71c1c' : (bad ? '#e65100' : '#2e7d32'), fontWeight: 700 }}>{r.status}</td>
                        <td style={{ ...td, color: hidden ? '#b71c1c' : '#607d8b', maxWidth: 360, whiteSpace: 'normal' }}>{r.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {traceRows && traceRows.some(r => r.status === '분배없음') && (
            <div style={{ fontSize: 12, color: '#8a6d3b', marginTop: 6 }}>
              ※ <b>분배없음</b> = 주문만 있고 분배(ShipmentDetail)가 안 만들어진 상태입니다.
              붙여넣기 주문에서 해당 품목을 <b>🚀 일괄 등록+분배</b>(또는 등록 후 🚀 일괄 분배)로 한 번 더 저장하면 분배가 생성됩니다.
            </div>
          )}

          {traceRaw && traceRaw.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                실제 분배 레코드 전체 (삭제 플래그 포함) — 전산 표시 여부 진단
                {traceRaw.some(r => r.ghost) && <span style={{ color: '#c0392b', marginLeft: 8 }}>⚠ 고스트 {traceRaw.filter(r => r.ghost).length}건</span>}
              </div>
              <div style={{ overflowX: 'auto', border: '1px solid #e0e0e0', borderRadius: 6 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead><tr>{['업체', '품목', 'ShipKey', 'SdKey', '수량', '출고일', '마스터삭제', '품목삭제', '업체삭제', '전산표시'].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {traceRaw.map((r, i) => (
                      <tr key={i} style={r.ghost ? { background: '#ffebee' } : (!r.visibleInErp ? { background: '#fff8e1' } : {})}>
                        <td style={td}>{r.custName}</td>
                        <td style={td}>{r.prodName}</td>
                        <td style={td}>{r.shipmentKey}</td>
                        <td style={td}>{r.sdetailKey}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{r.outQty}</td>
                        <td style={td}>{r.shipDtm || '-'}</td>
                        <td style={{ ...td, color: r.smDel ? '#c0392b' : '#bbb', fontWeight: r.smDel ? 700 : 400 }}>{r.smDel ? 'Y' : '·'}</td>
                        <td style={{ ...td, color: r.prodDel ? '#c0392b' : '#bbb', fontWeight: r.prodDel ? 700 : 400 }}>{r.prodDel ? 'Y' : '·'}</td>
                        <td style={{ ...td, color: r.custDel ? '#c0392b' : '#bbb', fontWeight: r.custDel ? 700 : 400 }}>{r.custDel ? 'Y' : '·'}</td>
                        <td style={{ ...td, color: r.visibleInErp ? '#2e7d32' : '#c0392b', fontWeight: 700 }} title={r.hiddenReason}>
                          {r.visibleInErp ? '표시' : `숨김(${r.hiddenReason})`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {traceRaw.some(r => r.ghost) && (
                <div style={{ fontSize: 12, color: '#8a6d3b', marginTop: 6 }}>
                  ⚠ <b>고스트</b> = 분배수량이 있는데 마스터/품목/업체가 삭제 처리돼 전산 화면엔 안 보이지만, 취소는 막는 레코드입니다.
                </div>
              )}
            </div>
          )}

          {traceGm && traceGm.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                출고 마스터(취소 게이트 단위) — nenova.exe 는 ShipmentMaster 존재로 취소를 막음
                {traceGm.some(g => g.blocksCancelButHidden) && <span style={{ color: '#c0392b', marginLeft: 8 }}>⚠ 취소차단 고스트 {traceGm.filter(g => g.blocksCancelButHidden).length}건</span>}
              </div>
              <div style={{ fontSize: 11, color: '#90a4ae', marginBottom: 4 }}>
                전산 취소 게이트: <code>COUNT(*) FROM ShipmentMaster WHERE 연도+차수+업체</code> (isDeleted 무시) · 화면: ViewShipment(표시가능 분배 필요)
              </div>
              <div style={{ overflowX: 'auto', border: '1px solid #e0e0e0', borderRadius: 6 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead><tr>{['업체', 'ShipKey', '확정', '상세수', '수량≠0', '표시가능', '전산표시', '사유', '정리'].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {traceGm.map((g, i) => (
                      <tr key={i} style={g.blocksCancelButHidden ? { background: '#ffebee' } : {}}>
                        <td style={td}>{g.custName}</td>
                        <td style={td}>{g.shipmentKey}</td>
                        <td style={{ ...td, color: g.smFix ? '#c0392b' : '#bbb' }}>{g.smFix ? '확정' : '·'}</td>
                        <td style={td}>{g.detailCnt}</td>
                        <td style={td}>{g.nzCnt}</td>
                        <td style={{ ...td, fontWeight: 700, color: g.visCnt > 0 ? '#1b5e20' : '#c0392b' }}>{g.visCnt}</td>
                        <td style={{ ...td, color: g.visibleInErp ? '#2e7d32' : '#c0392b', fontWeight: 700 }}>{g.visibleInErp ? '표시' : '숨김'}</td>
                        <td style={td} title={g.reason}>{g.reason}</td>
                        <td style={td}>
                          {g.blocksCancelButHidden && g.safeToClean ? (
                            <button onClick={() => cleanGhostMaster(g)} disabled={cleaning === g.shipmentKey}
                              style={{ ...btnRepairAlt, padding: '4px 10px', fontSize: 12 }}>
                              {cleaning === g.shipmentKey ? '정리중…' : '🧹 정리'}
                            </button>
                          ) : g.smFix ? <span style={{ fontSize: 11, color: '#90a4ae' }}>확정-불가</span>
                            : g.visibleInErp ? <span style={{ fontSize: 11, color: '#90a4ae' }}>정상</span>
                            : <span style={{ fontSize: 11, color: '#e65100' }}>실제분배有</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {traceGm.some(g => g.blocksCancelButHidden && g.safeToClean) && (
                <div style={{ fontSize: 12, color: '#8a6d3b', marginTop: 6 }}>
                  ⚠ <b>취소차단 고스트</b> = 전산엔 안 보이지만 ShipmentMaster가 남아 취소를 막는 빈/숨겨진 마스터입니다.
                  <b>🧹 정리</b>를 누르면 그 ShipmentKey만 안전하게 삭제(확정 아님 + 실제 표시분배 0 재검증)되어 주문 취소가 됩니다.
                </div>
              )}
            </div>
          )}
        </div>
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
