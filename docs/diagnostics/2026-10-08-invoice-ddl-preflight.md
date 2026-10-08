# 2026-10-08 WebInvoice DDL preflight

Read-only SSMS snapshot before approved create-only migration. No objects with the six proposed names were returned. No open transaction. Existing shared SQL/staging captured below. Staging can change through concurrent legitimate work; mismatch is not authorization to restore it.

Second read-only preflight in SSMS session 1413 confirmed compatibility level 130,
no database DDL triggers returned by `sys.triggers WHERE parent_class=0`, the six
names still absent, TranCount=0, CreateTable=1 and AlterDbo=1. Shared procedure
hashes and staging 4 rows / checksum 1343479630 still match the first snapshot.
This does not inspect server-level triggers hidden from the current account.

```text
																	1335 편집 DatabaseName (nvarchar) 행 0 Value: nenova1_nenova
																	1338 편집 TranCount (int) 행 0 Value: 0
																	1341 편집 CanCreateTable (int) 행 0 Value: 1
																	1344 편집 CanAlterDbo (int) 행 0 Value: 1
																	1360 편집 name (nvarchar) 행 0 Value: usp_CreateWarehouse
																	1361 편집 name (nvarchar) 행 1 Value: usp_GetNextKey
																	1362 편집 name (nvarchar) 행 2 Value: usp_NenovaStockWeekGateEnter
																	1363 편집 name (nvarchar) 행 3 Value: usp_NenovaStockWeekGateLeave
																	1364 편집 name (nvarchar) 행 4 Value: usp_StockCalculation
																	1367 편집 DefinitionHash (varchar) 행 0 Value: C52523F2A5735B9420E845AE601B3E3F730205E99DFD9309FEF29C8325C23BD8
																	1368 편집 DefinitionHash (varchar) 행 1 Value: 2CAA094745C908F29E31702EE1C563EF7C34C2AFA28B48E0A1A604D08A2A7418
																	1369 편집 DefinitionHash (varchar) 행 2 Value: 7A363422078D91A1583728AA65EBDAAED42E57DB311787742E9707709EE2EAD8
																	1370 편집 DefinitionHash (varchar) 행 3 Value: 887C41FE7C5A25E8F7E816CEF85A06464ECF1E4E434511FCBAC4D75E50183FE1
																	1371 편집 DefinitionHash (varchar) 행 4 Value: 879357E7BF8AABE4CB60F853D18331109580F673E0DC3BA21570AD984BFBC67B
																	1377 편집 StagingRows (bigint) 행 0 Value: 4
																	1380 편집 StagingChecksum (int) 행 0 Value: 1343479630
```
