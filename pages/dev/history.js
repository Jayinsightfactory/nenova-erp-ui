// pages/dev/history.js
// 작업 히스토리 대시보드 (로컬 전용)
// URL: /dev/history

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';

const API = '/api/dev/git-log';

// 파일 확장자별 색상
function fileColor(file = '') {
  if (file.endsWith('.js'))  return '#f0db4f';
  if (file.endsWith('.css')) return '#264de4';
  if (file.endsWith('.json')) return '#5ba346';
  if (file.endsWith('.md'))  return '#6cb6ff';
  return '#aaa';
}

// 변경코드 라벨
function codeLabel(code) {
  const map = { M: '수정', A: 'New', D: '삭제', R: '이름변경', '??': 'New' };
  return map[code] || code;
}
function codeColor(code) {
  const map = { M: '#f59e0b', A: '#22c55e', D: '#ef4444', R: '#a78bfa', '??': '#22c55e' };
  return map[code] || '#aaa';
}

// diff 라인 파싱
function parseDiff(diff) {
  if (!diff) return [];
  return diff.split('\n').map((line, i) => {
    let color = 'var(--text2)';
    let bg = 'transparent';
    if (line.startsWith('+++') || line.startsWith('---')) { color = '#aaa'; }
    else if (line.startsWith('+')) { color = '#86efac'; bg = '#052e16'; }
    else if (line.startsWith('-')) { color = '#fca5a5'; bg = '#2d0a0a'; }
    else if (line.startsWith('@@')) { color = '#7dd3fc'; }
    else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new ') || line.startsWith('old ')) { color = '#d8b4fe'; }
    return { line, color, bg, key: i };
  });
}

