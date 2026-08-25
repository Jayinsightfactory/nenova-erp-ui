// lib/moyiDriveViewModel.js
// pages/integrations/moyi-drive.js 화면을 위한 순수 함수 view-model.
// React·DOM에 의존하지 않는다 — 실제 API 응답(JSON)만 입력으로 받아 렌더링용 값을 만든다.
// 실제 원장 연결(loadMoyiDrive)이나 권한 검사(requireMoyiDriveAdmin) 로직은 건드리지 않는다.

export const TAB_DEFS = Object.freeze([
  { key: 'files', label: '파일' },
  { key: 'versions', label: '버전' },
  { key: 'permissions', label: '권한' },
  { key: 'downloads', label: '다운로드 기록' },
  { key: 'identities', label: '사용자 연결' },
  { key: 'automations', label: '자동 업무' },
]);

export const TAB_PENDING_KEY = Object.freeze({
  versions: 'versions',
  permissions: 'permissions',
  downloads: 'downloads',
  identities: 'identities',
  automations: 'automations',
});

// 320px 이하 실기기는 거의 없어 최소 기준으로만 유지하고, 기본은 44px(WCAG 권장)를 쓴다.
export const BREAKPOINTS = Object.freeze({ desktop: 1440, tablet: 768, phone: 390, phoneSmall: 360 });
export const TOUCH_TARGET = Object.freeze({ min: 40, preferred: 44 });

export const DISABLED_REASON = Object.freeze({
  upload: 'MOYI 파일 업로드 연결 대기',
  classify: 'MOYI 분류 저장 연결 대기',
  saveChanges: 'MOYI Core 권한 저장 연결 대기',
  automationPreview: '자동 업무 미리보기 연결 대기',
  erpApproval: '전산 자료 변경 승인 연결 대기',
});

export function filterFiles(files, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return files || [];
  return (files || []).filter((f) => String(f?.name || '').toLowerCase().includes(q)
    || (f?.tags || []).some((tag) => String(tag).toLowerCase().includes(q)));
}

