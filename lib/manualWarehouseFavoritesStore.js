import { canUseManualWarehouseUpload } from './manualWarehouseAccess.js';
import { readImportTeamRecord, writeImportTeamRecord } from './importTeamStore.js';
import {
  MANUAL_WAREHOUSE_FAVORITES_KEY,
  buildManualFavoriteDraft,
  deleteManualFavoriteValue,
  mergeManualFavoriteLists,
  upsertManualFavoriteValue,
  validateManualWarehouseFavorites,
} from './manualWarehouseFavorites.js';

export function createManualFavoritesHandler({
  readRecord = readImportTeamRecord,
  writeRecord = writeImportTeamRecord,
  root,
} = {}) {
  return async function manualFavoritesHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!canUseManualWarehouseUpload(req.user)) {
      return res.status(403).json({
        success: false,
        code: 'WAREHOUSE_MANUAL_FORBIDDEN',
        error: '수기 입고 업로드 및 즐겨찾기 권한이 없습니다.',
      });
    }
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, DELETE');
      return res.status(405).json({ success: false, error: '지원하지 않는 요청입니다.' });
    }

    const storeOpts = root ? { root } : undefined;
    const actor = {
      userId: String(req.user?.userId ?? req.user?.UserID ?? '').trim(),
      userName: String(req.user?.userName ?? req.user?.UserName ?? req.user?.userId ?? '').trim(),
    };

    try {
      if (req.method === 'GET') {
        const record = await readRecord(MANUAL_WAREHOUSE_FAVORITES_KEY, storeOpts);
        const entries = Array.isArray(record.value?.entries) ? record.value.entries : [];
        return res.status(200).json({
          success: true,
          favorites: entries,
          revision: record.revision,
        });
      }

      const body = req.body ?? {};
      const action = req.method === 'DELETE' ? 'delete' : String(body.action || 'upsert');

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await readRecord(MANUAL_WAREHOUSE_FAVORITES_KEY, storeOpts);
        const expectedRevision = attempt === 0 && Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 0
          ? body.expectedRevision
          : current.revision;

        let nextValue;
        let savedFavorite = null;
        if (action === 'delete') {
          nextValue = deleteManualFavoriteValue(current.value, body.id);
        } else if (action === 'syncLocal') {
          const incomingEntries = Array.isArray(body.entries) ? body.entries : [];
          const mergedEntries = mergeManualFavoriteLists(current.value?.entries ?? [], incomingEntries);
          nextValue = { version: 1, entries: mergedEntries };
          validateManualWarehouseFavorites(nextValue);
        } else if (action === 'upsert') {
          savedFavorite = buildManualFavoriteDraft({
            id: body.id,
            name: body.name,
            farmName: body.farmName,
            farm: body.farm,
            rows: body.rows ?? body.items,
            actorUserId: actor.userId,
          });
          nextValue = upsertManualFavoriteValue(current.value, savedFavorite);
        } else {
          return res.status(400).json({ success: false, error: '지원하지 않는 즐겨찾기 작업입니다.' });
        }

        try {
          const saved = await writeRecord(
            MANUAL_WAREHOUSE_FAVORITES_KEY,
            { value: nextValue, expectedRevision, actor },
            storeOpts,
          );
          return res.status(200).json({
            success: true,
            favorite: savedFavorite,
            favorites: saved.value?.entries ?? [],
            revision: saved.revision,
          });
        } catch (writeError) {
          if (writeError?.statusCode === 409 && attempt === 0) continue;
          throw writeError;
        }
      }
      return res.status(409).json({ success: false, error: '즐겨찾기 저장 중 충돌이 발생했습니다. 다시 시도하세요.' });
    } catch (error) {
      return res.status(error?.statusCode || 500).json({
        success: false,
        code: error?.code || 'MANUAL_FAVORITES_ERROR',
        error: error?.statusCode ? error.message : '수기입고 즐겨찾기를 처리하지 못했습니다.',
      });
    }
  };
}
