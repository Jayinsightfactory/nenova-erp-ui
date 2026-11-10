// pages/ops.js
// 운영 관제탑(/ops) — 사장님 전용 한 화면 운영 관제. nenovaSS3(관리자)만, 그 외 404 은닉(pages/my-work.js 와 같은 게이트).
// v1 = "샘플/프로토타입 룩" 우선: 팔란티어식 관제탑 화면을 먼저 보여주고,
//   쉽게 되는 실데이터만 iframe 으로 연결(Orbit /erp-work.html·/work-unified.html, 열람토큰 ?token=).
//   나머지 칸은 "샘플 · 실데이터 아님" 뱃지를 단 예시값으로 채워 모양을 먼저 확인한다.
// 읽기 전용(쓰기·금융 로직 없음). 새 집계 SQL 없음 — 기존 Orbit 관리자 화면 재사용 + 페이지 마크업.
import MenuBackButton from '../components/MenuBackButton';
import { verifyReqUser } from '../lib/auth';
import { isOrbitReportViewer } from '../lib/orbitReportAccess';

const ORBIT = process.env.ORBIT_SERVER_URL || 'https://mindmap-viewer-production-adb2.up.railway.app';

// pages/my-work.js 와 동일한 열람토큰 발급(관리자 토큰으로 12시간 토큰, 1시간 전까지 캐시).
let _viewer = { token: '', exp: 0 };
async function orbitViewerToken() {
  if (_viewer.token && Date.now() < _viewer.exp - 3600 * 1000) return _viewer.token;
  if (!process.env.ORBIT_OWNER_TOKEN) return '';
  try {
    const r = await fetch(ORBIT + '/api/auth/viewer-token', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.ORBIT_OWNER_TOKEN } });
    const j = await r.json();
    if (r.ok && j.token) _viewer = { token: j.token, exp: new Date(j.expiresAt).getTime() };
  } catch {}
  return _viewer.token;
}

export async function getServerSideProps({ req, res }) {
  const user = await verifyReqUser(req, res);
  if (!isOrbitReportViewer(user)) return { notFound: true }; // 관리자 외 404 은닉
  const viewerToken = await orbitViewerToken();
  const orbitQs = viewerToken ? '?token=' + encodeURIComponent(viewerToken) : '';
  return { props: { userId: user.userId, orbit: ORBIT, orbitQs, hasToken: !!viewerToken } };
}

// ───── 9단계 업무 흐름(사장님 정의) ─────
const BIZ9 = [
  { k: '발주', dept: '영업부·수입부' },
  { k: '입고', dept: '수입부' },
  { k: '분배', dept: '영업지원' },
  { k: '현장출고', dept: '현장팀' },
  { k: '견적서', dept: '영업지원' },
  { k: '거래처전달', dept: '영업부' },
  { k: '입금', dept: '경영지원' },
  { k: '해외송금', dept: '경영지원' },
  { k: '이익', dept: '경영지원' },
];
// 샘플 흐름 건수 — 실데이터 아님(모양 확인용)
const SAMPLE_FLOW = [38, 22, 19, 17, 24, 24, 15, 6, 1];

// 샘플 부서 현황 — 실데이터 아님
const SAMPLE_DEPTS = [
  { name: '영업지원', people: ['설연주', '강현우', '임재용'], today: 41, note: '분배·견적 집중' },
  { name: '수입부', people: ['가브리엘', '김원빈'], today: 18, note: '발주·정산' },
  { name: '영업부', people: ['박성수', '정재훈', '조현욱'], today: 29, note: '거래처 전달' },
  { name: '경영지원', people: ['강명훈'], today: 12, note: '입금·송금' },
  { name: '현장팀', people: ['분류·배송'], today: 17, note: '현장 출고' },
];

// 샘플 전산 처리 요약 — 실데이터 아님
const SAMPLE_ERP = [
  { who: '설연주', saves: 54, match: 92, nochange: 6, screen: '출고분배' },
  { who: '강현우', saves: 37, match: 88, nochange: 11, screen: '견적서관리' },
  { who: '임재용', saves: 22, match: 95, nochange: 3, screen: '주문관리' },
  { who: '김원빈', saves: 15, match: 90, nochange: 5, screen: '발주관리' },
];

// 샘플 병목·이상 — 실데이터 아님
const SAMPLE_ALERTS = [
  { level: 'warn', title: '해독 큐 적체', body: '분석 대기 캡처 120건 (야간 워커 대기)' },
  { level: 'warn', title: '전산 "변경없음" 다발', body: '강현우 견적서관리 11건 저장했으나 전산 변화 없음' },
  { level: 'bad', title: '무응답 PC', body: '1대 (아침 부팅 시 자동 복구 예정)' },
  { level: 'ok', title: '데몬 상태', body: '활성 데몬 9대 정상' },
];

