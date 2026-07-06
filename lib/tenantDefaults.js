/** 클라이언트·서버 공용 기본 테넌트 설정 (config/tenant.nenova.example.json 과 동기) */

export const DEFAULT_TENANT_CONFIG = {
  tenantId: 'nenova',
  displayName: '네노바',
  locale: { default: 'ko', supported: ['ko', 'es', 'bi'] },
  branding: {
    appTitle: 'nenova ERP',
    logoPath: '/nenova-logo.png',
    logoEstimatePath: '/nenova-logo-estimate.png',
    primaryColor: '#1565c0',
    accentColor: '#15803d',
  },
  company: {
    legalName: '(주)네노바 / 김원배',
    bizNo: '134-86-94367',
    address: '서울 서초구 언남길 15-7, 102호',
    bizType: '도매 / 무역',
    bankAccount: '하나 630-008129-149',
    telFax: '02-575-8003 / 02-576-8003',
  },
  domains: {
    web: 'https://nenovaweb.com',
  },
  industry: {
    vertical: 'flower-import',
    timeBucketLabel: '차수',
    timeBucketFormat: 'YY-SS',
    units: ['박스', '단', '송이'],
    weekdayLabels: ['월', '화', '수', '목', '금', '토', '일'],
  },
  legacyAdapter: {
    enabled: true,
    clientName: 'nenova.exe',
  },
  integrations: {
    ecount: { enabled: true },
    googleSheets: { enabled: true },
    anthropic: { enabled: true },
    n8n: { enabled: true, baseUrl: 'https://n8n.nenovaweb.com' },
  },
  features: {
    ordersPaste: true,
    ordersKakaoAudit: true,
    shipmentExeReconcile: true,
    catalogPptx: true,
    mobileChat: true,
    salesRevenueManagement: true,
    automation: true,
  },
  requirements: '',
};

export const TENANT_PRESETS = [
  {
    id: 'nenova',
    label: '네노바 (현재)',
    config: DEFAULT_TENANT_CONFIG,
  },
  {
    id: 'acme-flower',
    label: '샘플 — ACME 꽃도매',
    config: {
      ...DEFAULT_TENANT_CONFIG,
      tenantId: 'acme-flower',
      displayName: 'ACME플라워',
      branding: {
        appTitle: 'ACME Flower ERP',
        logoPath: '/nenova-logo.png',
        primaryColor: '#7c3aed',
        accentColor: '#0d9488',
      },
      company: {
        legalName: '(주)에이씨엠플라워 / 홍길동',
        bizNo: '123-45-67890',
        address: '경기도 김포시 샘플로 100',
        bizType: '도매 / 화훼',
        bankAccount: '국민 123-456-789012',
        telFax: '031-000-0000 / 031-000-0001',
      },
      domains: { web: 'https://erp.acme-flower.example' },
      legacyAdapter: { enabled: false, clientName: '' },
      integrations: {
        ecount: { enabled: false },
        googleSheets: { enabled: false },
        anthropic: { enabled: true },
        n8n: { enabled: false },
      },
      features: {
        ordersPaste: true,
        ordersKakaoAudit: false,
        shipmentExeReconcile: false,
        catalogPptx: true,
        mobileChat: false,
        salesRevenueManagement: true,
        automation: false,
      },
    },
  },
  {
    id: 'minimal',
    label: '샘플 — 최소 기능',
    config: {
      ...DEFAULT_TENANT_CONFIG,
      tenantId: 'minimal',
      displayName: '미니멀ERP',
      branding: {
        appTitle: 'Minimal ERP',
        logoPath: '/nenova-logo.png',
        primaryColor: '#334155',
        accentColor: '#334155',
      },
      company: {
        legalName: '미니멀 트레이딩',
        bizNo: '000-00-00000',
        address: '주소 입력',
        bizType: '도매',
        bankAccount: '계좌 입력',
        telFax: '연락처 입력',
      },
      legacyAdapter: { enabled: false },
      integrations: {
        ecount: { enabled: false },
        googleSheets: { enabled: false },
        anthropic: { enabled: false },
        n8n: { enabled: false },
      },
      features: {
        ordersPaste: false,
        ordersKakaoAudit: false,
        shipmentExeReconcile: false,
        catalogPptx: false,
        mobileChat: false,
        salesRevenueManagement: false,
        automation: false,
      },
      industry: {
        ...DEFAULT_TENANT_CONFIG.industry,
        timeBucketLabel: '주차',
        units: ['EA', 'BOX'],
      },
    },
  },
];

export function cloneTenantConfig(base = DEFAULT_TENANT_CONFIG) {
  return JSON.parse(JSON.stringify(base));
}
