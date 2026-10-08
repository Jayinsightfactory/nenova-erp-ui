/* 지출결의서·전표 1단계 — 웹 전용 테이블 (idempotent, SSMS 수동 실행)
   관찰 명세: nenova-work-features/observed/_kmh-ecount-spec.md §6 전표·회계거래, §7 지급·지출결의서, §11 입력화면
   ERP 공유 테이블(OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/Customer 등)은 변경하지 않는다.
   CustKey 는 ERP Customer 참조값만 저장(FK 없음). 이카운트에는 어떤 쓰기도 하지 않는다.

   테이블
   - dbo.WebAccount        계정과목 (코드·이름·구분 자산/부채/자본/수익/비용·활성) + 표준 시드
   - dbo.WebVoucher        결의서 헤더 (VoucherNo 'yy/mm/dd-n', 유형 지출/지급/급여, 상태 작성/결재완료/송금완료/전표반영/취소)
   - dbo.WebVoucherLine    결의서 라인 (계정코드·금액·외화금액·적요·부서·차수 OrderYearWeek 문자열)
   - dbo.WebJournal        전표 헤더 (차변합=대변합은 앱 검증, 확정 후 수정 불가, 취소=역분개 ReversalOfKey)
   - dbo.WebJournalLine    전표 라인 (DR/CR)
*/
SET NOCOUNT ON;

