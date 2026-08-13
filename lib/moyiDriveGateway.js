import { moyiBase, tokenFrom } from '../pages/api/moyi/_proxy.js';

const SOURCE_LABELS = Object.freeze({
  moyi_upload: 'MOYI 앱',
  naverworks_drive: '네이버웍스 Drive',
});

const STATE_LABELS = Object.freeze({
  verified: '확인 완료',
  observed: '백업 대기',
  source_deleted: '원본에서 삭제됨',
});

export const MOYI_DRIVE_CONTRACT_REVISION = '2026-08-12.1';

export function inspectDriveOpenApi(document) {
  const paths = document?.paths || {};
  return {
    listItems: Boolean(paths['/drive/v2/folders/{folder_id}/items']?.get),
    listConnectionItems: Boolean(paths['/integrations/nenovaweb/drive-items']?.get),
    writeAcl: Boolean(paths['/drive/v2/folders/{folder_id}/acl']?.put),
    recordManifest: Boolean(paths['/drive/v2/folders/{folder_id}/naverworks/manifest']?.post),
    rawUrl: Boolean(paths['/files/{file_id}/raw-url']?.get),
    guardedRaw: Boolean(paths['/files/{file_id}/raw']?.get),
  };
}

export function mapDriveItem(item) {
  return {
    id: String(item?.id || ''),
    fileId: item?.file_id ? String(item.file_id) : null,
    name: String(item?.name || '이름 없는 파일'),
    source: SOURCE_LABELS[item?.source_kind] || String(item?.source_kind || '알 수 없음'),
    state: STATE_LABELS[item?.sync_state] || String(item?.sync_state || '상태 확인 필요'),
    sourceDeleted: Boolean(item?.source_deleted),
    contentReady: Boolean(item?.file_id),
  };
}

export function pendingDriveModel(reason, code = 'MOYI_DRIVE_CONNECTION_PENDING') {
  return {
    success: false,
    code,
    connectionReady: false,
    connectionReason: reason,
    company: { id: null, name: 'MOYI 연결 회사 확인 대기' },
    rootFolder: null,
    files: [],
    capabilities: {
      listItems: false,
      folderTree: false,
      readAcl: false,
      writeAcl: false,
      syncStatus: false,
      preview: false,
      download: false,
      versions: false,
      identityMapping: false,
    },
    pending: {
      permissions: 'backend에 ACL 조회 API가 아직 없습니다.',
      naverworks: 'backend에 동기화 작업·checkpoint 조회 API와 실제 connector 인증 계약이 아직 없습니다.',
      versions: 'backend에 파일 버전 조회 API가 아직 없습니다.',
      downloads: 'backend에 관리자용 다운로드 감사 조회 API가 아직 없습니다.',
      identities: 'Nenova UserInfo.UserID 연결표와 승인 API가 아직 없습니다.',
      automations: 'Drive 동기화 작업 조회·제어 API가 아직 없습니다.',
    },
  };
}

export function hasCrossWorkspaceInput(body = {}) {
  return ['workspace_id', 'workspaceId', 'tenant_id', 'tenantId', 'company_id', 'companyId']
    .some((key) => Object.prototype.hasOwnProperty.call(body, key));
}

export function moyiUpstreamFailure(status) {
  const reason = status === 404
    ? '연결된 MOYI 회사에서 지정 Drive 폴더를 찾을 수 없거나 접근할 수 없습니다.'
    : status === 401 || status === 403
      ? 'MOYI 연결이 만료됐거나 지정 폴더를 볼 권한이 없습니다.'
      : 'MOYI Drive 읽기 API가 아직 준비되지 않았습니다.';
  return { status: status >= 500 ? 503 : status, body: pendingDriveModel(reason, 'MOYI_DRIVE_UPSTREAM_REJECTED') };
}

