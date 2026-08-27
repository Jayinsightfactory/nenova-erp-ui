/*
  NENOVA_STOCK_GATE_OWNER_V2 -- SQL Server 2016 SP1+ / compatibility level 130.
  MAIN-ONLY, NOT an application-startup migration. No business formula changes.

  BEFORE APPLY:
  - Back up current definitions. Drain EXE/web/jobs; require the singleton fully idle.
  - Main preflights VIEW DEFINITION, ALTER table/all six existing procedures,
    CREATE PROCEDURE + dbo schema authority for capability creation, and object
    extended-property updates. This script never grants permissions.
  - Disable/update ALL legacy skipStockCalc / no-argument Clear / raw clear callers.
    A queued ownerless Clear cannot be retained safely. Clear now raises an error;
    the state CHECK rejects the old raw UPDATE that leaves owner/pending metadata.
  - Run __tests__/stockGateOwnership.test.js --sql in the dedicated fixture DB.
  - On the SAME connection explicitly acknowledge:
      EXEC sys.sp_set_session_context
        @key=N'nenova_stock_gate_owner_migration', @value=1;
    Then execute this file as ONE batch (no GO, no outer transaction).

  API CONTRACT:
  - GateCapability must return ProtocolVersion=2, IsReady=1 before new quantity writes.
  - Atomic callers take GateKey=1 UPDLOCK,HOLDLOCK in fully idle state BEFORE data
    locks and retain that physical transaction through native product CALCs/verify.
    Native nested ROLLBACK aborts the entire caller: stop; do not continue/replay.
  - OwnerToken is acquire-specific NEWID, passed through SQL LOCAL variables.
    A rollback can restore an older token on the SAME SPID; SPID alone is not enough.
  - No reentrant RUN; no age/session-liveness based reclaim. WAIT_CALC is pending
    work, not an expiring lease. A different EXE connection may acquire it only
    for SAME year/week full-product CALC (@ProdKey=0). Failure preserves pending.
  - Orphan RUN requires main-controlled recovery with writers drained and actual
    commit state checked. A dead session might have committed before calling Leave.
  - Old GateClear is deliberately fail-closed. Do not apply the old gate installer
    or roll the application back to ownerless clear paths after this migration.

  Result: hashes of before/after native definitions, unchanged external signatures,
  and read-only capability. A source hash change after migration disables capability.
  This file does NOT execute any native shipment/stock business procedure.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF ISNULL(TRY_CONVERT(int, SESSION_CONTEXT(N'nenova_stock_gate_owner_migration')), 0) <> 1
  THROW 51060, 'STOCK_GATE_MIGRATION_REQUIRES_MAIN_ACK_AND_DRAIN', 1;
IF @@TRANCOUNT <> 0
  THROW 51060, 'STOCK_GATE_MIGRATION_REQUIRES_STANDALONE_BATCH', 1;
IF OBJECT_ID(N'dbo.NenovaStockWeekGate', N'U') IS NULL
  THROW 51060, 'STOCK_GATE_LEGACY_TABLE_REQUIRED', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @gateCount int, @busy int;
  SELECT @gateCount=COUNT(*), @busy=SUM(CASE WHEN GateKey <> '1' OR Mode IS NOT NULL
    OR Action IS NOT NULL OR OrderYear IS NOT NULL OR OrderWeek IS NOT NULL
    OR LockedAt IS NOT NULL THEN 1 ELSE 0 END)
    FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT);
  IF @gateCount <> 1 OR ISNULL(@busy,1) <> 0
    THROW 51060, 'STOCK_GATE_MIGRATION_REQUIRES_IDLE_SINGLETON_NO_PENDING_WORK', 1;

  CREATE TABLE #GateOwnerNative (
    Name sysname NOT NULL, ActionName nvarchar(20) NOT NULL,
    BeforeSql nvarchar(max) NULL, AfterSql nvarchar(max) NULL,
    BeforeHash varbinary(32) NULL, AfterHash varbinary(32) NULL,
    UsesAnsiNulls bit NULL, UsesQuotedIdentifier bit NULL
  );
  INSERT #GateOwnerNative(Name,ActionName)
    VALUES(N'usp_ShipmentFix',N'FIX'),(N'usp_ShipmentFixCancel',N'CANCEL'),
          (N'usp_StockCalculation',N'CALC');
  UPDATE n SET BeforeSql=m.definition, BeforeHash=HASHBYTES('SHA2_256',m.definition),
    UsesAnsiNulls=m.uses_ansi_nulls, UsesQuotedIdentifier=m.uses_quoted_identifier
    FROM #GateOwnerNative n
    LEFT JOIN sys.sql_modules m ON m.object_id=OBJECT_ID(N'dbo.'+n.Name,N'P');
  IF EXISTS(SELECT 1 FROM #GateOwnerNative WHERE BeforeSql IS NULL)
    THROW 51060, 'STOCK_GATE_NATIVE_DEFINITION_MISSING_OR_NOT_VISIBLE', 1;

  SELECT o.name AS ProcedureName,p.parameter_id,p.name AS ParameterName,
         p.system_type_id,p.user_type_id,p.max_length,p.precision,p.scale,
         p.is_output,p.is_readonly
    INTO #GateOwnerParameters
    FROM sys.parameters p JOIN sys.objects o ON o.object_id=p.object_id
    JOIN #GateOwnerNative n ON o.object_id=OBJECT_ID(N'dbo.'+n.Name,N'P');

  DECLARE @v2Count int;
  SELECT @v2Count=COUNT(*) FROM #GateOwnerNative
    WHERE BeforeSql LIKE N'%NENOVA_STOCK_GATE_OWNER_V2%';
  IF @v2Count NOT IN (0,3)
    THROW 51060, 'STOCK_GATE_PARTIAL_UPGRADE_REQUIRES_MAIN_REVIEW', 1;
  IF @v2Count=3 AND EXISTS(
    SELECT 1 FROM #GateOwnerNative n
    LEFT JOIN sys.extended_properties e
      ON e.class=1 AND e.major_id=OBJECT_ID(N'dbo.'+n.Name,N'P') AND e.minor_id=0
      AND e.name=N'NenovaStockGateOwnerV2Hash'
    WHERE e.value IS NULL OR CONVERT(varbinary(32),e.value)<>n.BeforeHash)
    THROW 51060, 'STOCK_GATE_NATIVE_DRIFT_REQUIRES_MAIN_REVIEW', 1;

  IF COL_LENGTH(N'dbo.NenovaStockWeekGate',N'OwnerSessionID') IS NULL
    ALTER TABLE dbo.NenovaStockWeekGate ADD OwnerSessionID int NULL;
  IF COL_LENGTH(N'dbo.NenovaStockWeekGate',N'OwnerToken') IS NULL
    ALTER TABLE dbo.NenovaStockWeekGate ADD OwnerToken uniqueidentifier NULL;
  IF COL_LENGTH(N'dbo.NenovaStockWeekGate',N'PendingCalc') IS NULL
    ALTER TABLE dbo.NenovaStockWeekGate ADD PendingCalc bit NOT NULL
      CONSTRAINT DF_NenovaStockWeekGate_PendingCalc DEFAULT(0) WITH VALUES;
  IF COL_LENGTH(N'dbo.NenovaStockWeekGate',N'CalcProdKey') IS NULL
    ALTER TABLE dbo.NenovaStockWeekGate ADD CalcProdKey int NULL;
  IF COL_LENGTH(N'dbo.NenovaStockWeekGate',N'ProtocolVersion') IS NULL
    ALTER TABLE dbo.NenovaStockWeekGate ADD ProtocolVersion smallint NULL;
  IF EXISTS(
    SELECT 1 FROM (VALUES(N'OwnerSessionID',56),(N'OwnerToken',36),
      (N'PendingCalc',104),(N'CalcProdKey',56),(N'ProtocolVersion',52)) v(Name,TypeID)
    LEFT JOIN sys.columns c ON c.object_id=OBJECT_ID(N'dbo.NenovaStockWeekGate') AND c.name=v.Name
    WHERE c.column_id IS NULL OR c.system_type_id<>v.TypeID)
    THROW 51060, 'STOCK_GATE_OWNER_COLUMN_TYPE_MISMATCH', 1;

  EXEC sys.sp_executesql N'
    IF EXISTS(SELECT 1 FROM dbo.NenovaStockWeekGate WHERE OwnerSessionID IS NOT NULL
      OR OwnerToken IS NOT NULL OR PendingCalc<>0 OR CalcProdKey IS NOT NULL)
      THROW 51060, ''STOCK_GATE_IDLE_OWNER_METADATA_INCONSISTENT'', 1;
    UPDATE dbo.NenovaStockWeekGate SET ProtocolVersion=2 WHERE GateKey=''1'';';

  IF OBJECT_ID(N'dbo.CK_NenovaStockWeekGate_OwnerV2_State',N'C') IS NOT NULL
    ALTER TABLE dbo.NenovaStockWeekGate DROP CONSTRAINT CK_NenovaStockWeekGate_OwnerV2_State;
  EXEC sys.sp_executesql N'
    ALTER TABLE dbo.NenovaStockWeekGate WITH CHECK ADD CONSTRAINT CK_NenovaStockWeekGate_OwnerV2_State
    CHECK (GateKey=''1'' AND ProtocolVersion IS NOT NULL AND ProtocolVersion=2 AND PendingCalc IS NOT NULL AND (
      (Mode IS NULL AND LockedAt IS NULL AND Action IS NULL AND OrderYear IS NULL AND OrderWeek IS NULL
        AND OwnerSessionID IS NULL AND OwnerToken IS NULL AND PendingCalc=0 AND CalcProdKey IS NULL)
      OR (Mode IS NOT NULL AND Mode IN(N''RUN'',N''WAIT_CALC'') AND LockedAt IS NOT NULL
        AND OwnerSessionID IS NOT NULL AND OwnerSessionID>0 AND OwnerToken IS NOT NULL
        AND OrderYear IS NOT NULL AND LEN(OrderYear)=4 AND OrderYear NOT LIKE N''%[^0-9]%''
        AND OrderWeek IS NOT NULL AND OrderWeek LIKE N''[0-9][0-9]-[0-9][0-9]'' AND LEN(OrderWeek)=5
        AND Action IS NOT NULL AND Action IN(N''FIX'',N''CANCEL'',N''CALC'') AND (
          (Mode=N''WAIT_CALC'' AND PendingCalc=1 AND CalcProdKey IS NULL)
          OR (Mode=N''RUN'' AND (
            (Action IN(N''FIX'',N''CANCEL'') AND PendingCalc=0 AND CalcProdKey IS NULL)
            OR (Action=N''CALC'' AND CalcProdKey IS NOT NULL AND CalcProdKey>=0
                AND (PendingCalc=0 OR CalcProdKey=0))))))));';

  DECLARE @stateHash varbinary(32)=HASHBYTES('SHA2_256',
    (SELECT definition FROM sys.check_constraints
      WHERE object_id=OBJECT_ID(N'dbo.CK_NenovaStockWeekGate_OwnerV2_State',N'C')));
  IF @stateHash IS NULL THROW 51060, 'STOCK_GATE_STATE_CONSTRAINT_HASH_UNAVAILABLE', 1;
  IF EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=1
    AND major_id=OBJECT_ID(N'dbo.NenovaStockWeekGate',N'U') AND minor_id=0
    AND name=N'NenovaStockGateOwnerV2StateHash')
    EXEC sys.sp_updateextendedproperty @name=N'NenovaStockGateOwnerV2StateHash',@value=@stateHash,
      @level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'NenovaStockWeekGate';
  ELSE
    EXEC sys.sp_addextendedproperty @name=N'NenovaStockGateOwnerV2StateHash',@value=@stateHash,
      @level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'NenovaStockWeekGate';

  EXEC sys.sp_executesql N'
CREATE OR ALTER PROCEDURE dbo.usp_NenovaStockWeekGateEnter
  @Action nvarchar(20), @OrderYear nvarchar(20), @OrderWeek nvarchar(20),
  @oResult int OUTPUT, @oMessage nvarchar(200) OUTPUT,
  @ProtocolVersion int=NULL, @OwnerToken uniqueidentifier=NULL OUTPUT, @CalcProdKey int=NULL
AS
BEGIN
  -- NENOVA_STOCK_GATE_OWNER_V2: never infer ownership from SPID alone.
  SET NOCOUNT ON;
  SET @OwnerToken=NULL;
  SET @oResult=-99;
  SET @oMessage=N''STOCK_GATE_BUSY_OR_PENDING_CALC'';
  IF ISNULL(@ProtocolVersion,0)<>2
  BEGIN SET @oResult=-98; SET @oMessage=N''STOCK_GATE_OWNER_PROTOCOL_REQUIRED''; RETURN; END;
  IF @Action IS NULL OR @Action NOT IN(N''FIX'',N''CANCEL'',N''CALC'')
    OR @OrderYear IS NULL OR LEN(@OrderYear)<>4 OR @OrderYear LIKE N''%[^0-9]%''
    OR @OrderWeek IS NULL OR LEN(@OrderWeek)<>5 OR @OrderWeek NOT LIKE N''[0-9][0-9]-[0-9][0-9]''
    OR (@Action=N''CALC'' AND (@CalcProdKey IS NULL OR @CalcProdKey<0))
    OR (@Action<>N''CALC'' AND @CalcProdKey IS NOT NULL)
  BEGIN SET @oResult=-98; SET @oMessage=N''STOCK_GATE_SCOPE_INVALID''; RETURN; END;
  DECLARE @newToken uniqueidentifier=NEWID(), @changed int;
  BEGIN TRY
    UPDATE dbo.NenovaStockWeekGate WITH (UPDLOCK,ROWLOCK,NOWAIT)
       SET Mode=N''RUN'', LockedAt=GETDATE(), Action=@Action,
           OrderYear=@OrderYear, OrderWeek=@OrderWeek,
           OwnerSessionID=@@SPID, OwnerToken=@newToken, CalcProdKey=@CalcProdKey
     WHERE GateKey=''1'' AND ProtocolVersion=2 AND (
       (Mode IS NULL AND PendingCalc=0 AND OwnerSessionID IS NULL AND OwnerToken IS NULL)
       OR (Mode=N''WAIT_CALC'' AND PendingCalc=1 AND @Action=N''CALC'' AND @CalcProdKey=0
           AND OrderYear=@OrderYear AND OrderWeek=@OrderWeek));
    SET @changed=@@ROWCOUNT;
  END TRY
  BEGIN CATCH
    IF ERROR_NUMBER()=1222 RETURN;
    THROW;
  END CATCH;
  IF @changed=1
  BEGIN SET @OwnerToken=@newToken; SET @oResult=0; SET @oMessage=N''''; END;
END;';

  EXEC sys.sp_executesql N'
CREATE OR ALTER PROCEDURE dbo.usp_NenovaStockWeekGateLeave
  @Action nvarchar(20), @Success bit,
  @ProtocolVersion int=NULL, @OwnerToken uniqueidentifier=NULL,
  @oResult int=NULL OUTPUT
AS
BEGIN
  -- NENOVA_STOCK_GATE_OWNER_V2: stale Leave is a zero-row no-op, including after ROLLBACK.
  SET NOCOUNT ON;
  SET @oResult=-98;
  IF ISNULL(@ProtocolVersion,0)<>2 OR @OwnerToken IS NULL OR @Success IS NULL
    OR @Action IS NULL OR @Action NOT IN(N''FIX'',N''CANCEL'',N''CALC'') RETURN;
  DECLARE @pending bit=CASE WHEN (@Action IN(N''FIX'',N''CANCEL'') AND @Success=1)
    OR (@Action=N''CALC'' AND @Success=0) THEN 1 ELSE 0 END;
  UPDATE dbo.NenovaStockWeekGate
     SET Mode=CASE WHEN @pending=1 THEN N''WAIT_CALC'' ELSE NULL END,
         LockedAt=CASE WHEN @pending=1 THEN GETDATE() ELSE NULL END,
         Action=CASE WHEN @pending=1 THEN @Action ELSE NULL END,
         OrderYear=CASE WHEN @pending=1 THEN OrderYear ELSE NULL END,
         OrderWeek=CASE WHEN @pending=1 THEN OrderWeek ELSE NULL END,
         OwnerSessionID=CASE WHEN @pending=1 THEN OwnerSessionID ELSE NULL END,
         OwnerToken=CASE WHEN @pending=1 THEN OwnerToken ELSE NULL END,
         PendingCalc=@pending, CalcProdKey=NULL
   WHERE GateKey=''1'' AND ProtocolVersion=2 AND Mode=N''RUN'' AND Action=@Action
     AND OwnerSessionID=@@SPID AND OwnerToken=@OwnerToken;
  SET @oResult=CASE WHEN @@ROWCOUNT=1 THEN 0 ELSE -97 END;
END;';

  EXEC sys.sp_executesql N'
CREATE OR ALTER PROCEDURE dbo.usp_NenovaStockWeekGateClear
AS
BEGIN
  -- NENOVA_STOCK_GATE_OWNER_V2: retained name/zero-arg signature, NOT unsafe behavior.
  SET NOCOUNT ON;
  THROW 51061, ''STOCK_GATE_UNSAFE_CLEAR_DISABLED_USE_OWNED_CALC'', 1;
END;';

  -- Patch ONLY the exact previously installed gate protocol, never reconstruct native SQL.
  DECLARE @name sysname,@action nvarchar(20),@before nvarchar(max),@after nvarchar(max),
    @old nvarchar(max),@new nvarchar(max),@leavePrefix nvarchar(200),@leaveCount int,
    @matched int,@success int,@settings nvarchar(max),
    @scan int,@tokenStart int,@headerStart int,@procStart int,@phase int,@depth int,
    @word nvarchar(40),@ch nchar(1);
  DECLARE native_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT Name,ActionName,BeforeSql FROM #GateOwnerNative ORDER BY Name;
  OPEN native_cursor;
  FETCH NEXT FROM native_cursor INTO @name,@action,@before;
  WHILE @@FETCH_STATUS=0
  BEGIN
    -- Preserve every business-body byte, including CRLF, tabs and string literals.
    SET @after=@before;
    IF @v2Count=0
    BEGIN
      SET @old=N'DECLARE @gateRes int, @gateMsg nvarchar(200);';
      IF (LEN(@after)-LEN(REPLACE(@after,@old,N'')))/LEN(@old)<>1
        THROW 51060, 'STOCK_GATE_UNRECOGNIZED_NATIVE_DECLARATION', 1;
      SET @new=N'DECLARE @gateRes int, @gateMsg nvarchar(200), @nenovaGateOwnerToken uniqueidentifier; -- NENOVA_STOCK_GATE_OWNER_V2';
      IF @action=N'CALC' SET @new=@new+CASE WHEN CHARINDEX(CHAR(13)+CHAR(10),@before)>0
        THEN CHAR(13)+CHAR(10) ELSE CHAR(10) END
        +N'DECLARE @nenovaGateCalcProdKey int=ISNULL(@ProdKey,0);';
      SET @after=REPLACE(@after,@old,@new);
      SET @old=N'@oMessage = @gateMsg OUTPUT;';
      IF (LEN(@after)-LEN(REPLACE(@after,@old,N'')))/LEN(@old)<>1
        THROW 51060, 'STOCK_GATE_UNRECOGNIZED_NATIVE_ENTER', 1;
      SET @new=N'@oMessage = @gateMsg OUTPUT, @ProtocolVersion = 2, @OwnerToken = @nenovaGateOwnerToken OUTPUT, @CalcProdKey = '
        +CASE WHEN @action=N'CALC' THEN N'@nenovaGateCalcProdKey;' ELSE N'NULL;' END;
      SET @after=REPLACE(@after,@old,@new);
      SET @leavePrefix=N'EXEC dbo.usp_NenovaStockWeekGateLeave';
      SET @leaveCount=(LEN(@after)-LEN(REPLACE(@after,@leavePrefix,N'')))/LEN(@leavePrefix);
      IF @leaveCount<2 THROW 51060, 'STOCK_GATE_NATIVE_EXIT_COVERAGE_MISSING', 1;
      SET @matched=0; SET @success=0;
      WHILE @success<=1
      BEGIN
        SET @old=@leavePrefix+N' @Action = N'''+@action+N''', @Success = '+CONVERT(nvarchar(1),@success)+N';';
        SET @matched=@matched+(LEN(@after)-LEN(REPLACE(@after,@old,N'')))/LEN(@old);
        SET @new=LEFT(@old,LEN(@old)-1)+N', @ProtocolVersion = 2, @OwnerToken = @nenovaGateOwnerToken;';
        SET @after=REPLACE(@after,@old,@new);
        SET @success=@success+1;
      END;
      IF @matched<>@leaveCount THROW 51060, 'STOCK_GATE_UNRECOGNIZED_NATIVE_LEAVE', 1;
      -- HEADER_TOKEN_PATCH_BEGIN: scan only leading trivia and the DDL keywords.
      -- SQL stores CREATE OR ALTER as e.g. CREATE   PROCEDURE. Never normalize
      -- the full definition or search for CREATE inside comments/business SQL.
      SET @scan=1; SET @phase=0; SET @headerStart=0; SET @procStart=0;
      WHILE @phase<>4
      BEGIN
        WHILE @scan<=LEN(@after)
        BEGIN
          SET @ch=SUBSTRING(@after,@scan,1);
          IF @ch IN(N' ',NCHAR(9),NCHAR(10),NCHAR(13),NCHAR(12),NCHAR(65279))
          BEGIN SET @scan=@scan+1; CONTINUE; END;
          IF SUBSTRING(@after,@scan,2)=N'--'
          BEGIN
            SET @scan=CHARINDEX(NCHAR(10),@after,@scan+2);
            IF @scan=0 THROW 51060, 'STOCK_GATE_UNRECOGNIZED_NATIVE_HEADER', 1;
            CONTINUE;
          END;
          IF SUBSTRING(@after,@scan,2)=N'/*'
          BEGIN
            SET @depth=1; SET @scan=@scan+2;
            WHILE @depth>0 AND @scan<=LEN(@after)
            BEGIN
              IF SUBSTRING(@after,@scan,2)=N'/*'
              BEGIN SET @depth=@depth+1; SET @scan=@scan+2; END
              ELSE IF SUBSTRING(@after,@scan,2)=N'*/'
              BEGIN SET @depth=@depth-1; SET @scan=@scan+2; END
              ELSE SET @scan=@scan+1;
            END;
            IF @depth<>0 THROW 51060, 'STOCK_GATE_UNRECOGNIZED_NATIVE_HEADER', 1;
            CONTINUE;
          END;
          BREAK;
        END;
        SET @tokenStart=@scan;
        WHILE @scan<=LEN(@after) AND SUBSTRING(@after,@scan,1) COLLATE Latin1_General_100_BIN2 LIKE N'[A-Za-z]'
          SET @scan=@scan+1;
        IF @scan=@tokenStart OR SUBSTRING(@after,@scan,1) COLLATE Latin1_General_100_BIN2 LIKE N'[0-9_@$#]'
          THROW 51060, 'STOCK_GATE_UNRECOGNIZED_NATIVE_HEADER', 1;
        SET @word=UPPER(SUBSTRING(@after,@tokenStart,@scan-@tokenStart));
        IF @phase=0 AND @word IN(N'CREATE',N'ALTER')
        BEGIN SET @headerStart=@tokenStart; SET @phase=CASE WHEN @word=N'CREATE' THEN 1 ELSE 3 END; END
        ELSE IF @phase=1 AND @word=N'OR' SET @phase=2;
        ELSE IF @phase=2 AND @word=N'ALTER' SET @phase=3;
        ELSE IF @phase IN(1,3) AND @word IN(N'PROCEDURE',N'PROC')
        BEGIN SET @procStart=@tokenStart; SET @phase=4; END
        ELSE THROW 51060, 'STOCK_GATE_UNRECOGNIZED_NATIVE_HEADER', 1;
      END;
      SET @after=STUFF(@after,@headerStart,@procStart-@headerStart,N'ALTER ');
      -- HEADER_TOKEN_PATCH_END: everything from PROC/PROCEDURE onwards is intact.
      SELECT @settings=N'SET ANSI_NULLS '+CASE WHEN UsesAnsiNulls=1 THEN N'ON' ELSE N'OFF' END
        +N'; SET QUOTED_IDENTIFIER '+CASE WHEN UsesQuotedIdentifier=1 THEN N'ON' ELSE N'OFF' END
        +N'; EXEC sys.sp_executesql @body;' FROM #GateOwnerNative WHERE Name=@name;
      EXEC sys.sp_executesql @settings,N'@body nvarchar(max)',@body=@after;
    END;
    UPDATE #GateOwnerNative SET AfterSql=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@name,N'P')),
      AfterHash=HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@name,N'P')))
      WHERE Name=@name;
    FETCH NEXT FROM native_cursor INTO @name,@action,@before;
  END;
  CLOSE native_cursor;
  DEALLOCATE native_cursor;
  IF EXISTS(SELECT 1 FROM #GateOwnerNative n JOIN sys.sql_modules m
    ON m.object_id=OBJECT_ID(N'dbo.'+n.Name,N'P')
    WHERE n.UsesAnsiNulls<>m.uses_ansi_nulls OR n.UsesQuotedIdentifier<>m.uses_quoted_identifier)
    THROW 51060, 'STOCK_GATE_NATIVE_MODULE_SET_OPTIONS_CHANGED', 1;

  SELECT o.name AS ProcedureName,p.parameter_id,p.name AS ParameterName,
         p.system_type_id,p.user_type_id,p.max_length,p.precision,p.scale,p.is_output,p.is_readonly
    INTO #GateOwnerParametersAfter
    FROM sys.parameters p JOIN sys.objects o ON o.object_id=p.object_id
    JOIN #GateOwnerNative n ON o.object_id=OBJECT_ID(N'dbo.'+n.Name,N'P');
  IF EXISTS(SELECT * FROM #GateOwnerParameters EXCEPT SELECT * FROM #GateOwnerParametersAfter)
    OR EXISTS(SELECT * FROM #GateOwnerParametersAfter EXCEPT SELECT * FROM #GateOwnerParameters)
    THROW 51060, 'STOCK_GATE_NATIVE_EXTERNAL_SIGNATURE_CHANGED', 1;

  DECLARE @hash varbinary(32);
  DECLARE hash_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT Name FROM #GateOwnerNative UNION ALL
    SELECT N'usp_NenovaStockWeekGateEnter' UNION ALL SELECT N'usp_NenovaStockWeekGateLeave'
    UNION ALL SELECT N'usp_NenovaStockWeekGateClear';
  OPEN hash_cursor;
  FETCH NEXT FROM hash_cursor INTO @name;
  WHILE @@FETCH_STATUS=0
  BEGIN
    SET @hash=HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@name,N'P')));
    IF @hash IS NULL THROW 51060, 'STOCK_GATE_MODULE_HASH_UNAVAILABLE', 1;
    IF EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=1 AND major_id=OBJECT_ID(N'dbo.'+@name,N'P')
      AND minor_id=0 AND name=N'NenovaStockGateOwnerV2Hash')
      EXEC sys.sp_updateextendedproperty @name=N'NenovaStockGateOwnerV2Hash',@value=@hash,
        @level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'PROCEDURE',@level1name=@name;
    ELSE
      EXEC sys.sp_addextendedproperty @name=N'NenovaStockGateOwnerV2Hash',@value=@hash,
        @level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'PROCEDURE',@level1name=@name;
    FETCH NEXT FROM hash_cursor INTO @name;
  END;
  CLOSE hash_cursor;
  DEALLOCATE hash_cursor;

  EXEC sys.sp_executesql N'
