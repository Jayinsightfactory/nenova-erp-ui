import { useEffect, useMemo, useState } from 'react';
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

export default function MoyiDriveAdminPage() {
  const [tabKey, setTabKey] = useState(TAB_DEFS[0].key);
  const [classification, setClassification] = useState(null); // null = 최초 로딩 중
  const [query, setQuery] = useState('');
  const [selectedFileId, setSelectedFileId] = useState(null);

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

  const files = classification?.body?.files || [];
  const filteredFiles = useMemo(() => filterFiles(files, query), [files, query]);

  if (!classification) {
    return <StatusPanel panel={loadingStatusPanel()} />;
  }

  const hardError = hardErrorStatusPanel(classification);
  if (hardError) {
    return <StatusPanel panel={hardError} />;
  }

  const data = classification.body;
  const connected = classification.kind === 'connected';
  const activeTab = TAB_DEFS.find((t) => t.key === tabKey) || TAB_DEFS[0];

  return (
    <div className="moyi-drive-page">
      <StatusPanel panel={topStatusPanel(classification)} />

      <Toolbar
        company={data.company}
        rootFolder={data.rootFolder}
        query={query}
        onQueryChange={setQuery}
        disabledReasons={DISABLED_REASON}
        connected={connected}
      />

      <Tabs tabs={TAB_DEFS} activeKey={tabKey} onSelect={setTabKey} />

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
                      <th>폴더</th>
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
        .moyi-file-table-wrap { max-height: calc(100vh - 260px); }
        .moyi-scroll-hint { display: none; }
        .moyi-erp-approval-box {
          border: 2px solid var(--red); border-radius: 2px; padding: 8px; margin-top: 6px;
        }
        .moyi-erp-approval-title { color: var(--red); font-weight: bold; font-size: 12px; margin-bottom: 6px; }
        .moyi-erp-approval-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .moyi-page-actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; margin-top: 4px; }

        @media (max-width: 768px) {
          .card-body { padding: 6px; }
          .moyi-erp-approval-actions :global(button) { min-height: 44px; flex: 1 1 auto; }
          .moyi-page-actions :global(button) { min-height: 44px; width: 100%; }
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
