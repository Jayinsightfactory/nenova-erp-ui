// pages/demo/commercial-suite.js — NOWLINK · MOYI 업종별 상용 솔루션 시연 스튜디오 (외부 시연용 100% 가상 데이터)
import { useMemo, useState } from 'react';
import Head from 'next/head';
import {
  DEVICE_HUB_ADDON,
  INDUSTRY_PRESETS,
  PRICING_PLANS,
  buildMappingJson,
  calculateCommercialRoi,
  calculateLandedCost,
  calculateThreeUnitTotals,
  getIndustryPreset,
} from '../../lib/commercialSuiteDemo';

const SIM_STAGES = [
  { id: 'captured', stepNo: '1', label: '채널 수집 (Read-Only)' },
  { id: 'leased', stepNo: '2', label: 'Device Hub · 3단위 환산' },
  { id: 'approval', stepNo: '3', label: 'MOYI 승인 카드' },
  { id: 'applied', stepNo: '4', label: '원장 반영 영수증' },
];

function formatKrw(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}원`;
}

export default function CommercialSuiteDemoPage() {
  const [industryId, setIndustryId] = useState('flower');
  const [selectedSku, setSelectedSku] = useState('');
  const [largeQtyOverride, setLargeQtyOverride] = useState(null);
  const [simStage, setSimStage] = useState('approval');
  const [moyiApproved, setMoyiApproved] = useState(false);
  const [supplyAdjustPct, setSupplyAdjustPct] = useState(0);
  const [logisticsAdjustPct, setLogisticsAdjustPct] = useState(0);
  const [planId, setPlanId] = useState('team');
  const [includeDeviceHub, setIncludeDeviceHub] = useState(true);
  const [staffCount, setStaffCount] = useState(12);
  const [deviceCount, setDeviceCount] = useState(2);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  const preset = useMemo(() => getIndustryPreset(industryId), [industryId]);
  const [largeUnit, midUnit, smallUnit] = preset.units;

  const activeItem = useMemo(
    () => preset.catalogItems.find((item) => item.sku === selectedSku) || preset.catalogItems[0],
    [preset, selectedSku]
  );

  const effectiveLargeQty = useMemo(() => {
    if (largeQtyOverride === null || largeQtyOverride === '') return activeItem.defaultLargeQty;
    const parsed = Number(largeQtyOverride);
    if (!Number.isFinite(parsed) || parsed < 1) return activeItem.defaultLargeQty;
    return Math.min(200, Math.round(parsed));
  }, [largeQtyOverride, activeItem.defaultLargeQty]);

  const inputLargeQtyValue = largeQtyOverride !== null ? largeQtyOverride : String(activeItem.defaultLargeQty);

  const unitSummary = useMemo(
    () => calculateThreeUnitTotals(activeItem, effectiveLargeQty),
    [activeItem, effectiveLargeQty]
  );

  const landedSummary = useMemo(
    () => calculateLandedCost(preset, { supplyAdjustPct, logisticsAdjustPct }),
    [preset, supplyAdjustPct, logisticsAdjustPct]
  );

  const roiSummary = useMemo(
    () =>
      calculateCommercialRoi({
        staffCount,
        deviceCount,
        planId,
        includeDeviceHub,
      }),
    [staffCount, deviceCount, planId, includeDeviceHub]
  );

  const mappingJsonText = useMemo(
    () => JSON.stringify(buildMappingJson(preset), null, 2),
    [preset]
  );

  const handleSelectIndustry = (nextId) => {
    setIndustryId(nextId);
    setSelectedSku('');
    setLargeQtyOverride(null);
    setSimStage('approval');
    setMoyiApproved(false);
    setSupplyAdjustPct(0);
    setLogisticsAdjustPct(0);
    setCopyStatus('');
  };

  const handleSelectItem = (item) => {
    setSelectedSku(item.sku);
    setLargeQtyOverride(String(item.defaultLargeQty));
  };

  const handleApproveMoyi = () => {
    setMoyiApproved(true);
    setSimStage('applied');
  };

  const handleResetMoyi = () => {
    setMoyiApproved(false);
    setSimStage('approval');
  };

  const handleCopyMappingJson = async () => {
    try {
      await navigator.clipboard.writeText(mappingJsonText);
      setCopyStatus(`${preset.shortLabel} mapping.json 복사 완료`);
    } catch {
      setCopyStatus('브라우저 클립보드 권한이 없어 아래 JSON을 직접 선택하세요.');
    }
  };

  const handleDownloadMappingJson = () => {
    const blob = new Blob([mappingJsonText], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mapping.${preset.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setCopyStatus(`mapping.${preset.id}.json 다운로드 완료`);
  };

  return (
    <>
      <Head>
        <title>NOWLINK · MOYI 업종별 상용 솔루션 시연 스튜디오</title>
      </Head>

      <div
        data-testid="commercial-suite-demo"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          maxWidth: 1560,
          margin: '0 auto',
          paddingBottom: 140,
        }}
      >
        {/* 상단 시연 헤더 & 4대 업종 실시간 치환 스위치 */}
        <section
          className="card"
          style={{
            padding: '16px 18px',
            borderTop: `4px solid ${preset.accent}`,
            background: '#ffffff',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '3px 9px',
                    borderRadius: 999,
                    background: preset.accentSoft,
                    color: preset.accent,
                  }}
                >
                  {preset.badge}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '3px 9px',
                    borderRadius: 999,
                    background: '#f1f5f9',
                    color: '#334155',
                  }}
                >
                  외부 시연 전용 · 100% 가상 샘플 (실거래·사내 실명 비노출)
                </span>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  테넌트: <code>{preset.tenantCode}</code> · {preset.sampleCompany}
                </span>
              </div>
              <h1 data-desktop-chrome style={{ margin: '0 0 4px', fontSize: 21, fontWeight: 900, color: '#0f172a' }}>
                NOWLINK · MOYI 업종별 상용 솔루션 시연 스튜디오
              </h1>
              <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>{preset.headline}</p>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-sm"
                data-act="toggle-mapping-json"
                onClick={() => setJsonOpen((v) => !v)}
              >
                {jsonOpen ? 'mapping.json 닫기' : 'mapping.json 보기'}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-act="download-mapping-json"
                onClick={handleDownloadMappingJson}
              >
                mapping.json 내려받기
              </button>
            </div>
          </div>

          {/* 4대 업종 실시간 치환 버튼 바 */}
          <div
            data-testid="industry-switcher"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 8,
              marginTop: 14,
            }}
          >
            {INDUSTRY_PRESETS.map((item) => {
              const active = item.id === preset.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-industry={item.id}
                  aria-pressed={active}
                  onClick={() => handleSelectIndustry(item.id)}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: active ? `2px solid ${item.accent}` : '1px solid #cbd5e1',
                    background: active ? item.accentSoft : '#f8fafc',
                    color: '#0f172a',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <strong style={{ fontSize: 13, color: active ? item.accent : '#0f172a' }}>{item.label}</strong>
                    {active && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: 999,
                          background: item.accent,
                          color: '#fff',
                        }}
                      >
                        LIVE
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#475569' }}>
                    {item.sourceLabel} / {item.units.join('·')} / {item.bucketLabel}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 실시간 mapping.json 용어 치환 배지 스트립 */}
          <div
            data-testid="terminology-strip"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 8,
              marginTop: 10,
              paddingTop: 10,
              borderTop: '1px solid #e2e8f0',
              fontSize: 12,
            }}
          >
            <div style={{ background: '#f8fafc', padding: '7px 10px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <span style={{ color: '#64748b', fontSize: 11 }}>출처·원산지 축</span>
              <div style={{ fontWeight: 800, color: '#0f172a' }}>{preset.sourceLabel}</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '7px 10px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <span style={{ color: '#64748b', fontSize: 11 }}>3단위 환산 체계</span>
              <div style={{ fontWeight: 800, color: preset.accent }}>{preset.units.join(' → ')}</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '7px 10px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <span style={{ color: '#64748b', fontSize: 11 }}>기간·차수 버킷</span>
              <div style={{ fontWeight: 800, color: '#0f172a' }}>
                {preset.bucketLabel} ({preset.sampleBucket})
              </div>
            </div>
            <div style={{ background: '#f8fafc', padding: '7px 10px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <span style={{ color: '#64748b', fontSize: 11 }}>안전 제어 정책</span>
              <div style={{ fontWeight: 800, color: '#167047' }}>Read-Only 수집 · 사람 승인 후 반영</div>
            </div>
          </div>

          {copyStatus && (
            <div className="banner-ok" style={{ marginTop: 10, padding: '6px 10px', fontSize: 12 }}>
              {copyStatus}
            </div>
          )}

          {jsonOpen && (
            <div
              data-testid="mapping-json-panel"
              style={{ marginTop: 12, border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden' }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontSize: 12,
                }}
              >
                <strong>config/mapping.{preset.id}.json (무코드 업종 이식 스키마)</strong>
                <button type="button" className="btn btn-sm" onClick={handleCopyMappingJson}>
                  JSON 복사
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  maxHeight: 260,
                  overflow: 'auto',
                  fontSize: 11,
                  background: '#020617',
                  color: '#cbd5e1',
                }}
              >
                {mappingJsonText}
              </pre>
            </div>
          )}
        </section>

        {/* 메인 2x2 상용 시연 그리드 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(560px, 1fr))',
            gap: 14,
            alignItems: 'start',
          }}
        >
          {/* ① 3단위 품목 마스터 & 주문·분배 테이블 */}
          <section className="card" data-testid="section-three-unit-master" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: '#0f172a' }}>
                  ① 3단위 품목 마스터 &amp; 주문·분배 테이블
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                  {preset.sourceLabel} 기준 품목 선택 시 <strong>{largeUnit} → {midUnit} → {smallUnit}</strong> 환산 및 거래처 분배 자동 계산
                </p>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: preset.accentSoft,
                  color: preset.accent,
                }}
              >
                {preset.bucketLabel}: {preset.sampleBucket}
              </span>
            </div>

            {/* 품목 선택 테이블 */}
            <div className="table-wrap" style={{ overflowX: 'auto', marginBottom: 12 }}>
              <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#edf2f8' }}>
                    <th style={{ padding: '7px 8px', textAlign: 'left' }}>품목명</th>
                    <th style={{ padding: '7px 8px', textAlign: 'left' }}>{preset.sourceLabel}</th>
                    <th style={{ padding: '7px 8px', textAlign: 'right' }}>환산비</th>
                    <th style={{ padding: '7px 8px', textAlign: 'right' }}>기준 {midUnit} 단가</th>
                  </tr>
                </thead>
                <tbody>
                  {preset.catalogItems.map((item) => {
                    const isSelected = item.sku === activeItem.sku;
                    return (
                      <tr
                        key={item.sku}
                        data-sku={item.sku}
                        onClick={() => handleSelectItem(item)}
                        style={{
                          cursor: 'pointer',
                          background: isSelected ? preset.accentSoft : undefined,
                          fontWeight: isSelected ? 700 : 400,
                        }}
                      >
                        <td style={{ padding: '7px 8px' }}>
                          <span style={{ color: preset.accent, fontWeight: 700, marginRight: 6 }}>{item.sku}</span>
                          {item.name}
                        </td>
                        <td style={{ padding: '7px 8px', color: '#475569' }}>{item.originSource}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                          1{largeUnit}={item.ratioMidPerLarge}{midUnit} ({item.ratioMidPerLarge * item.ratioSmallPerMid}{smallUnit})
                        </td>
                        <td style={{ padding: '7px 8px', textAlign: 'right' }}>{formatKrw(item.midUnitPriceKrw)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 수량 입력 & 3단위 실시간 환산 바 */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: 8,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                marginBottom: 12,
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700 }}>
                <span>발주 수량 ({largeUnit}):</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  data-testid="unit-large-input"
                  className="form-control"
                  value={inputLargeQtyValue}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setLargeQtyOverride('');
                      return;
                    }
                    const digits = raw.replace(/[^\d]/g, '');
                    setLargeQtyOverride(digits ? String(Math.min(200, Number(digits))) : '');
                  }}
                  onBlur={() => {
                    if (!largeQtyOverride || Number(largeQtyOverride) < 1) {
                      setLargeQtyOverride(String(activeItem.defaultLargeQty));
                    }
                  }}
                  style={{ width: 74, padding: '4px 8px', fontWeight: 800, textAlign: 'right' }}
                />
              </label>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
                <span>
                  대단위: <strong>{unitSummary.largeQty.toLocaleString('ko-KR')}{largeUnit}</strong>
                </span>
                <span>
                  중단위: <strong style={{ color: preset.accent }}>{unitSummary.midQty.toLocaleString('ko-KR')}{midUnit}</strong>
                </span>
                <span>
                  소단위: <strong>{unitSummary.smallQty.toLocaleString('ko-KR')}{smallUnit}</strong>
                </span>
                <span>
                  공급합계: <strong style={{ color: '#167047' }}>{formatKrw(unitSummary.totalSalesKrw)}</strong>
                </span>
              </div>
            </div>

            {/* 거래처별 분배 테이블 */}
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#edf2f8' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>가상 거래처</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>{largeUnit}</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>{midUnit}</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>{smallUnit}</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>공급액</th>
                    <th style={{ padding: '6px 8px', textAlign: 'center' }}>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {unitSummary.allocations.map((row) => (
                    <tr key={row.buyer}>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{row.buyer}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{row.largeQty}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: preset.accent }}>
                        {row.midQty.toLocaleString('ko-KR')}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{row.smallQty.toLocaleString('ko-KR')}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatKrw(row.amountKrw)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 7px',
                            borderRadius: 999,
                            background: '#edf8f1',
                            color: '#167047',
                            fontWeight: 700,
                          }}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ② Phone Harness + 카톡/위챗 수집 → MOYI 모바일 승인 카드 시뮬레이터 */}
          <section className="card" data-testid="section-phone-moyi-simulator" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: '#0f172a' }}>
                  ② Phone Harness + 메신저 수집 → MOYI 승인 카드
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                  Read-Only 공용폰 수집 후 3단위 자동 환산 · 사람 승인 분리(2FA)까지 실시간 시연
                </p>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {SIM_STAGES.map((stage) => {
                  const active = simStage === stage.id;
                  return (
                    <button
                      key={stage.id}
                      type="button"
                      data-sim-stage={stage.id}
                      onClick={() => setSimStage(stage.id)}
                      className={`chip ${active ? 'chip-active' : 'chip-inactive'}`}
                      style={{ padding: '4px 8px', fontSize: 11, border: '1px solid #cbd5e1' }}
                    >
                      {stage.stepNo}. {stage.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 12,
              }}
            >
              {/* 왼쪽: Phone Harness 목업 */}
              <div
                data-testid="phone-harness-mockup"
                style={{
                  borderRadius: 12,
                  border: '2px solid #1e293b',
                  background: '#0f172a',
                  color: '#f8fafc',
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                  <span style={{ fontWeight: 800, color: '#38bdf8' }}>{preset.phoneHarness.deviceId}</span>
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: 999,
                      background: '#064e3b',
                      color: '#6ee7b7',
                      fontWeight: 700,
                      fontSize: 10,
                    }}
                  >
                    Read-Only · 발송차단
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  {preset.phoneHarness.channel} · {preset.phoneHarness.receivedAt}
                </div>
                <div style={{ background: '#1e293b', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 700, marginBottom: 4 }}>
                    {preset.phoneHarness.roomTitle} ({preset.phoneHarness.sender})
                  </div>
                  <div
                    style={{
                      background: '#334155',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 12,
                      color: '#fef08a',
                      lineHeight: 1.45,
                    }}
                  >
                    {preset.phoneHarness.rawMessage}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#a5f3fc', lineHeight: 1.4 }}>
                  <div>
                    <strong>중복 방지:</strong> <code>{preset.phoneHarness.dedupKey}</code>
                  </div>
                  <div>
                    <strong>OCR·AI 환산:</strong> {preset.phoneHarness.ocrHighlight}
                  </div>
                </div>
              </div>

              {/* 오른쪽: MOYI 모바일 승인 카드 */}
              <div
                data-testid="moyi-approval-card"
                style={{
                  borderRadius: 12,
                  border: `2px solid ${moyiApproved ? '#167047' : preset.accent}`,
                  background: '#ffffff',
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                    <strong style={{ color: preset.accent }}>{preset.phoneHarness.moyiCard.room}</strong>
                    <span
                      style={{
                        padding: '2px 7px',
                        borderRadius: 999,
                        fontWeight: 800,
                        fontSize: 10,
                        background: moyiApproved ? '#dcfce7' : '#fef3c7',
                        color: moyiApproved ? '#166534' : '#92400e',
                      }}
                    >
                      {moyiApproved ? 'APPLIED · 원장 반영 완료' : 'DRAFT · 사람 승인 대기'}
                    </span>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
                    {preset.phoneHarness.moyiCard.title}
                  </div>

                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                      padding: 8,
                      fontSize: 12,
                      display: 'grid',
                      gap: 3,
                    }}
                  >
                    <div>
                      <span style={{ color: '#64748b' }}>대상 품목:</span> <strong>{preset.phoneHarness.moyiCard.item}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#64748b' }}>3단위 환산:</span>{' '}
                      <strong style={{ color: preset.accent }}>{preset.phoneHarness.moyiCard.qtyText}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#64748b' }}>기안/승인 분리:</span> {preset.phoneHarness.moyiCard.proposedBy} →{' '}
                      {preset.phoneHarness.moyiCard.approvedBy}
                    </div>
                  </div>

                  {(moyiApproved || simStage === 'applied') && (
                    <div
                      data-testid="moyi-receipt-box"
                      style={{
                        background: '#edf8f1',
                        border: '1px solid #86efac',
                        borderRadius: 6,
                        padding: 8,
                        fontSize: 11,
                        color: '#14532d',
                      }}
                    >
                      <strong>영수증 {preset.phoneHarness.moyiCard.receiptId}:</strong>{' '}
                      {preset.phoneHarness.moyiCard.ledgerSummary}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    data-act="moyi-approve"
                    className="btn btn-success btn-sm"
                    onClick={handleApproveMoyi}
                    disabled={moyiApproved}
                    style={{ flex: 1, fontWeight: 800 }}
                  >
                    {moyiApproved ? 'MOYI 승인 및 원장 반영 완료' : 'MOYI 원터치 승인 실행'}
                  </button>
                  <button type="button" data-act="moyi-reset" className="btn btn-sm" onClick={handleResetMoyi}>
                    초기화
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ③ Landed Cost(도착원가) 자동 배부 예시 */}
          <section className="card" data-testid="section-landed-cost" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: '#0f172a' }}>
                  ③ Landed Cost(도착원가) 자동 배부 예시
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                  {preset.landedCost.batchLabel} 기준 {largeUnit}·{midUnit}·{smallUnit} 단위 도착원가 자동 산출
                </p>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: '#edf8f1',
                  color: '#167047',
                }}
              >
                목표 총이익률 {landedSummary.marginPct}%
              </span>
            </div>

            {/* 환율·시세 / 물류·운임 시뮬레이션 슬라이더 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                marginBottom: 12,
                fontSize: 12,
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontWeight: 700 }}>
                  매입·환율 시나리오 변동: <strong style={{ color: preset.accent }}>{supplyAdjustPct >= 0 ? `+${supplyAdjustPct}%` : `${supplyAdjustPct}%`}</strong>
                </span>
                <input
                  type="range"
                  min={-15}
                  max={20}
                  step={1}
                  data-testid="landed-supply-slider"
                  value={supplyAdjustPct}
                  onChange={(e) => setSupplyAdjustPct(Number(e.target.value))}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontWeight: 700 }}>
                  운임·물류비 변동: <strong style={{ color: preset.accent }}>{logisticsAdjustPct >= 0 ? `+${logisticsAdjustPct}%` : `${logisticsAdjustPct}%`}</strong>
                </span>
                <input
                  type="range"
                  min={-15}
                  max={25}
                  step={1}
                  data-testid="landed-logistics-slider"
                  value={logisticsAdjustPct}
                  onChange={(e) => setLogisticsAdjustPct(Number(e.target.value))}
                />
              </label>
            </div>

            {/* 비용 항목 배부 표 */}
            <div className="table-wrap" style={{ overflowX: 'auto', marginBottom: 12 }}>
              <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#edf2f8' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>원가 구성 항목</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>총 배부 금액</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>{midUnit}당 배부</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '6px 8px' }}>{preset.landedCost.costLabels[0]}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatKrw(landedSummary.adjustedFobKrw)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {formatKrw(landedSummary.adjustedFobKrw / preset.landedCost.midQty)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 8px' }}>{preset.landedCost.costLabels[1]}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatKrw(landedSummary.adjustedFreightKrw)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {formatKrw(landedSummary.adjustedFreightKrw / preset.landedCost.midQty)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 8px' }}>{preset.landedCost.costLabels[2]}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatKrw(landedSummary.adjustedCustomsKrw)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {formatKrw(landedSummary.adjustedCustomsKrw / preset.landedCost.midQty)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 8px' }}>{preset.landedCost.costLabels[3]}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatKrw(landedSummary.adjustedDomesticKrw)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {formatKrw(landedSummary.adjustedDomesticKrw / preset.landedCost.midQty)}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f1f5f9', fontWeight: 800 }}>
                    <td style={{ padding: '7px 8px' }}>총 도착원가 합계</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }}>{formatKrw(landedSummary.totalLandedKrw)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: preset.accent }}>
                      {formatKrw(landedSummary.unitCostMid)} / {midUnit}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* 3단위 개당 도착원가 KPI */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 12 }}>
              <div style={{ padding: '8px 10px', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>1{largeUnit} 원가</div>
                <strong style={{ fontSize: 14 }}>{formatKrw(landedSummary.unitCostLarge)}</strong>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: 6, background: preset.accentSoft, border: `1px solid ${preset.accent}` }}>
                <div style={{ fontSize: 11, color: '#475569' }}>1{midUnit} 원가</div>
                <strong style={{ fontSize: 14, color: preset.accent }}>{formatKrw(landedSummary.unitCostMid)}</strong>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>1{smallUnit} 원가</div>
                <strong style={{ fontSize: 14 }}>{landedSummary.unitCostSmall.toLocaleString('ko-KR')}원</strong>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: 6, background: '#edf8f1', border: '1px solid #86efac' }}>
                <div style={{ fontSize: 11, color: '#166534' }}>권장 공급가({midUnit})</div>
                <strong style={{ fontSize: 14, color: '#167047' }}>{formatKrw(landedSummary.suggestedSupplyMid)}</strong>
              </div>
            </div>
          </section>

          {/* ④ 고객사 직원 수·기기 수 슬라이더 기반 주간 시간 단축 & 월 요금제 ROI 계산기 */}
          <section className="card" data-testid="section-roi-calculator" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: '#0f172a' }}>
                  ④ 주간 시간 단축 &amp; 월 요금제 ROI 계산기
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                  고객사 직원 수 · 연동 기기 수에 따른 <strong>Watch / Build / Team + Device Hub Add-on</strong> 도입 효과 산정
                </p>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '3px 9px',
                  borderRadius: 999,
                  background: '#edf3ff',
                  color: '#245bd7',
                }}
              >
                예상 ROI {roiSummary.roiMultiple}배 · 손익분기 약 {roiSummary.paybackDays}일
              </span>
            </div>

            {/* 요금제 선택 카드 (Watch / Build / Team) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
              {PRICING_PLANS.map((plan) => {
                const selected = plan.id === planId;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    data-plan={plan.id}
                    aria-pressed={selected}
                    onClick={() => setPlanId(plan.id)}
                    style={{
                      textAlign: 'left',
                      padding: '9px 10px',
                      borderRadius: 8,
                      border: selected ? `2px solid ${preset.accent}` : '1px solid #cbd5e1',
                      background: selected ? preset.accentSoft : '#ffffff',
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b' }}>{plan.badge}</div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: selected ? preset.accent : '#0f172a', margin: '2px 0' }}>
                      {plan.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#475569' }}>
                      기본 {Math.round(plan.monthlyBaseKrw / 10000)}만원 + {Math.round(plan.perSeatKrw / 1000)}천/인
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 슬라이더 및 Device Hub Add-on 토글 */}
            <div
              style={{
                display: 'grid',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                marginBottom: 12,
                fontSize: 12,
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontWeight: 700 }}>
                    사용 직원 수: <strong style={{ color: preset.accent }}>{roiSummary.seats}명</strong>
                  </span>
                  <input
                    type="range"
                    min={3}
                    max={50}
                    step={1}
                    data-testid="roi-staff-slider"
                    value={staffCount}
                    onChange={(e) => setStaffCount(Number(e.target.value))}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontWeight: 700 }}>
                    연동 기기 수 (Edge Box · 공용폰):{' '}
                    <strong style={{ color: preset.accent }}>{includeDeviceHub ? `${roiSummary.devices}대` : '미포함'}</strong>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    disabled={!includeDeviceHub}
                    data-testid="roi-device-slider"
                    value={deviceCount}
                    onChange={(e) => setDeviceCount(Number(e.target.value))}
                  />
                </label>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700 }}>
                <input
                  type="checkbox"
                  data-testid="roi-device-addon-toggle"
                  checked={includeDeviceHub}
                  onChange={(e) => setIncludeDeviceHub(e.target.checked)}
                />
                <span>
                  + {DEVICE_HUB_ADDON.name} ({DEVICE_HUB_ADDON.subtitle} · 대당 월 {formatKrw(DEVICE_HUB_ADDON.monthlyPerDeviceKrw)})
                </span>
              </label>
            </div>

            {/* ROI 산출 결과 KPI 그리드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 12 }}>
              <div style={{ padding: '10px 12px', borderRadius: 8, background: preset.accentSoft, border: `1px solid ${preset.accent}` }}>
                <div style={{ fontSize: 11, color: '#334155', fontWeight: 700 }}>주간 업무 시간 단축</div>
                <div data-testid="roi-weekly-hours" style={{ fontSize: 20, fontWeight: 900, color: preset.accent }}>
                  주 {roiSummary.weeklyHoursSaved}시간 단축
                </div>
                <div style={{ fontSize: 11, color: '#475569' }}>월 환산 약 {roiSummary.monthlyHoursSaved}시간 절감</div>
              </div>

              <div style={{ padding: '10px 12px', borderRadius: 8, background: '#edf8f1', border: '1px solid #86efac' }}>
                <div style={{ fontSize: 11, color: '#166534', fontWeight: 700 }}>월 예상 인건비 절감 · 순효익</div>
                <div data-testid="roi-net-benefit" style={{ fontSize: 20, fontWeight: 900, color: '#167047' }}>
                  +{formatKrw(roiSummary.netMonthlyBenefitKrw)}
                </div>
                <div style={{ fontSize: 11, color: '#166534' }}>
                  총 절감 {formatKrw(roiSummary.monthlyLaborSavingsKrw)} / 월
                </div>
              </div>

              <div style={{ padding: '8px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>선택 플랜 월 요금 ({roiSummary.plan.name})</div>
                <strong style={{ fontSize: 14 }}>{formatKrw(roiSummary.monthlyPlanKrw)}</strong>
              </div>

              <div style={{ padding: '8px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>Device Hub Add-on 포함 월 총액</div>
                <strong data-testid="roi-total-monthly" style={{ fontSize: 14 }}>
                  {formatKrw(roiSummary.totalMonthlyKrw)}
                </strong>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
