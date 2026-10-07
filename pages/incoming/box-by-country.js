// pages/incoming/box-by-country.js — 차수별 국가 입고 박스
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import IncomingBoxByCountryTable, { VIEWS } from '../../components/IncomingBoxByCountryTable';

const btn = { height: 32, padding: '0 14px', border: '1px solid #1557a2', background: '#1557a2', color: '#fff', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 12 };
const ghost = { ...btn, background: '#fff', color: '#1557a2' };
const fmt = value => (Number(value) || 0).toLocaleString('ko-KR');

export default function IncomingBoxByCountryPage() {
  const [report, setReport] = useState(null);
  const [view, setView] = useState('byWeek');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async (y) => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/incoming/box-by-country?year=${encodeURIComponent(y)}`, { credentials: 'same-origin', cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '입고 박스 집계 조회 실패');
      setReport(json);
    } catch (e) { setReport(null); setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(year); }, [load, year]);

  async function uploadKakao(file) {
    if (!file) return;
    setUploading(true); setError(''); setNotice('');
    try {
      const text = await file.text();
      const res = await fetch('/api/incoming/box-by-country', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, fileName: file.name, fromYear: year }) });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '카톡 업로드 실패');
      setNotice(`카톡 선적 ${fmt(json.saved)}건 반영 (공지 ${fmt(json.mentions)}건, 중복 ${fmt(json.duplicates)}건 제외)`);
      await load(year);
    } catch (e) { setError(e.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  const needs = report?.needsCheck || [];
  return (
    <>
      <Head><title>NENOVA | 차수별 국가 입고 박스</title></Head>
      <div style={{ padding: 18, maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>차수별 국가 입고 박스</h1>
            <div style={{ marginTop: 4, fontSize: 12, color: '#667085' }}>
              입고관리 전산 박스 + 비행 스케줄 카톡 공지 박스를 합산합니다. 중복 AWB는 제외되어 있고, 웹에 박스 단위가 없는 국가는 카톡 박스를 씁니다.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={year} onChange={e => setYear(e.target.value)} style={{ height: 32, border: '1px solid #cfd6e4', borderRadius: 4, padding: '0 8px', fontSize: 12 }}>
              {[0, 1, 2].map(i => { const y = String(new Date().getFullYear() - i); return <option key={y} value={y}>{y}년</option>; })}
            </select>
            {VIEWS.map(v => <button key={v.key} onClick={() => setView(v.key)} style={view === v.key ? btn : ghost}>{v.label}</button>)}
            <button onClick={() => load(year)} disabled={loading} style={ghost}>{loading ? '조회중…' : '최신화'}</button>
            <input ref={fileRef} type="file" accept=".txt" style={{ display: 'none' }} onChange={e => uploadKakao(e.target.files?.[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} style={btn}>{uploading ? '업로드중…' : '카톡 내보내기 업로드'}</button>
          </div>
        </div>

        {error && <p style={{ padding: 10, background: '#fff1f2', color: '#b42318', border: '1px solid #fecdd3', borderRadius: 6 }}>{error}</p>}
        {notice && <p style={{ padding: 10, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: 6 }}>{notice}</p>}

        {report && (
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#52657a', marginBottom: 10, flexWrap: 'wrap' }}>
            <span>전산 입고 기준 {report.year}년 · 카톡 선적 {fmt(report.kakaoShipments)}건{report.kakaoLastUpdate ? ` (최근 업로드 ${new Date(report.kakaoLastUpdate.at).toLocaleString('ko-KR')})` : ' (카톡 업로드 전: 전산 박스만 표시)'}</span>
            <span>총 {fmt(report.grandTotal?.total)}박스</span>
            {needs.length > 0 && <span style={{ color: '#b45309' }}>웹 미입고 확인 {needs.length}건</span>}
            <button onClick={() => setShowDetail(s => !s)} style={{ ...ghost, height: 24, padding: '0 8px' }}>{showDetail ? '선적별 상세 닫기' : '선적별 상세 보기'}</button>
          </div>
        )}

        <IncomingBoxByCountryTable report={report} view={view} />

        {showDetail && report && (
          <div style={{ marginTop: 16, overflow: 'auto', background: '#fff', border: '1px solid #d5dfeb', borderRadius: 10 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead><tr style={{ background: '#edf3fa' }}>{['차수', '국가', '품목', 'AWB', '최종박스', '출처', '카톡', '웹', '도착일', '농장', '비고'].map(h => <th key={h} style={{ padding: 6, textAlign: 'left', borderBottom: '1px solid #d5dfeb', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={`${r.awb}-${i}`} style={{ background: r.needsCheck ? '#fff1f2' : r.source.startsWith('카톡') ? '#eef4ff' : '#fff' }}>
                    <td style={td}>{r.subWeek}</td><td style={td}>{r.country}</td><td style={td}>{r.item}</td><td style={{ ...td, fontFamily: 'monospace' }}>{r.awb}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(r.finalBox)}</td><td style={td}>{r.source}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.kakaoBox == null ? '' : fmt(r.kakaoBox)}</td><td style={{ ...td, textAlign: 'right' }}>{r.webBox == null ? '' : fmt(r.webBox)}</td>
                    <td style={td}>{r.arrival}</td><td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.farms}</td><td style={td}>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
const td = { padding: '5px 6px', borderBottom: '1px solid #eef2f6', whiteSpace: 'nowrap' };
