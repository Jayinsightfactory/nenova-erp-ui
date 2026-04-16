// pages/freight.js — 운송기준원가 탭
// BILL(AWB) 선택 → 차수 요약 + 카테고리 분배 + 품목 상세 그리드 → 스냅샷 저장 / 엑셀 다운로드
import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { apiGet } from '../lib/useApi';
import { useLang } from '../lib/i18n';
import { computeFreightCost, normalizeFlower } from '../lib/freightCalc';

const fmt = (n, d = 0) => (n == null || Number.isNaN(Number(n))) ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const fmt2 = n => fmt(n, 2);
const fmt4 = n => fmt(n, 4);
const pct = n => (n == null || Number.isNaN(Number(n))) ? '–' : (Number(n) * 100).toFixed(2) + '%';

export default function FreightPage() {
  const { t } = useLang();
  const [groups, setGroups] = useState([]);          // AWB 그룹 리스트 ([{ GroupKey, AWB, AllKeys, MergeCount, ... }])
  const [groupKey, setGroupKey] = useState('');      // 선택된 GroupKey
  const [basis, setBasis] = useState('AUTO');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [apiData, setApiData] = useState(null);
  const [master, setMaster] = useState(null);
  const [customs, setCustoms] = useState(null);
  const [rowsOverride, setRowsOverride] = useState({});
  const [editMode, setEditMode] = useState(false);

  // AWB 그룹 리스트 로드
  useEffect(() => {
    apiGet('/api/freight').then(d => setGroups(d.groups || [])).catch(e => setErr(e.message));
  }, []);

  // 그룹 선택시 로드
  useEffect(() => {
    if (!groupKey) return;
    const g = groups.find(x => x.GroupKey === groupKey);
    if (!g) return;
    setLoading(true);
    setErr(''); setMsg('');
    // AWB 있으면 awb 파라미터로, 없으면 warehouseKey
    const queryParams = g.AWB ? { awb: g.AWB } : { warehouseKey: g.PrimaryKey };
    apiGet('/api/freight', queryParams)
      .then(d => {
        if (!d.success) throw new Error(d.error);
        setApiData(d);
        setMaster({ ...d.input.master });
        setCustoms({ ...d.input.customs });
        setBasis(d.input.basis || 'AUTO');
        setRowsOverride({});
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [groupKey, groups]);

  // 실시간 재계산 (클라이언트)
  const liveResult = useMemo(() => {
    if (!apiData || !master || !customs) return null;
    const details = apiData.input.details.map(d => {
      const ov = rowsOverride[d.prodKey] || {};
      return { ...d,
        stemsPerBunch: ov.stemsPerBunch ?? d.stemsPerBunch,
        salePriceKRW:  ov.salePriceKRW  ?? d.salePriceKRW,
        tariffRate:    ov.tariffRate    ?? d.tariffRate,
      };
    });
    return computeFreightCost({
      master, basis, customs, details,
      productMeta: apiData.productMeta,
      flowerMeta: apiData.flowerMeta,
    });
  }, [apiData, master, customs, rowsOverride, basis]);

  const selectedGroup = groups.find(g => g.GroupKey === groupKey);

  const updateRow = (prodKey, field, val) => {
    setRowsOverride(m => ({ ...m, [prodKey]: { ...(m[prodKey] || {}), [field]: val === '' ? null : Number(val) } }));
  };

  const handleSave = async () => {
    if (!apiData || !master) return;
    if (!master.gw || !master.cw || !master.rateUSD || !master.exchangeRate) {
      alert('GW, CW, Rate, 환율은 필수입니다.'); return;
    }
    setSaving(true);
    try {
      const rows = apiData.input.details.map(d => {
        const ov = rowsOverride[d.prodKey] || {};
        return { ...d,
          stemsPerBunch: ov.stemsPerBunch ?? d.stemsPerBunch,
          salePriceKRW:  ov.salePriceKRW  ?? d.salePriceKRW,
          tariffRate:    ov.tariffRate    ?? d.tariffRate,
        };
      });
      const res = await fetch('/api/freight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseKey: apiData.primaryKey,
          warehouseKeys: apiData.warehouseKeys,
          basis, master, customs, rows,
        }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      setMsg(`✅ 스냅샷 저장 완료 (FreightKey ${d.freightKey}, 품목 ${d.saved}건)`);
      setTimeout(() => setMsg(''), 4000);
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };

  const handleExcel = () => {
    if (!apiData) { alert('BILL을 선택하세요.'); return; }
    const keys = (apiData.warehouseKeys || [apiData.primaryKey]).join(',');
    window.open(`/api/freight/excel?warehouseKeys=${keys}&awb=${encodeURIComponent(apiData.awb || '')}`, '_blank');
  };

  return (
    <div>
      <Head><title>운송기준원가 / Shipping Cost</title></Head>

      {/* 필터 바 */}
      <div className="filter-bar">
        <span className="filter-label">BILL / AWB</span>
        <select className="filter-input" value={groupKey} onChange={e => setGroupKey(e.target.value)} style={{ minWidth: 380 }}>
          <option value="">선택하세요</option>
          {groups.map(g => (
            <option key={g.GroupKey} value={g.GroupKey}>
              {g.AWB ? `AWB ${g.AWB}` : `[AWB없음]`}
              {g.MergeCount > 1 ? ` · ${g.MergeCount}원장 합산` : ''}
              {` · ${g.OrderWeek || ''} · ${g.FarmName || ''} (${g.InputDate})`}
              {g.FreightKey ? ' 💾' : ''}
            </option>
          ))}
        </select>
        <span className="filter-label" style={{ marginLeft: 12 }}>기준</span>
        <label style={{ fontSize: 12, cursor: 'pointer' }}>
          <input type="radio" checked={basis === 'AUTO'} onChange={() => setBasis('AUTO')} /> 자동
        </label>
        <label style={{ fontSize: 12, cursor: 'pointer', marginLeft: 8 }}>
          <input type="radio" checked={basis === 'GW'} onChange={() => setBasis('GW')} /> GW (무게)
        </label>
        <label style={{ fontSize: 12, cursor: 'pointer', marginLeft: 8 }}>
          <input type="radio" checked={basis === 'CBM'} onChange={() => setBasis('CBM')} /> CBM (부피)
        </label>
        <div className="page-actions">
          <label style={{ fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={editMode} onChange={e => setEditMode(e.target.checked)} /> 편집모드
          </label>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !apiData}>💾 스냅샷 저장</button>
          <button className="btn btn-secondary" onClick={handleExcel} disabled={!apiData}>📊 엑셀</button>
          <button className="btn btn-secondary" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기</button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>⚠️ {err}</div>}
      {msg && <div style={{ padding: '8px 14px', background: 'var(--green-bg)', color: 'var(--green)', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>{msg}</div>}

      {!groupKey && (
        <div className="empty-state" style={{ padding: 80 }}>
          <div className="empty-icon">📦</div>
          <div className="empty-text">상단에서 BILL을 선택하세요. 같은 AWB로 여러 번 업로드된 경우 자동으로 합산됩니다.</div>
        </div>
      )}

      {loading && <div className="skeleton" style={{ height: 400, borderRadius: 8 }}></div>}

      {apiData && master && customs && liveResult && (
        <>
          {/* 경고 배너 */}
          {liveResult.warnings.length > 0 && (
            <div style={{ padding: '8px 14px', background: 'var(--amber-bg, #fff8e1)', color: 'var(--amber, #f57c00)', borderRadius: 8, marginBottom: 10, fontSize: 12 }}>
              {liveResult.warnings.map((w, i) => (
                <div key={i}>{w.level === 'error' ? '⛔' : '⚠️'} {w.msg}</div>
              ))}
            </div>
          )}

          {/* 차수 요약 + 설정값 */}
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="card-header">
              <span className="card-title">차수 요약 · 입력값</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>
                {selectedGroup?.OrderWeek} · {selectedGroup?.FarmName} · AWB {selectedGroup?.AWB || '–'} · {selectedGroup?.InputDate}
                {apiData.mergeCount > 1 && <span style={{ marginLeft: 8, padding: '2px 6px', background: 'var(--blue-bg)', color: 'var(--blue)', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>🔗 {apiData.mergeCount}원장 합산</span>}
                {apiData.snapshot && <span style={{ marginLeft: 12, color: 'var(--green)' }}>💾 스냅샷 있음 (최종 {new Date(apiData.snapshot.UpdateDtm || apiData.snapshot.CreateDtm).toLocaleString()})</span>}
              </span>
            </div>
            <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, fontSize: 12 }}>
              <NumField label="총금액 Invoice (USD)" value={master.invoiceUSD} onChange={v => setMaster(m => ({ ...m, invoiceUSD: v }))} readOnly={!editMode} />
              <NumField label="환율 (KRW/USD)" value={master.exchangeRate} onChange={v => setMaster(m => ({ ...m, exchangeRate: v }))} readOnly={!editMode} />
              <NumField label="GW 실중량 (kg)" value={master.gw} onChange={v => setMaster(m => ({ ...m, gw: v }))} readOnly={!editMode} />
              <NumField label="CW 과금중량 (kg)" value={master.cw} onChange={v => setMaster(m => ({ ...m, cw: v }))} readOnly={!editMode} />
              <NumField label="Rate (USD/kg)" value={master.rateUSD} onChange={v => setMaster(m => ({ ...m, rateUSD: v }))} readOnly={!editMode} />
              <NumField label="서류 (USD)" value={master.docFeeUSD} onChange={v => setMaster(m => ({ ...m, docFeeUSD: v }))} readOnly={!editMode} />
              <NumField label="품목수 (자동)" value={master.itemCount} readOnly />
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>항공료 계산</div>
                <div style={{ fontWeight: 700, color: 'var(--blue)' }}>{fmt2(liveResult.header.freightTotalUSD)} USD</div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>기준: {liveResult.header.basis}</div>
              </div>
            </div>
            <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', margin: '8px 0' }}>📦 통관비 상수 (KRW) — 차수별 수정 가능</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
                <NumField label="백상 단가 × GW" value={customs.bakSangRate} onChange={v => setCustoms(c => ({ ...c, bakSangRate: v }))} readOnly={!editMode} />
                <NumField label="수수료" value={customs.handlingFee} onChange={v => setCustoms(c => ({ ...c, handlingFee: v }))} readOnly={!editMode} />
                <NumField label="검역 × 품목수" value={customs.quarantinePerItem} onChange={v => setCustoms(c => ({ ...c, quarantinePerItem: v }))} readOnly={!editMode} />
                <NumField label="국내운송" value={customs.domesticFreight} onChange={v => setCustoms(c => ({ ...c, domesticFreight: v }))} readOnly={!editMode} />
                <NumField label="차감" value={customs.deductFee} onChange={v => setCustoms(c => ({ ...c, deductFee: v }))} readOnly={!editMode} />
                <NumField label="추가 통관" value={customs.extraFee} onChange={v => setCustoms(c => ({ ...c, extraFee: v }))} readOnly={!editMode} />
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--blue)', fontWeight: 600 }}>
                → 통관 합계: {fmt(liveResult.header.customsTotalKRW)} 원
              </div>
            </div>
          </div>

          {/* 카테고리별 분배 */}
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="card-header"><span className="card-title">카테고리별 분배 (BILL 포함 카테고리만)</span></div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>카테고리</th>
                  <th style={{ textAlign: 'right' }}>박스수</th>
                  <th style={{ textAlign: 'right' }}>박스무게</th>
                  <th style={{ textAlign: 'right' }}>박스CBM</th>
                  <th style={{ textAlign: 'right' }}>송이/박스</th>
                  <th style={{ textAlign: 'right' }}>총 송이수</th>
                  <th style={{ textAlign: 'right' }}>무게비율</th>
                  <th style={{ textAlign: 'right' }}>CBM비율</th>
                  <th style={{ textAlign: 'right' }}>사용 비율</th>
                  <th style={{ textAlign: 'right' }}>운임 (USD)</th>
                  <th style={{ textAlign: 'right' }}>운임/송이 (USD)</th>
                  <th style={{ textAlign: 'right' }}>통관/송이 (KRW)</th>
                </tr>
              </thead>
              <tbody>
                {liveResult.categories.map(c => (
                  <tr key={c.flowerName}>
                    <td className="name"><span className="badge badge-purple">{c.flowerName}</span></td>
                    <td className="num">{fmt(c.boxCount)}</td>
                    <td className="num">{c.boxWeight ?? '–'}</td>
                    <td className="num">{c.boxCBM ?? '–'}</td>
                    <td className="num">{c.stemsPerBox ?? '–'}</td>
                    <td className="num">{fmt(c.stemsCount)}</td>
                    <td className="num">{pct(c.weightRatio)}</td>
                    <td className="num">{pct(c.cbmRatio)}</td>
                    <td className="num" style={{ fontWeight: 700, color: 'var(--blue)' }}>{pct(c.usedRatio)}</td>
                    <td className="num">{fmt2(c.freightUSD)}</td>
                    <td className="num">{fmt4(c.freightPerStemUSD)}</td>
                    <td className="num">{fmt2(c.customsPerStemKRW)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 품목 상세 그리드 */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">품목 상세 원가</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>{liveResult.rows.length}개 품목</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ minWidth: 1400, fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>농장</th><th>품목명</th>
                    <th style={{ textAlign: 'right' }}>수량</th>
                    <th style={{ textAlign: 'right' }}>FOB</th>
                    <th style={{ textAlign: 'right' }}>운송비/송이</th>
                    <th style={{ textAlign: 'right' }}>CNF USD</th>
                    <th style={{ textAlign: 'right' }}>CNF 원</th>
                    <th style={{ textAlign: 'right' }}>관세</th>
                    <th style={{ textAlign: 'right' }}>그외통관</th>
                    <th style={{ textAlign: 'right' }}>도착원가/송이</th>
                    <th style={{ textAlign: 'right' }}>단수(N)</th>
                    <th style={{ textAlign: 'right' }}>도착원가/단</th>
                    <th style={{ textAlign: 'right' }}>판매가(Q)</th>
                    <th style={{ textAlign: 'right' }}>단이익</th>
                    <th style={{ textAlign: 'right' }}>이익률</th>
                    <th style={{ textAlign: 'right' }}>종 판매</th>
                    <th style={{ textAlign: 'right' }}>종 이익</th>
                  </tr>
                </thead>
                <tbody>
                  {liveResult.rows.map((r, i) => {
                    const overridden = rowsOverride[r.prodKey] || {};
                    const profitNeg = (r.profitPerBunch || 0) < 0;
                    // 농장 바뀔 때만 표시 (엑셀 원본과 동일)
                    const prevFarm = i > 0 ? liveResult.rows[i-1].farmName : null;
                    const showFarm = r.farmName && r.farmName !== prevFarm;
                    const isFarmBoundary = i > 0 && r.farmName !== prevFarm;
                    return (
                      <tr key={i} style={{
                        background: overridden.stemsPerBunch != null || overridden.salePriceKRW != null ? '#fffde7' : undefined,
                        borderTop: isFarmBoundary ? '2px solid var(--blue)' : undefined,
                      }}>
                        <td style={{ color: 'var(--blue)', fontSize: 11, fontWeight: showFarm ? 700 : 400 }}>{showFarm ? r.farmName : ''}</td>
                        <td>{r.prodName}</td>
                        <td className="num">{fmt(r.steamQty)}</td>
                        <td className="num">{fmt2(r.fobUSD)}</td>
                        <td className="num">{fmt4(r.freightPerStemUSD)}</td>
                        <td className="num">{fmt4(r.cnfUSD)}</td>
                        <td className="num">{fmt2(r.cnfKRW)}</td>
                        <td className="num" style={{ color: r.tariffKRW > 0 ? 'var(--amber)' : 'var(--text3)' }}>{fmt2(r.tariffKRW)}</td>
                        <td className="num">{fmt2(r.customsPerStem)}</td>
                        <td className="num">{fmt2(r.arrivalPerStem)}</td>
                        <td className="num">
                          {editMode
                            ? <input type="number" value={rowsOverride[r.prodKey]?.stemsPerBunch ?? r.stemsPerBunch ?? ''} onChange={e => updateRow(r.prodKey, 'stemsPerBunch', e.target.value)} style={iCell} />
                            : fmt(r.stemsPerBunch)}
                        </td>
                        <td className="num">{fmt2(r.arrivalPerBunch)}</td>
                        <td className="num">
                          {editMode
                            ? <input type="number" value={rowsOverride[r.prodKey]?.salePriceKRW ?? r.salePriceKRW ?? ''} onChange={e => updateRow(r.prodKey, 'salePriceKRW', e.target.value)} style={iCell} />
                            : fmt(r.salePriceKRW)}
                        </td>
                        <td className="num" style={{ color: profitNeg ? 'var(--red)' : 'inherit' }}>{fmt2(r.profitPerBunch)}</td>
                        <td className="num" style={{ color: profitNeg ? 'var(--red)' : 'inherit', fontWeight: 600 }}>{pct(r.profitRate)}</td>
                        <td className="num">{fmt(r.totalSaleKRW)}</td>
                        <td className="num" style={{ color: profitNeg ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>{fmt(r.totalProfitKRW)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="foot">
                    <td colSpan={15} style={{ textAlign: 'right' }}>합계</td>
                    <td className="num">{fmt(liveResult.totals.totalSaleKRW)}</td>
                    <td className="num" style={{ color: liveResult.totals.totalProfitKRW < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>{fmt(liveResult.totals.totalProfitKRW)}</td>
                  </tr>
                  <tr className="foot">
                    <td colSpan={15} style={{ textAlign: 'right' }}>종 이익률</td>
                    <td colSpan={2} className="num" style={{ fontWeight: 700, color: 'var(--blue)' }}>{pct(liveResult.totals.overallProfitRate)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const iCell = { width: 70, height: 22, border: '1px solid var(--border2)', borderRadius: 4, textAlign: 'right', fontSize: 11, fontFamily: 'var(--mono)', padding: '0 4px', background: '#fff' };

function NumField({ label, value, onChange, readOnly }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
      {readOnly
        ? <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)' }}>{value != null ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '–'}</div>
        : <input type="number" step="any" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} style={{ width: '100%', height: 26, border: '1px solid var(--blue)', borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 6px', background: '#e3f2fd' }} />}
    </div>
  );
}
