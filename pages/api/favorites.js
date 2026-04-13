// pages/api/favorites.js
// 즐겨찾기 CRUD — UserFavorite 테이블 자동 생성
// GET    ?page=stock-status  → 유저별 즐겨찾기 목록
// POST   { page, name, filterData }  → 저장
// DELETE { favoriteKey }  → 삭제 (본인 것만)

import { query, sql } from '../../lib/db';
import { withAuth } from '../../lib/auth';

let tableChecked = false;

async function ensureTable() {
  if (tableChecked) return;
  await query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='UserFavorite')
    CREATE TABLE UserFavorite (
      FavoriteKey INT IDENTITY(1,1) PRIMARY KEY,
      UserID      NVARCHAR(50)   NOT NULL,
      PageName    NVARCHAR(100)  NOT NULL,
      FavName     NVARCHAR(100)  NOT NULL,
      FilterData  NVARCHAR(MAX)  NOT NULL,
      SortOrder   INT            NOT NULL DEFAULT 0,
      CreateDtm   DATETIME       NOT NULL DEFAULT GETDATE()
    )`, {});
  tableChecked = true;
}

export default withAuth(async function handler(req, res) {
  try {
    await ensureTable();
    const uid = req.user?.userId || 'system';

    // GET: 즐겨찾기 목록
    if (req.method === 'GET') {
      const { page } = req.query;
      if (!page) return res.status(400).json({ success: false, error: 'page 필요' });
      const result = await query(
        `SELECT FavoriteKey, FavName, FilterData, SortOrder, CreateDtm
         FROM UserFavorite WHERE UserID=@uid AND PageName=@page
         ORDER BY SortOrder, FavoriteKey`,
        { uid: { type: sql.NVarChar, value: uid }, page: { type: sql.NVarChar, value: page } }
      );
      return res.status(200).json({ success: true, favorites: result.recordset });
    }

    // POST: 즐겨찾기 저장
    if (req.method === 'POST') {
      const { page, name, filterData } = req.body;
      if (!page || !name || !filterData) {
        return res.status(400).json({ success: false, error: 'page, name, filterData 필요' });
      }
      // JSON 검증
      try { JSON.parse(filterData); } catch { return res.status(400).json({ success: false, error: 'filterData는 유효한 JSON이어야 합니다' }); }

      const result = await query(
        `INSERT INTO UserFavorite (UserID, PageName, FavName, FilterData)
         OUTPUT INSERTED.FavoriteKey
         VALUES (@uid, @page, @name, @data)`,
        {
          uid:  { type: sql.NVarChar, value: uid },
          page: { type: sql.NVarChar, value: page },
          name: { type: sql.NVarChar, value: name },
          data: { type: sql.NVarChar, value: filterData },
        }
      );
      return res.status(200).json({ success: true, favoriteKey: result.recordset[0].FavoriteKey });
    }

    // DELETE: 즐겨찾기 삭제
    if (req.method === 'DELETE') {
      const { favoriteKey } = req.body;
      if (!favoriteKey) return res.status(400).json({ success: false, error: 'favoriteKey 필요' });
      await query(
        `DELETE FROM UserFavorite WHERE FavoriteKey=@fk AND UserID=@uid`,
        { fk: { type: sql.Int, value: parseInt(favoriteKey) }, uid: { type: sql.NVarChar, value: uid } }
      );
      return res.status(200).json({ success: true });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
