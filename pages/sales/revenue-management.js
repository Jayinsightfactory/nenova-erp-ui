import { useMemo, useState } from 'react';

const fmt = n => Number(n || 0).toLocaleString();

const FLOW_STEPS = [
  { title: '1. API 조회', text: '차수/기간을 기준으로 이카운트 판매현황을 읽어옵니다.' },
  { title: '2. 원본 저장', text: '조회 결과를 네노바웹 매출 비교용 원본 Batch로 저장합니다.' },
  { title: '3. 업체 매칭', text: '사업자명과 네노바 통용명을 매칭하고 필요 시 분배합니다.' },
  { title: '4. 매출 비교', text: '24/25/26년 차수별 업체 매출을 비교표로 확인합니다.' },
];

const SAMPLE_ROWS = [
  {
    canonicalName: '미우',
    year2024: 0,
    year2025: 14891800,
    year2026: 0,
    status: '매칭 필요',
    sourceNames: '아이엠',
  },
  {
    canonicalName: '소재2호',
    year2024: 0,
    year2025: 17807900,
    year2026: 0,
    status: '후보',
    sourceNames: '소재2호',
  },
  {
    canonicalName: '미카엘',
    year2024: 0,
    year2025: 1935000,
    year2026: 0,
    status: '후보',
    sourceNames: '(주)미카엘플라워',
  },
  {
    canonicalName: '선미',
    year2024: 0,
    year2025: 361500,
    year2026: 0,
    status: '후보',
    sourceNames: '선미원예(중매1484)',
  },
];

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function pct(current, previous) {
  if (!previous) return current ? '신규' : '-';
  return `${(((current - previous) / previous) * 100).toFixed(1)}%`;
}