export default function HistoryPage() {
  const [data, setData] = useState(null);           // 커밋 목록 + 상태
  const [selectedHash, setSelectedHash] = useState(null);
  const [diffData, setDiffData] = useState(null);   // 선택한 커밋의 파일 목록
  const [showDiff, setShowDiff] = useState(false);  // diff 본문
  const [diffContent, setDiffContent] = useState('');
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [tab, setTab] = useState('commits');        // commits | pending | plans
  const [pendingDiff, setPendingDiff] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(API + '?type=log');
      const d = await r.json();
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadDiff = async (hash) => {
    if (selectedHash === hash && diffData) {
      setSelectedHash(null); setDiffData(null); setShowDiff(false);
      return;
    }
    setSelectedHash(hash);
    setShowDiff(false);
    setDiffContent('');
    const r = await fetch(`${API}?type=diff&hash=${hash}`);
    const d = await r.json();
    setDiffData(d);
  };

  const loadFullDiff = async (hash) => {
    if (showDiff) { setShowDiff(false); return; }
    const r = await fetch(`${API}?type=show&hash=${hash}`);
    const d = await r.json();
    setDiffContent(d.diff || '');
    setShowDiff(true);
  };

  const loadPending = async () => {
    setTab('pending');
    const r = await fetch(API + '?type=pending');
    const d = await r.json();
    setPendingDiff(d.diff || '(변경 없음)');
  };

  const loadPlans = async () => {
    setTab('plans');
    if (plans.length > 0) return;
    const r = await fetch(API + '?type=plan');
    const d = await r.json();
    setPlans(d.plans || []);
    if (d.plans?.length > 0) setSelectedPlan(d.plans[0]);
  };

  const commits = data?.commits || [];
  const status  = data?.status || [];

  return (
    <>
      <Head><title>작업 히스토리 — nenova</title></Head>
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'monospace' }}>

        {/* 헤더 */}
        <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#38bdf8' }}>🛠 nenova 작업 히스토리</span>
          <span style={{ fontSize: 12, color: '#64748b' }}>브랜치: <strong style={{ color: '#a78bfa' }}>{data?.branch || '...'}</strong></span>
          <button onClick={load} style={{ marginLeft: 'auto', background: '#1d4ed8', border: 'none', color: '#fff', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
            {loading ? '새로고침 중...' : '🔄 새로고침'}
          </button>
        </div>

        <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>

          {/* 왼쪽: 탭 + 목록 */}
          <div style={{ width: 340, borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>
            {/* 탭 */}
            <div style={{ display: 'flex', background: '#1e293b', borderBottom: '1px solid #334155' }}>
              {[['commits','커밋 목록'], ['pending','미커밋 변경'], ['plans','작업 플랜']].map(([k, label]) => (
                <button key={k}
                  onClick={() => k === 'pending' ? loadPending() : k === 'plans' ? loadPlans() : setTab('commits')}
                  style={{
                    flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 12,
                    background: tab === k ? '#0f172a' : '#1e293b',
                    color: tab === k ? '#38bdf8' : '#94a3b8',
                    borderBottom: tab === k ? '2px solid #38bdf8' : '2px solid transparent',
                  }}>{label}</button>
              ))}
            </div>

            {/* 미커밋 파일 상태 (항상 상단에 표시) */}
            {status.length > 0 && (
              <div style={{ padding: '8px 12px', background: '#1a1a2e', borderBottom: '1px solid #334155', fontSize: 11 }}>
                <div style={{ color: '#f59e0b', marginBottom: 4, fontWeight: 600 }}>⚠ 미커밋 파일 {status.length}개</div>
                {status.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
                    <span style={{ color: codeColor(s.code), width: 28, flexShrink: 0 }}>{codeLabel(s.code)}</span>
                    <span style={{ color: '#cbd5e1', fontSize: 10, wordBreak: 'break-all' }}>{s.file}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 커밋 목록 */}
            {tab === 'commits' && (
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {commits.length === 0 && <div style={{ padding: 20, color: '#64748b', fontSize: 12 }}>커밋 정보 없음 (git 환경 확인)</div>}
                {commits.map(c => (
                  <div key={c.hash}
                    onClick={() => loadDiff(c.hash)}
                    style={{
                      padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #1e293b',
                      background: selectedHash === c.hash ? '#1e3a5f' : 'transparent',
                      transition: 'background 0.1s',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#7dd3fc', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>{c.shortHash}</span>
                      {c.refs && <span style={{ fontSize: 10, color: '#a78bfa' }}>{c.refs.replace('HEAD -> ', '')}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#e2e8f0', marginBottom: 4, lineHeight: 1.4 }}>{c.subject}</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{c.author} · {c.date?.slice(0, 16)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* 플랜 목록 */}
            {tab === 'plans' && (
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {plans.length === 0 && <div style={{ padding: 20, color: '#64748b', fontSize: 12 }}>플랜 파일 없음</div>}
                {plans.map((p, i) => (
                  <div key={i} onClick={() => setSelectedPlan(p)}
                    style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #1e293b',
                      background: selectedPlan?.name === p.name ? '#1e3a5f' : 'transparent' }}>
                    <div style={{ fontSize: 12, color: '#38bdf8' }}>📋 {p.name}</div>
                  </div>
                ))}
              </div>
            )}

            {/* 미커밋 탭 — 왼쪽 패널은 안내만 */}
            {tab === 'pending' && (
              <div style={{ padding: 16, color: '#94a3b8', fontSize: 12 }}>
                <div style={{ marginBottom: 8, color: '#f59e0b', fontWeight: 600 }}>미커밋 변경 diff</div>
                <div style={{ color: '#64748b' }}>오른쪽에서 전체 diff를 확인하세요.</div>
              </div>
            )}
          </div>

          {/* 오른쪽: 상세 패널 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 40px' }}>

            {/* 커밋 상세 */}
            {tab === 'commits' && selectedHash && diffData && (
              <div style={{ padding: 20 }}>
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: '#7dd3fc', fontFamily: 'monospace' }}>{selectedHash}</span>
                  <button onClick={() => loadFullDiff(selectedHash)}
                    style={{ background: '#334155', border: 'none', color: '#e2e8f0', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
                    {showDiff ? '▲ diff 접기' : '▼ 전체 diff 보기'}
                  </button>
                </div>

                {/* 변경 파일 목록 */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>변경 파일 {diffData.files?.length}개</div>
                  {diffData.files?.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5, padding: '5px 10px', background: '#1e293b', borderRadius: 6 }}>
                      <span style={{ width: 36, fontSize: 11, color: codeColor(f.code), fontWeight: 600 }}>{codeLabel(f.code)}</span>
                      <span style={{ fontSize: 11, color: '#e2e8f0', wordBreak: 'break-all' }}>{f.file}</span>
                      {f.newFile && <span style={{ fontSize: 11, color: '#94a3b8' }}>→ {f.newFile}</span>}
                      <span style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: fileColor(f.file), flexShrink: 0 }} />
                    </div>
                  ))}
                </div>

                {/* stat */}
                {diffData.stat && (
                  <pre style={{ background: '#1e293b', padding: 12, borderRadius: 6, fontSize: 11, color: '#94a3b8', whiteSpace: 'pre-wrap', marginBottom: 16 }}>
                    {diffData.stat}
                  </pre>
                )}

                {/* 전체 diff */}
                {showDiff && (
                  <div style={{ background: '#020617', border: '1px solid #334155', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', background: '#1e293b', fontSize: 11, color: '#94a3b8', borderBottom: '1px solid #334155' }}>diff 내용 (최대 50KB)</div>
                    <div style={{ padding: 12, fontSize: 11, lineHeight: 1.6, overflowX: 'auto' }}>
                      {parseDiff(diffContent).map(({ line, color, bg, key }) => (
                        <div key={key} style={{ color, background: bg, whiteSpace: 'pre', padding: '0 2px' }}>{line || ' '}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 커밋 선택 전 안내 */}
            {tab === 'commits' && !selectedHash && (
              <div style={{ padding: 40, color: '#334155', textAlign: 'center', fontSize: 14 }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
                <div>왼쪽에서 커밋을 클릭하면</div>
                <div>변경 파일과 diff를 확인할 수 있습니다.</div>
              </div>
            )}

            {/* 미커밋 diff */}
            {tab === 'pending' && (
              <div style={{ padding: 20 }}>
                <div style={{ marginBottom: 12, fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>⚠ 미커밋 변경사항 (git diff HEAD)</div>
                <div style={{ background: '#020617', border: '1px solid #334155', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: 12, fontSize: 11, lineHeight: 1.6, overflowX: 'auto' }}>
                    {parseDiff(pendingDiff).map(({ line, color, bg, key }) => (
                      <div key={key} style={{ color, background: bg, whiteSpace: 'pre', padding: '0 2px' }}>{line || ' '}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 플랜 내용 */}
            {tab === 'plans' && selectedPlan && (
              <div style={{ padding: 20 }}>
                <div style={{ marginBottom: 12, fontSize: 13, color: '#38bdf8', fontWeight: 600 }}>📋 {selectedPlan.name}</div>
                <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: 20 }}>
                  <pre style={{ fontSize: 12, color: '#e2e8f0', whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: 0 }}>
                    {selectedPlan.content}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
