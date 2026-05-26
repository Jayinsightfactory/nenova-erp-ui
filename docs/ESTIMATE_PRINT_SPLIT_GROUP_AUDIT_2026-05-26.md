# Estimate Print Split Group Audit - 2026-05-26

## Request
- Fix estimate print "item split" grouping where:
  - Regular roses and Ecuador roses were attached together.
  - Hydrangea could print under an alstro label.
  - Colombia roses and China roses were mixed.
  - Alstro items could fall into 기타.
  - Netherlands items could fall into 기타.
  - A combined estimate page was appended after split pages.

## Changes
- Split grouping now checks the full row context: country name, flower name, and product name.
- Hydrangea and alstro are separate groups.
- Colombia rose, China rose, and Ecuador rose are separate groups.
- Netherlands items are grouped as 네덜란드 instead of 기타.
- Split mode no longer appends the final 종합견적서 page automatically.

## Safety Notes
- Print-only behavior change.
- No shipment, estimate, product, or customer data writes were changed.
