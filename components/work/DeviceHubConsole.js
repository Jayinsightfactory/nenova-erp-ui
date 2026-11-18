// components/work/DeviceHubConsole.js
// 디바이스 허브 관제 (Phase 1) — 관리자 전용(/my-work?tab=devices, !mineOnly).
// Rust 사이드카(nenova-device-sidecar.exe)가 수집한 단말 상태·Read-Only 가드·Lease 점유·WAITING_HUMAN 안내를 시각화한다.
import { useCallback, useEffect, useMemo, useState } from 'react';

export const DEFAULT_KILL_SWITCH_KEYWORDS = [
  '송금',
  '이체',
  '결제',
  '출금',
  '전송',
  '보내기',
  '삭제',
  '계좌이체',
  '초기화',
  'Pay',
  'Transfer',
  'Payment',
  'Delete',
];

export const ONBOARDING_CHECKLIST = [
  {
    step: '01',
    title: 'Rust 단일 바이너리 준비',
    cmd: 'C:\\Users\\USER\\nenova-pm\\bin\\nenova-device-sidecar.exe --version',
    detail: '외부 런타임 없이 순수 Rust std 정적 빌드(약 400KB)로 Read-Only 스캔 및 1ms 킬스위치 판정을 실행합니다.',
  },
  {
    step: '02',
    title: '카나리 공용폰 1대 ADB 연결',
    cmd: 'nenova-device-sidecar.exe scan --json',
    detail: '테스트용 Android 11~14 공용폰 1대만 USB 또는 사내 Wi-Fi ADB 디버깅으로 연결해 48~72시간 검증합니다.',
  },
  {
    step: '03',
    title: '킬스위치 안전 차단 검증',
    cmd: 'nenova-device-sidecar.exe guard-check --text "거래처 계좌로 50만원 송금"',
    detail: '송금·이체·결제·출금·전송·보내기·삭제·Pay·Transfer 등 위험 액션 문구를 1ms 이내에 allowed: false로 차단합니다.',
  },
  {
    step: '04',
    title: '네노바웹 실시간 스냅샷 연동',
    cmd: 'node C:\\Users\\USER\\nenova-pm\\upload-device-hub.js',
    detail: 'device-hub-status.json을 /api/work/feature-data-ingest (name=device-hub-status)로 전송해 이 관제판에 반영합니다.',
  },
];

export const PREVIEW_SNAPSHOT = {
  generatedAt: '2026-11-18T09:00:00Z',
  host: 'CANARY-PREVIEW-HOST',
  sidecarVersion: '0.1.0',
  binarySizeKB: 402.5,
  adbAvailable: true,
  readOnlyEnforced: true,
  canaryMode: true,
  killSwitchActive: true,
  killSwitchKeywords: DEFAULT_KILL_SWITCH_KEYWORDS,
  waitingHumanTimeoutSec: 10,
  waitingHumanRule: '보안키패드·잠금화면·인증창 감지 시 10초 내 WAITING_HUMAN 원격 개입 요청',
  statusNote: '시뮬레이션 미리보기 — 실제 단말 업로드 전 Phase 1 카나리 구성 예시입니다.',
  devices: [
    {
      serial: 'R58M12345AB',
      state: 'device',
      ready: true,
      model: 'Galaxy S10 (SM-G973N)',
      product: 'beyond1q',
      deviceCode: 'dev-ph-wechat-01',
      transport: 'USB',
      transportId: '1',
      readOnlyLocked: true,
      leaseOwner: 'hermes-suip-reader',
      leaseStatus: 'ACTIVE',
      leaseTtlSec: 165,
      killSwitchArmed: true,
      waitingHuman: false,
      channel: '위챗 해외농장방 · 수입 카톡방 (Read-Only)',
    },
    {
      serial: '192.168.0.55:5555',
      state: 'device',
      ready: true,
      model: 'Galaxy S22 Ultra (SM-S908N)',
      product: 'b0q',
      deviceCode: 'dev-wh-cam-02',
      transport: 'WIFI',
      transportId: '2',
      readOnlyLocked: true,
      leaseOwner: 'warehouse-label-ocr',
      leaseStatus: 'WAITING_HUMAN',
      leaseTtlSec: 10,
      killSwitchArmed: true,
      waitingHuman: true,
      waitingReason: '잠금화면 / 보안키패드 감지 — 담당자 10초 원격 해제 대기',
      channel: '창고 입고 박스 라벨 촬영 (Read-Only)',
    },
  ],
  leases: [
    {
      leaseId: 'LEASE-CANARY-01',
      serial: 'R58M12345AB',
      owner: 'hermes-suip-reader',
      status: 'ACTIVE',
      ttlSec: 165,
      fps: 30,
      note: 'Read-Only 단톡방 텍스트·라벨 수집 점유',
    },
    {
      leaseId: 'LEASE-CANARY-02',
      serial: '192.168.0.55:5555',
      owner: 'warehouse-label-ocr',
      status: 'WAITING_HUMAN',
      ttlSec: 10,
      fps: 30,
      note: '잠금화면 감지 → Lease 자동 반납 대기 (10초 원격 개입 안내)',
    },
  ],
  queueSummary: {
    totalDevices: 2,
    onlineDevices: 2,
    offlineDevices: 0,
    unauthorizedDevices: 0,
    usbDevices: 1,
    wifiDevices: 1,
    activeLeases: 2,
    waitingHuman: 1,
    blockedActionsCount: 0,
  },
};

