import { useEffect, useState } from 'react';

export default function MoyiIntegration() {
  const [code, setCode] = useState('');
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadMembers() {
    const res = await fetch('/api/moyi/members');
    if (!res.ok) return;
    const data = await res.json();
    setMembers(data.members || []);
    setSelected(data.selected_user_ids || []);
    setConnected(true);
  }

  useEffect(() => { loadMembers(); }, []);

  async function exchange() {
    setBusy(true); setMessage('');
    const res = await fetch('/api/moyi/exchange', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ code })
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setMessage(data.detail || data.message || '연결코드가 올바르지 않습니다.'); return; }
    setMembers(data.members || []); setSelected([]); setConnected(true);
    setMessage('MOYI 연결이 완료되었습니다. 보고 받을 사람을 선택하세요.');
  }

  async function saveRecipients() {
    setBusy(true);
    const res = await fetch('/api/moyi/recipients', {
      method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ user_ids: selected })
    });
    setBusy(false);
    setMessage(res.ok ? '수신자 설정을 저장했습니다. 이후 보고부터 자동 적용됩니다.' : '수신자 저장에 실패했습니다.');
  }

  async function revoke() {
    if (!window.confirm('네노바웹과 MOYI 연결을 해지할까요?')) return;
    await fetch('/api/moyi/connection', { method: 'DELETE' });
    setConnected(false); setMembers([]); setSelected([]); setMessage('연결을 해지했습니다.');
  }

  const toggle = (id) => setSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]);
  return <>
    <div style={{maxWidth: 760, margin: '24px auto', padding: 24, background: '#fff', border: '1px solid #ddd'}}>
      <h1 style={{marginTop: 0}}>MOYI 보고 연동</h1>
      <p style={{color: '#666'}}>MOYI 앱 또는 데스크톱에서 발급한 연결코드를 한 번 입력하면, 이후 보고서 수신자를 자동으로 사용할 수 있습니다.</p>
      {!connected && <div style={{display: 'flex', gap: 8, marginTop: 24}}>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="MOYI-NV-XXXX-XXXX" style={{flex: 1, padding: 12, border: '1px solid #bbb'}} />
        <button onClick={exchange} disabled={busy || !code.trim()} style={{padding: '0 18px'}}>연결</button>
      </div>}
      {connected && <>
        <div style={{marginTop: 20, padding: 12, background: '#eef8ee', color: '#176b2c'}}>연결됨</div>
        <h2 style={{fontSize: 18, marginTop: 26}}>보고 받을 MOYI 멤버</h2>
        <div style={{display: 'grid', gap: 8}}>{members.map((m) => <label key={m.user_id} style={{display: 'flex', gap: 10, padding: 10, borderBottom: '1px solid #eee'}}>
          <input type="checkbox" checked={selected.includes(m.user_id)} onChange={() => toggle(m.user_id)} />
          <span><b>{m.name}</b> {m.dept ? `· ${m.dept}` : ''} {m.role === 'owner' ? '· 대표/소유자' : ''}</span>
        </label>)}</div>
        <div style={{display: 'flex', gap: 8, marginTop: 20}}>
          <button onClick={saveRecipients} disabled={busy}>수신자 저장</button>
          <button onClick={revoke} style={{color: '#a11'}}>연결 해지</button>
        </div>
      </>}
      {message && <p style={{marginTop: 18, color: '#2454a6'}}>{message}</p>}
    </div>
  </>;
}
