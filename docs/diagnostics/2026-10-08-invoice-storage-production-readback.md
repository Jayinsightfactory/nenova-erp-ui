# WebInvoice V1 운영 적용 결과

2026-10-08 11:09:59 +09:00, 로그인 SSMS 세션 1469에서 승인된 빈 6테이블 생성 완료.
동일 세션에서 읽기 전용 사후 조회. DDL SHA256:
`B8C7F25CBF99B00478BD082A000C7721B30A9D6064116EF59F653490D816AF97`.
기존 EXE/공유 프로시저/ERP 원장 변경 및 운영 시험 INSERT는 하지 않았다.
SSMS의 자체 DDL 탭 버퍼는 사후 SELECT로 교체했지만 디스크의 migration 원본은 저장·변경하지 않았다.

## UI에서 읽은 결과

```text
51062 편집 DatabaseName (nvarchar) 행 0 Value: nenova1_nenova
51065 편집 TranCount (int) 행 0 Value: 0
51078 편집 TableName (nvarchar) 행 0 Value: WebInvoiceDocument
51079 편집 TableName (nvarchar) 행 1 Value: WebInvoiceLine
51080 편집 TableName (nvarchar) 행 2 Value: WebInvoiceOperation
51081 편집 TableName (nvarchar) 행 3 Value: WebInvoiceHistory
51082 편집 TableName (nvarchar) 행 4 Value: WebInvoiceCostRevision
51083 편집 TableName (nvarchar) 행 5 Value: WebInvoiceCostLine
51086 편집 RowCount (bigint) 행 0 Value: 0
51087 편집 RowCount (bigint) 행 1 Value: 0
51088 편집 RowCount (bigint) 행 2 Value: 0
51089 편집 RowCount (bigint) 행 3 Value: 0
51090 편집 RowCount (bigint) 행 4 Value: 0
51091 편집 RowCount (bigint) 행 5 Value: 0
51103 편집 name (nvarchar) 행 0 Value: usp_CreateWarehouse
51104 편집 name (nvarchar) 행 1 Value: usp_GetNextKey
51105 편집 name (nvarchar) 행 2 Value: usp_NenovaStockWeekGateEnter
51106 편집 name (nvarchar) 행 3 Value: usp_NenovaStockWeekGateLeave
51107 편집 name (nvarchar) 행 4 Value: usp_StockCalculation
51110 편집 DefinitionHash (varchar) 행 0 Value: C52523F2A5735B9420E845AE601B3E3F730205E99DFD9309FEF29C8325C23BD8
51111 편집 DefinitionHash (varchar) 행 1 Value: 2CAA094745C908F29E31702EE1C563EF7C34C2AFA28B48E0A1A604D08A2A7418
51112 편집 DefinitionHash (varchar) 행 2 Value: 7A363422078D91A1583728AA65EBDAAED42E57DB311787742E9707709EE2EAD8
51113 편집 DefinitionHash (varchar) 행 3 Value: 887C41FE7C5A25E8F7E816CEF85A06464ECF1E4E434511FCBAC4D75E50183FE1
51114 편집 DefinitionHash (varchar) 행 4 Value: 879357E7BF8AABE4CB60F853D18331109580F673E0DC3BA21570AD984BFBC67B
51122 편집 StagingRows (bigint) 행 0 Value: 4
51125 편집 StagingChecksum (int) 행 0 Value: 1343479630
51139 편집 TableName (nvarchar) 행 0 Value: WebInvoiceLine
51140 편집 TableName (nvarchar) 행 1 Value: WebInvoiceOperation
51141 편집 TableName (nvarchar) 행 2 Value: WebInvoiceHistory
51142 편집 TableName (nvarchar) 행 3 Value: WebInvoiceHistory
51143 편집 TableName (nvarchar) 행 4 Value: WebInvoiceCostRevision
51144 편집 TableName (nvarchar) 행 5 Value: WebInvoiceCostLine
51145 편집 TableName (nvarchar) 행 6 Value: WebInvoiceCostLine
51148 편집 name (nvarchar) 행 0 Value: FK_WebInvoiceLine_Document
51149 편집 name (nvarchar) 행 1 Value: FK_WebInvoiceOperation_Document
51150 편집 name (nvarchar) 행 2 Value: FK_WebInvoiceHistory_Document
51151 편집 name (nvarchar) 행 3 Value: FK_WebInvoiceHistory_OperationScope
51152 편집 name (nvarchar) 행 4 Value: FK_WebInvoiceCostRevision_OperationScope
51153 편집 name (nvarchar) 행 5 Value: FK_WebInvoiceCostLine_CostRevisionScope
51154 편집 name (nvarchar) 행 6 Value: FK_WebInvoiceCostLine_SourceLine
51157 편집 ReferencedTable (nvarchar) 행 0 Value: WebInvoiceDocument
51158 편집 ReferencedTable (nvarchar) 행 1 Value: WebInvoiceDocument
51159 편집 ReferencedTable (nvarchar) 행 2 Value: WebInvoiceDocument
51160 편집 ReferencedTable (nvarchar) 행 3 Value: WebInvoiceOperation
51161 편집 ReferencedTable (nvarchar) 행 4 Value: WebInvoiceOperation
51162 편집 ReferencedTable (nvarchar) 행 5 Value: WebInvoiceCostRevision
51163 편집 ReferencedTable (nvarchar) 행 6 Value: WebInvoiceLine
51166 편집 is_disabled (bit) 행 0 Value: 0
51167 편집 is_disabled (bit) 행 1 Value: 0
51168 편집 is_disabled (bit) 행 2 Value: 0
51169 편집 is_disabled (bit) 행 3 Value: 0
51170 편집 is_disabled (bit) 행 4 Value: 0
51171 편집 is_disabled (bit) 행 5 Value: 0
51172 편집 is_disabled (bit) 행 6 Value: 0
51175 편집 is_not_trusted (bit) 행 0 Value: 0
51176 편집 is_not_trusted (bit) 행 1 Value: 0
51177 편집 is_not_trusted (bit) 행 2 Value: 0
51178 편집 is_not_trusted (bit) 행 3 Value: 0
51179 편집 is_not_trusted (bit) 행 4 Value: 0
51180 편집 is_not_trusted (bit) 행 5 Value: 0
51181 편집 is_not_trusted (bit) 행 6 Value: 0
51184 편집 delete_referential_action_desc (nvarchar) 행 0 Value: NO_ACTION
51185 편집 delete_referential_action_desc (nvarchar) 행 1 Value: NO_ACTION
51186 편집 delete_referential_action_desc (nvarchar) 행 2 Value: NO_ACTION
51187 편집 delete_referential_action_desc (nvarchar) 행 3 Value: NO_ACTION
51188 편집 delete_referential_action_desc (nvarchar) 행 4 Value: NO_ACTION
51189 편집 delete_referential_action_desc (nvarchar) 행 5 Value: NO_ACTION
51190 편집 delete_referential_action_desc (nvarchar) 행 6 Value: NO_ACTION
51197 머리글 (settable, string) CheckCount (int) Value: CheckCount
51198 편집 CheckCount (int) 행 0 Value: 38
51200 머리글 (settable, string) VerifiedCheckCount (int) Value: VerifiedCheckCount
51201 편집 VerifiedCheckCount (int) 행 0 Value: 38
50954 텍스트 쿼리가 실행되었습니다.
50958 텍스트 nenova1_nenova (1469)
50960 텍스트 nenova1_nenova
```