export function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '크기 확인 필요';
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)}KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)}MB`;
}

export function fileBadgeTone(file) {
  if (file?.sourceDeleted) return 'red';
  if (file?.contentReady) return 'green';
  return 'amber';
}

// backend DTO(lib/moyiDriveGateway.js mapDriveItem)가 아직 주지 않는 열은
// 값을 지어내지 않고 "연결대기" 로 표시한다. 항목별 사유는 향후 계약 확장 시 갱신한다.
export function mapFileRowView(file) {
  const pendingCell = (text) => ({ value: text, pending: true });
  return {
    id: file?.id,
    preview: {
      available: Boolean(file?.previewAvailable && file?.fileId),
      src: file?.previewAvailable && file?.fileId ? `/api/moyi/drive-preview/${encodeURIComponent(file.fileId)}` : '',
      alt: `${file?.name || '파일'} 미리보기`,
    },
    name: { value: file?.name || '이름 없는 파일', pending: false, tags: file?.tags || [] },
    source: { value: file?.source || '알 수 없음', pending: false },
    size: { value: formatFileSize(file?.size), pending: false },
    modifiedAt: pendingCell('연결대기 · 변경시각 API 없음'),
    status: { value: file?.state || '상태 확인 필요', pending: false, tone: fileBadgeTone(file) },
    permission: pendingCell('연결대기 · 권한 API 없음'),
  };
}

const PERMISSION_ACTIONS = Object.freeze(['view', 'preview', 'download', 'upload', 'edit', 'delete', 'share']);
const PERMISSION_STATE_LABEL = Object.freeze({
  allowed: '직접 허용',
  inherited: '폴더에서 받음',
  denied: '차단',
  unknown: '확인 필요',
});

// docs/contract-drafts/moyi-drive-permission.draft.json의 action 집합을 반영한다.
// backend ACL 조회 API가 아직 없어 실제 페이지에서는 호출되지 않지만,
// 계약이 준비되면 바로 연결할 수 있도록 매핑만 미리 만들어 둔다.
export function mapPermissionRowView(row) {
  const actions = row?.actions || {};
  return {
    subject: row?.subjectLabel || '알 수 없음',
    subjectType: row?.subjectType || '',
    scope: row?.scopeLabel || '',
    actions: PERMISSION_ACTIONS.map((key) => ({
      key,
      state: actions[key] || 'unknown',
      label: PERMISSION_STATE_LABEL[actions[key]] || PERMISSION_STATE_LABEL.unknown,
    })),
  };
}

// ── 응답 분류 ────────────────────────────────────────────────
// loadMoyiDrive()는 성공(200)·연결대기(200/401/403/404/503, 모두 connectionReady 필드 포함)를 만든다.
// requireMoyiDriveAdmin·withAuth 실패는 connectionReady 필드가 없는 별도 오류 바디를 준다.
export function classifyDriveResponse({ status, body, networkError } = {}) {
  if (networkError) return { kind: 'networkError', status: status ?? null, body: null };
  if (body && typeof body === 'object' && 'connectionReady' in body) {
    return { kind: body.connectionReady ? 'connected' : 'pending', status, body };
  }
  if (status === 401) return { kind: 'authRequired', status, body };
  if (status === 403) return { kind: 'adminForbidden', status, body };
  if (status != null && status >= 500) return { kind: 'serverError', status, body };
  return { kind: 'unknown', status, body };
}

const NEXT_STEP_BY_CODE = Object.freeze({
  MOYI_DRIVE_UPSTREAM_REJECTED: (reason) => (String(reason || '').includes('찾을 수 없')
    ? '서버 관리자에게 MOYI Drive 루트 폴더 설정이 올바른지 확인을 요청하세요.'
    : '서버 관리자에게 MOYI 연결 상태와 폴더 접근 권한을 다시 확인해 달라고 요청하세요.'),
  MOYI_DRIVE_HANDSHAKE_FAILED: () => '잠시 후 새로고침해 보고, 계속되면 서버 관리자에게 MOYI 서버 상태 확인을 요청하세요.',
  MOYI_CONNECTION_TOKEN_MISSING: () => '연동 메뉴의 "MOYI 보고 연동" 화면에서 계정을 먼저 연결해 주세요.',
  MOYI_DRIVE_UPSTREAM_UNAVAILABLE: () => '잠시 후 다시 시도하고, 계속되면 MOYI 서버 상태를 서버 관리자에게 전달하세요.',
  MOYI_DRIVE_CONNECTION_PENDING: (reason) => {
    const text = String(reason || '');
    if (text.includes('운영에 반영')) return '배포 담당자에게 MOYI Drive 연동 PR의 운영 반영 여부를 확인해 달라고 요청하세요.';
    if (text.includes('루트 폴더')) return '서버 관리자에게 MOYI Drive 루트 폴더 설정을 요청하세요.';
    if (text.includes('계약 버전')) return '서버 관리자에게 MOYI Drive 계약 버전 확인을 요청하세요.';
    if (text.includes('배포되지 않았습니다')) return 'MOYI 쪽 개발팀에 Drive 목록 기능 배포 일정을 확인해 달라고 요청하세요.';
    return '서버 관리자에게 이 화면의 연결 대기 상태를 전달해 주세요.';
  },
});

export function nextStepFor(code, reason) {
  const resolver = NEXT_STEP_BY_CODE[code] || NEXT_STEP_BY_CODE.MOYI_DRIVE_CONNECTION_PENDING;
  return resolver(reason);
}

const AVAILABLE_NOW_TEXT = '화면 탐색과 탭 이동은 가능합니다. 실제 파일 목록·업로드·권한 변경은 연결된 뒤에만 가능합니다.';

// 상단 연결 상태 패널: 원인 / 지금 가능한 것 / 관리자가 할 다음 확인 3줄로 고정한다.
export function connectionStatusPanel(body) {
  const reason = body?.connectionReason || '원인이 아직 확인되지 않았습니다.';
  return {
    kind: 'pending',
    tone: 'amber',
    role: 'status',
    title: '연결 대기',
    lines: [
      { label: '원인', text: reason },
      { label: '지금 가능한 것', text: AVAILABLE_NOW_TEXT },
      { label: '관리자가 할 다음 확인', text: nextStepFor(body?.code, reason) },
    ],
  };
}

const HARD_ERROR_COPY = Object.freeze({
  authRequired: { title: '로그인이 필요합니다.', tone: 'red', role: 'alert', next: '다시 로그인한 뒤 이 화면을 열어 주세요.' },
  adminForbidden: { title: '접근 권한이 없습니다.', tone: 'red', role: 'alert', next: 'Drive 관리 권한이 필요하면 시스템 관리자에게 계정 등록을 요청하세요.' },
  serverError: { title: '서버 오류', tone: 'red', role: 'alert', next: '잠시 후 다시 시도하고, 계속되면 서버 관리자에게 알려 주세요.' },
  networkError: { title: '연결할 수 없습니다.', tone: 'red', role: 'alert', next: '네트워크 상태를 확인하고 다시 시도해 주세요.' },
  unknown: { title: '알 수 없는 오류', tone: 'red', role: 'alert', next: '잠시 후 다시 시도하고, 계속되면 서버 관리자에게 알려 주세요.' },
});

export function hardErrorStatusPanel(classification) {
  const copy = HARD_ERROR_COPY[classification?.kind];
  if (!copy) return null;
  const message = classification.body?.error || copy.title;
  return {
    kind: classification.kind,
    tone: copy.tone,
    role: copy.role,
    title: copy.title,
    lines: [
      { label: '원인', text: message },
      { label: '다음 확인', text: copy.next },
    ],
  };
}

// 상단 배너: 연결됨이면 초록 "실제 원장 연결", 아니면 connectionStatusPanel() 재사용.
export function topStatusPanel(classification) {
  if (classification.kind === 'connected') {
    return {
      kind: 'connected',
      tone: 'green',
      role: 'status',
      title: '실제 원장 연결',
      lines: [
        { label: '상태', text: classification.body?.connectionReason || '연결된 MOYI 회사의 실제 Drive 원장을 조회했습니다.' },
        { label: '참고', text: '실제 파일·권한·계정만 표시됩니다.' },
      ],
    };
  }
  return connectionStatusPanel(classification.body);
}

export function loadingStatusPanel() {
  return {
    kind: 'loading',
    tone: 'blue',
    role: 'status',
    title: '불러오는 중',
    lines: [{ label: '상태', text: 'Drive 화면 정보를 불러오는 중입니다.' }],
  };
}

// 파일 탭 이외 탭(버전/권한/다운로드 기록/사용자 연결/자동 업무) 상태 패널.
// data.pending.<key> 사유는 lib/moyiDriveGateway.js pendingDriveModel()이 정한다 — 여기서 값을 지어내지 않는다.
export function tabStatusPanel(tabKey, body) {
  const pendingField = TAB_PENDING_KEY[tabKey];
  if (!pendingField) return null;
  const reason = body?.pending?.[pendingField] || '아직 확인되지 않았습니다.';
  const extra = tabKey === 'automations' && body?.pending?.naverworks
    ? [{ label: '네이버웍스 연결', text: body.pending.naverworks }]
    : [];
  const label = TAB_DEFS.find((t) => t.key === tabKey)?.label || tabKey;
  return {
    kind: 'pending',
    tone: 'amber',
    role: 'status',
    title: `${label} 연결 대기`,
    lines: [
      { label: '원인', text: reason },
      ...extra,
      { label: '지금 가능한 것', text: `${label} 화면 구조와 예정 항목만 미리 볼 수 있습니다.` },
      { label: '관리자가 할 다음 확인', text: `개발팀에 ${label} 관련 backend API 일정을 확인해 달라고 요청하세요.` },
    ],
  };
}

export function emptyFileStatusPanel(reason) {
  return {
    kind: 'empty',
    tone: 'gray',
    role: 'status',
    title: '표시할 파일 없음',
    lines: [{ label: '원인', text: reason }],
  };
}

// 파일 탭 전용: 연결 전이면 상단 연결 패널을 재사용하고, 연결 후에는 목록/빈 목록/검색 결과 없음을 가른다.
export function fileTabStatus(classification, query) {
  if (classification.kind !== 'connected') return connectionStatusPanel(classification.body);
  const files = classification.body?.files || [];
  if (files.length === 0) return emptyFileStatusPanel('이 폴더에 표시할 실제 파일이 없습니다.');
  const filtered = filterFiles(files, query);
  if (filtered.length === 0) return emptyFileStatusPanel(`"${query}" 검색과 일치하는 파일이 없습니다.`);
  return null;
}