export function evaluateKillSwitch(text, keywords = DEFAULT_KILL_SWITCH_KEYWORDS) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const matched = [];
  for (const kw of keywords) {
    const hit = /^[a-z0-9_-]+$/i.test(kw) ? lower.includes(kw.toLowerCase()) : raw.includes(kw);
    if (hit && !matched.includes(kw)) matched.push(kw);
  }
  return {
    allowed: matched.length === 0,
    blocked: matched.length > 0,
    matchedKeywords: matched,
    reason: matched.length
      ? `위험 액션 키워드(${matched.join(', ')}) 감지 — Read-Only 킬스위치로 차단`
      : '읽기 전용 안전 범위 확인 — 실행 허용',
  };
}

function fmtDateTime(iso) {
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso);
  try {
    return new Date(t).toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return String(iso);
  }
}

export default function DeviceHubConsole({ initialData = null, onSelectTab = null }) {
  const [liveData, setLiveData] = useState(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [fetchError, setFetchError] = useState('');
  const [previewMode, setPreviewMode] = useState(() => !initialData || !(initialData.devices?.length));
  const [guardInput, setGuardInput] = useState('거래처 계좌로 50만원 송금');

  const fetchStatus = useCallback((signal) => {
    setLoading(true);
    setFetchError('');
    return fetch('/api/my-work/feature?name=device-hub-status', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    })
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok || !body?.success) throw new Error(body?.error || '스냅샷 조회 실패');
        const next = body.data || null;
        setLiveData(next);
        if (next && Array.isArray(next.devices) && next.devices.length > 0) {
          setPreviewMode(false);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setFetchError(String(err?.message || err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchStatus(controller.signal);
    return () => controller.abort();
  }, [fetchStatus]);

  const hasLiveSnapshot = Boolean(liveData && liveData.generatedAt);
  const hasLiveDevices = Boolean(hasLiveSnapshot && Array.isArray(liveData.devices) && liveData.devices.length > 0);
  const showingPreview = previewMode || !hasLiveSnapshot;
  const activeSnapshot = showingPreview ? PREVIEW_SNAPSHOT : liveData;

  const keywords = useMemo(() => {
    const list = liveData?.killSwitchKeywords || activeSnapshot?.killSwitchKeywords;
    return Array.isArray(list) && list.length ? list : DEFAULT_KILL_SWITCH_KEYWORDS;
  }, [liveData, activeSnapshot]);

  const guardVerdict = useMemo(() => evaluateKillSwitch(guardInput, keywords), [guardInput, keywords]);

  const devices = Array.isArray(activeSnapshot?.devices) ? activeSnapshot.devices : [];
  const leases = Array.isArray(activeSnapshot?.leases) ? activeSnapshot.leases : [];
  const leaseBySerial = useMemo(() => {
    const map = new Map();
    for (const lease of leases) {
      if (lease?.serial && !map.has(lease.serial)) map.set(lease.serial, lease);
    }
    return map;
  }, [leases]);

  const summary = activeSnapshot?.queueSummary || {
    totalDevices: devices.length,
    onlineDevices: devices.filter((d) => d.state === 'device' || d.ready).length,
    offlineDevices: devices.filter((d) => d.state === 'offline').length,
    unauthorizedDevices: devices.filter((d) => d.state === 'unauthorized').length,
    usbDevices: devices.filter((d) => d.transport === 'USB').length,
    wifiDevices: devices.filter((d) => d.transport === 'WIFI').length,
    activeLeases: leases.length,
    waitingHuman: devices.filter((d) => d.waitingHuman).length,
    blockedActionsCount: 0,
  };

  return (
    <div className="dhc-root" data-testid="device-hub-console">
      <header className="dhc-hero">
        <div className="dhc-hero-copy">
          <div className="dhc-badges">
            <span className="dhc-pill is-cyan">Phase 1 · 읽기·관제 파일럿</span>
            <span className="dhc-pill is-green">
              {activeSnapshot?.readOnlyEnforced !== false ? 'READ-ONLY 잠금 활성' : '잠금 확인 필요'}
            </span>
            <span className="dhc-pill is-amber">
              {activeSnapshot?.canaryMode !== false ? '카나리 1대 우선 원칙' : '확장 풀'}
            </span>
            {showingPreview ? (
              <span className="dhc-pill is-preview">시뮬레이션 미리보기</span>
            ) : (
              <span className="dhc-pill is-live">실시간 스냅샷 연동</span>
            )}
          </div>
          <h1>디바이스 허브 관제 (Phone Harness · Phase 1)</h1>
          <p className="dhc-sub">
            공용 Android 단말 연결 상태, 독점 Lease 점유 주체, Read-Only 안전 잠금 및{' '}
            <code>WAITING_HUMAN</code> 10초 원격 개입 절차를 한 화면에서 점검합니다.
          </p>
        </div>

        <div className="dhc-hero-actions">
          <button
            type="button"
            className="dhc-btn is-primary"
            onClick={() => fetchStatus()}
            disabled={loading}
          >
            {loading ? '점검 중…' : '실시간 새로고침 ↻'}
          </button>
          <button
            type="button"
            className={`dhc-btn ${showingPreview ? 'is-active' : ''}`}
            onClick={() => setPreviewMode((v) => !v)}
            disabled={!hasLiveSnapshot}
            title={hasLiveSnapshot ? '실제 스냅샷과 시뮬레이션 미리보기 전환' : '아직 업로드된 스냅샷이 없어 미리보기를 표시 중입니다'}
          >
            {showingPreview ? '실시간 스냅샷 보기' : '시뮬레이션 미리보기'}
          </button>
          {onSelectTab && (
            <button
              type="button"
              className="dhc-btn"
              onClick={() => onSelectTab('suite-sim')}
            >
              통합 시뮬레이션 ↗
            </button>
          )}
        </div>
      </header>

      <section className={`dhc-banner ${hasLiveSnapshot ? (hasLiveDevices ? 'is-ok' : 'is-info') : 'is-warn'}`}>
        <div className="dhc-banner-main">
          {fetchError ? (
            <>
              <strong>실시간 피드 조회 오류:</strong> {fetchError} (카나리 온보딩 가이드와 시뮬레이션 미리보기를 표시합니다)
            </>
          ) : !hasLiveSnapshot ? (
            <>
              <strong>아직 실시간 device-hub-status 피드가 업로드되지 않았습니다.</strong> 아래{' '}
              <code>nenova-device-sidecar.exe</code> 연결 체크리스트를 완료하면 실제 단말 상태가 자동 반영됩니다.
            </>
          ) : !hasLiveDevices ? (
            <>
              <strong>사이드카 스냅샷 수신 완료</strong> ({liveData.host} ·{' '}
              <code>v{liveData.sidecarVersion || '0.1.0'}</code> · {liveData.binarySizeKB ?? '-'} KB ·{' '}
              {liveData.adbAvailable ? 'ADB 준비됨' : 'ADB 미연결 대기'}) — 현재 연결된 물리 단말이 0대여서{' '}
              {showingPreview ? '시뮬레이션 미리보기를 함께 표시합니다.' : '대기 상태로 표시 중입니다.'}
            </>
          ) : (
            <>
              <strong>실시간 단말 관제 정상:</strong> {liveData.host} · 연결 {summary.totalDevices}대 (온라인{' '}
              {summary.onlineDevices}대) · 갱신 {fmtDateTime(liveData.generatedAt)}
            </>
          )}
        </div>
        <div className="dhc-banner-meta">
          최근 스냅샷: {hasLiveSnapshot ? fmtDateTime(liveData.generatedAt) : '미수신'} · 사이드카:{' '}
          <code>nenova-device-sidecar.exe</code> ({(liveData || activeSnapshot)?.binarySizeKB ?? 402.5} KB)
        </div>
      </section>

      <section className="dhc-kpi-grid" aria-label="디바이스 허브 요약 지표">
        <div className="dhc-kpi">
          <span className="dhc-kpi-label">연결 단말</span>
          <strong className="dhc-kpi-val">
            {summary.onlineDevices} / {summary.totalDevices}대
          </strong>
          <span className="dhc-kpi-foot">
            USB {summary.usbDevices ?? 0} · Wi-Fi {summary.wifiDevices ?? 0}
          </span>
        </div>
        <div className="dhc-kpi">
          <span className="dhc-kpi-label">활성 Lease 점유</span>
          <strong className="dhc-kpi-val">{summary.activeLeases ?? leases.length}건</strong>
          <span className="dhc-kpi-foot">기기당 ACTIVE 1건 독점 잠금</span>
        </div>
        <div className="dhc-kpi">
          <span className="dhc-kpi-label">WAITING_HUMAN 대기</span>
          <strong className={`dhc-kpi-val ${(summary.waitingHuman ?? 0) > 0 ? 'is-alert' : ''}`}>
            {summary.waitingHuman ?? 0}건
          </strong>
          <span className="dhc-kpi-foot">보안화면 감지 시 10초 원격 개입</span>
        </div>
        <div className="dhc-kpi">
          <span className="dhc-kpi-label">Read-Only · 킬스위치</span>
          <strong className="dhc-kpi-val is-safe">무장 ({keywords.length}종)</strong>
          <span className="dhc-kpi-foot">송금·이체·결제·삭제 1ms 차단</span>
        </div>
      </section>

      <section className="dhc-section">
        <div className="dhc-section-head">
          <h2>
            단말 상태 카드{' '}
            <small>{showingPreview ? '카나리 시뮬레이션 미리보기' : '실시간 ADB 점검 결과'}</small>
          </h2>
          <span className="dhc-waiting-pill">
            ⏱ WAITING_HUMAN 10초 원격 개입 규칙: 보안키패드·잠금화면 감지 시 즉시 Lease 반납 후 담당자 원격 해제
          </span>
        </div>

        {devices.length === 0 ? (
          <div className="dhc-empty-card">
            <h3>연결된 Android 단말이 아직 없습니다 (카나리 대기)</h3>
            <p>
              사이드카 바이너리(<code>nenova-device-sidecar.exe</code>)가 정상 응답했으나 현재 ADB에 연결된
              단말이 없습니다. 공용폰 1대를 USB 또는 사내 Wi-Fi로 연결한 뒤{' '}
              <code>node C:\Users\USER\nenova-pm\upload-device-hub.js</code>를 실행하세요.
            </p>
            <button type="button" className="dhc-btn is-primary" onClick={() => setPreviewMode(true)}>
              카나리 시뮬레이션 카드 미리보기
            </button>
          </div>
        ) : (
          <div className="dhc-device-grid">
            {devices.map((dev, idx) => {
              const lease = leaseBySerial.get(dev.serial);
              const leaseOwner = dev.leaseOwner || lease?.owner || null;
              const leaseStatus = dev.leaseStatus || lease?.status || (leaseOwner ? 'ACTIVE' : 'IDLE');
              const isWaiting = Boolean(dev.waitingHuman || leaseStatus === 'WAITING_HUMAN');
              const isOnline = dev.state === 'device' || dev.ready;
              return (
                <article
                  key={dev.serial || idx}
                  className={`dhc-device-card ${isWaiting ? 'is-waiting' : isOnline ? 'is-online' : 'is-offline'}`}
                >
                  <div className="dhc-card-top">
                    <div>
                      <div className="dhc-card-code">{dev.deviceCode || `device-${idx + 1}`}</div>
                      <h3>{dev.model || '미식별 Android 단말'}</h3>
                      <div className="dhc-serial">Serial: {dev.serial}</div>
                    </div>
                    <div className="dhc-card-badges">
                      <span className={`dhc-tag ${dev.transport === 'WIFI' ? 'is-wifi' : 'is-usb'}`}>
                        {dev.transport === 'WIFI' ? 'Wi-Fi 연결' : 'USB 연결'}
                      </span>
                      <span className={`dhc-tag ${isWaiting ? 'is-warn' : isOnline ? 'is-ok' : 'is-err'}`}>
                        {isWaiting ? 'WAITING_HUMAN' : isOnline ? '연결 정상' : dev.state || 'offline'}
                      </span>
                    </div>
                  </div>

                  {dev.channel && <div className="dhc-channel">{dev.channel}</div>}

                  <dl className="dhc-spec-list">
                    <div>
                      <dt>Read-Only 잠금</dt>
                      <dd>
                        <span className="dhc-lock-badge">
                          🔒 {dev.readOnlyLocked !== false ? 'READ-ONLY 잠금 활성' : '잠금 해제'}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>활성 Lease 점유 주체</dt>
                      <dd>
                        {leaseOwner ? (
                          <span className="dhc-lease-owner">
                            {leaseOwner} ({leaseStatus}
                            {dev.leaseTtlSec || lease?.ttlSec ? ` · ${dev.leaseTtlSec || lease?.ttlSec}s` : ''})
                          </span>
                        ) : (
                          <span className="dhc-dim">미점유 (대기 중)</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>킬스위치 보호 상태</dt>
                      <dd>
                        <span className="dhc-shield-badge">
                          🛡 {dev.killSwitchArmed !== false ? '킬스위치 무장 (금지 액션 차단)' : '비활성'}
                        </span>
                      </dd>
                    </div>
                  </dl>

                  <div className={`dhc-human-box ${isWaiting ? 'is-urgent' : ''}`}>
                    <strong>WAITING_HUMAN 10초 원격 개입 안내</strong>
                    <p>
                      {isWaiting
                        ? dev.waitingReason || '보안 화면이 감지되어 Lease를 반납했습니다. 10초 내 원격 화면에서 직접 해제 후 재개하세요.'
                        : '정상 수집 중 — FLAG_SECURE·보안키패드·인증창 감지 시 즉시 Lease를 반납하고 10초 원격 개입을 요청합니다.'}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="dhc-two-col">
        <div className="dhc-panel">
          <h2>
            카나리 온보딩 &amp; <code>nenova-device-sidecar.exe</code> 연결 체크리스트
          </h2>
          <ol className="dhc-checklist">
            {ONBOARDING_CHECKLIST.map((item) => (
              <li key={item.step}>
                <div className="dhc-step-head">
                  <span className="dhc-step-no">{item.step}</span>
                  <strong>{item.title}</strong>
                </div>
                <p>{item.detail}</p>
                <code className="dhc-cmd">{item.cmd}</code>
              </li>
            ))}
          </ol>
        </div>

        <div className="dhc-panel">
          <h2>킬스위치 안전 차단 즉시 점검 (1ms 미만 판정)</h2>
          <p className="dhc-panel-desc">
            사이드카(<code>nenova-device-sidecar.exe guard-check</code>)와 동일한 규칙으로 위험 액션 문구
            차단 여부를 미리 점검합니다.
          </p>

          <div className="dhc-kw-list" aria-label="차단 대상 킬스위치 키워드">
            {keywords.map((kw) => (
              <span key={kw} className="dhc-kw-chip">
                {kw}
              </span>
            ))}
          </div>

          <label className="dhc-input-label" htmlFor="dhc-guard-input">
            점검할 액션 문구 입력
          </label>
          <input
            id="dhc-guard-input"
            className="dhc-input"
            type="text"
            value={guardInput}
            onChange={(e) => setGuardInput(e.target.value)}
            placeholder="예: 거래처 송금 실행 또는 화면 캡처 읽기"
          />

          <div className="dhc-presets">
            <button type="button" className="dhc-chip-btn" onClick={() => setGuardInput('거래처 계좌로 50만원 송금')}>
              송금 테스트
            </button>
            <button type="button" className="dhc-chip-btn" onClick={() => setGuardInput('Bank Transfer Pay 5000')}>
              Pay/Transfer 테스트
            </button>
            <button type="button" className="dhc-chip-btn" onClick={() => setGuardInput('위챗 단톡방 화면 캡처 읽기')}>
              안전 읽기 테스트
            </button>
          </div>

          <div className={`dhc-verdict ${guardVerdict.blocked ? 'is-blocked' : 'is-allowed'}`}>
            <div className="dhc-verdict-head">
              <strong>{guardVerdict.blocked ? '차단됨 (allowed: false)' : '허용됨 (allowed: true)'}</strong>
              {guardVerdict.matchedKeywords.length > 0 && (
                <span>일치 키워드: {guardVerdict.matchedKeywords.join(', ')}</span>
              )}
            </div>
            <p>{guardVerdict.reason}</p>
            <code>
              nenova-device-sidecar.exe guard-check --text &quot;{guardInput}&quot;
            </code>
          </div>
        </div>
      </section>

      <style jsx>{`
        .dhc-root {
          max-width: 1380px;
          margin: 0 auto;
          padding: 18px 22px 56px;
          color: #e2e8f0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .dhc-hero {
          background: linear-gradient(135deg, #0d1626 0%, #101b2d 100%);
          border: 1px solid #223047;
          border-radius: 14px;
          padding: 18px 20px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          flex-wrap: wrap;
        }
        .dhc-badges {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-bottom: 8px;
        }
        .dhc-pill {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 9px;
          border-radius: 999px;
          border: 1px solid #334155;
        }
        .dhc-pill.is-cyan {
          background: #0c263b;
          color: #38bdf8;
          border-color: #0284c7;
        }
        .dhc-pill.is-green {
          background: #0d2b1f;
          color: #34d399;
          border-color: #059669;
        }
        .dhc-pill.is-amber {
          background: #2b210d;
          color: #fbbf24;
          border-color: #d97706;
        }
        .dhc-pill.is-preview {
          background: #24193d;
          color: #c4b5fd;
          border-color: #7c3aed;
        }
        .dhc-pill.is-live {
          background: #0d2e24;
          color: #6ee7b7;
          border-color: #10b981;
        }
        .dhc-hero h1 {
          margin: 0 0 6px;
          font-size: 20px;
          color: #f8fafc;
        }
        .dhc-sub {
          margin: 0;
          font-size: 13px;
          color: #94a3b8;
          line-height: 1.5;
        }
        .dhc-sub code,
        .dhc-banner code,
        .dhc-empty-card code,
        .dhc-panel code {
          background: #0b1019;
          border: 1px solid #263449;
          border-radius: 5px;
          padding: 1px 5px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11.5px;
          color: #7dd3fc;
        }
        .dhc-hero-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .dhc-btn {
          background: #162133;
          color: #e2e8f0;
          border: 1px solid #2d3e59;
          border-radius: 8px;
          padding: 7px 12px;
          font: inherit;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
        }
        .dhc-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .dhc-btn.is-primary {
          background: #0c314c;
          border-color: #0ea5e9;
          color: #f0f9ff;
        }
        .dhc-btn.is-active {
          background: #1e1b4b;
          border-color: #818cf8;
          color: #e0e7ff;
        }
        .dhc-banner {
          border-radius: 10px;
          padding: 11px 14px;
          border: 1px solid #2b384e;
          background: #111827;
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12.5px;
        }
        .dhc-banner.is-warn {
          border-color: #b45309;
          background: #1c150c;
        }
        .dhc-banner.is-info {
          border-color: #0369a1;
          background: #0c1927;
        }
        .dhc-banner.is-ok {
          border-color: #059669;
          background: #0b1d17;
        }
        .dhc-banner-meta {
          font-size: 11.5px;
          color: #94a3b8;
        }
        .dhc-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        .dhc-kpi {
          background: #0d131f;
          border: 1px solid #222e42;
          border-radius: 11px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .dhc-kpi-label {
          font-size: 11.5px;
          color: #94a3b8;
          font-weight: 600;
        }
        .dhc-kpi-val {
          font-size: 20px;
          color: #f8fafc;
        }
        .dhc-kpi-val.is-alert {
          color: #fbbf24;
        }
        .dhc-kpi-val.is-safe {
          color: #34d399;
        }
        .dhc-kpi-foot {
          font-size: 11.5px;
          color: #7dd3fc;
        }
        .dhc-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .dhc-section-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .dhc-section-head h2 {
          margin: 0;
          font-size: 16px;
          color: #f8fafc;
        }
        .dhc-section-head h2 small {
          margin-left: 8px;
          font-size: 12px;
          font-weight: 500;
          color: #94a3b8;
        }
        .dhc-waiting-pill {
          font-size: 11.5px;
          color: #fde68a;
          background: #291e0b;
          border: 1px solid #92400e;
          border-radius: 999px;
          padding: 3px 10px;
        }
        .dhc-empty-card {
          background: #0d131f;
          border: 1px dashed #334155;
          border-radius: 12px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 10px;
        }
        .dhc-empty-card h3 {
          margin: 0;
          font-size: 15px;
        }
        .dhc-empty-card p {
          margin: 0;
          font-size: 13px;
          color: #94a3b8;
          line-height: 1.5;
        }
        .dhc-device-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .dhc-device-card {
          background: #0d131f;
          border: 1px solid #253248;
          border-radius: 12px;
          padding: 15px;
          display: flex;
          flex-direction: column;
          gap: 11px;
        }
        .dhc-device-card.is-waiting {
          border-color: #d97706;
          box-shadow: 0 0 0 1px rgba(217, 119, 6, 0.25);
        }
        .dhc-card-top {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: flex-start;
        }
        .dhc-card-code {
          font-size: 11px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          color: #38bdf8;
        }
        .dhc-card-top h3 {
          margin: 2px 0;
          font-size: 15.5px;
          color: #f8fafc;
        }
        .dhc-serial {
          font-size: 11.5px;
          color: #94a3b8;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }
        .dhc-card-badges {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .dhc-tag {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid #334155;
        }
        .dhc-tag.is-usb {
          background: #0c2438;
          color: #38bdf8;
          border-color: #0284c7;
        }
        .dhc-tag.is-wifi {
          background: #16223d;
          color: #93c5fd;
          border-color: #3b82f6;
        }
        .dhc-tag.is-ok {
          background: #0d2b1f;
          color: #34d399;
          border-color: #059669;
        }
        .dhc-tag.is-warn {
          background: #352208;
          color: #fbbf24;
          border-color: #d97706;
        }
        .dhc-tag.is-err {
          background: #321216;
          color: #f87171;
          border-color: #dc2626;
        }
        .dhc-channel {
          font-size: 12px;
          color: #cbd5e1;
          background: #121b2b;
          border: 1px solid #223047;
          border-radius: 7px;
          padding: 6px 9px;
        }
        .dhc-spec-list {
          margin: 0;
          display: grid;
          gap: 7px;
          font-size: 12.5px;
        }
        .dhc-spec-list > div {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          border-bottom: 1px dashed #1e293b;
          padding-bottom: 5px;
        }
        .dhc-spec-list dt {
          color: #94a3b8;
          font-weight: 600;
        }
        .dhc-spec-list dd {
          margin: 0;
          text-align: right;
        }
        .dhc-lock-badge {
          color: #6ee7b7;
          font-weight: 700;
        }
        .dhc-lease-owner {
          color: #7dd3fc;
          font-weight: 600;
        }
        .dhc-shield-badge {
          color: #34d399;
          font-weight: 600;
        }
        .dhc-dim {
          color: #94a3b8;
        }
        .dhc-human-box {
          background: #0b1019;
          border: 1px solid #223047;
          border-radius: 8px;
          padding: 9px 11px;
          font-size: 12px;
        }
        .dhc-human-box.is-urgent {
          background: #241809;
          border-color: #d97706;
        }
        .dhc-human-box strong {
          display: block;
          margin-bottom: 3px;
          color: #fbbf24;
        }
        .dhc-human-box p {
          margin: 0;
          color: #cbd5e1;
          line-height: 1.45;
        }
        .dhc-two-col {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .dhc-panel {
          background: #0d131f;
          border: 1px solid #222e42;
          border-radius: 12px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .dhc-panel h2 {
          margin: 0;
          font-size: 15.5px;
          color: #f8fafc;
        }
        .dhc-panel-desc {
          margin: 0;
          font-size: 12.5px;
          color: #94a3b8;
          line-height: 1.5;
        }
        .dhc-checklist {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .dhc-checklist li {
          background: #0b1019;
          border: 1px solid #1e293b;
          border-radius: 9px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .dhc-step-head {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dhc-step-no {
          background: #0c314c;
          color: #38bdf8;
          border: 1px solid #0284c7;
          border-radius: 999px;
          padding: 1px 8px;
          font-size: 11px;
          font-weight: 700;
        }
        .dhc-checklist p {
          margin: 0;
          font-size: 12px;
          color: #cbd5e1;
          line-height: 1.45;
        }
        .dhc-cmd {
          display: block;
          overflow-x: auto;
          padding: 5px 8px !important;
        }
        .dhc-kw-list {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }
        .dhc-kw-chip {
          font-size: 11px;
          font-weight: 600;
          color: #fca5a5;
          background: #2b1215;
          border: 1px solid #7f1d1d;
          border-radius: 999px;
          padding: 2px 8px;
        }
        .dhc-input-label {
          font-size: 12px;
          font-weight: 600;
          color: #cbd5e1;
        }
        .dhc-input {
          width: 100%;
          box-sizing: border-box;
          background: #0b1019;
          color: #f8fafc;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 8px 10px;
          font: inherit;
          font-size: 13px;
        }
        .dhc-presets {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .dhc-chip-btn {
          background: #162133;
          color: #cbd5e1;
          border: 1px solid #2b384e;
          border-radius: 999px;
          padding: 4px 10px;
          font: inherit;
          font-size: 11.5px;
          cursor: pointer;
        }
        .dhc-verdict {
          border-radius: 9px;
          padding: 11px 12px;
          border: 1px solid #334155;
          display: flex;
          flex-direction: column;
          gap: 5px;
          font-size: 12.5px;
        }
        .dhc-verdict.is-blocked {
          background: #2b1215;
          border-color: #dc2626;
        }
        .dhc-verdict.is-allowed {
          background: #0d2b1f;
          border-color: #059669;
        }
        .dhc-verdict-head {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
        }
        .dhc-verdict p {
          margin: 0;
          color: #e2e8f0;
        }
        @media (prefers-reduced-motion: reduce) {
          .dhc-root * {
            transition: none !important;
            animation: none !important;
          }
        }
        @media (max-width: 1080px) {
          .dhc-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .dhc-device-grid,
          .dhc-two-col {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .dhc-kpi-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
