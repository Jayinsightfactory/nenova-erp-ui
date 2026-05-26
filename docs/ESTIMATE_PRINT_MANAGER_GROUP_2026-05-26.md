# Estimate Print Manager Group Audit - 2026-05-26

## Request
- In Estimate Management, printing selected estimates should automatically print by manager so the user does not need to manually classify printed pages afterward.

## Changes
- `/api/estimate` list response now includes `Customer.Manager` and `Customer.CustArea`.
- The estimate shipment list shows the manager for each customer group.
- Multi-select estimate printing now defaults to manager grouping:
  - Selected customer groups are sorted by manager, week, then customer name.
  - Manager separator pages were removed to avoid wasting printed paper.
  - The print dialog does not show manager grouping controls; sorting is applied automatically.
- Single-customer printing remains unchanged.

## Safety Notes
- This change only affects estimate list read data and print HTML generation.
- It does not write ERP data or change estimate/shipment values.
