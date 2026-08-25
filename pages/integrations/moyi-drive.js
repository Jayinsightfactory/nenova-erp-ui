import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '../../components/moyiDrive/Button';
import StatusPanel from '../../components/moyiDrive/StatusPanel';
import Tabs from '../../components/moyiDrive/Tabs';
import Toolbar from '../../components/moyiDrive/Toolbar';
import FileRow from '../../components/moyiDrive/FileRow';
import {
  TAB_DEFS,
  DISABLED_REASON,
  classifyDriveResponse,
  connectionStatusPanel,
  hardErrorStatusPanel,
  loadingStatusPanel,
  tabStatusPanel,
  topStatusPanel,
  fileTabStatus,
  filterFiles,
  mapFileRowView,
} from '../../lib/moyiDriveViewModel';

const FILE_VIEWS = [
  { id: 'all', label: '전체 파일' },
  { id: 'moyi', label: 'MOYI 앱에서 올림' },
  { id: 'naverworks', label: '네이버웍스에서 가져옴' },
  { id: 'needs-review', label: '정리 필요' },
  { id: 'ready', label: '확인 완료' },
];

const EXISTING_FILE_BUCKETS = [
  { key: 'eligible', label: '연결 가능', help: '현재 연결된 회사와 저장 원본을 확인한 파일입니다.' },
  { key: 'ambiguous', label: '확인 필요', help: '회사 또는 소유자 정보가 겹쳐 자동 연결하지 않습니다.' },
  { key: 'no_workspace', label: '회사 정보 없음', help: '어느 회사 자료인지 확인할 수 없어 연결하지 않습니다.' },
  { key: 'already_linked', label: '이미 연결됨', help: '중복 연결하지 않습니다.' },
  { key: 'missing_storage', label: '원본 확인 불가', help: '저장 원본을 찾을 수 없어 연결하지 않습니다.' },
];

