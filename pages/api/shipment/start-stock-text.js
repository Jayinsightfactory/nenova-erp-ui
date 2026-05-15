import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek } from '../../../lib/orderUtils';
import { scoreMatch } from '../../../lib/displayName';

const SECTION_FLOWERS = ['수국', '장미', '알스트로', '카네이션', '루스커스', '튤립', '거베라', '국화'];

function parseLines(text) {
  const rows = [];
  let section = '';
  String(text || '').split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line || /^[ㅡ\-_=\s]{5,}$/.test(line)) return;
    if (!/\d/.test(line)) {
      section = line;
      return;
    }
    const m = line.match(/^(.*?)(\d+(?:\.\d+)?)\s*(박스|단|송이|개)?\s*$/);
    if (!m) return;
    const name = m[1].trim();
    const qty = parseFloat(m[2]);
    if (!name || !(qty > 0)) return;
    const unit = m[3] || '';
    rows.push({ section, inputName: name, qty, unit });
  });
  return rows;
}

function sectionHint(section) {
  const s = String(section || '');
  return SECTION_FLOWERS.find(f => s.includes(f)) || '';
}

function productScore(row, product) {
  const hint = sectionHint(row.section);
  const input = [hint, row.inputName].filter(Boolean).join(' ');
  let score = scoreMatch(input, product, row.inputName);
  if (hint && product.FlowerName?.includes(hint)) score += 20;
  const compactInput = row.inputName.toLowerCase().replace(/\s+/g, '');
  const compactProd = `${product.ProdName || ''} ${product.DisplayName || ''}`.toLowerCase().replace(/\s+/g, '');
  if (compactProd.includes(compactInput)) score += 25;
  return Math.min(100, score);
}

async function saveRows(tQ, week, rows) {
  let smResult = await tQ(
    `SELECT StockKey FROM StockMaster WITH (UPDLOCK, HOLDLOCK) WHERE OrderWeek=@wk AND isFix=2`,
    { wk: { type: sql.NVarChar, value: week } }
  );
  let sk;
  if (smResult.recordset.length === 0) {
    const ins = await tQ(
      `INSERT INTO StockMaster (OrderWeek, isFix) OUTPUT INSERTED.StockKey VALUES (@wk, 2)`,
      { wk: { type: sql.NVarChar, value: week } }
    );
    sk = ins.recordset[0].StockKey;
  } else {
    sk = smResult.recordset[0].StockKey;
  }

  for (const row of rows) {
    await tQ(
      `MERGE INTO ProductStock WITH (HOLDLOCK) AS t
       USING (VALUES (@pk, @sk)) AS s(ProdKey, StockKey) ON t.ProdKey=s.ProdKey AND t.StockKey=s.StockKey
       WHEN MATCHED THEN UPDATE SET Stock=@stock
       WHEN NOT MATCHED THEN INSERT (ProdKey, StockKey, Stock) VALUES (@pk, @sk, @stock);`,
      {
        pk: { type: sql.Int, value: row.prodKey },
        sk: { type: sql.Int, value: sk },
        stock: { type: sql.Float, value: row.qty },
      }
    );
  }
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { week, text, save } = req.body || {};
  const wk = normalizeOrderWeek(week || '');
  if (!wk) return res.status(400).json({ success: false, error: 'week 필요' });
  if (!String(text || '').trim()) return res.status(400).json({ success: false, error: 'text 필요' });

  try {
    const parsed = parseLines(text);
    const prodResult = await query(
      `SELECT ProdKey, ProdName, ISNULL(DisplayName, ProdName) AS DisplayName, FlowerName, CounName, OutUnit
       FROM Product WHERE isDeleted=0`
    );
    const products = prodResult.recordset;
    const mapped = parsed.map(row => {
      const candidates = products
        .map(p => ({ p, score: productScore(row, p) }))
        .filter(x => x.score >= 35)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      const best = candidates[0];
      return {
        ...row,
        prodKey: best?.p?.ProdKey || null,
        prodName: best?.p?.ProdName || '',
        displayName: best?.p?.DisplayName || '',
        flowerName: best?.p?.FlowerName || '',
        counName: best?.p?.CounName || '',
        score: best?.score || 0,
        candidates: candidates.map(x => ({
          prodKey: x.p.ProdKey,
          prodName: x.p.ProdName,
          displayName: x.p.DisplayName,
          flowerName: x.p.FlowerName,
          counName: x.p.CounName,
          score: x.score,
        })),
      };
    });
    const matched = mapped.filter(r => r.prodKey && r.score >= 45);
    const unmatched = mapped.filter(r => !r.prodKey || r.score < 45);

    if (save) {
      if (unmatched.length > 0) {
        return res.status(409).json({ success: false, error: '미매칭 품목이 있어 저장하지 않았습니다.', rows: mapped, unmatched });
      }
      await withTransaction(tQ => saveRows(tQ, wk, matched));
    }

    return res.status(200).json({ success: true, week: wk, saved: !!save, rows: mapped, matched, unmatched });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
