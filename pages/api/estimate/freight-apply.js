import { withAuth } from '../../../lib/auth.js';

// Old cached clients must reload and use the estimate additional-product fix cycle.
export default withAuth(async function handler(req, res) {
  return res.status(410).json({
    success: false,
    code: 'FREIGHT_USE_ESTIMATE_ADD_FLOW',
    error: '운임 등록 방식이 변경되었습니다. 견적서를 새로고침한 뒤 운임비 추가에서 등록하세요.',
  });
});
