// pages/briefing.js — 아침 브리핑 한 장
// 출근해서 "오늘 바로 볼 것"을 한 화면에서 본다. 읽기 전용: 기존 조회 API만 부르고 어떤 원장도 쓰지 않는다.
// 숫자는 각 원본 화면과 같은 API에서 그대로 가져온다(카드 변환: lib/morningBriefing.js).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BRIEFING_SOURCES, buildBriefing, todayKst } from '../lib/morningBriefing';
import { isAdminUser } from '../lib/userAccess';
import WorkflowGuide from '../components/WorkflowGuide';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const STATUS_MARK = { red: '●', amber: '▲', green: '✓', gray: '–' };

function dateLabel(today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return '';
  const [y, m, d] = today.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일 (${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

async function readSource(source) {
  try {
    const response = await fetch(source.path, { credentials: 'include', cache: 'no-store' });
    if (response.status === 401) {
      if (typeof window !== 'undefined') window.location.href = '/login';
      return { ok: false, status: 401, error: '로그인이 필요합니다.' };
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.success === false) {
      return { ok: false, status: response.status, error: data?.error || `조회 실패 (${response.status})` };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || '연결 실패' };
  }
}

export default function MorningBriefingPage() {
  const [briefing, setBriefing] = useState(null);
  const [busy, setBusy] = useState(true);
  const [loadedAt, setLoadedAt] = useState('');
  const [userName, setUserName] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    const me = await readSource({ path: '/api/auth/me' });
    const user = me.ok ? me.data.user || {} : {};
    const isAdmin = isAdminUser(user);
    // 관리자 전용 조회는 관리자가 아닐 때 아예 부르지 않는다(403 기록을 남기지 않기 위해).
    const sources = BRIEFING_SOURCES.filter((source) => isAdmin || !source.adminOnly);
    const entries = await Promise.all(sources.map(async (source) => [source.id, await readSource(source)]));
    setUserName(user.userName || user.userId || '');
    setBriefing(buildBriefing(Object.fromEntries(entries), { today: todayKst(), isAdmin }));
    setLoadedAt(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date()));
    setBusy(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="briefing">
      <header className="head">
        <div>
          <h1>아침 브리핑</h1>
          <p className="date">{briefing ? dateLabel(briefing.today) : ''}{userName ? ` · ${userName}` : ''}</p>
        </div>
        <div className="actions">
          <span className="loaded" aria-live="polite">{busy ? '불러오는 중…' : loadedAt ? `${loadedAt} 기준` : ''}</span>
          <button type="button" data-briefing="reload" onClick={load} disabled={busy}>다시 불러오기</button>
          <button type="button" onClick={() => window.print()} disabled={busy || !briefing}>인쇄 (A4)</button>
        </div>
      </header>

      <WorkflowGuide workflowId="morning-briefing" />

      {briefing && (
        <section data-briefing="summary" className={`summary ${briefing.overall}`} aria-label="오늘 요약">
          <strong>{briefing.summary}</strong>
          <span className="tally">
            <span className="chip red">{STATUS_MARK.red} 바로 확인 {briefing.tally.red}</span>
            <span className="chip amber">{STATUS_MARK.amber} 확인 필요 {briefing.tally.amber}</span>
            <span className="chip green">{STATUS_MARK.green} 문제 없음 {briefing.tally.green}</span>
            {briefing.tally.gray > 0 && <span className="chip gray">{STATUS_MARK.gray} 확인 못 함 {briefing.tally.gray}</span>}
          </span>
        </section>
      )}

      {!briefing && busy && <p className="loading">오늘 볼 것을 모으는 중입니다…</p>}

      {briefing && (
        <ol className="cards">
          {briefing.cards.map((card, index) => (
            <li key={card.id} data-briefing-card={card.id} className={`card ${card.status}`}>
              <div className="top">
                <span className="no">{index + 1}</span>
                <h2>{card.title}</h2>
                <span className={`state ${card.status}`}>{STATUS_MARK[card.status]} {card.statusLabel}</span>
              </div>
              <p className="headline">{card.headline}</p>
              {card.lines.length > 0 && (
                <ul className="lines">
                  {card.lines.map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}
                  {card.more > 0 && <li className="more">외 {card.more}건 더 있음</li>}
                </ul>
              )}
              {card.sourceNote && <p className="source">{card.sourceNote}</p>}
              <Link href={card.href} className="open">{card.linkLabel} →</Link>
            </li>
          ))}
        </ol>
      )}

      <p className="foot">
        이 화면은 보기만 합니다. 전산 자료를 바꾸지 않으며, 숫자는 각 카드 아래 화면과 같은 조회 결과를 그대로 보여 줍니다.
        불러오지 못한 항목은 0으로 보이지 않고 ‘확인 못 함’으로 표시합니다.
      </p>

      <style jsx>{`
        .briefing{max-width:1280px;margin:0 auto;padding:20px 20px 60px;color:#17324d;font-size:15px;line-height:1.55}
        .head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
        h1{margin:0;font-size:28px}
        .date{margin:4px 0 0;color:#52677d;font-size:15px}
        .actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .loaded{color:#52677d;font-size:13px}
        button{border:1px solid #9db4cb;border-radius:8px;background:#fff;color:#12385e;padding:9px 16px;font-size:14px;cursor:pointer}
        button:disabled{opacity:.5;cursor:default}
        button:focus-visible,.briefing :global(a.open:focus-visible){outline:3px solid #1d6fd6;outline-offset:2px}
        .summary{margin-top:16px;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border:2px solid}
        .summary strong{font-size:22px}
        .summary.red{background:#fdecec;border-color:#d64545;color:#8f1d1d}
        .summary.amber{background:#fff6e0;border-color:#d99a1c;color:#7a5200}
        .summary.green{background:#e8f6ec;border-color:#2f9a57;color:#17603a}
        .summary.gray{background:#f1f4f7;border-color:#9aa9b8;color:#44556a}
        .tally{display:flex;gap:8px;flex-wrap:wrap}
        .chip{border-radius:999px;padding:4px 12px;font-size:14px;font-weight:600;background:#fff;border:1px solid}
        .chip.red,.state.red{color:#b32626;border-color:#e3a1a1}
        .chip.amber,.state.amber{color:#8a5d00;border-color:#e2c27a}
        .chip.green,.state.green{color:#1c6f42;border-color:#9fd0b1}
        .chip.gray,.state.gray{color:#52677d;border-color:#c2ccd6}
        .loading{margin-top:24px;color:#52677d}
        .cards{list-style:none;margin:16px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px}
        .card{background:#fff;border:1px solid #d5e0ea;border-left:8px solid #9aa9b8;border-radius:12px;padding:16px 18px;overflow-wrap:anywhere;break-inside:avoid}
        .card.red{border-left-color:#d64545}
        .card.amber{border-left-color:#d99a1c}
        .card.green{border-left-color:#2f9a57}
        .top{display:flex;align-items:center;gap:10px}
        .no{flex:none;width:28px;height:28px;border-radius:50%;background:#17324d;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
        h2{margin:0;font-size:17px;flex:1}
        .state{flex:none;border:1px solid;border-radius:999px;padding:2px 10px;font-size:13px;font-weight:700;background:#fff}
        .headline{margin:10px 0 6px;font-size:22px;font-weight:700}
        .lines{margin:0 0 8px;padding-left:18px}
        .lines li{margin:2px 0}
        .more{color:#52677d;list-style:none;margin-left:-18px}
        .source{margin:0 0 8px;color:#52677d;font-size:13px}
        .briefing :global(a.open){display:inline-block;color:#12509a;font-weight:600;text-decoration:underline}
        .foot{margin-top:20px;color:#52677d;font-size:13px}
        @media(max-width:600px){.briefing{padding:14px 12px 48px}.cards{grid-template-columns:1fr}.summary strong{font-size:19px}h1{font-size:24px}}
        @media print{
          .briefing{max-width:none;padding:0;font-size:12px}
          .actions{display:none}
          .cards{grid-template-columns:1fr 1fr;gap:8px}
          .card{padding:10px 12px}
          .headline{font-size:16px}
          .summary strong{font-size:16px}
          .briefing :global(a.open){display:none}
        }
      `}</style>
    </main>
  );
}
