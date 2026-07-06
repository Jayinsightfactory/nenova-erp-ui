// lib/tenant.js — 테넌트 설정 로더 (Phase 1 청사진)
// 브라우저 번들 안전: fs는 서버에서만 dynamic require

let _cached = null;

const FALLBACK_COMPANY = {
  legalName: '(주)네노바 / 김원배',
  bizNo: '134-86-94367',
  address: '서울 서초구 언남길 15-7, 102호',
  bizType: '도매 / 무역',
  bankAccount: '하나 630-008129-149',
  telFax: '02-575-8003 / 02-576-8003',
};

function loadTenantFile() {
  if (typeof window !== 'undefined') return null;
  // eslint-disable-next-line global-require
  const fs = require('fs');
  // eslint-disable-next-line global-require
  const path = require('path');
  const tenantId = process.env.TENANT_ID || 'nenova';
  const root = process.cwd();
  const candidates = [
    path.join(root, 'config', `tenant.${tenantId}.json`),
    path.join(root, 'config', 'tenant.nenova.example.json'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }
  return null;
}

export function getTenant() {
  if (_cached) return _cached;
  const fromFile = loadTenantFile();
  if (fromFile) {
    _cached = fromFile;
    return _cached;
  }
  _cached = {
    tenantId: 'nenova',
    company: FALLBACK_COMPANY,
    branding: {
      appTitle: process.env.NEXT_PUBLIC_APP_TITLE || 'nenova ERP',
      logoPath: process.env.NEXT_PUBLIC_LOGO_PATH || '/nenova-logo.png',
    },
    industry: { vertical: 'flower-import' },
    features: {},
    legacyAdapter: { enabled: true },
  };
  return _cached;
}

export function getCompany() {
  const t = getTenant();
  return t.company || {};
}

export function getBranding() {
  const t = getTenant();
  return t.branding || {};
}

export function getIndustry() {
  const t = getTenant();
  return t.industry || {};
}

export function isFeatureEnabled(name) {
  const t = getTenant();
  return t.features?.[name] !== false;
}

export function isLegacyAdapterEnabled() {
  const t = getTenant();
  return t.legacyAdapter?.enabled === true;
}

/** 브라우저 — NEXT_PUBLIC_TENANT_ID 또는 빌드 시 주입 */
export function getPublicBranding() {
  if (typeof window === 'undefined') return getBranding();
  return {
    appTitle: process.env.NEXT_PUBLIC_APP_TITLE || 'ERP',
    logoPath: process.env.NEXT_PUBLIC_LOGO_PATH || '/nenova-logo.png',
    primaryColor: process.env.NEXT_PUBLIC_PRIMARY_COLOR || '#1565c0',
  };
}
