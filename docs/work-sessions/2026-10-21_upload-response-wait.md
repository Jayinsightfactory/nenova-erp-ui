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
- Local gates final: test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest, guard:erp-writes, npm run build all exit0. CIRCLE_NODE_TOTAL=3; 137 manifests. Build-generated history files restored to pre-build version.
- PR1185 (622b94a2) CI39552447489 verify success, squash22983567. Cafe24 run39552707668 in progress. No schema migration or business data repair requested/executed.
- Later live raw-ledger read: active order details762 (initial ViewOrder snapshot760 was earlier), shipment details0/date0/farm0/confirmed sales0. A direct anti-join found zero active OrderDetail rows missing from ViewOrder; concurrent business edits mean snapshot counts must not be treated as one frozen state.
- Final release: Cafe24 run39552707668 SUCCESS (22983567), all deployment gates, SSH deploy and hydration smoke success. Authenticated Chrome /orders/import loaded and restored existing draft. Observed production page bundle import-995c505f6d7923c8.js contains ORDER_IMPORT_RESPONSE_TIMEOUT, 120-second deadline and 30-second read deadline.
- User clarified to continue if DB has no damage. Bounded reconciliation supports no unexplained partial-write evidence; it is not a blanket certification of all DB rows. Existing 10 missing native headers remain explicitly unresolved; no operational repair performed. Specific employee request/root network or server stall is unverified because customer/stage evidence was not supplied. Never describe the preventive timeout as proof of that original root cause.

## 후속 완료 — 2026-10-21
사용자의 명시적 추가 요청으로 기존 누락 10업체 헤더를 보정했다. 앞선 미해결 표기는 보정 이전 시점의 기록이다. 주문 재업로드 없이 빈 ShipmentMaster만 추가했고 14개 보호 영역을 보존했다. [완료 기록](../session-backups/2026-10-21_upload-header-repair.md), [dnSpy 계약](../knowledge/NATIVE_SHIPMENT_HEADER_CONTRACT.md)을 참조한다.
