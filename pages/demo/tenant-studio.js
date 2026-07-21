// pages/demo/tenant-studio.js — 테넌트 설정 샘플: 입력 즉시 전체 UI 미리보기
import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import TenantStudioForm from '../../components/tenant/TenantStudioForm';
import TenantStudioPreview from '../../components/tenant/TenantStudioPreview';
import { cloneTenantConfig, DEFAULT_TENANT_CONFIG, TENANT_PRESETS } from '../../lib/tenantDefaults';
import { applyRequirementsHints, buildTenantJson, filterMenuForTenant } from '../../lib/tenantStudio';

const STORAGE_KEY = 'tenant-studio-draft-v1';

export default function TenantStudioPage() {
  const [tenant, setTenant] = useState(() => cloneTenantConfig(DEFAULT_TENANT_CONFIG));
  const [jsonOpen, setJsonOpen] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setTenant(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tenant));
    } catch { /* ignore */ }
  }, [tenant]);

  const exportJson = useMemo(() => JSON.stringify(buildTenantJson(tenant), null, 2), [tenant]);
  const menuCount = useMemo(() => filterMenuForTenant(tenant).reduce((n, g) => n + g.items.length, 0), [tenant]);

  const loadPreset = (preset) => {
    setTenant(cloneTenantConfig(preset.config));
    setStatus(`프리셋 적용: ${preset.label}`);
  };

  const applyRequirements = () => {
    setTenant((prev) => applyRequirementsHints(prev, prev.requirements));
    setStatus('요구사항 키워드를 설정에 반영했습니다. 세부 값은 직접 조정하세요.');
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(exportJson);
      setStatus('tenant JSON을 클립보드에 복사했습니다.');
    } catch {
      setStatus('복사 실패 — 아래 JSON을 직접 선택하세요.');
    }
  };

  const downloadJson = () => {
    const blob = new Blob([exportJson], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tenant.${tenant.tenantId || 'draft'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`tenant.${tenant.tenantId}.json 다운로드`);
  };

  return (
    <>
      <Head>
        <title>테넌트 스튜디오 — ERP 화이트라벨 샘플</title>
      </Head>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1400, margin: '0 auto' }}>
        <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 900 }}>테넌트 스튜디오</h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text3)', maxWidth: 560 }}>
              요구사항·회사정보·기능을 입력하면 <strong>메뉴·색상·인쇄헤더·용어</strong>가 즉시 바뀝니다.
              결과 JSON을 <code>config/tenant.{'{id}'}.json</code>으로 저장해 배포합니다.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TENANT_PRESETS.map((p) => (
              <button key={p.id} type="button" className="btn btn-sm" onClick={() => loadPreset(p)}>{p.label}</button>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => setJsonOpen((v) => !v)}>{jsonOpen ? 'JSON 닫기' : 'JSON 보기'}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={downloadJson}>JSON 다운로드</button>
          </div>
        </header>

        {status && (
          <div className="banner-ok" style={{ margin: 0 }}>{status}</div>
        )}

        <div style={{ fontSize: 12, color: '#64748b' }}>
          활성 메뉴 {menuCount}개 · tenantId: <strong>{tenant.tenantId}</strong>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 400px) 1fr',
          gap: 16,
          alignItems: 'start',
        }}
        >
          <div className="card" style={{ padding: 16, maxHeight: 'calc(100vh - 200px)', overflow: 'auto' }}>
            <TenantStudioForm
              tenant={tenant}
              onChange={setTenant}
              onApplyRequirements={applyRequirements}
            />
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <TenantStudioPreview tenant={tenant} />
            {jsonOpen && (
              <div className="card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>config/tenant.{tenant.tenantId}.json</strong>
                  <button type="button" className="btn btn-sm" onClick={copyJson}>복사</button>
                </div>
                <pre style={{
                  margin: 0,
                  maxHeight: 280,
                  overflow: 'auto',
                  fontSize: 11,
                  background: '#0f172a',
                  color: '#e2e8f0',
                  padding: 12,
                  borderRadius: 8,
                }}
                >
                  {exportJson}
                </pre>
              </div>
            )}
          </div>
        </div>

        <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>
          청사진: docs/BLUEPRINT_WHITE_LABEL_ERP.md · 브라우저 localStorage에 초안 자동 저장
        </p>
      </div>
    </>
  );
}
