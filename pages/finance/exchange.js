// pages/finance/exchange.js
// 외화/환율 관리 — 이카운트 "외화리스트" 화면

import { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/Layout';
import { apiGet, apiPost } from '../../lib/useApi';

const fmt4 = n => Number(n || 0).toFixed(4);

export default function ExchangePage() {
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [err, setErr]               = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 인라인 수정 상태: { [currencyCode]: { exchangeRate, isActive } }
  const [editMap, setEditMap] = useState({});

  // 신규추가 모달
  const [showNew, setShowNew]   = useState(false);
  const [newForm, setNewForm]   = useState({ currencyCode: '', currencyName: '', exchangeRate: '', isActive: true });
  const [saving, setSaving]     = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    apiGet('/api/finance/exchange')
      .then(d => { setCurrencies(d.currencies || []); setEditMap({}); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, []);

  // 수정 시작
  const startEdit = (c) => {
    setEditMap(prev => ({
      ...prev,
      [c.currencyCode]: {
        exchangeRate: String(c.exchangeRate),
        isActive:     c.isActive,
      },
    }));
  };

  // 수정 취소
  const cancelEdit = (code) => {
    setEditMap(prev => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
  };

  // 수정 저장
  const saveEdit = async (c) => {
    const edit = editMap[c.currencyCode];
    if (!edit) return;
    setSaving(true);
    try {
      await apiPost('/api/finance/exchange', {
        currencyCode: c.currencyCode,
        currencyName: c.currencyName,
        exchangeRate: parseFloat(edit.exchangeRate) || 0,
        isActive:     edit.isActive,
      });
      setSuccessMsg(`[${c.currencyCode}] 환율이 업데이트되었습니다.`);
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  // 신규추가
  const handleCreate = async () => {
    if (!newForm.currencyCode) { alert('외화코드를 입력하세요.'); return; }
    if (!newForm.currencyName) { alert('외화명을 입력하세요.'); return; }
    setSaving(true);
    try {
      await apiPost('/api/finance/exchange', {
        currencyCode: newForm.currencyCode.toUpperCase(),
        currencyName: newForm.currencyName,
        exchangeRate: parseFloat(newForm.exchangeRate) || 0,
        isActive:     newForm.isActive,
      });
      setShowNew(false);
      setNewForm({ currencyCode: '', currencyName: '', exchangeRate: '', isActive: true });
      setSuccessMsg('신규 외화가 추가되었습니다.');
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const updateEditField = (code, field, value) => {
    setEditMap(prev => ({
      ...prev,
      [code]: { ...prev[code], [field]: value },
    }));
  };

  return (
    <Layout title="외화/환율 관리">
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            환율은 구매현황 페이지에서 원화 환산 시 사용됩니다.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={load} title="목록 새로고침">
            환율 업데이트
          </button>
          <button className="btn btn-success" onClick={() => setShowNew(true)}>
            ＋ 신규추가
          </button>
        </div>
      </div>

      {/* 메시지 배너 */}
      {err        && <div className="banner-err" style={{ marginBottom: 10 }}>⚠️ {err}</div>}
      {successMsg && <div className="banner-ok"  style={{ marginBottom: 10 }}>✔ {successMsg}</div>}

      {/* 테이블 */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">외화 목록</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>총 {currencies.length}종</span>
        </div>
        {loading ? (
          <div className="skeleton" style={{ height: 200, borderRadius: 0 }}></div>
        ) : currencies.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
            등록된 외화가 없습니다.
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>외화코드</th>
                <th>외화명</th>
                <th style={{ textAlign: 'right' }}>현재 환율 (₩)</th>
                <th>업데이트일시</th>
                <th style={{ textAlign: 'center' }}>사용여부</th>
                <th style={{ textAlign: 'center' }}>수정</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map(c => {
                const editing = !!editMap[c.currencyCode];
                const edit    = editMap[c.currencyCode] || {};
                return (
                  <tr key={c.currencyCode}
                    style={{ background: editing ? '#fffbeb' : undefined }}
                  >
                    <td>
                      <span style={{
                        fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13,
                        padding: '2px 10px', borderRadius: 4,
                        background: c.isActive ? '#dbeafe' : '#f3f4f6',
                        color: c.isActive ? '#1d4ed8' : '#9ca3af',
                      }}>
                        {c.currencyCode}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{c.currencyName}</td>
                    <td style={{ textAlign: 'right' }}>
                      {editing ? (
                        <input
                          type="number" step="0.0001"
                          value={edit.exchangeRate}
                          onChange={e => updateEditField(c.currencyCode, 'exchangeRate', e.target.value)}
                          style={{
                            width: 120, padding: '3px 6px', textAlign: 'right',
                            border: '1px solid #f59e0b', borderRadius: 4, fontSize: 13,
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="num" style={{ fontWeight: 700, fontSize: 14 }}>
                          {fmt4(c.exchangeRate)}
                        </span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                      {c.updateDtm?.slice(0, 16) || '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {editing ? (
                        <button
                          onClick={() => updateEditField(c.currencyCode, 'isActive', !edit.isActive)}
                          style={{
                            padding: '3px 14px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
                            fontWeight: 700, border: 'none',
                            background: edit.isActive ? '#d1fae5' : '#fee2e2',
                            color:      edit.isActive ? '#065f46'  : '#dc2626',
                          }}
                        >
                          {edit.isActive ? '사용' : '미사용'}
                        </button>
                      ) : (
                        <span style={{
                          display: 'inline-block', padding: '2px 12px', borderRadius: 20,
                          fontSize: 11, fontWeight: 600,
                          background: c.isActive ? '#d1fae5' : '#f3f4f6',
                          color:      c.isActive ? '#065f46'  : '#9ca3af',
                        }}>
                          {c.isActive ? '사용' : '미사용'}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {editing ? (
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          <button className="btn btn-sm btn-primary" onClick={() => saveEdit(c)} disabled={saving}>
                            저장
                          </button>
                          <button className="btn btn-sm" onClick={() => cancelEdit(c.currencyCode)}>
                            취소
                          </button>
                        </span>
                      ) : (
                        <button className="btn btn-sm" onClick={() => startEdit(c)}>
                          수정
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 안내 */}
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text3)', padding: '8px 12px', background: '#f9fafb', borderRadius: 6, border: '1px solid var(--border)' }}>
        ※ 환율은 구매현황 페이지에서 원화 환산 시 사용됩니다. 환율 값은 1외화 단위 기준 원화 환산 금액입니다. (예: USD 1 = 1,300.0000 KRW)
      </div>

      {/* 신규추가 모달 */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ minWidth: 360 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>신규 외화 추가</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={lblSt}>
                <span>외화코드 * <span style={{ fontSize: 10, color: 'var(--text3)' }}>(영문 대문자, 예: USD)</span></span>
                <input type="text" value={newForm.currencyCode} maxLength={10}
                  onChange={e => setNewForm(f => ({ ...f, currencyCode: e.target.value.toUpperCase() }))}
                  placeholder="USD" style={inSt} />
              </label>
              <label style={lblSt}>
                <span>외화명 *</span>
                <input type="text" value={newForm.currencyName}
                  onChange={e => setNewForm(f => ({ ...f, currencyName: e.target.value }))}
                  placeholder="미국 달러" style={inSt} />
              </label>
              <label style={lblSt}>
                <span>환율 (원화 기준)</span>
                <input type="number" step="0.0001" value={newForm.exchangeRate}
                  onChange={e => setNewForm(f => ({ ...f, exchangeRate: e.target.value }))}
                  placeholder="0.0000" style={{ ...inSt, textAlign: 'right' }} />
              </label>
              <div style={{ ...lblSt, alignItems: 'center' }}>
                <span>사용여부</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newForm.isActive}
                    onChange={e => setNewForm(f => ({ ...f, isActive: e.target.checked }))} />
                  <span style={{ fontSize: 13 }}>{newForm.isActive ? '사용' : '미사용'}</span>
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn" onClick={() => setShowNew(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
                {saving ? '저장 중...' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

const lblSt = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text2)' };
const inSt  = { padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 };
