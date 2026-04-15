// pages/api/m/catalog.js — 챗봇 엔티티 카탈로그 학습 API
// GET    : 현재 카탈로그 메타 반환 (sizes, builtAt)
// GET ?refresh=1 또는 POST : 강제 재빌드
import { withAuth } from '../../../lib/auth';
import { getCatalog } from '../../../lib/chat/catalog';

async function handler(req, res) {
  try {
    const force = req.method === 'POST' || req.query.refresh === '1';
    const cat = await getCatalog({ force });
    return res.status(200).json({
      success: true,
      builtAt: cat.builtAt,
      sizes:   cat.sizes,
      // 디버그용 — 처음 10개씩만
      sample: {
        countries: cat.countries.slice(0, 10).map(c => c.name),
        flowers:   cat.flowers.slice(0, 10).map(f => f.name),
        areas:     cat.areas.slice(0, 10),
      },
    });
  } catch (err) {
    console.error('[catalog]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
