IF OBJECT_ID(N'dbo.WebPreShipmentPlan', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebPreShipmentPlan (
    PlanKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    OrderYear CHAR(4) NOT NULL,
    MajorWeek TINYINT NOT NULL,
    CustomerName NVARCHAR(100) NOT NULL CONSTRAINT DF_WebPreShipmentPlan_Customer DEFAULT N'주광',
    SourceFileName NVARCHAR(260) NULL,
    SourceSheetName NVARCHAR(200) NULL,
    SourceSheetMajor TINYINT NULL,
    CreatedBy NVARCHAR(100) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_WebPreShipmentPlan_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy NVARCHAR(100) NULL,
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_WebPreShipmentPlan_UpdatedAt DEFAULT SYSDATETIME(),
    isDeleted BIT NOT NULL CONSTRAINT DF_WebPreShipmentPlan_Deleted DEFAULT 0
  );
  CREATE INDEX IX_WebPreShipmentPlan_Scope ON dbo.WebPreShipmentPlan(OrderYear, MajorWeek, isDeleted);
END;

IF OBJECT_ID(N'dbo.WebPreShipmentItem', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebPreShipmentItem (
    ItemKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    PlanKey INT NOT NULL,
    SpeciesName NVARCHAR(100) NOT NULL,
    ItemName NVARCHAR(200) NOT NULL,
    OrderBoxQty DECIMAL(18,4) NOT NULL CONSTRAINT DF_WebPreShipmentItem_Box DEFAULT 0,
    OrderUnitQty DECIMAL(18,4) NOT NULL CONSTRAINT DF_WebPreShipmentItem_Unit DEFAULT 0,
    BusanWilsonQty DECIMAL(18,4) NOT NULL CONSTRAINT DF_WebPreShipmentItem_Wilson DEFAULT 0,
    Memo NVARCHAR(500) NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_WebPreShipmentItem_Sort DEFAULT 0,
    CONSTRAINT FK_WebPreShipmentItem_Plan FOREIGN KEY (PlanKey) REFERENCES dbo.WebPreShipmentPlan(PlanKey)
  );
  CREATE INDEX IX_WebPreShipmentItem_Plan ON dbo.WebPreShipmentItem(PlanKey, SortOrder);
END;

IF OBJECT_ID(N'dbo.WebPreShipmentSchedule', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebPreShipmentSchedule (
    ScheduleKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    PlanKey INT NOT NULL,
    ShipmentDate DATE NULL,
    DayLabel NVARCHAR(100) NOT NULL,
    TargetOrderYear CHAR(4) NULL,
    TargetMajorWeek TINYINT NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_WebPreShipmentSchedule_Sort DEFAULT 0,
    UpdatedBy NVARCHAR(100) NULL,
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_WebPreShipmentSchedule_UpdatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_WebPreShipmentSchedule_Plan FOREIGN KEY (PlanKey) REFERENCES dbo.WebPreShipmentPlan(PlanKey)
  );
  CREATE INDEX IX_WebPreShipmentSchedule_Plan ON dbo.WebPreShipmentSchedule(PlanKey, SortOrder);
END;

IF OBJECT_ID(N'dbo.WebPreShipmentAllocation', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebPreShipmentAllocation (
    AllocationKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ScheduleKey INT NOT NULL,
    ItemKey INT NOT NULL,
    Quantity DECIMAL(18,4) NOT NULL CONSTRAINT DF_WebPreShipmentAllocation_Qty DEFAULT 0,
    UpdatedBy NVARCHAR(100) NULL,
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_WebPreShipmentAllocation_UpdatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_WebPreShipmentAllocation_Schedule FOREIGN KEY (ScheduleKey) REFERENCES dbo.WebPreShipmentSchedule(ScheduleKey),
    CONSTRAINT FK_WebPreShipmentAllocation_Item FOREIGN KEY (ItemKey) REFERENCES dbo.WebPreShipmentItem(ItemKey),
    CONSTRAINT UX_WebPreShipmentAllocation UNIQUE (ScheduleKey, ItemKey)
  );
END;

