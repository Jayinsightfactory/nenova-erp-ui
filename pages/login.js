import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Login() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

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
        router.push('/dashboard');
      } else {
        setErr(data.error || '로그인 실패');
        setLoading(false);
      }
    } catch {
      setErr('서버 연결 오류.');
      setLoading(false);
    }
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
        </div>
      </div>
    </>
  );
}
