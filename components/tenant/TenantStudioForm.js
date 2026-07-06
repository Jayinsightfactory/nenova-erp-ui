import { FEATURE_LABELS, INTEGRATION_LABELS } from '../../lib/tenantStudio';

const inputStyle = {
  width: '100%',
  height: 34,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '0 10px',
  fontSize: 13,
  boxSizing: 'border-box',
};

const labelStyle = { fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 4, display: 'block' };

function Field({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

export default function TenantStudioForm({ tenant, onChange, onApplyRequirements }) {
  const set = (path, value) => {
    const next = JSON.parse(JSON.stringify(tenant));
    const keys = path.split('.');
    let cur = next;
    for (let i = 0; i < keys.length - 1; i += 1) {
      cur[keys[i]] = cur[keys[i]] || {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
    onChange(next);
  };

  const toggleFeature = (key) => {
    set(`features.${key}`, tenant.features?.[key] === false);
  };

  const toggleIntegration = (key) => {
    const cur = tenant.integrations?.[key]?.enabled !== false;
    set(`integrations.${key}.enabled`, !cur);
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0f172a' }}>요구사항 (자연어)</h3>
        <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
          예: &quot;exe 없음, 이카운트 미연동, 붙여넣기·카탈로그 필요&quot; → 기능 토글이 자동 반영됩니다. 직접 수정도 가능합니다.
        </p>
        <textarea
          value={tenant.requirements || ''}
          onChange={(e) => onChange({ ...tenant, requirements: e.target.value })}
          rows={3}
          placeholder="이 업체에 필요한 기능·연동·제약을 적어주세요"
          style={{ ...inputStyle, height: 'auto', padding: 10, resize: 'vertical' }}
        />
        <button
          type="button"
          onClick={() => onApplyRequirements?.()}
          style={{ height: 34, border: 'none', borderRadius: 6, background: '#7c3aed', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
        >
          요구사항 분석 → 설정 반영
        </button>
      </section>

      <section style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900 }}>기본</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="tenantId (영문)">
            <input style={inputStyle} value={tenant.tenantId || ''} onChange={(e) => set('tenantId', e.target.value.replace(/\s/g, '-').toLowerCase())} />
          </Field>
          <Field label="표시명">
            <input style={inputStyle} value={tenant.displayName || ''} onChange={(e) => set('displayName', e.target.value)} />
          </Field>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900 }}>브랜딩</h3>
        <Field label="앱 제목 (상단·로그인)">
          <input style={inputStyle} value={tenant.branding?.appTitle || ''} onChange={(e) => set('branding.appTitle', e.target.value)} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="주 색상">
            <input type="color" style={{ ...inputStyle, padding: 4 }} value={tenant.branding?.primaryColor || '#1565c0'} onChange={(e) => set('branding.primaryColor', e.target.value)} />
          </Field>
          <Field label="강조 색상">
            <input type="color" style={{ ...inputStyle, padding: 4 }} value={tenant.branding?.accentColor || '#15803d'} onChange={(e) => set('branding.accentColor', e.target.value)} />
          </Field>
        </div>
        <Field label="도메인 (표시용)">
          <input style={inputStyle} value={tenant.domains?.web || ''} onChange={(e) => set('domains.web', e.target.value)} />
        </Field>
      </section>

      <section style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900 }}>회사정보 (인쇄·견적)</h3>
        <Field label="회사명 / 대표">
          <input style={inputStyle} value={tenant.company?.legalName || ''} onChange={(e) => set('company.legalName', e.target.value)} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="사업자번호">
            <input style={inputStyle} value={tenant.company?.bizNo || ''} onChange={(e) => set('company.bizNo', e.target.value)} />
          </Field>
          <Field label="업태/종목">
            <input style={inputStyle} value={tenant.company?.bizType || ''} onChange={(e) => set('company.bizType', e.target.value)} />
          </Field>
        </div>
        <Field label="주소">
          <input style={inputStyle} value={tenant.company?.address || ''} onChange={(e) => set('company.address', e.target.value)} />
        </Field>
        <Field label="계좌번호">
          <input style={inputStyle} value={tenant.company?.bankAccount || ''} onChange={(e) => set('company.bankAccount', e.target.value)} />
        </Field>
        <Field label="TEL / FAX">
          <input style={inputStyle} value={tenant.company?.telFax || ''} onChange={(e) => set('company.telFax', e.target.value)} />
        </Field>
      </section>

      <section style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900 }}>업종·용어</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="시간 단위 라벨 (차수/주차)">
            <input style={inputStyle} value={tenant.industry?.timeBucketLabel || ''} onChange={(e) => set('industry.timeBucketLabel', e.target.value)} />
          </Field>
          <Field label="수량 단위 (쉼표 구분)">
            <input
              style={inputStyle}
              value={(tenant.industry?.units || []).join(', ')}
              onChange={(e) => set('industry.units', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            />
          </Field>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={tenant.legacyAdapter?.enabled !== false}
            onChange={(e) => set('legacyAdapter.enabled', e.target.checked)}
          />
          레거시 EXE 연동 (nenova.exe 등)
        </label>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900 }}>기능 ON/OFF</h3>
        {FEATURE_LABELS.map(({ key, label }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <input type="checkbox" checked={tenant.features?.[key] !== false} onChange={() => toggleFeature(key)} />
            {label}
          </label>
        ))}
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900 }}>외부 연동</h3>
        {INTEGRATION_LABELS.map(({ key, label }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <input type="checkbox" checked={tenant.integrations?.[key]?.enabled !== false} onChange={() => toggleIntegration(key)} />
            {label}
          </label>
        ))}
      </section>
    </div>
  );
}
