-- ============================================================================
-- 2026-05-04  ShipmentAdjustment table (audit log for ADD/CANCEL operations)
-- SSMS: open this file and press F5. Idempotent: safe to re-run.
--
-- Purpose:
--   Existing flow lets users freely edit ShipmentDetail.OutQuantity, which
--   loses the intent (was it a new order or a cancellation?) and breaks the
--   OrderDetail / ShipmentDetail relationship over time.
--
--   This table records every change as one of two atomic actions:
--     ADD    : OrderDetail += qty  AND ShipmentDetail += qty
--     CANCEL : OrderDetail unchanged, ShipmentDetail -= qty
--
--   It mirrors the format the owner already writes by hand in the
--   carnation volume table (cell example):
--     kkotgil 9>8 (2), maeil 2>3 (1), taerim 23>24 (0) / (1>0)
--
--   Each line = one row in this table; the trailing / (start>end)
--   comes from the per-product remain at the time the row was inserted.
-- ============================================================================

IF OBJECT_ID(''ShipmentAdjustment'',''U'') IS NULL
BEGIN
  CREATE TABLE ShipmentAdjustment (
    AdjKey          INT IDENTITY(1,1) PRIMARY KEY,
    OrderYear       NVARCHAR(4)   NOT NULL,
    OrderWeek       NVARCHAR(10)  NOT NULL,
    ProdKey         INT           NOT NULL,
    CustKey         INT           NOT NULL,
    AdjType         NVARCHAR(10)  NOT NULL,
    QtyDelta        DECIMAL(14,3) NOT NULL,
    QtyBefore       DECIMAL(14,3) NOT NULL,
    QtyAfter        DECIMAL(14,3) NOT NULL,
    OrderQtyBefore  DECIMAL(14,3) NULL,
    OrderQtyAfter   DECIMAL(14,3) NULL,
    RemainBefore    DECIMAL(14,3) NULL,
    RemainAfter     DECIMAL(14,3) NULL,
    Memo            NVARCHAR(200) NULL,
    CreateID        NVARCHAR(50)  NULL,
    CreateDtm       DATETIME      NOT NULL DEFAULT GETDATE(),
    CONSTRAINT CK_ShipmentAdj_Type    CHECK (AdjType IN (''ADD'',''CANCEL'')),
    CONSTRAINT CK_ShipmentAdj_Delta   CHECK (QtyDelta > 0),
    CONSTRAINT FK_ShipmentAdj_Prod    FOREIGN KEY (ProdKey) REFERENCES Product(ProdKey),
    CONSTRAINT FK_ShipmentAdj_Cust    FOREIGN KEY (CustKey) REFERENCES Customer(CustKey)
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=''IX_ShipAdj_Week_Prod_Time'')
  CREATE INDEX IX_ShipAdj_Week_Prod_Time
  ON ShipmentAdjustment(OrderYear, OrderWeek, ProdKey, CreateDtm);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=''IX_ShipAdj_Week_Cust_Time'')
  CREATE INDEX IX_ShipAdj_Week_Cust_Time
  ON ShipmentAdjustment(OrderYear, OrderWeek, CustKey, CreateDtm);
