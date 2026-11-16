-- Run once in the ERP database before deploying the pallet export.
IF OBJECT_ID(N'dbo.ShipmentImportAudit', N'U') IS NULL
    THROW 51000, 'ShipmentImportAudit not installed', 1;
IF COL_LENGTH('dbo.ShipmentImportAudit','PalletSnapshot') IS NULL
    ALTER TABLE dbo.ShipmentImportAudit ADD PalletSnapshot nvarchar(max) NULL;
