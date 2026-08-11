/* 잔량분배 게시판 — 기준업체 CustKey 오연결 복구 (웹 전용 설정 원장)
   2026-08-11

   배경
   - 2026-08-10 자동 seed 가 이름만 비슷한 '신라상사'(CustKey 444)를 신라 그룹의 기준업체로
     넣었다. 444/445 는 OrderMaster/ShipmentMaster 가 생애 0건인 껍데기 거래처이고, 신라의
     실제 원장 거래처는 '신라호텔'(CustKey 446, OrderCode 'CLS', Descr '신라/…')이다.
   - 그 결과 2026-33차 등 모든 차수에서 신라 예상물량·현재분배·잔량이 전부 비었다.

   범위
   - 웹 전용 설정 테이블 dbo.WebShillaMiuBoardGroup 의 BaseCustKey/BaseCustName 만 고친다.
   - ERP 원장(Customer/Order*/Shipment*/Stock*/Estimate/WebProfitReport)은 읽기만 한다.
   - 웹 저장값(WebShillaMiuBoardAllocation)은 GroupKey 로 묶여 있어 그대로 따라간다.

   안전장치 (idempotent · 조건부)
   - 현재 기준 CustKey 가 해당 연도는 물론 생애 전체 주문·분배가 0건일 때만 바꾼다.
   - 바꿀 대상 CustKey 는 활성 Customer 이면서 실제 주문 실적이 있어야 한다.
   - 이미 올바른 CustKey 면 0행 갱신으로 끝난다. 여러 번 실행해도 안전하다.
   - 배포된 웹의 [업체관리] 화면에서 같은 작업을 사용자가 직접 할 수도 있다. */

SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.WebShillaMiuBoardGroup', N'U') IS NULL
BEGIN
  RAISERROR(N'먼저 2026-07-23_web_shilla_miu_board.sql 을 실행하세요.', 16, 1);
  RETURN;
END;

DECLARE @repair TABLE (GroupName NVARCHAR(100), WrongName NVARCHAR(200), RightName NVARCHAR(200));
INSERT @repair (GroupName, WrongName, RightName)
VALUES (N'신라', N'신라상사', N'신라호텔');

SELECT g.GroupKey, g.GroupName, g.BaseCustKey AS BeforeCustKey, g.BaseCustName AS BeforeCustName
  FROM dbo.WebShillaMiuBoardGroup g;  /* 변경 전 스냅샷 */

UPDATE g
   SET g.BaseCustKey  = t.CustKey,
       g.BaseCustName = t.CustName,
       g.UpdatedBy    = N'custkey-repair-20260811',
       g.UpdatedAt    = GETDATE()
  FROM dbo.WebShillaMiuBoardGroup g
  JOIN @repair r        ON r.GroupName = g.GroupName
  JOIN Customer wrong   ON wrong.CustKey = g.BaseCustKey AND wrong.CustName = r.WrongName
  JOIN Customer t       ON t.CustName = r.RightName AND ISNULL(t.isDeleted, 0) = 0
 WHERE g.IsActive = 1
   /* 잘못된 쪽은 생애 실적이 0건이어야 한다 */
   AND NOT EXISTS (SELECT 1 FROM OrderMaster om    WHERE om.CustKey = g.BaseCustKey)
   AND NOT EXISTS (SELECT 1 FROM ShipmentMaster sm WHERE sm.CustKey = g.BaseCustKey)
   /* 새로 연결할 쪽은 유일하고 실제 주문 실적이 있어야 한다 */
   AND (SELECT COUNT(*) FROM Customer x WHERE x.CustName = r.RightName AND ISNULL(x.isDeleted, 0) = 0) = 1
   AND EXISTS (SELECT 1 FROM OrderMaster om WHERE om.CustKey = t.CustKey AND ISNULL(om.isDeleted, 0) = 0)
   /* 다른 활성 그룹이 이미 그 CustKey 를 쓰고 있으면 건드리지 않는다(UX_…_BaseActive) */
   AND NOT EXISTS (SELECT 1 FROM dbo.WebShillaMiuBoardGroup x
                    WHERE x.IsActive = 1 AND x.BaseCustKey = t.CustKey AND x.GroupKey <> g.GroupKey);

SELECT g.GroupKey, g.GroupName, g.BaseCustKey AS AfterCustKey, g.BaseCustName AS AfterCustName,
       g.ReceiverCustKey, g.ReceiverCustName, g.IsActive, g.UpdatedBy, g.UpdatedAt
  FROM dbo.WebShillaMiuBoardGroup g
 ORDER BY g.DisplayOrder, g.GroupKey;  /* 변경 후 확인 */