export async function loadMoyiDrive(req) {
  const token = tokenFrom(req);
  if (!token) {
    return { status: 503, body: pendingDriveModel('MOYI 계정 연결 토큰이 없습니다. 먼저 MOYI 보고 연동을 연결해 주세요.', 'MOYI_CONNECTION_TOKEN_MISSING') };
  }
  let handshake;
  try {
    const [capabilityResponse, openApiResponse] = await Promise.all([
      fetch(`${moyiBase()}/drive/capabilities`, { headers: { Accept: 'application/json' } }),
      fetch(`${moyiBase()}/openapi.json`, { headers: { Accept: 'application/json' } }),
    ]);
    const capability = await capabilityResponse.json().catch(() => null);
    handshake = inspectDriveOpenApi(await openApiResponse.json().catch(() => null));
    if (!capabilityResponse.ok || capability?.contract_revision !== MOYI_DRIVE_CONTRACT_REVISION
      || capability?.flags?.drive_legacy_inline_url !== false || !handshake.listConnectionItems) {
      return { status: 503, body: pendingDriveModel('MOYI 서버에 필요한 Drive 목록 기능이 아직 배포되지 않았습니다.') };
    }
  } catch (_) {
    return { status: 503, body: pendingDriveModel('MOYI Drive 기능 확인에 실패했습니다.', 'MOYI_DRIVE_HANDSHAKE_FAILED') };
  }
  let rootResponse;
  try {
    rootResponse = await fetch(`${moyiBase()}/integrations/nenovaweb/drive-root`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
  } catch (_) {
    return { status: 503, body: pendingDriveModel('MOYI Drive 루트 연결을 확인할 수 없습니다.', 'MOYI_DRIVE_ROOT_UNAVAILABLE') };
  }
  const root = await rootResponse.json().catch(() => null);
  if (!rootResponse.ok) return moyiUpstreamFailure(rootResponse.status);
  const folderId = String(root?.root_folder_id || '');
  if (!root?.ready || !folderId) {
    return { status: 503, body: pendingDriveModel('MOYI 연결은 확인됐습니다. 아래 연결 준비 버튼으로 회사 전용 Drive 폴더를 만들어 주세요.', 'MOYI_DRIVE_BOOTSTRAP_REQUIRED') };
  }

  let upstream;
  try {
    upstream = await fetch(`${moyiBase()}/integrations/nenovaweb/drive-items`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
  } catch (_) {
    return { status: 503, body: pendingDriveModel('MOYI Drive 서버에 연결할 수 없습니다.', 'MOYI_DRIVE_UPSTREAM_UNAVAILABLE') };
  }
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !Array.isArray(data)) {
    return moyiUpstreamFailure(upstream.status);
  }

  const model = pendingDriveModel('');
  return {
    status: 200,
    body: {
      ...model,
      success: true,
      code: 'MOYI_DRIVE_CONNECTED',
      connectionReady: true,
      connectionReason: '연결된 MOYI 회사의 실제 Drive 원장을 조회했습니다.',
      company: { id: null, name: '연결된 MOYI 회사' },
      rootFolder: { id: folderId, name: '설정된 Drive 루트' },
      files: data.map(mapDriveItem),
      contractRevision: MOYI_DRIVE_CONTRACT_REVISION,
      capabilities: {
        ...model.capabilities,
        listItems: handshake.listConnectionItems,
        writeAcl: false,
        preview: handshake.rawUrl && handshake.guardedRaw,
        download: handshake.rawUrl && handshake.guardedRaw,
      },
    },
  };
}

export async function bootstrapMoyiDrive(req) {
  const token = tokenFrom(req);
  if (!token) return { status: 503, body: pendingDriveModel('MOYI 보고 연동을 먼저 연결해 주세요.', 'MOYI_CONNECTION_TOKEN_MISSING') };
  let upstream;
  try {
    upstream = await fetch(`${moyiBase()}/integrations/nenovaweb/drive-root`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
  } catch (_) {
    return { status: 503, body: pendingDriveModel('MOYI Drive 연결 준비 요청에 실패했습니다.', 'MOYI_DRIVE_BOOTSTRAP_FAILED') };
  }
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !data?.ready) return moyiUpstreamFailure(upstream.status);
  return { status: 200, body: { success: true, code: 'MOYI_DRIVE_BOOTSTRAPPED',
    message: data.created ? '회사 전용 Drive 폴더를 만들었습니다.' : '회사 전용 Drive 폴더가 이미 준비돼 있습니다.' } };
}
