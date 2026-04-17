-- 농장 크레딧 테이블 (차수별 불량/크레딧 차감 관리)
CREATE TABLE FarmCredit (
    CreditKey       INT IDENTITY(1,1) PRIMARY KEY,
    FarmName        NVARCHAR(100) NOT NULL,
    OrderWeek       NVARCHAR(30)  NOT NULL,
    CreditUSD       DECIMAL(10,2) NOT NULL DEFAULT 0,
    Memo            NVARCHAR(500) NULL,
    CreateDtm       DATETIME      NOT NULL DEFAULT GETDATE(),
    UpdateDtm       DATETIME      NOT NULL DEFAULT GETDATE(),
    isDeleted       BIT           NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX UX_FarmCredit_Farm_Week ON FarmCredit(FarmName, OrderWeek) WHERE isDeleted = 0;
