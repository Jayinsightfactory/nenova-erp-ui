// pages/automation.js
// 업무 자동화 허브 — 같은 서버(Cafe24 VPS)에 docker로 띄운 n8n을 서브도메인으로 연다.
// (n8n은 서브경로(/n8n)보다 서브도메인을 공식 권장. 설치/연동: docs/N8N_SETUP.md, deploy/n8n/*)
//
// 서브도메인은 네노바웹과 다른 출처라 iframe 임베드 시 로그인 쿠키 문제가 생길 수 있어,
// 새 탭으로 여는 런처 방식으로 제공한다.

const N8N_URL = 'https://n8n.nenovaweb.com/';

export default function AutomationHub() {
  return (
    <div style={{ maxWidth: 760, margin: '24px auto', padding: '0 12px' }}>
      <h2 style={{ marginBottom: 4 }}>🔗 업무 자동화 (n8n)</h2>
      <p style={{ color: 'var(--text3)', marginTop: 0 }}>
        직원이 각자 자기 업무에 맞는 자동화 워크플로우를 만들어 사용하는 도구입니다.
      </p>

      <div className="banner-info" style={{ margin: '12px 0' }}>
        n8n은 별도 창(서브도메인)에서 열립니다. 아래 버튼으로 접속하세요. 처음 접속 시 <b>공용 계정</b>으로
        로그인합니다.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '16px 0' }}>
        <a className="btn btn-primary" href={N8N_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 15, padding: '10px 18px' }}>
          n8n 열기 ↗
        </a>
        <a className="btn" href={N8N_URL} target="_blank" rel="noopener noreferrer">새 탭에서 열기</a>
      </div>

      <div className="banner-warn" style={{ marginTop: 16 }}>
        보안 안내: n8n은 임의 코드·외부 요청이 가능한 강력한 도구입니다. ERP DB 관리자 계정 등 민감 정보는
        워크플로우에 저장하지 마세요. ERP 데이터 연동이 필요하면 별도 토큰 인증 API(브리지)를 사용하세요.
      </div>

      <p style={{ color: 'var(--text3)', fontSize: 12, marginTop: 16 }}>
        접속이 안 되면 서버 설정(서브도메인/인증서)이 아직 완료되지 않았을 수 있습니다. 설치 안내: <code>docs/N8N_SETUP.md</code>
      </p>
    </div>
  );
}
