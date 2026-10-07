-- 2026-10-07 웹 전용: 비행 스케줄 카톡방 공지에서 파싱한 AWB별 선적 박스
-- API(/api/incoming/box-by-country)가 첫 호출 시 같은 DDL을 ensure 패턴으로 실행한다. 수동 실행도 idempotent.
-- ERP 원장(WarehouseMaster/Detail 등)은 변경하지 않는다.
IF OBJECT_ID(N'dbo.WebFlightScheduleBox', N'U') IS NULL
CREATE TABLE dbo.WebFlightScheduleBox (
  RowKey NVARCHAR(160) NOT NULL CONSTRAINT PK_WebFlightScheduleBox PRIMARY KEY, -- '{OrderYear}|AWB:{digits}' 또는 '{OrderYear}|NOAWB:{차수}|{국가}|{품목}|{표기}'
  OrderYear NVARCHAR(4) NOT NULL,
  OrderWeek NVARCHAR(10) NOT NULL,        -- 'NN-NN' (분할 A/B/C 합산 기준 차수)
  SubWeek NVARCHAR(12) NOT NULL DEFAULT N'', -- '16-2A' 등 카톡 표기
  Country NVARCHAR(30) NOT NULL,
  Item NVARCHAR(60) NOT NULL DEFAULT N'',  -- 카장/수국/홀렉스/덴파레/HENGGE ...
  AwbKey NVARCHAR(40) NOT NULL DEFAULT N'', -- 숫자만, 선행 0 제거
  AwbRaw NVARCHAR(60) NOT NULL DEFAULT N'',
  Flight NVARCHAR(20) NOT NULL DEFAULT N'',
  BoxQty INT NULL,                          -- 마지막 공지 박스
  ArrivalDate NVARCHAR(10) NOT NULL DEFAULT N'',
  ItemsJson NVARCHAR(1000) NOT NULL DEFAULT N'[]', -- 콜롬비아 '박스 카운트' 품목별 박스
  Flags NVARCHAR(500) NOT NULL DEFAULT N'',  -- 연착/박스변동/중복의심 사유
  IsDuplicate BIT NOT NULL DEFAULT 0,        -- 1이면 집계 제외(AWB 변경 재공지)
  IsEstimated BIT NOT NULL DEFAULT 0,        -- AWB 미기재 → 품목합 추정
  MentionCount INT NOT NULL DEFAULT 1,
  SourceFile NVARCHAR(255) NOT NULL DEFAULT N'',
  UpdateID NVARCHAR(50) NOT NULL,
  UpdateDtm DATETIME NOT NULL DEFAULT GETDATE()
);
