// pages/api/kakao/raw-tail.js
// 임시 진단용(작업 완료 후 제거 예정): 카카오 시트 최근 원본 행(가공 없이) 확인.
// ⚠️ 읽기 전용. GET ?tab=비즈니스이벤트&n=3
import { withAuth } from '../../../lib/auth';
import { getKakaoSheetId, readSheetValues } from '../../../lib/googleSheets';

async function handler(req, res) {
  try {
    const tab = req.query.tab || '비즈니스이벤트';
    const n = Math.min(parseInt(req.query.n) || 3, 20);
    const id = getKakaoSheetId();
    const v = await readSheetValues({ spreadsheetId: id, range: `${tab}!A:J` });
    const header = v[0] || [];
    const tail = v.slice(1).slice(-n);
    res.status(200).json({ success: true, tab, totalRows: v.length - 1, header, tail });
  } catch (e) {
    res.status(200).json({ success: false, error: String(e?.message || e) });
  }
}

export default withAuth(handler);
