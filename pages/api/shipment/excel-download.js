// pages/api/shipment/excel-download.js
// 업체별 출고 엑셀 다운로드
// GET?week=14-01&custKey=123 → 특정 업체만
// GET?week=14-01              → 전체 업체 (ZIP은 아니고 하나의 workbook에 업체별 시트)

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import XLSX from 'xlsx';

const DAY_NAMES = ['월','화','수','목','금'];
const DAY_KO = { '월':'월요일','화':'화요일','수':'수요일','목':'목요일','금':'금요일','토':'토요일','일':'일요일' };

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { week, custKey, shipDayConfigs: cfgStr, dailyQtyInputs: qtyStr, prodDayOverrides: overStr } = req.query;
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });

  // 프론트엔드에서 전달한 설정 파싱
  let shipDayConfigs = {};
  let dailyQtyInputs = {};
  let prodDayOverrides = {};
  try { shipDayConfigs = JSON.parse(cfgStr || '{}'); } catch {}
  try { dailyQtyInputs = JSON.parse(qtyStr || '{}'); } catch {}
  try { prodDayOverrides = JSON.parse(overStr || '{}'); } catch {}

  try {
    // 거래처 목록
    let custWhere = '';
    const params = { week: { type: sql.NVarChar, value: week } };
    if (custKey) {
      custWhere = 'AND om.CustKey = @ck';
      params.ck = { type: sql.Int, value: parseInt(custKey) };
    }

    // 출고 데이터 조회 (ShipmentDetail 기준)
    const result = await query(
      `SELECT
        c.CustKey, c.CustName,
        p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.CountryFlower,
        p.OutUnit,
        ISNULL(sd.OutQuantity, 0) AS OutQty,
        CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipmentDtm
       FROM ShipmentMaster sm
       JOIN Customer c ON sm.CustKey = c.CustKey
       JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       JOIN OrderMaster om ON om.CustKey = sm.CustKey AND om.OrderWeek = @week AND om.isDeleted = 0
       WHERE sm.OrderWeek = @week AND sm.isDeleted = 0 AND sd.OutQuantity > 0
       ${custWhere}
       ORDER BY c.CustName, p.CountryFlower, p.FlowerName, p.ProdName`,
      params
    );

    // _new_ShipmentDetail도 체크 (아직 확정 안 된 것)
    const newResult = await query(
      `SELECT
        c.CustKey, c.CustName,
        p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.CountryFlower,
        p.OutUnit,
        ISNULL(sd.OutQuantity, 0) AS OutQty,
        CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipmentDtm
       FROM _new_ShipmentMaster sm
       JOIN Customer c ON sm.CustKey = c.CustKey
       JOIN _new_ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       WHERE sm.OrderWeek = @week AND sm.isDeleted = 0 AND sd.OutQuantity > 0
       ${custWhere ? custWhere.replace('om.CustKey','sm.CustKey') : ''}
       ORDER BY c.CustName, p.CountryFlower, p.FlowerName, p.ProdName`,
      params
    );

    // 두 결과 합치기 (new가 있으면 우선)
    const allRows = [...newResult.recordset];
    const newKeys = new Set(allRows.map(r => `${r.CustKey}|${r.ProdKey}`));
    result.recordset.forEach(r => {
      if (!newKeys.has(`${r.CustKey}|${r.ProdKey}`)) allRows.push(r);
    });

    // 업체별 그룹핑
    const custMap = {};
    allRows.forEach(row => {
      if (!custMap[row.CustKey]) {
        custMap[row.CustKey] = { name: row.CustName, items: [] };
      }
      custMap[row.CustKey].items.push(row);
    });

    // 차수 접미사
    const suffix = `-${week.split('-').pop() || '01'}`;

    // 품목의 출고요일 가져오기
    function getShipDays(ck, pk, prodGroup) {
      const overKey = `${ck}|${pk}`;
      if (prodDayOverrides[overKey]) return prodDayOverrides[overKey].split(',').filter(Boolean);
      const cfgKey = `${prodGroup}|${suffix}`;
      return (shipDayConfigs[cfgKey] || '').split(',').filter(Boolean);
    }

    // 품목의 일별 수량 가져오기
    function getDailyQty(ck, pk) {
      return dailyQtyInputs[`${ck}|${pk}`] || {};
    }

    const wb = XLSX.utils.book_new();

    // 각 업체별 처리
    for (const [ck, cust] of Object.entries(custMap)) {
      const custName = cust.name;
      const items = cust.items;

      // 요일별로 그룹핑
      const dayGroups = {}; // { '월': [ {item, qty} ], ... }
      const noDayItems = []; // 출고일 미지정

      items.forEach(item => {
        const days = getShipDays(parseInt(ck), item.ProdKey, item.CountryFlower || '');
        const dailyQty = getDailyQty(parseInt(ck), item.ProdKey);

        if (days.length === 0) {
          // 출고일 미지정
          noDayItems.push({ ...item, qty: item.OutQty });
        } else {
          days.forEach(day => {
            if (!dayGroups[day]) dayGroups[day] = [];
            const qty = dailyQty[day] !== undefined ? parseFloat(dailyQty[day]) || 0 : Math.round(item.OutQty / days.length);
            if (qty > 0) {
              dayGroups[day].push({ ...item, qty });
            }
          });
        }
      });

      // 미지정 품목도 '미지정' 그룹으로
      if (noDayItems.length > 0) {
        dayGroups['미지정'] = noDayItems;
      }

      // 요일별 시트 생성
      const orderedDays = DAY_NAMES.filter(d => dayGroups[d]);
      if (dayGroups['미지정']) orderedDays.push('미지정');

      orderedDays.forEach(day => {
        const dayItems = dayGroups[day];
        if (!dayItems || dayItems.length === 0) return;

        // 카테고리별 그룹핑 (CountryFlower)
        const catMap = {};
        dayItems.forEach(item => {
          const cat = item.CountryFlower || item.FlowerName || '기타';
          if (!catMap[cat]) catMap[cat] = { unit: item.OutUnit || '박스', items: [] };
          catMap[cat].items.push(item);
        });

        // 엑셀 시트 데이터 빌드
        const wsData = [];
        // 행0: 업체명 + 출고일자
        const dayLabel = day === '미지정' ? '(미지정)' : `${DAY_KO[day] || day}`;
        wsData.push([`${custName} 출고일자 ${dayLabel}`]);

        for (const [cat, group] of Object.entries(catMap)) {
          // 카테고리 헤더
          const unitLabel = group.unit === '단' ? '단' : group.unit === '송이' ? '송이' : '박스';
          wsData.push([cat, '색상 ', `총 수량 / ${unitLabel}`, '비고']);

          let catTotal = 0;
          group.items.forEach(item => {
            wsData.push(['', item.ProdName, item.qty, '']);
            catTotal += item.qty;
          });

          // 합계
          wsData.push(['', '합 계', catTotal, '']);
          wsData.push([]); // 빈 행
        }

        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // 열 너비 설정
        ws['!cols'] = [
          { wch: 16 }, // 카테고리
          { wch: 20 }, // 색상
          { wch: 14 }, // 수량
          { wch: 10 }, // 비고
        ];

        // 셀 병합: 행0 (타이틀)
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];

        // 카테고리 셀 병합 (세로)
        let rowIdx = 1;
        for (const [, group] of Object.entries(catMap)) {
          const catStartRow = rowIdx + 1; // 첫 아이템 행
          const catEndRow = catStartRow + group.items.length - 1;
          if (catEndRow > catStartRow) {
            ws['!merges'].push({ s: { r: catStartRow, c: 0 }, e: { r: catEndRow, c: 0 } });
          }
          rowIdx += 1 + group.items.length + 1 + 1; // 헤더 + items + 합계 + 빈행
        }

        // 시트 이름: "업체명_요일" (31자 제한)
        let sheetName = `${custName.substring(0, 20)}_${day}`;
        // 중복 방지
        let cnt = 1;
        while (wb.SheetNames.includes(sheetName)) {
          sheetName = `${custName.substring(0, 18)}_${day}_${cnt++}`;
        }
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });
    }

    if (wb.SheetNames.length === 0) {
      return res.status(404).json({ success: false, error: '출고 데이터가 없습니다. 탭1에서 먼저 분배하세요.' });
    }

    // 엑셀 파일 생성
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fileName = custKey
      ? `출고_${week}_${custMap[custKey]?.name || custKey}.xlsx`
      : `출고_${week}_전체.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', buf.length);
    return res.status(200).send(Buffer.from(buf));

  } catch (err) {
    console.error('Excel download error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});
