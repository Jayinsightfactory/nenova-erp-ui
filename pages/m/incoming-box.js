// pages/m/incoming-box.js — 대표 모바일 보고서: 차수별 국가 입고 박스
import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import MobileShell from '../../components/m/MobileShell';
import IncomingBoxByCountryTable, { VIEWS } from '../../components/IncomingBoxByCountryTable';
import { isAdminUser } from '../../lib/userAccess';
import { verifyReqUser } from '../../lib/auth';
import styles from '../../styles/executive-volume.module.css';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const user = verifyReqUser(req);
  if (!user) return { redirect: { destination: '/m/login?next=/m/incoming-box', permanent: false } };
  if (!isAdminUser(user)) return { notFound: true };
  return { props: { user: { userId: user.userId || '', userName: user.userName || '' } } };
}

const number = value => new Intl.NumberFormat('ko-KR').format(Number(value) || 0);

export default function MobileIncomingBoxPage({ user }) {
  const router = useRouter();
  const [report, setReport] = useState(null);
  const [view, setView] = useState('byWeek');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (y) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/incoming/box-by-country?year=${encodeURIComponent(y)}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '입고 박스 보고서 조회에 실패했습니다.');
      setReport(data);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(year); }, [load, year]);

  const latest = report?.byWeek?.length ? report.byWeek[report.byWeek.length - 1] : null;
  return <MobileShell title="국가별 입고 박스" user={user}>
    <Head><title>NENOVA | 국가별 입고 박스</title><meta name="robots" content="noindex,nofollow" /><meta name="viewport" content="width=device-width, initial-scale=1" /></Head>
    <main className={styles.page}>
      <header className={styles.heading}>
        <div><h1>차수별 국가 입고 박스</h1><p>전산 입고 박스 + 비행 스케줄 카톡 공지 박스. 중복 AWB 제외, 국가는 물량 많은 순.</p></div>
        <button onClick={() => router.push('/m/executive-volume')}>국가별 물량 보고서 →</button>
      </header>
      <section className={styles.filters}>
        <label>연도<select value={year} disabled={busy} onChange={e => setYear(e.target.value)}>{[0, 1, 2].map(i => { const y = String(new Date().getFullYear() - i); return <option key={y} value={y}>{y}년</option>; })}</select></label>
        <label>보기<select value={view} onChange={e => setView(e.target.value)}>{VIEWS.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}</select></label>
        <button onClick={() => load(year)} disabled={busy}>{busy ? '조회 중…' : '최신화'}</button>
        <span>갱신 {report?.generatedAt ? new Date(report.generatedAt).toLocaleString('ko-KR') : ''}</span>
      </section>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!report && !error && <p className={styles.empty} role="status">{busy ? '보고서를 불러오는 중입니다.' : '표시할 자료가 없습니다.'}</p>}
      {report && <>
        <section className={styles.total}>
          <h2>{report.year}년 합계 · {number(report.grandTotal?.total)} 박스{latest ? ` · 최근 ${latest.label}차 ${number(latest.total)} 박스` : ''}</h2>
          <div>{report.countries.map(c => <span key={c} style={{ color: '#172b45' }}>{c} <b>{number(report.grandTotal.byCountry[c])}</b></span>)}</div>
        </section>
        <section className={styles.notes}>
          <strong>기준</strong>
          <span>카톡 선적 {number(report.kakaoShipments)}건{report.kakaoLastUpdate ? ` · 최근 업로드 ${new Date(report.kakaoLastUpdate.at).toLocaleDateString('ko-KR')}` : ' · 카톡 업로드 전'}</span>
          <span>{report.needsCheck?.length ? `웹 미입고 확인 ${report.needsCheck.length}건` : '웹 미입고 없음'}</span>
          <small>{report.basis?.rule}</small>
        </section>
        <IncomingBoxByCountryTable report={report} view={view} compact />
      </>}
    </main>
  </MobileShell>;
}