export default function SalesRevenueManagement() {
  const currentYear = new Date().getFullYear();
  const [channel, setChannel] = useState('양재동');
  const [week, setWeek] = useState('24');
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [years, setYears] = useState({
    y1: String(currentYear - 2),
    y2: String(currentYear - 1),
    y3: String(currentYear),
  });

  const summary = useMemo(() => {
    return SAMPLE_ROWS.reduce((acc, row) => {
      acc.y1 += row.year2024;
      acc.y2 += row.year2025;
      acc.y3 += row.year2026;
      if (row.status !== '확정') acc.needReview += 1;
      return acc;
    }, { y1: 0, y2: 0, y3: 0, needReview: 0 });
  }, []);

  const showPending = () => {
    alert('이 화면은 메뉴/화면 배포 확인용 1차 화면입니다. 다음 단계에서 이카운트 판매현황 read-only API 조회 및 저장 API를 연결합니다.');
  };

  return (
    <div>
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="filter-label">지점</span>
        <select className="filter-select" value={channel} onChange={e => setChannel(e.target.value)}>
          <option value="양재동">양재동</option>
          <option value="전체">전체</option>
        </select>

        <span className="filter-label">차수</span>
        <input
          className="filter-input"
          value={week}
          onChange={e => setWeek(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
          style={{ width: 46, textAlign: 'center' }}
        />
        <span className="filter-label">차</span>

        <span className="filter-label">기간</span>
        <input className="filter-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span style={{ color: 'var(--text3)' }}>~</span>
        <input className="filter-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />

        <span className="filter-label">비교연도</span>
        {['y1', 'y2', 'y3'].map(key => (
          <input
            key={key}
            className="filter-input"
            value={years[key]}
            onChange={e => setYears(prev => ({ ...prev, [key]: e.target.value.replace(/[^\d]/g, '').slice(0, 4) }))}
            style={{ width: 58, textAlign: 'center' }}
          />
        ))}

        <div className="page-actions">
          <button className="btn btn-primary" onClick={showPending}>이카운트 API 조회 및 저장</button>
          <button className="btn" onClick={showPending}>강제 재조회</button>
          <button className="btn" onClick={showPending}>매칭 검증</button>
          <button className="btn" onClick={showPending}>비교표 생성</button>
          <button className="btn" onClick={showPending}>엑셀</button>
        </div>
      </div>

      <div className="banner-warn" style={{ marginBottom: 6 }}>
        운영 기준: 이 화면은 엑셀 업로드로 자료를 만드는 메뉴가 아니라, 이카운트 API 판매현황을 읽어서 네노바웹 비교용 DB에 저장한 뒤 매칭/비교하는 메뉴입니다. 이카운트 원본 쓰기나 판매전표 전송은 하지 않습니다.
      </div>

      <div className="kpi-grid">
        <div className="kpi-card kpi-accent">
          <div className="kpi-label">{years.y1}년 {week}차 매출</div>
          <div className="kpi-value">{fmt(summary.y1)}</div>
          <div className="kpi-sub">저장 Batch 기준</div>
        </div>
        <div className="kpi-card kpi-green">
          <div className="kpi-label">{years.y2}년 {week}차 매출</div>
          <div className="kpi-value">{fmt(summary.y2)}</div>
          <div className="kpi-sub">샘플 구조 표시</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">{years.y3}년 {week}차 매출</div>
          <div className="kpi-value">{fmt(summary.y3)}</div>
          <div className="kpi-sub">API 조회 후 표시</div>
        </div>
        <div className="kpi-card kpi-amber">
          <div className="kpi-label">매칭 확인</div>
          <div className="kpi-value">{summary.needReview}</div>
          <div className="kpi-sub">후보/분배 필요 건</div>
        </div>
      </div>

      <div style={styles.grid}>
        <section style={styles.panel}>
          <div style={styles.panelHead}>
            <strong>작업 흐름</strong>
            <span>API 조회부터 비교표까지</span>
          </div>
          <div style={styles.flow}>
            {FLOW_STEPS.map(step => (
              <div key={step.title} style={styles.flowItem}>
                <b>{step.title}</b>
                <p>{step.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.panelHead}>
            <strong>업체명 매칭 기준</strong>
            <span>사업자명과 통용명 차이 보정</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>이카운트 거래처명</th>
                <th>통용명 후보</th>
                <th>방식</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>(주)미카엘플라워</td><td>미카엘</td><td>1:1</td></tr>
              <tr><td>선미원예(중매1484)</td><td>선미</td><td>1:1</td></tr>
              <tr><td>주식회사 송우플라워시스템</td><td>송우</td><td>1:1</td></tr>
              <tr><td>중매1536 (스타일)</td><td>스타일</td><td>1:1</td></tr>
              <tr><td>아이엠</td><td>미우</td><td>확인필요</td></tr>
            </tbody>
          </table>
        </section>
      </div>

      <section style={styles.panel}>
        <div style={styles.panelHead}>
          <strong>차수별 매출 비교 미리보기</strong>
          <span>API 연결 후 실제 저장 데이터로 대체됩니다</span>
        </div>
        <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>업체 통용명</th>
              <th>{years.y1}</th>
              <th>{years.y2}</th>
              <th>{years.y3}</th>
              <th>{years.y2}/{years.y1}</th>
              <th>{years.y3}/{years.y2}</th>
              <th>매칭상태</th>
              <th>원본 거래처명</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_ROWS.map(row => (
              <tr key={row.canonicalName}>
                <td>{row.canonicalName}</td>
                <td style={styles.num}>{fmt(row.year2024)}</td>
                <td style={styles.num}>{fmt(row.year2025)}</td>
                <td style={styles.num}>{fmt(row.year2026)}</td>
                <td style={styles.num}>{pct(row.year2025, row.year2024)}</td>
                <td style={styles.num}>{pct(row.year2026, row.year2025)}</td>
                <td>{row.status}</td>
                <td>{row.sourceNames}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: '1.1fr 1fr',
    gap: 6,
    marginBottom: 6,
  },
  panel: {
    background: 'var(--surface)',
    border: '1px solid var(--border2)',
    padding: 8,
  },
  panelHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderBottom: '1px solid var(--border)',
    paddingBottom: 6,
    marginBottom: 8,
    fontSize: 12,
    color: 'var(--text1)',
  },
  flow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 6,
  },
  flowItem: {
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    padding: 8,
    minHeight: 76,
    fontSize: 12,
  },
  num: {
    textAlign: 'right',
    fontFamily: 'var(--mono)',
  },
};