-- 1) 계정과목 --------------------------------------------------------------
IF OBJECT_ID(N'dbo.WebAccount', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebAccount (
    AccountCode NVARCHAR(10) NOT NULL,
    AccountName NVARCHAR(60) NOT NULL,
    AccountClass NVARCHAR(10) NOT NULL,            -- 자산/부채/자본/수익/비용
    IsActive BIT NOT NULL CONSTRAINT DF_WebAccount_IsActive DEFAULT 1,
    SortOrder INT NOT NULL CONSTRAINT DF_WebAccount_SortOrder DEFAULT 0,
    CreateDtm DATETIME NOT NULL CONSTRAINT DF_WebAccount_CreateDtm DEFAULT GETDATE(),
    UpdateDtm DATETIME NOT NULL CONSTRAINT DF_WebAccount_UpdateDtm DEFAULT GETDATE(),
    CONSTRAINT PK_WebAccount PRIMARY KEY (AccountCode),
    CONSTRAINT CK_WebAccount_Class CHECK (AccountClass IN (N'자산', N'부채', N'자본', N'수익', N'비용'))
  );
END;

-- 2) 결의서 헤더 -----------------------------------------------------------
IF OBJECT_ID(N'dbo.WebVoucher', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebVoucher (
    VoucherKey INT IDENTITY(1,1) NOT NULL,
    VoucherNo NVARCHAR(16) NOT NULL,               -- 'yy/mm/dd-n'
    VoucherType NVARCHAR(10) NOT NULL,             -- 지출/지급/급여
    VoucherDate DATE NOT NULL,
    FiscalYear INT NOT NULL,
    CustKey INT NULL,                              -- ERP Customer.CustKey 참조값(FK 없음)
    CustName NVARCHAR(100) NULL,                   -- 작성 시점 거래처명 스냅샷
    Period NVARCHAR(30) NULL,                      -- 기간(예: 2026/08, 2026/09/01~09/12)
    Manager NVARCHAR(50) NULL,                     -- 담당자명
    EmployeeName NVARCHAR(50) NULL,                -- 급여 결의서 직원명
    FundCode NVARCHAR(20) NULL,                    -- 자금결의서코드(지급결의서)
    Currency NVARCHAR(10) NOT NULL CONSTRAINT DF_WebVoucher_Currency DEFAULT N'KRW',
    FxRate DECIMAL(18,6) NOT NULL CONSTRAINT DF_WebVoucher_FxRate DEFAULT 1,
    TotalAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_WebVoucher_TotalAmount DEFAULT 0,
    TotalForeign DECIMAL(18,2) NOT NULL CONSTRAINT DF_WebVoucher_TotalForeign DEFAULT 0,
    Status NVARCHAR(10) NOT NULL CONSTRAINT DF_WebVoucher_Status DEFAULT N'작성',
    AttachUrl NVARCHAR(500) NULL,
    Memo NVARCHAR(400) NULL,
    JournalKey INT NULL,                           -- 결재완료 시 자동생성된 전표
    ApproveDtm DATETIME NULL,
    RemitDtm DATETIME NULL,
    PostDtm DATETIME NULL,
    isDeleted BIT NOT NULL CONSTRAINT DF_WebVoucher_isDeleted DEFAULT 0,
    CreateID NVARCHAR(50) NOT NULL,
    CreateDtm DATETIME NOT NULL CONSTRAINT DF_WebVoucher_CreateDtm DEFAULT GETDATE(),
    UpdateID NVARCHAR(50) NOT NULL,
    UpdateDtm DATETIME NOT NULL CONSTRAINT DF_WebVoucher_UpdateDtm DEFAULT GETDATE(),
    CONSTRAINT PK_WebVoucher PRIMARY KEY (VoucherKey),
    CONSTRAINT UQ_WebVoucher_No UNIQUE (VoucherNo),
    CONSTRAINT CK_WebVoucher_Type CHECK (VoucherType IN (N'지출', N'지급', N'급여')),
    CONSTRAINT CK_WebVoucher_Status CHECK (Status IN (N'작성', N'결재완료', N'송금완료', N'전표반영', N'취소'))
  );
  CREATE INDEX IX_WebVoucher_Date ON dbo.WebVoucher (VoucherDate DESC, VoucherKey DESC);
  CREATE INDEX IX_WebVoucher_Cust ON dbo.WebVoucher (CustKey, VoucherDate DESC);
END;

-- 3) 결의서 라인 -----------------------------------------------------------
IF OBJECT_ID(N'dbo.WebVoucherLine', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebVoucherLine (
    LineKey INT IDENTITY(1,1) NOT NULL,
    VoucherKey INT NOT NULL,
    LineNo INT NOT NULL,
    AccountCode NVARCHAR(10) NOT NULL,
    Amount DECIMAL(18,2) NOT NULL CONSTRAINT DF_WebVoucherLine_Amount DEFAULT 0,       -- 원화
    ForeignAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_WebVoucherLine_Foreign DEFAULT 0, -- 외화
    Descr NVARCHAR(200) NULL,
    Dept NVARCHAR(50) NULL,
    OrderYearWeek NVARCHAR(12) NULL,               -- 차수 문자열(예: 202638, 38-2) — ERP 조인 없음
    CONSTRAINT PK_WebVoucherLine PRIMARY KEY (LineKey),
    CONSTRAINT FK_WebVoucherLine_Voucher FOREIGN KEY (VoucherKey) REFERENCES dbo.WebVoucher (VoucherKey)
  );
  CREATE INDEX IX_WebVoucherLine_Voucher ON dbo.WebVoucherLine (VoucherKey, LineNo);
END;

-- 4) 전표 헤더 -------------------------------------------------------------
IF OBJECT_ID(N'dbo.WebJournal', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebJournal (
    JournalKey INT IDENTITY(1,1) NOT NULL,
    JournalNo NVARCHAR(16) NOT NULL,               -- 'yy/mm/dd-n' (전표 자체 채번)
    JournalDate DATE NOT NULL,
    JournalType NVARCHAR(20) NOT NULL,             -- 지출결의서/지급결의서/급여결의서/역분개
    VoucherKey INT NULL,                           -- 원천 결의서
    CustKey INT NULL,
    CustName NVARCHAR(100) NULL,
    Descr NVARCHAR(200) NULL,
    TotalDebit DECIMAL(18,2) NOT NULL CONSTRAINT DF_WebJournal_Debit DEFAULT 0,
    TotalCredit DECIMAL(18,2) NOT NULL CONSTRAINT DF_WebJournal_Credit DEFAULT 0,
    Status NVARCHAR(10) NOT NULL CONSTRAINT DF_WebJournal_Status DEFAULT N'작성',   -- 작성/확정/취소
    ReversalOfKey INT NULL,                        -- 이 전표가 역분개한 원전표
    ReversedByKey INT NULL,                        -- 이 전표를 역분개한 전표
    IsClosed BIT NOT NULL CONSTRAINT DF_WebJournal_IsClosed DEFAULT 0,  -- 마감 여부
    ConfirmDtm DATETIME NULL,
    CreateID NVARCHAR(50) NOT NULL,
    CreateDtm DATETIME NOT NULL CONSTRAINT DF_WebJournal_CreateDtm DEFAULT GETDATE(),
    UpdateID NVARCHAR(50) NOT NULL,
    UpdateDtm DATETIME NOT NULL CONSTRAINT DF_WebJournal_UpdateDtm DEFAULT GETDATE(),
    CONSTRAINT PK_WebJournal PRIMARY KEY (JournalKey),
    CONSTRAINT UQ_WebJournal_No UNIQUE (JournalNo),
    CONSTRAINT CK_WebJournal_Status CHECK (Status IN (N'작성', N'확정', N'취소'))
  );
  CREATE INDEX IX_WebJournal_Date ON dbo.WebJournal (JournalDate DESC, JournalKey DESC);
  CREATE INDEX IX_WebJournal_Voucher ON dbo.WebJournal (VoucherKey);
END;

-- 5) 전표 라인 -------------------------------------------------------------
IF OBJECT_ID(N'dbo.WebJournalLine', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebJournalLine (
    LineKey INT IDENTITY(1,1) NOT NULL,
    JournalKey INT NOT NULL,
    LineNo INT NOT NULL,
    Side NCHAR(2) NOT NULL,                        -- DR(차변)/CR(대변)
    AccountCode NVARCHAR(10) NOT NULL,
    Amount DECIMAL(18,2) NOT NULL,
    Descr NVARCHAR(200) NULL,
    Dept NVARCHAR(50) NULL,
    OrderYearWeek NVARCHAR(12) NULL,
    CONSTRAINT PK_WebJournalLine PRIMARY KEY (LineKey),
    CONSTRAINT FK_WebJournalLine_Journal FOREIGN KEY (JournalKey) REFERENCES dbo.WebJournal (JournalKey),
    CONSTRAINT CK_WebJournalLine_Side CHECK (Side IN (N'DR', N'CR')),
    CONSTRAINT CK_WebJournalLine_Amount CHECK (Amount > 0)
  );
  CREATE INDEX IX_WebJournalLine_Journal ON dbo.WebJournalLine (JournalKey, LineNo);
  CREATE INDEX IX_WebJournalLine_Account ON dbo.WebJournalLine (AccountCode);
END;

-- 6) 표준 계정과목 시드 (일반기업회계기준 관행 코드) — 있으면 건너뜀 ---------
DECLARE @seed TABLE (Code NVARCHAR(10), Name NVARCHAR(60), Class NVARCHAR(10), Ord INT);
INSERT INTO @seed (Code, Name, Class, Ord) VALUES
  -- 자산
  (N'101', N'현금', N'자산', 101), (N'102', N'당좌예금', N'자산', 102), (N'103', N'보통예금', N'자산', 103),
  (N'104', N'정기예금', N'자산', 104), (N'105', N'정기적금', N'자산', 105), (N'106', N'외화예금', N'자산', 106),
  (N'107', N'단기매매증권', N'자산', 107), (N'108', N'외상매출금', N'자산', 108), (N'109', N'대손충당금(외상매출금)', N'자산', 109),
  (N'110', N'받을어음', N'자산', 110), (N'114', N'단기대여금', N'자산', 114), (N'116', N'미수수익', N'자산', 116),
  (N'120', N'미수금', N'자산', 120), (N'131', N'선급금', N'자산', 131), (N'133', N'선급비용', N'자산', 133),
  (N'134', N'가지급금', N'자산', 134), (N'135', N'부가세대급금', N'자산', 135), (N'136', N'선납세금', N'자산', 136),
  (N'146', N'상품', N'자산', 146), (N'150', N'제품', N'자산', 150), (N'153', N'원재료', N'자산', 153),
  (N'154', N'미착품', N'자산', 154), (N'179', N'장기대여금', N'자산', 179), (N'201', N'토지', N'자산', 201),
  (N'202', N'건물', N'자산', 202), (N'206', N'기계장치', N'자산', 206), (N'208', N'차량운반구', N'자산', 208),
  (N'212', N'비품', N'자산', 212), (N'214', N'건설중인자산', N'자산', 214), (N'232', N'임차보증금', N'자산', 232),
  (N'240', N'소프트웨어', N'자산', 240),
  -- 부채
  (N'251', N'외상매입금', N'부채', 251), (N'252', N'지급어음', N'부채', 252), (N'253', N'미지급금', N'부채', 253),
  (N'254', N'예수금', N'부채', 254), (N'255', N'부가세예수금', N'부채', 255), (N'257', N'가수금', N'부채', 257),
  (N'259', N'선수금', N'부채', 259), (N'260', N'단기차입금', N'부채', 260), (N'261', N'미지급세금', N'부채', 261),
  (N'262', N'미지급비용', N'부채', 262), (N'263', N'선수수익', N'부채', 263), (N'264', N'유동성장기부채', N'부채', 264),
  (N'293', N'장기차입금', N'부채', 293), (N'295', N'퇴직급여충당부채', N'부채', 295),
  -- 자본
  (N'331', N'자본금', N'자본', 331), (N'341', N'주식발행초과금', N'자본', 341), (N'375', N'이월이익잉여금', N'자본', 375),
  -- 수익
  (N'401', N'상품매출', N'수익', 401), (N'404', N'제품매출', N'수익', 404), (N'411', N'용역매출', N'수익', 411),
  (N'901', N'이자수익', N'수익', 901), (N'903', N'배당금수익', N'수익', 903), (N'904', N'임대료', N'수익', 904),
  (N'907', N'외환차익', N'수익', 907), (N'910', N'외화환산이익', N'수익', 910), (N'930', N'잡이익', N'수익', 930),
  (N'914', N'유형자산처분이익', N'수익', 914),
  -- 비용
  (N'451', N'상품매입', N'비용', 451), (N'501', N'원재료매입', N'비용', 501), (N'455', N'매입운임', N'비용', 455),
  (N'456', N'관세', N'비용', 456), (N'457', N'통관수수료', N'비용', 457),
  (N'801', N'임원급여', N'비용', 801), (N'802', N'급여', N'비용', 802), (N'803', N'상여금', N'비용', 803),
  (N'806', N'퇴직급여', N'비용', 806), (N'811', N'복리후생비', N'비용', 811), (N'812', N'여비교통비', N'비용', 812),
  (N'813', N'접대비', N'비용', 813), (N'814', N'통신비', N'비용', 814), (N'815', N'수도광열비', N'비용', 815),
  (N'816', N'전력비', N'비용', 816), (N'817', N'세금과공과', N'비용', 817), (N'818', N'감가상각비', N'비용', 818),
  (N'819', N'임차료', N'비용', 819), (N'820', N'수선비', N'비용', 820), (N'821', N'보험료', N'비용', 821),
  (N'822', N'차량유지비', N'비용', 822), (N'824', N'운반비', N'비용', 824), (N'825', N'교육훈련비', N'비용', 825),
  (N'826', N'도서인쇄비', N'비용', 826), (N'829', N'사무용품비', N'비용', 829), (N'830', N'소모품비', N'비용', 830),
  (N'831', N'지급수수료', N'비용', 831), (N'833', N'광고선전비', N'비용', 833), (N'835', N'대손상각비', N'비용', 835),
  (N'837', N'건물관리비', N'비용', 837), (N'840', N'무형자산상각비', N'비용', 840), (N'848', N'잡비', N'비용', 848),
  (N'931', N'이자비용', N'비용', 931), (N'952', N'외환차손', N'비용', 952), (N'955', N'외화환산손실', N'비용', 955),
  (N'956', N'매출채권처분손실', N'비용', 956), (N'961', N'기부금', N'비용', 961), (N'970', N'유형자산처분손실', N'비용', 970),
  (N'980', N'잡손실', N'비용', 980), (N'998', N'법인세등', N'비용', 998);

INSERT INTO dbo.WebAccount (AccountCode, AccountName, AccountClass, IsActive, SortOrder)
SELECT s.Code, s.Name, s.Class, 1, s.Ord
  FROM @seed s
 WHERE NOT EXISTS (SELECT 1 FROM dbo.WebAccount a WHERE a.AccountCode = s.Code);

SELECT (SELECT COUNT(*) FROM dbo.WebAccount) AS WebAccountCount,
       OBJECT_ID(N'dbo.WebVoucher') AS WebVoucher, OBJECT_ID(N'dbo.WebVoucherLine') AS WebVoucherLine,
       OBJECT_ID(N'dbo.WebJournal') AS WebJournal, OBJECT_ID(N'dbo.WebJournalLine') AS WebJournalLine;
