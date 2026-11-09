// lib/erpChangeLog.js — Orbit 업무 기록(nenova.exe 저장 동작)과 실제 전산 변경을 시각·사용자로 대조하기 위한 읽기 전용 변경 로그.
export const ERP_CHANGE_LOG_MAX_ROWS = 5000;
export const ERP_CHANGE_LOG_MAX_WINDOW_MS = 26 * 60 * 60 * 1000;

const DT_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

// 'YYYY-MM-DD HH:MM:SS' (KST 벽시계) → 서버 시간대와 무관한 Date(로컬 해석). 형식 오류는 null.
export function parseKstDatetime(value) {
  if (typeof value !== 'string') return null;
  const m = DT_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d
    || date.getHours() !== h || date.getMinutes() !== mi || date.getSeconds() !== s) return null;
  return date;
}

export function validateChangeLogRequest(queryParams = {}) {
  const since = parseKstDatetime(queryParams.since);
  const until = parseKstDatetime(queryParams.until);
  if (!since || !until) throw new Error('since, until은 YYYY-MM-DD HH:MM:SS 형식이어야 합니다.');
  const span = until.getTime() - since.getTime();
  if (span <= 0) throw new Error('until은 since보다 뒤여야 합니다.');
  if (span > ERP_CHANGE_LOG_MAX_WINDOW_MS) throw new Error('조회 구간은 26시간 이하여야 합니다.');
  // DB 는 KST 벽시계 DATETIME — Date 로 넘기면 드라이버가 UTC 변환해 9시간 어긋난다. 문자열로 넘겨 SQL 에서 CONVERT.
  const text = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  return { since, until, sinceText: text(since), untilText: text(until) };
}

export const erpChangeLogSql = `
SELECT * FROM (
  SELECT 'order' AS kind, oh.ChangeDtm AS sortDtm,
    CONVERT(NVARCHAR(19), oh.ChangeDtm, 120) AS ts,
    oh.ChangeID AS changeId, om.OrderYear AS [year], om.OrderWeek AS [week],
    c.CustName AS cust, p.CounName AS country, p.FlowerName AS flower, p.ProdName AS prod,
    oh.ChangeType AS changeType, oh.ColumName AS [column],
    oh.BeforeValue AS [before], oh.AfterValue AS [after], oh.Descr AS descr
  FROM OrderHistory oh
  JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
  JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
  LEFT JOIN Customer c ON om.CustKey = c.CustKey
  LEFT JOIN Product p ON od.ProdKey = p.ProdKey
  WHERE oh.ChangeDtm >= CONVERT(DATETIME, @since, 120) AND oh.ChangeDtm < CONVERT(DATETIME, @until, 120)
  UNION ALL
  SELECT 'shipment' AS kind, sh.ChangeDtm AS sortDtm,
    CONVERT(NVARCHAR(19), sh.ChangeDtm, 120) AS ts,
    sh.ChangeID AS changeId, sm.OrderYear AS [year], sm.OrderWeek AS [week],
    c.CustName AS cust, p.CounName AS country, p.FlowerName AS flower, p.ProdName AS prod,
    sh.ChangeType AS changeType, NULL AS [column],
    sh.BeforeValue AS [before], sh.AfterValue AS [after], sh.Descr AS descr
  FROM ShipmentHistory sh
  LEFT JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
  LEFT JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
  LEFT JOIN Customer c ON sd.CustKey = c.CustKey
  LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
  WHERE sh.ChangeDtm >= CONVERT(DATETIME, @since, 120) AND sh.ChangeDtm < CONVERT(DATETIME, @until, 120)
  UNION ALL
  -- 입고 등록(헤더 1건 = 업로드 1회). 거래처 자리에 농장, 품목 자리에 인보이스 번호. 이력 테이블이 없어 생성 기록만.
  SELECT 'warehouse' AS kind, wm.CreateDtm AS sortDtm,
    CONVERT(NVARCHAR(19), wm.CreateDtm, 120) AS ts,
    wm.CreateID AS changeId, wm.OrderYear AS [year], wm.OrderWeek AS [week],
    wm.FarmName AS cust, NULL AS country, NULL AS flower, wm.InvoiceNo AS prod,
    N'입고 등록' AS changeType, NULL AS [column],
    NULL AS [before], NULL AS [after], wm.FileName AS descr
  FROM WarehouseMaster wm
  WHERE wm.CreateDtm >= CONVERT(DATETIME, @since, 120) AND wm.CreateDtm < CONVERT(DATETIME, @until, 120)
) t
ORDER BY t.sortDtm ASC
OFFSET 0 ROWS FETCH NEXT @take ROWS ONLY`;
