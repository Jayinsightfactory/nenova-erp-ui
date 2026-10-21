# 2026-10-21 44-01 upload response wait

## Criteria and side effects
- Scope: browser wait only. No API/SQL/save policy changes; all ERP tables and existing FINAL_SNAPSHOT semantics preserved.
- Parse and registration deadline: 120 seconds, including JSON body. Customer fallback/readback: 30 seconds. Chosen UI response limits, not native transaction deadlines.
- A timeout does not prove rollback/cancel. Registration retains the draft and uses existing ambiguous-result warning; no retry. Successful save plus failed readback remains a saved result with verification warning.
- Shared helper: withOrderImportDeadline. Late completion has no UI side effects; original request may finish server-side.
- dnSpy FormOrderAdd.btnSave_Click rechecked with local CLI. Existing native header preparation is already deployed via PR1183; this change does not modify it.

## Read-only production probe
- 2026/44-01: ViewOrder 760 rows, ViewShipment 0, ShipmentImportAudit 0.
- Last 3 days: 24 order API successes across weeks, no logged failures. No completed order requests today at probe time. This does not identify the employee browser request or prove all network requests succeeded.
- Stock gate IDLE, PendingCalc false. VIEW SERVER STATE absent: cannot certify all SQL sessions unblocked.
- 53 active OrderMaster rows; 10 customers with prior final-upload successes lack active ShipmentMaster. Their active order rows total 169. Existing missing headers are not auto-repaired by PR1183. No production mutations in this task.
- Original payloads, actor identities and credentials are not stored in this report.

## Release evidence
- PR1183 ba7b99c2: Cafe24 run39549322949 success, ERP checks and hydration smoke success.
- Latest checked production release 943d948f: run39550935780 success.
- Current browser /orders/import loads authenticated and restores its local draft. That owner's draft is not the affected employee's tab.
- New deadline regression/build/deployment: pending.

Search: 44-01 upload hang response timeout missing ShipmentMaster 10 withOrderImportDeadline
- Additional SELECT-only reconciliation: latest complete 44-01 final-upload payloads for 15 customers, 299 items. Seven quantity differences and three additional active items all have subsequent OrderHistory edits/deletes/additions after upload. Do not overwrite those legitimate subsequent edits by replaying the files. This bounded comparison found no unexplained partial-write evidence.
