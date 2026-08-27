import {
  assertChinaVolumeBoardSchema,
  deleteChinaVolumeBoard,
  deleteChinaVolumeProductMapping,
  loadChinaVolumeBoards,
  loadChinaVolumeProductMappings,
  saveChinaVolumeBoard,
  saveChinaVolumeProductMapping,
} from './chinaVolumeBoardStore.js';

export function createChinaVolumeBoardHandler(deps = {}) {
  const services = {
    assertSchema: assertChinaVolumeBoardSchema,
    loadBoards: loadChinaVolumeBoards,
    loadMappings: loadChinaVolumeProductMappings,
    saveBoard: saveChinaVolumeBoard,
    saveMapping: saveChinaVolumeProductMapping,
    deleteBoard: deleteChinaVolumeBoard,
    deleteMapping: deleteChinaVolumeProductMapping,
    ...deps,
  };
  return async function handler(req, res) {
    try {
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST, DELETE');
        return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: '지원하지 않는 요청 방식입니다.' });
      }
      await services.assertSchema();
      if (req.method === 'GET') {
        const boards = await services.loadBoards({
          orderYear: req.query?.orderYear,
          orderWeek: req.query?.orderWeek,
          boardKey: req.query?.boardKey,
        });
        const productMappings = await services.loadMappings();
        return res.status(200).json({ success: true, boards, current: boards[0] || null, productMappings });
      }
      const actor = req.user?.userId || 'user';
      if (req.method === 'POST') {
        const action = String(req.body?.action || 'save');
        if (action === 'save') {
          const board = await services.saveBoard(req.body || {}, actor);
          return res.status(200).json({ success: true, board });
        }
        if (action === 'save-mapping') {
          const mapping = await services.saveMapping(req.body || {}, actor);
          return res.status(200).json({ success: true, mapping });
        }
        return res.status(400).json({ success: false, code: 'INVALID_ACTION', error: '지원하지 않는 저장 작업입니다.' });
      }
      const boardKey = req.query?.boardKey;
      const mappingKey = req.query?.mappingKey;
      if ((boardKey && mappingKey) || (!boardKey && !mappingKey)) {
        return res.status(400).json({ success: false, code: 'INVALID_DELETE_TARGET', error: '삭제할 작업본 또는 품목 매핑 하나를 선택하세요.' });
      }
      if (boardKey) return res.status(200).json({ success: true, ...(await services.deleteBoard({ boardKey, expectedRowVersion: req.query?.expectedRowVersion }, actor)) });
      return res.status(200).json({ success: true, ...(await services.deleteMapping(mappingKey, actor)) });
    } catch (error) {
      const status = Number(error?.statusCode || (error?.code === 'MIGRATION_REQUIRED' ? 503 : 500));
      return res.status(status).json({ success: false, code: error?.code || 'CHINA_VOLUME_BOARD_ERROR', error: error?.message || '자동 중국물량표 처리에 실패했습니다.' });
    }
  };
}
