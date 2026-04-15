// pages/m/login.js — 모바일 전용 로그인 페이지 (풀스크린, 터치 친화적)
// 성공 시: router.query.next (기본 /m/chat) 으로 이동
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function MobileLogin() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [nextUrl, setNextUrl] = useState('/m/chat');

  useEffect(() => {
    if (router.isReady) {
      const n = typeof router.query.next === 'string' ? router.query.next : '/m/chat';
      // 보안: 내부 경로만 허용
      setNextUrl(n.startsWith('/') && !n.startsWith('//') ? n : '/m/chat');
    }
  }, [router.isReady, router.query.next]);

  // 이미 로그인 돼있으면 바로 next 로 이동
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (d?.success && d?.user) {
          router.replace(nextUrl || '/m/chat');
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextUrl]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!id || !pw) { setErr('아이디와 비밀번호를 입력하세요.'); return; }
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id, password: pw }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('nenovaUser', JSON.stringify(data.user));
        router.push(nextUrl || '/m/chat');
      } else {
        setErr(data.error || '로그인 실패');
        setLoading(false);
      }
    } catch {
      setErr('서버 연결 오류');
      setLoading(false);
    }
  };

  return (
    <div className="ml-root">
      <Head>
        <title>네노바 모바일 로그인</title>
      </Head>

      {/* 상단 헤더 */}
      <header className="ml-header">
        <div className="ml-logo">🌸</div>
        <div className="ml-title">네노바 ERP</div>
        <div className="ml-subtitle">모바일 로그인</div>
      </header>

      {/* 로그인 폼 카드 */}
      <div className="ml-card">
        {err && (
          <div className="ml-error">
            ⚠️ {err}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <label className="ml-label">아이디</label>
          <input
            className="ml-input"
            type="text"
            autoComplete="username"
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder="아이디"
            autoFocus
            disabled={loading}
          />

          <label className="ml-label" style={{ marginTop: 14 }}>비밀번호</label>
          <input
            className="ml-input"
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="비밀번호"
            disabled={loading}
          />

          <button
            className="ml-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <div className="ml-footer">
          <a href="/login" className="ml-link">🖥️ PC 로그인</a>
        </div>
      </div>

      <style jsx global>{`
        html, body, #__next { height: 100%; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', '맑은 고딕', sans-serif;
          background: linear-gradient(180deg, #2b6cb0 0%, #1e4e8c 100%);
          color: #1a202c;
          -webkit-font-smoothing: antialiased;
        }
        * { box-sizing: border-box; }
        button, input { font-family: inherit; }
      `}</style>

      <style jsx>{`
        .ml-root {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          min-height: 100dvh;
          max-width: 480px;
          margin: 0 auto;
          padding: 0 20px;
          padding-top: env(safe-area-inset-top);
          padding-bottom: env(safe-area-inset-bottom);
        }
        .ml-header {
          flex-shrink: 0;
          text-align: center;
          color: white;
          padding: 48px 0 32px;
        }
        .ml-logo {
          font-size: 56px;
          line-height: 1;
          margin-bottom: 8px;
        }
        .ml-title {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: 1px;
        }
        .ml-subtitle {
          font-size: 13px;
          margin-top: 4px;
          opacity: 0.85;
        }
        .ml-card {
          flex: 0 0 auto;
          background: white;
          border-radius: 16px;
          padding: 24px 20px 20px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.15);
          margin-bottom: 24px;
        }
        .ml-error {
          padding: 10px 12px;
          background: #FED7D7;
          border: 1px solid #FC8181;
          color: #9B2C2C;
          font-size: 13px;
          border-radius: 8px;
          margin-bottom: 14px;
          word-break: keep-all;
        }
        .ml-label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          color: #4A5568;
          margin-bottom: 6px;
        }
        .ml-input {
          display: block;
          width: 100%;
          height: 48px;
          padding: 0 14px;
          font-size: 16px; /* 16px 이상이어야 iOS Safari 에서 자동 확대 안 됨 */
          border: 2px solid #E2E8F0;
          border-radius: 10px;
          background: #F7FAFC;
          outline: none;
          -webkit-appearance: none;
          appearance: none;
        }
        .ml-input:focus {
          border-color: #2b6cb0;
          background: #fff;
        }
        .ml-submit {
          display: block;
          width: 100%;
          height: 52px;
          margin-top: 22px;
          background: #2b6cb0;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: 2px;
          box-shadow: 0 4px 10px rgba(43, 108, 176, 0.3);
        }
        .ml-submit:active {
          background: #1e4e8c;
          transform: translateY(1px);
        }
        .ml-submit:disabled {
          background: #A0AEC0;
          cursor: not-allowed;
          box-shadow: none;
        }
        .ml-footer {
          margin-top: 16px;
          text-align: center;
        }
        .ml-link {
          font-size: 12px;
          color: #718096;
          text-decoration: none;
          padding: 8px 14px;
          display: inline-block;
          border-radius: 6px;
        }
        .ml-link:active {
          background: #EDF2F7;
        }
      `}</style>
    </div>
  );
}
