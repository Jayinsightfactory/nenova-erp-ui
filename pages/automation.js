// pages/automation.js
// 업무 자동화 허브 — 같은 서버(Cafe24 VPS)에 docker로 띄운 n8n을 같은 출처 경로(/n8n/)로 임베드.
// n8n은 Next 라우트가 아니라 nginx가 /n8n/ 을 n8n 컨테이너(127.0.0.1:5678)로 프록시한다.
// (설치/배포: docs/N8N_SETUP.md, deploy/n8n/*)
//
// 같은 출처(nenovaweb.com)라 iframe 임베드가 가능하다. 혹시 브라우저/보안정책으로 iframe이
// 막히면 상단의 "새 탭에서 열기"로 바로 접속한다.

import { useState } from 'react';

const N8N_URL = '/n8n/';

export default function AutomationHub() {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 96px)' }}>
      <div className="filter-bar" style={{ justifyContent: 'space-between' }}>
        <span className="filter-label" style={{ fontWeight: 'bold' }}>
          업무 자동화 (n8n) — 직원이 각자 워크플로우를 만들어 사용합니다
        </span>
        <div className="page-actions">
          <button className="btn" onClick={() => setReloadKey(k => k + 1)}>새로고침</button>
          <a className="btn btn-primary" href={N8N_URL} target="_blank" rel="noopener noreferrer">새 탭에서 열기 ↗</a>
        </div>
      </div>
      <div className="banner-info" style={{ marginBottom: 6 }}>
        화면이 비어 있으면 아직 서버에 n8n이 설치되지 않았거나 프록시 설정 전입니다. 설치 안내: <code>docs/N8N_SETUP.md</code>.
        n8n은 강력한 도구이므로 ERP DB 관리자 계정 등 민감 정보는 워크플로우에 저장하지 마세요.
      </div>
      <iframe
        key={reloadKey}
        src={N8N_URL}
        title="n8n"
        style={{ flex: 1, width: '100%', border: '1px solid var(--border2)', background: '#fff' }}
      />
    </div>
  );
}
