import { withAuth } from '../../../../lib/auth';
import { fetchAudMarketRate, validExchangeDate } from '../../../../lib/audMarketExchangeRate';

function seoulDateNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export default withAuth(async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET 요청만 지원합니다.' });
  }
  const date = String(req.query?.date || '');
  if (!validExchangeDate(date) || date > seoulDateNow()) {
    return res.status(400).json({ error: '유효한 업로드 날짜를 지정하세요.' });
  }
  try {
    const market = await fetchAudMarketRate(date);
    return res.status(200).json({ success: true, ...market });
  } catch (error) {
    return res.status(503).json({ success: false, error: error.message || 'AUD/KRW 시장 환율을 조회하지 못했습니다.' });
  }
});
