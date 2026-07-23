// 영업수입불량차감 양식 다운로드

import { withAuth } from '../../../lib/auth';
import { buildSalesDefectWorkbook } from '../../../lib/salesDefectDeductionExcel.js';
import { listDeductions } from '../../../lib/salesDefectDeductions.js';
import { managerFilterForUser, normalizeParentWeek, normalizeYear } from '../../../lib/salesDefectDeductionCore.js';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const year = normalizeYear(req.query.year);
  const week = normalizeParentWeek(req.query.week);
  if (!year || !week) return res.status(400).json({ success: false, error: '연도와 차수를 확인하세요.' });
  try {
    const selectedManager = managerFilterForUser(req.query.manager || '', req.user);
    const data = await listDeductions({ year, week, manager: selectedManager });
    const selectedOption = data.managerOptions?.find((item) => String(item.managerId) === selectedManager);
    const buffer = await buildSalesDefectWorkbook(data.rows, {
      year,
      week,
      managerName: selectedOption?.managerName || (selectedManager || req.user?.userName || ''),
    });
    const fileName = encodeURIComponent(`영업수입불량차감_${year}_${String(week).padStart(2, '0')}차.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});