CREATE OR ALTER PROCEDURE dbo.usp_NenovaStockWeekGateCapability
AS
BEGIN
  -- NENOVA_STOCK_GATE_OWNER_V2: read-only; inaccessible metadata fails closed.
  SET NOCOUNT ON;
  DECLARE @valid int;
  SELECT @valid=COUNT(*)
    FROM (VALUES(N''usp_ShipmentFix''),(N''usp_ShipmentFixCancel''),(N''usp_StockCalculation''),
      (N''usp_NenovaStockWeekGateEnter''),(N''usp_NenovaStockWeekGateLeave''),
      (N''usp_NenovaStockWeekGateClear'')) v(Name)
    JOIN sys.sql_modules m ON m.object_id=OBJECT_ID(N''dbo.''+v.Name,N''P'')
    JOIN sys.extended_properties e ON e.class=1 AND e.major_id=m.object_id AND e.minor_id=0
      AND e.name=N''NenovaStockGateOwnerV2Hash''
    WHERE m.definition LIKE N''%NENOVA_STOCK_GATE_OWNER_V2%''
      AND CONVERT(varbinary(32),e.value)=HASHBYTES(''SHA2_256'',m.definition);
  SELECT 2 AS ProtocolVersion, CONVERT(bit,CASE WHEN @valid=6
    AND EXISTS(SELECT 1 FROM dbo.NenovaStockWeekGate WHERE GateKey=''1'' AND ProtocolVersion=2)
    AND 5=(SELECT COUNT(*) FROM (VALUES(N''OwnerSessionID'',56,1),(N''OwnerToken'',36,1),
        (N''PendingCalc'',104,0),(N''CalcProdKey'',56,1),(N''ProtocolVersion'',52,1)) v(Name,TypeID,Nullable)
      JOIN sys.columns c ON c.object_id=OBJECT_ID(N''dbo.NenovaStockWeekGate'',N''U'') AND c.name=v.Name
        AND c.system_type_id=v.TypeID AND c.is_nullable=v.Nullable)
    AND EXISTS(SELECT 1 FROM sys.check_constraints c
      JOIN sys.extended_properties e ON e.class=1 AND e.major_id=c.parent_object_id AND e.minor_id=0
        AND e.name=N''NenovaStockGateOwnerV2StateHash''
      WHERE c.object_id=OBJECT_ID(N''dbo.CK_NenovaStockWeekGate_OwnerV2_State'',N''C'')
        AND c.parent_object_id=OBJECT_ID(N''dbo.NenovaStockWeekGate'',N''U'')
        AND c.is_disabled=0 AND c.is_not_trusted=0
        AND CONVERT(varbinary(32),e.value)=HASHBYTES(''SHA2_256'',c.definition))
    THEN 1 ELSE 0 END) AS IsReady,
    N''OWNER_SESSION_AND_ACQUIRE_TOKEN;NO_GLOBAL_CLEAR;NO_TIMEOUT_RECLAIM'' AS Capability;
END;';

  COMMIT TRANSACTION;
  SELECT Name,CONVERT(varchar(64),BeforeHash,2) AS BeforeHash,
    CONVERT(varchar(64),AfterHash,2) AS AfterHash FROM #GateOwnerNative ORDER BY Name;
  EXEC dbo.usp_NenovaStockWeekGateCapability;
  DROP TABLE #GateOwnerParametersAfter;
  DROP TABLE #GateOwnerParameters;
  DROP TABLE #GateOwnerNative;
END TRY
BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
