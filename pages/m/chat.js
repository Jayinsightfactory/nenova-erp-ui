// pages/m/chat.js — 모바일 챗봇 페이지 (내부 직원용)
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const QUICK_PROMPTS = [
  { icon: '📦', text: '오늘 출고 확정 업체' },
  { icon: '🌸', text: '이번 주 재고 부족 품목' },
  { icon: '💰', text: '이번 달 매출' },
  { icon: '📋', text: '승인 대기 주문' },
];

export default function MobileChat() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingStage, setLoadingStage] = useState(''); // 로딩 단계 표시
  const scrollRef = useRef(null);

  // ── localStorage 영속 히스토리 키
  const HISTORY_KEY = 'nenova_chat_history_v1';

  // 로컬 저장
  const saveHistory = (msgs) => {
    try {
      // 최근 100개만 저장 (용량 제한)
      const toSave = msgs.slice(-100);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(toSave));
    } catch (_) { /* quota exceeded 무시 */ }
  };

  // 로컬 로드
  const loadHistory = () => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return null;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return null;
      return arr;
    } catch (_) { return null; }
  };

  // ── 인증 체크 (기존 PC 세션 재사용)
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (d?.success && d?.user) {
          setMe(d.user);
          // 로컬 히스토리 복원 (있으면)
          const saved = loadHistory();
          if (saved && saved.length > 0) {
            setMessages(saved);
          } else {
            setMessages([
              {
                role: 'bot',
                type: 'text',
                content: `안녕하세요, ${d.user.userName || d.user.userId}님 👋\n무엇을 도와드릴까요?\n\n아래 빠른 메뉴를 누르거나 자유롭게 질문하세요.`,
                ts: Date.now(),
              },
            ]);
          }
        } else {
          router.replace('/login?next=/m/chat');
        }
      })
      .catch(() => router.replace('/login?next=/m/chat'))
      .finally(() => setAuthChecked(true));
  }, [router]);

  // ── 메시지 스크롤 + localStorage 자동 저장
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (messages.length > 0) saveHistory(messages);
  }, [messages, sending]);

  // ── 메시지 전송 (payload 는 structured intent — 선택지 버튼에서 전달)
  async function send(text, payload = null) {
    const q = (text ?? input).trim();
    if (!q || sending) return;
    setInput('');
    const userMsg = { role: 'user', type: 'text', content: q, ts: Date.now() };
    setMessages(m => [...m, userMsg]);
    setSending(true);

    // 로딩 단계 시뮬레이션 (실제 타이밍에 맞춰)
    setLoadingStage('질문 분석 중...');
    const t1 = setTimeout(() => setLoadingStage('DB 조회 중...'), 1500);
    const t2 = setTimeout(() => setLoadingStage('답변 작성 중...'), 4000);
    const t3 = setTimeout(() => setLoadingStage('생각이 길어져요 (최대 20초)...'), 10000);

    try {
      const r = await fetch('/api/m/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, payload }),
      });
      const d = await r.json();
      if (d?.success) {
        const botMsgs = (d.messages || [{ type: 'text', content: d.content || '...' }]).map(m => ({
          role: 'bot',
          ...m,
          ts: Date.now(),
        }));
        setMessages(m => [...m, ...botMsgs]);
      } else {
        setMessages(m => [...m, { role: 'bot', type: 'text', content: `⚠️ ${d?.error || '오류가 발생했습니다.'}`, ts: Date.now() }]);
      }
    } catch (e) {
      setMessages(m => [...m, { role: 'bot', type: 'text', content: `⚠️ 네트워크 오류: ${e.message}`, ts: Date.now() }]);
    } finally {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      setLoadingStage('');
      setSending(false);
    }
  }

  if (!authChecked) {
    return (
      <div className="m-loading">
        <Head><title>모바일 챗 · 네노바</title></Head>
        로딩 중...
      </div>
    );
  }

  return (
    <div className="m-chat-root">
      <Head>
        <title>네노바 챗봇</title>
      </Head>

      {/* 상단 바 */}
      <header className="m-topbar">
        <button
          type="button"
          className="m-home-btn"
          aria-label="홈"
          onClick={() => {
            if (sending) return;
            setMessages([{
              role: 'bot',
              type: 'text',
              content: `안녕하세요, ${me?.userName || me?.userId || ''}님 👋\n무엇을 도와드릴까요?\n\n아래 빠른 메뉴를 누르거나 자유롭게 질문하세요.`,
              ts: Date.now(),
            }]);
            setInput('');
            // 로컬 히스토리도 정리
            try { localStorage.removeItem(HISTORY_KEY); } catch (_) {}
            // 서버 대화 기록도 초기화 (실패해도 UI 는 리셋됨)
            fetch('/api/m/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reset: true }),
            }).catch(() => {});
          }}
        >
          🏠
        </button>
        <div className="m-topbar-title">
          <span className="m-logo">🌸</span>
          <span>네노바 챗봇</span>
        </div>
        <div className="m-topbar-user">
          {me?.userName || me?.userId}
        </div>
      </header>

      {/* 메시지 영역 */}
      <div className="m-messages" ref={scrollRef}>
        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} onQuickAction={send} />
        ))}
        {sending && (
          <div className="m-msg bot">
            <div className="m-bubble bot typing">
              <span /><span /><span />
              {loadingStage && <div className="m-loading-stage">{loadingStage}</div>}
            </div>
          </div>
        )}
      </div>

      {/* 빠른 메뉴 (메시지가 인사뿐일 때만 표시) */}
      {messages.length <= 1 && !sending && (
        <div className="m-quick">
          {QUICK_PROMPTS.map(q => (
            <button
              key={q.text}
              className="m-quick-btn"
              onClick={() => send(q.text)}
            >
              <span className="m-quick-icon">{q.icon}</span>
              <span>{q.text}</span>
            </button>
          ))}
        </div>
      )}

      {/* 입력 영역 */}
      <form
        className="m-inputbar"
        onSubmit={e => { e.preventDefault(); send(); }}
      >
        <input
          type="text"
          className="m-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="질문을 입력하세요..."
          autoComplete="off"
          disabled={sending}
        />
        <button
          type="submit"
          className="m-send-btn"
          disabled={sending || !input.trim()}
          aria-label="전송"
        >
          ➤
        </button>
      </form>

      <style jsx global>{`
        html, body, #__next { height: 100%; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', '맑은 고딕', sans-serif;
          background: #F5F7FA;
          color: #1a202c;
          -webkit-font-smoothing: antialiased;
        }
        * { box-sizing: border-box; }
        button { font-family: inherit; }
      `}</style>

      <style jsx>{`
        .m-loading {
          display: flex; align-items: center; justify-content: center;
          height: 100vh; color: #666; font-size: 14px;
        }
        .m-chat-root {
          display: flex;
          flex-direction: column;
          height: 100vh;
          height: 100dvh;
          max-width: 768px;
          margin: 0 auto;
          background: #F5F7FA;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .m-topbar {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background: #2b6cb0;
          color: white;
          padding-top: calc(12px + env(safe-area-inset-top));
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .m-home-btn {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 50%;
          background: rgba(255,255,255,0.18);
          color: white;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .m-home-btn:active { background: rgba(255,255,255,0.3); }
        .m-topbar-title { flex: 1; }
        .m-topbar-title {
          display: flex; align-items: center; gap: 8px;
          font-weight: 700; font-size: 16px;
        }
        .m-logo { font-size: 20px; }
        .m-topbar-user {
          font-size: 12px;
          opacity: 0.85;
          padding: 4px 10px;
          background: rgba(255,255,255,0.15);
          border-radius: 12px;
        }
        .m-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          -webkit-overflow-scrolling: touch;
        }
        .m-quick {
          flex-shrink: 0;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 0 12px 12px;
        }
        .m-quick-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          background: white;
          border: 1px solid #E2E8F0;
          border-radius: 12px;
          font-size: 13px;
          color: #2D3748;
          text-align: left;
          cursor: pointer;
          transition: all 0.15s;
          min-height: 44px;
        }
        .m-quick-btn:active { background: #EDF2F7; }
        .m-quick-icon { font-size: 18px; flex-shrink: 0; }
        .m-inputbar {
          flex-shrink: 0;
          display: flex;
          gap: 8px;
          padding: 10px 12px;
          background: white;
          border-top: 1px solid #E2E8F0;
          padding-bottom: calc(10px + env(safe-area-inset-bottom));
        }
        .m-input {
          flex: 1;
          padding: 10px 14px;
          border: 1px solid #CBD5E0;
          border-radius: 20px;
          font-size: 15px;
          background: #F7FAFC;
          outline: none;
          min-height: 40px;
        }
        .m-input:focus { border-color: #2b6cb0; background: white; }
        .m-send-btn {
          width: 40px; height: 40px;
          border: none;
          border-radius: 50%;
          background: #2b6cb0;
          color: white;
          font-size: 16px;
          cursor: pointer;
          flex-shrink: 0;
        }
        .m-send-btn:disabled { background: #A0AEC0; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

// ── 메시지 버블 컴포넌트
function MessageBubble({ msg, onQuickAction }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`m-msg ${isUser ? 'user' : 'bot'}`}>
      <div className={`m-bubble ${isUser ? 'user' : 'bot'}`}>
        {msg.type === 'text' && <div className="m-bubble-text">{msg.content}</div>}
        {msg.type === 'card' && <CardBlock card={msg.card} />}
        {msg.type === 'cards' && (
          <div className="m-cards-group">
            {(msg.cards || []).map((c, i) => <CardBlock key={i} card={c} />)}
          </div>
        )}
        {msg.type === 'actions' && (
          <div className="m-actions">
            {(msg.actions || []).map((a, i) => (
              <button
                key={i}
                className={`m-action-btn ${a.primary ? 'primary' : ''}`}
                onClick={() => onQuickAction(a.text, a.payload || null)}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        {msg.type === 'choices' && (
          <div className="m-choices">
            {msg.prompt && <div className="m-choices-prompt">{msg.prompt}</div>}
            <div className="m-choices-list">
              {(msg.choices || []).map((c, i) => (
                <button
                  key={i}
                  className="m-choice-btn"
                  onClick={() => onQuickAction(c.text || c.label, c.payload || null)}
                >
                  <span className="m-choice-label">{c.label}</span>
                  {c.sub && <span className="m-choice-sub">{c.sub}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <style jsx>{`
        .m-msg { display: flex; }
        .m-msg.user { justify-content: flex-end; }
        .m-msg.bot { justify-content: flex-start; }
        .m-bubble {
          max-width: 85%;
          padding: 10px 14px;
          border-radius: 16px;
          font-size: 14px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .m-bubble.user {
          background: #2b6cb0;
          color: white;
          border-bottom-right-radius: 4px;
        }
        .m-bubble.bot {
          background: white;
          color: #2D3748;
          border-bottom-left-radius: 4px;
        }
        .m-bubble.typing {
          display: flex; align-items: center; flex-wrap: wrap;
          gap: 4px; padding: 12px 16px;
        }
        .m-loading-stage {
          flex-basis: 100%;
          font-size: 11px; color: #718096;
          margin-top: 4px;
        }
        .m-bubble.typing span {
          width: 6px; height: 6px; border-radius: 50%;
          background: #A0AEC0;
          animation: typing 1.4s infinite;
        }
        .m-bubble.typing span:nth-child(2) { animation-delay: 0.2s; }
        .m-bubble.typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typing {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-4px); }
        }
        .m-cards-group { display: flex; flex-direction: column; gap: 8px; }
        .m-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .m-action-btn {
          padding: 6px 12px;
          border: 1px solid #CBD5E0;
          background: white;
          border-radius: 14px;
          font-size: 12px;
          cursor: pointer;
        }
        .m-action-btn:active { background: #EDF2F7; }
        .m-action-btn.primary {
          background: #2b6cb0; color: white; border-color: #2b6cb0;
        }
        .m-action-btn.primary:active { background: #1e4e8c; }
        .m-choices { margin-top: 6px; }
        .m-choices-prompt {
          font-size: 12px; color: #4A5568; margin-bottom: 6px; font-weight: 600;
        }
        .m-choices-list {
          display: flex; flex-direction: column; gap: 6px;
        }
        .m-choice-btn {
          display: flex; flex-direction: column; align-items: flex-start;
          gap: 2px;
          padding: 10px 12px;
          border: 1px solid #CBD5E0;
          background: white;
          border-radius: 10px;
          font-size: 13px;
          cursor: pointer;
          text-align: left;
          min-height: 44px;
          width: 100%;
        }
        .m-choice-btn:active { background: #EDF2F7; border-color: #2b6cb0; }
        .m-choice-label { font-weight: 600; color: #1A202C; }
        .m-choice-sub { font-size: 11px; color: #718096; }
      `}</style>
    </div>
  );
}

// ── 결과 카드 컴포넌트 (Phase 3에서 확장)
function CardBlock({ card }) {
  if (!card) return null;
  return (
    <div className="m-card">
      {card.title && <div className="m-card-title">{card.title}</div>}
      {card.subtitle && <div className="m-card-subtitle">{card.subtitle}</div>}
      {card.rows && (
        <div className="m-card-rows">
          {card.rows.map((r, i) => (
            <div key={i} className="m-card-row">
              <span className="m-card-label">{r.label}</span>
              <span className="m-card-value">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      {card.footer && <div className="m-card-footer">{card.footer}</div>}
      <style jsx>{`
        .m-card {
          background: #F7FAFC;
          border: 1px solid #E2E8F0;
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 13px;
        }
        .m-card-title { font-weight: 700; color: #1A202C; margin-bottom: 2px; }
        .m-card-subtitle { font-size: 11px; color: #718096; margin-bottom: 6px; }
        .m-card-rows { display: flex; flex-direction: column; gap: 3px; }
        .m-card-row {
          display: flex; justify-content: space-between; align-items: baseline;
        }
        .m-card-label { color: #4A5568; font-size: 12px; }
        .m-card-value { color: #1A202C; font-weight: 600; }
        .m-card-footer { margin-top: 6px; padding-top: 6px; border-top: 1px solid #E2E8F0; font-size: 11px; color: #718096; }
      `}</style>
    </div>
  );
}
