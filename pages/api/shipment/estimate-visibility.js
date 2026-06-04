// pages/api/shipment/estimate-visibility.js — 견적서관리 노출 여부 진단 (읽기 전용)
//
//  dnSpy(FormEstimateView.GetData/GetDetail) 분석: 확정 출고가 견적서관리에 뜨려면 아래 INNER JOIN 을
//  모두 통과해야 한다. 하나라도 실패하면 그 품목이 견적에서 사라진다.
//   - ViewShipment: ShipmentMaster.isDeleted=0, Product.isDeleted=0, Customer.isDeleted=0
//   - ViewOrder:    Country(p.CounName 가 Country 테이블에 존재), UserInfo(om.Manager 가 UserID 로 존재)
//   - ShipmentDate 행 존재 + 그 ShipmentDtm 이 PeriodDay.BaseYmd 에 등록
//
//  GET ?week=23-01&q=호접난   (q=품목/국가/품종/업체 키워드)
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  const week = normalizeOrderWeek(req.query.week || '');
  const q = String(req.query.q || '').trim();
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  if (!q) return res.status(400).json({ success: false, error: '검색어(품목/국가/업체) 필요' });

  try {
    const r = await query(
      `SELECT TOP 200
              c.CustName, p.ProdName, p.CounName, p.FlowerName, p.CountryFlower,
              ISNULL(p.isDeleted,0) AS ProdDel, ISNULL(c.isDeleted,0) AS CustDel,
              ISNULL(sm.isDeleted,0) AS SmDel, ISNULL(sm.isFix,0) AS SmFix,
              sd.OutQuantity, sd.EstQuantity, sd.SdetailKey,
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipDtm,
              om.Manager,
              CASE WHEN ct.CounName IS NULL THEN 0 ELSE 1 END AS CountryOK,
              CASE WHEN om.OrderMasterKey IS NULL THEN 0 ELSE 1 END AS OrderOK,
              CASE WHEN ui.UserID IS NULL THEN 0 ELSE 1 END AS ManagerOK,
              (SELECT COUNT(*) FROM ShipmentDate sdt WHERE sdt.SdetailKey=sd.SdetailKey) AS ShipDateCnt,
              -- 전산 견적은 sdd.ShipmentDtm = pd.BaseYmd 정확(시각 포함) 매칭. 날짜만 맞고 시각 다르면 탈락.
              (SELECT COUNT(*) FROM ShipmentDate sdt JOIN PeriodDay pd ON pd.BaseYmd = sdt.ShipmentDtm
                 WHERE sdt.SdetailKey=sd.SdetailKey) AS PeriodExactCnt,
              (SELECT COUNT(*) FROM ShipmentDate sdt JOIN PeriodDay pd ON CONVERT(date,pd.BaseYmd)=CONVERT(date,sdt.ShipmentDtm)
                 WHERE sdt.SdetailKey=sd.SdetailKey) AS PeriodDateCnt,
              (SELECT TOP 1 CONVERT(NVARCHAR(30), sdt.ShipmentDtm, 121) FROM ShipmentDate sdt WHERE sdt.SdetailKey=sd.SdetailKey) AS ShipDateRaw,
              (SELECT TOP 1 CONVERT(NVARCHAR(30), pd.BaseYmd, 121) FROM PeriodDay pd WHERE CONVERT(date,pd.BaseYmd)=CONVERT(date,sd.ShipmentDtm)) AS PeriodRaw
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         JOIN Product p ON p.ProdKey=sd.ProdKey
         JOIN Customer c ON c.CustKey=sm.CustKey
         LEFT JOIN Country ct ON p.CounName=ct.CounName
         OUTER APPLY (
            SELECT TOP 1 om.OrderMasterKey, om.Manager
              FROM OrderMaster om
             WHERE om.CustKey=sm.CustKey AND om.OrderWeek=sm.OrderWeek AND ISNULL(om.isDeleted,0)=0
             ORDER BY om.OrderMasterKey ASC
         ) om
         LEFT JOIN UserInfo ui ON om.Manager=ui.UserID
        WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
          AND ( p.ProdName LIKE @q OR ISNULL(p.CounName,'') LIKE @q
                OR ISNULL(p.FlowerName,'') LIKE @q OR c.CustName LIKE @q )
        ORDER BY p.CounName, p.ProdName, c.CustName`,
      { wk: { type: sql.NVarChar, value: week }, q: { type: sql.NVarChar, value: `%${q}%` } }
    );

    const rows = (r.recordset || []).map(x => {
      const reasons = [];
      if (Number(x.SmDel) === 1) reasons.push('출고마스터 삭제(isDeleted=1)');
      if (Number(x.ProdDel) === 1) reasons.push('품목 삭제(isDeleted=1)');
      if (Number(x.CustDel) === 1) reasons.push('업체 삭제(isDeleted=1)');
      if (Number(x.CountryOK) === 0) reasons.push(`국가 '${x.CounName || '(빈값)'}' 가 Country 테이블에 없음`);
      if (Number(x.OrderOK) === 0) reasons.push('해당 업체/차수 주문(OrderMaster)이 없음');
      else if (Number(x.ManagerOK) === 0) reasons.push(`주문 Manager '${x.Manager || '(빈값)'}' 가 UserInfo.UserID 에 없음`);
      if (Number(x.ShipDateCnt) === 0) reasons.push('ShipmentDate 행 없음');
      else if (Number(x.PeriodExactCnt) === 0) {
        if (Number(x.PeriodDateCnt) > 0) {
          reasons.push(`출고일 시각 불일치: ShipmentDate=${x.ShipDateRaw} vs PeriodDay=${x.PeriodRaw} (전산은 정확매칭 → 견적 탈락)`);
        } else {
          reasons.push(`출고일 '${x.ShipDtm}' 이 PeriodDay(영업일)에 없음`);
        }
      }
      const visible = reasons.length === 0;
      return {
        custName: x.CustName, prodName: x.ProdName, counName: x.CounName, flowerName: x.FlowerName,
        outQty: Number(x.OutQuantity || 0), estQty: Number(x.EstQuantity || 0),
        shipDtm: x.ShipDtm, isFix: Number(x.SmFix), sdetailKey: x.SdetailKey,
        countryOK: Number(x.CountryOK) === 1, managerOK: Number(x.ManagerOK) === 1,
        shipDateCnt: Number(x.ShipDateCnt),
        periodExactCnt: Number(x.PeriodExactCnt), periodDateCnt: Number(x.PeriodDateCnt),
        shipDateRaw: x.ShipDateRaw, periodRaw: x.PeriodRaw,
        manager: x.Manager,
        visibleInEstimate: visible,
        reason: visible ? '정상(견적 노출)' : reasons.join(' / '),
      };
    });

    // 국가 마스터에 있는지 빠른 참조(중복 국가)
    const countries = await query(`SELECT CounName FROM Country ORDER BY CounName`, {});
    const countryList = (countries.recordset || []).map(c => c.CounName);

    return res.status(200).json({
      success: true, week, q,
      count: rows.length,
      hiddenCount: rows.filter(x => !x.visibleInEstimate).length,
      rows,
      countryHas베트남: countryList.some(c => String(c).includes('베트남') || /vietnam/i.test(String(c))),
      countryList,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(handler);