export default function MoyiDriveAdminPage() {
  const [tabKey, setTabKey] = useState(TAB_DEFS[0].key);
  const [classification, setClassification] = useState(null); // null = 최초 로딩 중
  const [query, setQuery] = useState('');
  const [fileView, setFileView] = useState('all');
  const [selectedFileId, setSelectedFileId] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [existingFiles, setExistingFiles] = useState({ state: 'idle', preview: null, result: null, error: '' });
  const loadDrive = useCallback(async () => {
    try {
      const res = await fetch('/api/moyi/drive-admin');
      const body = await res.json().catch(() => null);
      setClassification(classifyDriveResponse({ status: res.status, body }));
    } catch (_) {
      setClassification(classifyDriveResponse({ networkError: true }));
    }
  }, []);
  useEffect(() => {
    let active = true;
    fetch('/api/moyi/drive-admin')
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (active) setClassification(classifyDriveResponse({ status: res.status, body }));
      })
      .catch(() => { if (active) setClassification(classifyDriveResponse({ networkError: true })); });
    return () => { active = false; };
  }, []);
  const loadExistingPreview = useCallback(async () => {
    setExistingFiles((current) => ({ ...current, state: 'loading', error: '', result: null }));
    try {
      const res = await fetch('/api/moyi/drive-admin?view=existing-files-preview');
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.preview) {
        setExistingFiles({ state: 'error', preview: null, result: null, error: body?.error || body?.connectionReason || '기존 파일 연결 상태를 확인하지 못했습니다.' });
        return;
      }
      setExistingFiles({ state: 'preview', preview: body.preview, result: null, error: '' });
    } catch (_) {
      setExistingFiles({ state: 'error', preview: null, result: null, error: '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  }, []);
  const files = classification?.body?.files || [];
  const filteredFiles = useMemo(() => filterFiles(files, query).filter((file) => {
    if (fileView === 'moyi') return file.source === 'MOYI 앱';
    if (fileView === 'naverworks') return file.source === '네이버웍스 Drive';
    if (fileView === 'needs-review') return !file.contentReady || file.sourceDeleted;
    if (fileView === 'ready') return file.contentReady && !file.sourceDeleted;
    return true;
  }), [files, query, fileView]);

  if (!classification) {
    return <StatusPanel panel={loadingStatusPanel()} />;
  }

  const hardError = hardErrorStatusPanel(classification);
  if (hardError) {
    return <StatusPanel panel={hardError} />;
  }

  const data = classification.body;
  const connected = classification.kind === 'connected';
  const canBootstrap = classification?.body?.code === 'MOYI_DRIVE_BOOTSTRAP_REQUIRED';
  const activeTab = TAB_DEFS.find((t) => t.key === tabKey) || TAB_DEFS[0];
  const eligibleCount = Number(existingFiles.preview?.counts?.eligible || 0);
  const previewToken = existingFiles.preview?.previewToken || '';

  const applyExistingFiles = async () => {
    if (eligibleCount < 1 || !previewToken) return;
    if (!window.confirm(`현재 연결된 회사에 기존 MOYI 파일 ${eligibleCount}건을 연결합니다. 확인이 필요한 파일과 원본을 찾지 못한 파일은 연결하지 않습니다. 계속할까요?`)) return;
    setExistingFiles((current) => ({ ...current, state: 'applying', error: '', result: null }));
    try {
      const res = await fetch('/api/moyi/drive-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply-existing-files', preview_token: previewToken, confirm: true }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.result) {
        setExistingFiles((current) => ({ ...current, state: 'error', error: body?.error || body?.connectionReason || '기존 파일 연결을 완료하지 못했습니다.' }));
        return;
      }
      await Promise.all([loadDrive(), loadExistingPreview()]);
      setExistingFiles((current) => ({ ...current, state: 'done', result: body.result, error: '' }));
    } catch (_) {
      setExistingFiles((current) => ({ ...current, state: 'error', error: '서버에 연결하지 못했습니다. 연결 결과를 확인한 뒤 다시 시도해 주세요.' }));
    }
  };

  return (
    <div className="moyi-drive-page">
      <StatusPanel panel={topStatusPanel(classification)} />
      {canBootstrap && (
        <div className="moyi-bootstrap-action">
          <Button variant="primary" disabled={preparing} reason={preparing ? '회사 전용 폴더를 준비하고 있습니다.' : undefined} onClick={async () => {
            setPreparing(true);
            try {
              const res = await fetch('/api/moyi/drive-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bootstrap' }) });
              const body = await res.json().catch(() => null);
              if (!res.ok) setClassification(classifyDriveResponse({ status: res.status, body }));
              else window.location.reload();
            } finally { setPreparing(false); }
          }}>{preparing ? '연결 준비 중…' : '회사 Drive 연결 준비'}</Button>
        </div>
      )}

      <Toolbar
        company={data.company}
        rootFolder={data.rootFolder}
        query={query}
        onQueryChange={setQuery}
        disabledReasons={DISABLED_REASON}
        connected={connected}
      />

      {connected && tabKey === 'files' && (
        <section className="moyi-existing-files" aria-labelledby="moyi-existing-files-title">
          <div className="moyi-existing-files-head">
            <div>
              <b id="moyi-existing-files-title">기존 MOYI 파일 연결</b>
              <p>과거에 올린 파일 중 현재 회사 Drive에 아직 표시되지 않는 자료를 먼저 확인합니다.</p>
            </div>
            <Button
              variant="primary"
              disabled={existingFiles.state === 'loading' || existingFiles.state === 'applying'}
              reason={existingFiles.state === 'loading' ? '기존 파일을 확인하고 있습니다.' : existingFiles.state === 'applying' ? '기존 파일을 연결하고 있습니다.' : undefined}
              onClick={loadExistingPreview}
            >{existingFiles.state === 'loading' ? '확인 중…' : '기존 파일 확인'}</Button>
          </div>
          {existingFiles.state === 'error' && <div className="moyi-existing-files-error" role="alert">{existingFiles.error}</div>}
          {existingFiles.preview && (
            <div className="moyi-existing-files-preview" aria-live="polite">
              <div className="moyi-existing-files-counts">
                {EXISTING_FILE_BUCKETS.map((bucket) => (
                  <div key={bucket.key} className={`moyi-existing-count ${bucket.key}`}>
                    <b>{bucket.label} {Number(existingFiles.preview.counts?.[bucket.key] || 0)}건</b>
                    <span>{bucket.help}</span>
                  </div>
                ))}
              </div>
              {EXISTING_FILE_BUCKETS.map((bucket) => {
                const samples = existingFiles.preview.samples?.[bucket.key] || [];
                if (!samples.length) return null;
                return <div className="moyi-existing-file-samples" key={bucket.key}>
                  <b>{bucket.label} 예시</b>
                  <ul>{samples.map((sample, index) => <li key={`${bucket.key}-${sample.id || index}`}><span>{sample.name}</span>{sample.reason && <small>{sample.reason}</small>}</li>)}</ul>
                </div>;
              })}
              {existingFiles.preview.message && <p className="moyi-existing-files-message">{existingFiles.preview.message}</p>}
              <div className="moyi-existing-files-actions">
                <Button
                  variant="primary"
                  disabled={eligibleCount < 1 || !previewToken || existingFiles.state === 'applying'}
                  reason={eligibleCount < 1 ? '연결 가능한 기존 파일이 없습니다.' : !previewToken ? '확인값이 만료됐습니다. 기존 파일 확인을 다시 실행해 주세요.' : existingFiles.state === 'applying' ? '기존 파일을 연결하고 있습니다.' : undefined}
                  onClick={applyExistingFiles}
                >{existingFiles.state === 'applying' ? '연결 중…' : `연결 가능한 ${eligibleCount}건 연결`}</Button>
                <span>확인 필요·회사 정보 없음·원본 확인 불가 파일은 자동 연결하지 않습니다.</span>
              </div>
            </div>
          )}
          {existingFiles.result && <div className="moyi-existing-files-result" role="status">기존 파일 {existingFiles.result.applied}건을 연결했습니다. 목록을 다시 불러왔습니다.{existingFiles.result.message ? ` ${existingFiles.result.message}` : ''}</div>}
        </section>
      )}

      <Tabs tabs={TAB_DEFS} activeKey={tabKey} onSelect={setTabKey} />

      {tabKey === 'files' && <nav className="moyi-drive-views" aria-label="파일 빠른 보기">
        <b>빠른 보기</b>
        {FILE_VIEWS.map((view) => <button key={view.id} className={fileView===view.id?'active':''} aria-current={fileView===view.id?'page':undefined} onClick={()=>setFileView(view.id)}>{view.label}</button>)}
        <span className="moyi-drive-organize-help">폴더는 팀·업무 중심으로 적게 만들고, 연도·차수·거래처·문서 종류는 분류 정보로 찾습니다.</span>
      </nav>}

      <div className="card moyi-tab-card" role="tabpanel" id={`moyi-panel-${tabKey}`} aria-labelledby={`moyi-tab-${tabKey}`}>
        <div className="card-header">
          <span className="card-title">{activeTab.label}</span>
        </div>
        <div className="card-body">
          {tabKey === 'files' && (() => {
            const panel = fileTabStatus(classification, query);
            if (panel) return <StatusPanel panel={panel} />;
            return (
              <div className="table-wrap moyi-file-table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>미리보기</th>
                      <th>파일명</th>
                      <th>출처</th>
                      <th>크기</th>
                      <th>변경시각</th>
                      <th>상태</th>
                      <th>권한</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.map((file) => {
                      const row = mapFileRowView(file);
                      return (
                        <FileRow
                          key={row.id}
                          row={row}
                          selected={selectedFileId === row.id}
                          onSelect={() => setSelectedFileId(row.id)}
                        />
                      );
                    })}
                  </tbody>
                </table>
                <div className="moyi-scroll-hint">옆으로 밀어 더 보기</div>
              </div>
            );
          })()}

          {tabKey === 'automations' && (
            <>
              <StatusPanel panel={connected ? tabStatusPanel('automations', data) : connectionStatusPanel(data)} />
              <div className="moyi-erp-approval-box">
                <div className="moyi-erp-approval-title">전산 자료 변경 · 추가 승인 필요</div>
                <div className="moyi-erp-approval-actions">
                  <Button disabled reason={DISABLED_REASON.automationPreview}>미리보기</Button>
                  <Button variant="danger" disabled reason={DISABLED_REASON.erpApproval}>전산 변경 별도 승인</Button>
                </div>
              </div>
            </>
          )}

          {tabKey !== 'files' && tabKey !== 'automations' && (
            <StatusPanel panel={connected ? tabStatusPanel(tabKey, data) : connectionStatusPanel(data)} />
          )}
        </div>
      </div>

      {(tabKey === 'permissions' || tabKey === 'identities') && (
        <div className="moyi-page-actions">
          <Button variant="primary" disabled reason={DISABLED_REASON.saveChanges}>변경 저장</Button>
        </div>
      )}

      <style jsx>{`
        .moyi-tab-card { margin-top: 4px; }
        .moyi-drive-views { display: flex; align-items: center; gap: 3px; margin-top: 4px; padding: 5px; border: 1px solid var(--border); background: var(--surface2); overflow-x: auto; }
        .moyi-drive-views > b { white-space: nowrap; padding: 0 5px; }
        .moyi-drive-views button { border: 0; background: transparent; padding: 7px 8px; white-space: nowrap; cursor: pointer; }
        .moyi-drive-views button:hover, .moyi-drive-views button.active { background: #c5d9f1; box-shadow: inset 0 -3px #0066cc; font-weight: bold; }
        .moyi-drive-organize-help { margin-left: auto; color: var(--text3); white-space: nowrap; padding: 0 5px; }
        .moyi-bootstrap-action { display: flex; justify-content: flex-end; margin: 4px 0; }
        .moyi-existing-files { margin-top: 4px; padding: 8px; border: 1px solid #9abce3; background: #f6fbff; }
        .moyi-existing-files-head { display: flex; gap: 10px; justify-content: space-between; align-items: center; }
        .moyi-existing-files-head p { margin: 3px 0 0; color: var(--text3); font-size: 12px; }
        .moyi-existing-files-counts { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 5px; margin-top: 8px; }
        .moyi-existing-count { border: 1px solid var(--border); background: var(--surface); padding: 5px; }
        .moyi-existing-count b, .moyi-existing-count span { display: block; font-size: 11px; }
        .moyi-existing-count span { margin-top: 3px; color: var(--text3); }
        .moyi-existing-count.eligible { border-left: 4px solid #16803c; }
        .moyi-existing-count.ambiguous, .moyi-existing-count.no_workspace { border-left: 4px solid #bd7a00; }
        .moyi-existing-count.missing_storage { border-left: 4px solid var(--red); }
        .moyi-existing-file-samples { margin-top: 7px; font-size: 12px; }
        .moyi-existing-file-samples ul { margin: 3px 0 0; padding-left: 19px; }
        .moyi-existing-file-samples small { margin-left: 5px; color: var(--text3); }
        .moyi-existing-files-actions { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
        .moyi-existing-files-actions span, .moyi-existing-files-message { color: var(--text3); font-size: 11px; }
        .moyi-existing-files-error { margin-top: 6px; padding: 6px; border: 1px solid var(--red); color: var(--red); background: #fff4f4; }
        .moyi-existing-files-result { margin-top: 6px; padding: 6px; border: 1px solid #4e9d65; color: #0d6b2b; background: #f2fff5; }
        .moyi-file-table-wrap { max-height: calc(100vh - 260px); }
        .moyi-scroll-hint { display: none; }
        .moyi-erp-approval-box {
          border: 2px solid var(--red); border-radius: 2px; padding: 8px; margin-top: 6px;
        }
        .moyi-erp-approval-title { color: var(--red); font-weight: bold; font-size: 12px; margin-bottom: 6px; }
        .moyi-erp-approval-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .moyi-page-actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; margin-top: 4px; }

        @media (max-width: 900px) {
          .moyi-existing-files-head, .moyi-existing-files-actions { align-items: stretch; flex-direction: column; }
          .moyi-existing-files-head :global(button), .moyi-existing-files-actions :global(button) { min-height: 36px; width: 100%; }
          .moyi-existing-files-counts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        @media (max-width: 768px) {
          .moyi-drive-views { min-height: 44px; }
          .moyi-drive-views button { min-height: 44px; }
          .moyi-drive-organize-help, .moyi-drive-views > b { display: none; }
          .card-body { padding: 6px; }
          .moyi-erp-approval-actions :global(button) { min-height: 44px; flex: 1 1 auto; }
          .moyi-page-actions :global(button) { min-height: 44px; width: 100%; }
          .moyi-existing-files-head, .moyi-existing-files-actions { align-items: stretch; flex-direction: column; }
          .moyi-existing-files-head :global(button), .moyi-existing-files-actions :global(button) { min-height: 44px; width: 100%; }
          .moyi-existing-files-counts { grid-template-columns: 1fr; }
          .moyi-file-table-wrap .moyi-scroll-hint {
            display: block; font-size: 10px; color: var(--text3); padding: 4px 2px 0;
          }
          .moyi-file-table-wrap :global(th:nth-child(2)),
          .moyi-file-table-wrap :global(td:nth-child(2)) {
            position: sticky; left: 0; background: var(--surface); z-index: 1;
          }
        }
      `}</style>
    </div>
  );
}
