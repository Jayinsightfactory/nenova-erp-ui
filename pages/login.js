import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Login() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  // next 쿼리 파라미터 — 로그인 성공 후 이동할 페이지 (예: /m/chat)
  // router.query 는 hydration 후 채워지므로 useEffect 로 읽음
  const [nextUrl, setNextUrl] = useState('');
  useEffect(() => {
    if (router.isReady) {
      const n = typeof router.query.next === 'string' ? router.query.next : '';
      setNextUrl(n);
    }
  }, [router.isReady, router.query.next]);

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
        // next 파라미터가 있으면 그리로, 없으면 기본 dashboard
        // 보안: next 는 같은 사이트의 경로여야 함 (외부 리다이렉트 방지)
        const safeNext = nextUrl && nextUrl.startsWith('/') && !nextUrl.startsWith('//')
          ? nextUrl
          : '/dashboard';
        router.push(safeNext);
      } else {
        setErr(data.error || '로그인 실패');
        setLoading(false);
      }
    } catch {
      setErr('서버 연결 오류.');
      setLoading(false);
    }
  };

  const goMobileLogin = () => {
    // 모바일 전용 로그인 페이지로 이동 (풀스크린 터치 친화적)
    router.push('/m/login');
  };

  return (
    <>
      <Head><title>네노바 ERP 로그인</title></Head>
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F0F0F0' }}>
        <div style={{ background:'#fff', border:'2px solid #999', padding:'24px', width:320, boxShadow:'3px 3px 8px rgba(0,0,0,0.2)' }}>
          {/* 타이틀 바 (윈도우 스타일) */}
          <div style={{ background:'linear-gradient(to right,#000080,#1084d0)', color:'#fff', padding:'4px 8px', margin:'-24px -24px 16px -24px', fontSize:13, fontWeight:'bold', display:'flex', alignItems:'center', gap:8 }}>
            <span>🌿</span> nenova ERP
          </div>

          <div style={{ fontSize:13, fontWeight:'bold', marginBottom:12, color:'#333' }}>■ 로그인</div>

          {nextUrl === '/m/chat' && (
            <div style={{ padding:'6px 10px', background:'#E6F7FF', border:'1px solid #91D5FF', color:'#0050B3', fontSize:12, marginBottom:10, borderRadius:3 }}>
              📱 로그인 후 <b>모바일 챗봇</b> 으로 이동합니다
            </div>
          )}

          {err && (
            <div style={{ padding:'4px 8px', background:'#FFEEEE', border:'1px solid #FFAAAA', color:'#CC0000', fontSize:12, marginBottom:10 }}>
              {err}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <tbody>
                <tr>
                  <td style={{ padding:'5px 0', width:80, fontWeight:'bold', color:'#333' }}>아이디</td>
                  <td style={{ padding:'5px 0' }}>
                    <input
                      style={{ width:'100%', height:24, border:'1px solid #AAA', fontSize:12, padding:'0 4px', fontFamily:'inherit' }}
                      value={id} onChange={e=>setId(e.target.value)} autoFocus
                    />
                  </td>
                </tr>
                <tr>
                  <td style={{ padding:'5px 0', fontWeight:'bold', color:'#333' }}>비밀번호</td>
                  <td style={{ padding:'5px 0' }}>
                    <input
                      type="password"
                      style={{ width:'100%', height:24, border:'1px solid #AAA', fontSize:12, padding:'0 4px', fontFamily:'inherit' }}
                      value={pw} onChange={e=>setPw(e.target.value)}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop:14, display:'flex', justifyContent:'center', gap:8 }}>
              <button type="submit" disabled={loading}
                style={{ height:28, padding:'0 20px', fontSize:12, fontFamily:'inherit', border:'1px solid #AAA', background:'#E0E0E0', cursor:'pointer' }}>
                {loading ? '로그인 중...' : '확인'}
              </button>
              <button type="button"
                style={{ height:28, padding:'0 20px', fontSize:12, fontFamily:'inherit', border:'1px solid #AAA', background:'#E0E0E0', cursor:'pointer' }}
                onClick={() => { setId(''); setPw(''); setErr(''); }}>
                취소
              </button>
            </div>
          </form>

          {/* 모바일 로그인 바로가기 */}
          <div style={{ marginTop:16, paddingTop:12, borderTop:'1px dashed #CCC', textAlign:'center' }}>
            <button type="button"
              onClick={goMobileLogin}
              style={{
                height:36,
                padding:'0 16px',
                fontSize:12,
                fontFamily:'inherit',
                border:'1px solid #2b6cb0',
                background:'#EBF8FF',
                color:'#2b6cb0',
                fontWeight:'bold',
                cursor:'pointer',
                borderRadius:4,
                width:'100%',
                display:'flex',
                alignItems:'center',
                justifyContent:'center',
                gap:6,
              }}>
              📱 모바일 로그인
            </button>
            <div style={{ fontSize:10, color:'#888', marginTop:6, lineHeight:1.4 }}>
              모바일 전용 로그인 화면으로 이동합니다
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
