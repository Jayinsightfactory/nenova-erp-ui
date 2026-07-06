# nenova.exe 견적서 비고(적요) — dnSpy 패치 가이드

## 배경

- **웹** (`nenovaweb.com/estimate` 견적서 관리·인쇄): `sanitizeEstimateDescrForDisplay` / `formatEstimatePrintDescr` 로 운영 로그 제외 ✅
- **nenova.exe**
  - `FormEstimateView` (견적서 **관리** 그리드): `Estimate.Descr` 를 **필터 없이** 비고 컬럼에 표시
  - `FormPrintEstimate` (견적 **인쇄**): 동일
- **웹 API** `update-quantity.js`: 차감 수량 수정 시 `Estimate.Descr`에 `차감수량` append **중단** (2026-06-16)
- **DB 트리거** `tr_Estimate_SanitizeDescr`: exe/웹이 차감 행에 운영 로그를 쓰면 INSERT/UPDATE 직후 비움

검역차감 예: 비고 `차감수량 -1>-2차감수량 -2>-1` → DB·화면 모두 **빈칸**

25차 **(주)미카엘플라워** 예: `ShipmentDetail.Descr = "임재용0>1"` → exe 견적 인쇄 적요에 그대로 표시.

전체 변경 이력은 `ShipmentHistory` / `OrderHistory` 에 남아 있으므로, **인쇄용 적요에서만** 제거해도 됩니다.

## exe SQL (문자열 추출 확인)

```
sdd.Descr AS Descr
e.Descr AS Descr
```

## 권장 패치 (dnSpy)

1. `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe` 백업
2. dnSpy → `FormPrintEstimate` (또는 견적 출력 DataTable 바인딩 직전 메서드) 검색
3. `Descr` 컬럼을 리포트에 넘기기 **직전**에 아래 C# 헬퍼 적용

```csharp
// FormPrintEstimate 또는 공용 Util 클래스에 추가
private static bool IsOperationalEstimateDescr(string text)
{
    if (string.IsNullOrWhiteSpace(text)) return false;
    var s = text.Trim();
    if (System.Text.RegularExpressions.Regex.IsMatch(s, @"수량\s*변동|분배\s*변동|붙여\s*넣기|단가\s*변경|차감\s*단가|차감\s*수량", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
        return true;
    if (s.Contains("차감단가") || s.Contains("차감수량")) return true;
    if (System.Text.RegularExpressions.Regex.IsMatch(s, @"\[\d{4}-\d{2}-\d{2}"))
        return true;
    // 담당자+수량요약: 임16>12,임12>14
    if (System.Text.RegularExpressions.Regex.IsMatch(s, @"^[\u3131-\u318E\uAC00-\uD7A3a-zA-Z]{1,8}\d+(?:\.\d+)?>\d+(?:\.\d+)?(?:,[\u3131-\u318E\uAC00-\uD7A3a-zA-Z]{1,8}\d+(?:\.\d+)?>\d+(?:\.\d+)?)*$"))
        return true;
    return false;
}

private static string SanitizeDescrForPrint(string text)
{
    if (string.IsNullOrWhiteSpace(text)) return "";
    var raw = text.Trim();
    var parts = System.Text.RegularExpressions.Regex.Split(raw, @"[\r\n,]+");
    var kept = new System.Collections.Generic.List<string>();
    foreach (var p in parts)
    {
        var t = (p ?? "").Trim();
        if (t.Length == 0) continue;
        if (!IsOperationalEstimateDescr(t)) kept.Add(t);
    }
    if (kept.Count == 0) return "";
    if (kept.Count == 1 && parts.Length <= 1)
        return IsOperationalEstimateDescr(raw) ? "" : raw;
    return string.Join(", ", kept);
}
```

4. DataTable 루프 예시 (메서드명은 dnSpy에서 실제 이름 확인):

```csharp
foreach (DataRow row in dt.Rows)
{
    if (dt.Columns.Contains("Descr"))
        row["Descr"] = SanitizeDescrForPrint(Convert.ToString(row["Descr"]));
    // 수량 0 행 제거 (정상·차감 공통)
    var qty = 0.0;
    if (dt.Columns.Contains("Quantity"))
        double.TryParse(Convert.ToString(row["Quantity"]), out qty);
    // ... 인쇄 대상 필터 시 qty == 0 이면 row 삭제 또는 skip
}
```

5. **Compile** → exe 저장 → 미카엘 25차 견적 인쇄로 `임재용0>1` 미표시 확인

## 웹 측 임시 DB 정리 (exe 패치 전)

```http
GET  /api/dev/estimate-print-descr-cleanup?week=25&cust=미카엘
POST /api/dev/estimate-print-descr-cleanup  { "week": "25", "cust": "미카엘", "apply": true }
```

- `ShipmentDetail.Descr`, `ShipmentDate.Descr`, `Estimate.Descr` 에서 운영 로그만 제거
- 이후 수량 수정 시 비고가 다시 쌓이면 exe 인쇄에 재노출 → **exe 패치가 근본 해결**

## 웹 규칙과 동기화

JS 원본: `lib/estimateInvariants.js` → `isOperationalEstimateDescr`, `sanitizeDescrTextForPrint`
