import {withAuth} from '../../../lib/auth';
import {parsePasteHandler} from './parse-paste';
import {createPasteAnalysisStore} from '../../../lib/pasteAnalysisStore';
import {analysisKey} from '../../../lib/pasteInboxPreanalysis';

const store = createPasteAnalysisStore();
export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (req.user?.accountActive === false) return res.status(403).json({success:false,error:'비활성 계정은 공유 분석을 조회할 수 없습니다.'});
  const {text, week, force, allowAnalyze, lookupOnly} = req.body || {};
  try { analysisKey(text, week); }
  catch (error) { return res.status(400).json({success: false, error: error.message}); }
  try {
    const data = await store.read({userId: req.user.userId, text, week, force: force === true, allowAnalyze: allowAnalyze !== false, lookupOnly: lookupOnly === true}, async () => {
      let response, status = 200;
      const capture = {status(code) {status = code; return this;}, json(value) {response = value; return value;}};
      await parsePasteHandler({...req, body: {text, mixedQuantitySupport: true, selectedOrderYear: week.slice(0, 4)}}, capture);
      if (status !== 200 || !response?.success) throw new Error(response?.error || '분석에 실패했습니다.');
      return response;
    });
    return res.status(200).json(data);
  } catch (error) {
    console.error('[paste-preanalysis]', error.message);
    return res.status(503).json({success: false, error: '분석 저장/조회 실패: ' + error.message});
  }
});
