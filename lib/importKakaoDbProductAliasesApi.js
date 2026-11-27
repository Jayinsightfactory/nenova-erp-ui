import { canManageInvoiceReceipt } from './invoiceReceiptAccess.js';
import { loadImportKakaoDbCatalog, searchCatalogProducts } from './importKakaoDbCatalog.js';
import { readImportTeamRecord, writeImportTeamRecord } from './importTeamStore.js';
import {
  KAKAO_DB_PRODUCT_ALIASES_KEY,
  mergeKakaoProductAliasMaps,
  normalizeKakaoProductAliasMap,
  removeKakaoProductAliasMap,
  sanitizeKakaoProductAliasEntry,
  upsertKakaoProductAliasMap,
} from './importKakaoDbProductAliases.js';

function actorFromUser(user = {}) {
  const userId = String(user?.userId || user?.UserID || user?.id || user?.username || '').trim();
  const userName = String(user?.userName || user?.UserName || user?.name || userId).trim();
  return { userId, userName };
}

async function writeAliasesWithRetry(mutator, actor, { root } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readImportTeamRecord(KAKAO_DB_PRODUCT_ALIASES_KEY, root ? { root } : undefined);
    const currentMap = normalizeKakaoProductAliasMap(current.value);
    const { nextMap, meta } = mutator(currentMap);
    try {
      const committed = await writeImportTeamRecord(
        KAKAO_DB_PRODUCT_ALIASES_KEY,
        {
          expectedRevision: current.revision,
          value: nextMap,
          actor,
        },
        root ? { root } : undefined,
      );
      return {
        aliases: normalizeKakaoProductAliasMap(committed.value),
        revision: committed.revision,
        meta,
      };
    } catch (err) {
      lastError = err;
      if (err?.statusCode === 409 && attempt < 3) continue;
      throw err;
    }
  }
  throw lastError || new Error('품목 매칭 저장에 실패했습니다.');
}

export async function handleKakaoProductAliasesRequest(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!canManageInvoiceReceipt(req.user)) {
    return res.status(403).json({ error: '수입부 또는 관리자만 DB 품목 영문 매칭을 관리할 수 있습니다.' });
  }

  const root = deps.root || undefined;
  const queryFn = deps.queryFn || null;
  const loadCatalog = deps.loadCatalog || loadImportKakaoDbCatalog;

  try {
    if (req.method === 'GET') {
      const wantSearch = req.query?.search === '1' || req.query?.q !== undefined;
      const [record, catalog] = await Promise.all([
        readImportTeamRecord(KAKAO_DB_PRODUCT_ALIASES_KEY, root ? { root } : undefined),
        wantSearch && typeof loadCatalog === 'function'
          ? loadCatalog({ queryFn })
          : Promise.resolve(null),
      ]);
      const aliases = normalizeKakaoProductAliasMap(record.value);
      const products = wantSearch && catalog
        ? searchCatalogProducts(catalog, {
            query: String(req.query?.q || ''),
            country: String(req.query?.country || ''),
            allCountries: req.query?.allCountries === '1',
            limit: Number(req.query?.limit) || 40,
          })
        : undefined;
      return res.status(200).json({
        success: true,
        aliases,
        revision: record.revision,
        ...(products !== undefined ? { products } : {}),
      });
    }

    const actor = actorFromUser(req.user);
    if (!actor.userId) {
      return res.status(401).json({ error: '로그인 사용자 정보를 확인할 수 없습니다.' });
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const action = String(body.action || 'upsert');

      if (action === 'sync') {
        const localAliases = body.aliases && typeof body.aliases === 'object' ? body.aliases : {};
        const current = await readImportTeamRecord(KAKAO_DB_PRODUCT_ALIASES_KEY, root ? { root } : undefined);
        const currentMap = normalizeKakaoProductAliasMap(current.value);
        const { changed } = mergeKakaoProductAliasMaps(currentMap, localAliases);
        if (!changed) {
          return res.status(200).json({
            success: true,
            aliases: currentMap,
            revision: current.revision,
            synced: false,
          });
        }
        const savedResult = await writeAliasesWithRetry(
          (latestMap) => {
            const mergedRes = mergeKakaoProductAliasMaps(latestMap, localAliases);
            return { nextMap: mergedRes.merged, meta: { synced: mergedRes.changed } };
          },
          actor,
          { root },
        );
        return res.status(200).json({
          success: true,
          aliases: savedResult.aliases,
          revision: savedResult.revision,
          synced: Boolean(savedResult.meta?.synced),
        });
      }

      const entry = sanitizeKakaoProductAliasEntry({
        country: body.country || '',
        product: body.product || '',
        dbProdName: body.dbProdName || '',
        dbProdKey: body.dbProdKey ?? null,
        isCustom: Boolean(body.isCustom || !body.dbProdKey),
        updatedAt: new Date().toISOString(),
        updatedBy: actor.userName || actor.userId,
      });

      const savedResult = await writeAliasesWithRetry(
        (latestMap) => ({
          nextMap: upsertKakaoProductAliasMap(latestMap, entry),
          meta: { saved: entry },
        }),
        actor,
        { root },
      );

      return res.status(200).json({
        success: true,
        aliases: savedResult.aliases,
        revision: savedResult.revision,
        saved: savedResult.meta?.saved || entry,
      });
    }

    if (req.method === 'DELETE') {
      const src = req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0
        ? req.body
        : (req.query || {});
      const aliasId = String(src.aliasId || '').trim();
      const country = String(src.country || '').trim();
      const product = String(src.product || '').trim();
      if (!aliasId && !product) {
        return res.status(400).json({ error: '초기화할 품목 정보를 확인하세요.' });
      }
      const removedResult = await writeAliasesWithRetry(
        (latestMap) => ({
          nextMap: removeKakaoProductAliasMap(latestMap, { aliasId, country, product }),
          meta: null,
        }),
        actor,
        { root },
      );
      return res.status(200).json({
        success: true,
        aliases: removedResult.aliases,
        revision: removedResult.revision,
      });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).end();
  } catch (err) {
    const status = Number(err?.statusCode) >= 400 && Number(err?.statusCode) < 600 ? Number(err.statusCode) : 500;
    return res.status(status).json({
      error: String(err?.message || '품목 영문 매칭 처리 중 오류가 발생했습니다.'),
    });
  }
}