function Badge({ kind, children }) {
  const c = { sample: '#b9892b', real: '#2e7d4f', warn: '#b9892b', bad: '#b2403a', ok: '#2e7d4f' }[kind] || '#4a5568';
  return <span className="badge" style={{ borderColor: c, color: c }}>{children}</span>;
}
const SampleTag = () => <Badge kind="sample">샘플 · 실데이터 아님</Badge>;

export default function Ops({ orbit, orbitQs, hasToken }) {
  const src = (p) => orbit + p + orbitQs;
  return (
    <div className="ops">
      <MenuBackButton standalone />
      <header className="ops-top">
        <div>
          <h1>운영 관제탑 <span className="sub">Operaciones</span></h1>
          <p className="dim">회사 전체 운영을 한 화면에서 — 발주부터 이익까지. 읽기 전용 · 관리자 전용.</p>
        </div>
        <div className="ops-note">
          <SampleTag />
          <span className="dim"> 표시가 붙은 칸은 모양 확인용 예시값입니다(사장님 방향 결정용). 실데이터는 다음 단계에서 연결합니다.</span>
        </div>
      </header>

      {/* 1. 9단계 업무 흐름 띠 */}
      <section className="card">
        <div className="card-h"><h2>업무 흐름 9단계</h2><SampleTag /></div>
        <div className="flow9">
          {BIZ9.map((s, i) => (
            <div key={s.k} className="f9">
              <div className="f9-step">{i + 1}</div>
              <div className="f9-k">{s.k}</div>
              <div className="f9-dept dim">{s.dept}</div>
              <div className="f9-cnt">오늘 {SAMPLE_FLOW[i]}건</div>
              {i < BIZ9.length - 1 && <div className="f9-arw">→</div>}
            </div>
          ))}
        </div>
      </section>

      <div className="grid2">
        {/* 2. 전산 실제 처리 요약 */}
        <section className="card">
          <div className="card-h"><h2>전산 실제 처리 요약</h2><SampleTag /></div>
          <div className="stat-row">
            <div className="stat"><b>128</b><span>오늘 전산 저장</span></div>
            <div className="stat"><b>91%</b><span>평균 일치율</span></div>
            <div className="stat"><b>25</b><span>변경없음</span></div>
          </div>
          <table className="tbl">
            <thead><tr><th>직원</th><th>저장</th><th>일치율</th><th>변경없음</th><th>주화면</th></tr></thead>
            <tbody>{SAMPLE_ERP.map((r) => (
              <tr key={r.who}><td>{r.who}</td><td>{r.saves}</td><td>{r.match}%</td><td>{r.nochange}</td><td className="dim">{r.screen}</td></tr>
            ))}</tbody>
          </table>
          <div className="embed-h"><h3>실제 전산 처리(Orbit)</h3><Badge kind="real">실데이터</Badge></div>
          {hasToken
            ? <iframe title="전산 실제 처리" src={src('/erp-work.html')} className="emb" />
            : <p className="warn">Orbit 열람토큰이 없어 실데이터 화면을 띄우지 못했습니다(ORBIT_OWNER_TOKEN 미설정). 샘플만 표시합니다.</p>}
        </section>

        {/* 4. 병목·이상 */}
        <section className="card">
          <div className="card-h"><h2>병목 · 이상</h2><SampleTag /></div>
          <div className="alerts">{SAMPLE_ALERTS.map((a, i) => (
            <div key={i} className={'alert a-' + a.level}>
              <div className="al-dot" />
              <div><div className="al-t">{a.title}</div><div className="dim">{a.body}</div></div>
            </div>
          ))}</div>
        </section>
      </div>

      {/* 3. 부서별 현황 */}
      <section className="card">
        <div className="card-h"><h2>부서별 현황</h2><SampleTag /></div>
        <div className="depts">{SAMPLE_DEPTS.map((d) => (
          <div key={d.name} className="dept">
            <div className="dept-h">{d.name}<span className="dept-cnt">{d.today}</span></div>
            <div className="dim">{d.people.join(' · ')}</div>
            <div className="dept-note">{d.note}</div>
          </div>
        ))}</div>
        <div className="embed-h"><h3>전사 업무 통합본(Orbit)</h3><Badge kind="real">실데이터</Badge></div>
        {hasToken
          ? <iframe title="전사 업무 통합본" src={src('/work-unified.html')} className="emb" />
          : <p className="warn">Orbit 열람토큰이 없어 실데이터 화면을 띄우지 못했습니다. 샘플만 표시합니다.</p>}
      </section>

      {/* 5. 솔루션 판매 파이프라인 — 자리만 */}
      <section className="card">
        <div className="card-h"><h2>솔루션 판매 파이프라인</h2><Badge kind="sample">준비 중</Badge></div>
        <div className="soon">
          <div className="soon-i">🧩</div>
          <div>
            <b>준비 중 — CRM 연동 예정</b>
            <p className="dim">솔루션(오르빗·MOYI 등) 판매 리드·상담·계약 단계를 이 자리에 붙입니다(Twenty/CRM 연동). 지금은 자리만 잡아 둔 칸입니다.</p>
            <div className="pipe">{['리드', '상담', '제안', '계약', '운영'].map((s) => (
              <div key={s} className="pipe-col"><div className="pipe-k">{s}</div><div className="pipe-box dim">—</div></div>
            ))}</div>
          </div>
        </div>
      </section>

      <footer className="ops-foot dim">
        운영 관제탑 v1(샘플) · 읽기 전용 · 관리자 전용 · 실데이터 연동은 사장님 확인 후 다음 단계
      </footer>

      <style jsx>{`
        .ops { background: #0d1117; color: #e6e9ee; min-height: 100vh; padding: 20px 24px 48px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .ops h1 { font-size: 24px; margin: 0 0 4px; font-weight: 700; }
        .ops h1 .sub { font-size: 14px; color: #7fb3ff; font-weight: 500; margin-left: 8px; }
        .ops h2 { font-size: 16px; margin: 0; }
        .ops h3 { font-size: 13px; margin: 0; color: #c9ced6; }
        .dim { color: #8b949e; }
        .warn { color: #e0a33a; padding: 8px 0; }
        .ops-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; border-bottom: 1px solid #222a35; padding-bottom: 14px; }
        .ops-top p { margin: 0; font-size: 13px; }
        .ops-note { max-width: 440px; font-size: 12px; }
        .badge { display: inline-block; border: 1px solid; border-radius: 999px; padding: 1px 9px; font-size: 11px; font-weight: 600; white-space: nowrap; }
        .card { background: #131a24; border: 1px solid #222a35; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
        .card-h { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .card-h h2 { flex: 0 0 auto; }
        .grid2 { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
        @media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
        .flow9 { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 4px; }
        .f9 { position: relative; flex: 1 1 0; min-width: 92px; background: #0d1117; border: 1px solid #263141; border-radius: 8px; padding: 10px 8px; text-align: center; }
        .f9-step { width: 22px; height: 22px; line-height: 22px; margin: 0 auto 6px; border-radius: 50%; background: #1f2a3a; color: #7fb3ff; font-weight: 700; font-size: 12px; }
        .f9-k { font-weight: 700; font-size: 14px; }
        .f9-dept { font-size: 11px; margin: 2px 0 6px; }
        .f9-cnt { font-size: 12px; color: #7fb3ff; }
        .f9-arw { position: absolute; right: -10px; top: 50%; transform: translateY(-50%); color: #3a4454; z-index: 1; font-size: 14px; }
        .stat-row { display: flex; gap: 10px; margin-bottom: 12px; }
        .stat { flex: 1; background: #0d1117; border: 1px solid #263141; border-radius: 8px; padding: 10px; text-align: center; }
        .stat b { display: block; font-size: 22px; color: #7fb3ff; }
        .stat span { font-size: 11px; color: #8b949e; }
        .tbl { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 14px; }
        .tbl th, .tbl td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #222a35; }
        .tbl th { color: #8b949e; font-weight: 600; font-size: 12px; }
        .embed-h { display: flex; align-items: center; gap: 8px; margin: 6px 0 8px; }
        .emb { width: 100%; height: 420px; border: 1px solid #222a35; border-radius: 8px; background: #fff; }
        .alerts { display: flex; flex-direction: column; gap: 8px; }
        .alert { display: flex; gap: 10px; align-items: flex-start; background: #0d1117; border: 1px solid #263141; border-radius: 8px; padding: 10px; }
        .al-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; flex: 0 0 auto; }
        .a-warn .al-dot { background: #b9892b; } .a-bad .al-dot { background: #b2403a; } .a-ok .al-dot { background: #2e7d4f; }
        .al-t { font-weight: 600; font-size: 13px; }
        .depts { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin-bottom: 14px; }
        .dept { background: #0d1117; border: 1px solid #263141; border-radius: 8px; padding: 12px; }
        .dept-h { display: flex; justify-content: space-between; font-weight: 700; font-size: 14px; margin-bottom: 4px; }
        .dept-cnt { color: #7fb3ff; }
        .dept-note { font-size: 12px; color: #c9ced6; margin-top: 6px; }
        .soon { display: flex; gap: 14px; align-items: flex-start; }
        .soon-i { font-size: 34px; }
        .soon p { margin: 4px 0 12px; font-size: 13px; }
        .pipe { display: flex; gap: 8px; }
        .pipe-col { flex: 1; text-align: center; }
        .pipe-k { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
        .pipe-box { border: 1px dashed #3a4454; border-radius: 6px; padding: 18px 6px; font-size: 12px; }
        .ops-foot { font-size: 12px; text-align: center; padding-top: 8px; }
      `}</style>
    </div>
  );
}
