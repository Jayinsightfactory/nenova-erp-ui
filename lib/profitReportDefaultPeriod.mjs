// 주차별 매출이익보고서는 진행 중인 현재 차수가 아니라
// 직전 완료 차수를 기본 조회 대상으로 사용한다.
export function getPreviousProfitReportPeriod(currentWeek) {
  const match = String(currentWeek || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { year: '', major: '' };

  let year = Number(match[1]);
  let major = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(major) || major < 1 || major > 52) {
    return { year: '', major: '' };
  }

  major -= 1;
  if (major < 1) {
    year -= 1;
    major = 52;
  }

  return {
    year: String(year),
    major: String(major).padStart(2, '0'),
  };
}
