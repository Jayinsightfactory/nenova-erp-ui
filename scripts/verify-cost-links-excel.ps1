param([string]$Directory = '.verify/excel')
$ErrorActionPreference='Stop'
$root=(Resolve-Path $Directory).Path
$cases=Get-Content (Join-Path $root 'cases.json') -Raw | ConvertFrom-Json
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false
$excel.DisplayAlerts=$false
$excel.AutomationSecurity=3
$results=@()
try {
 foreach($case in $cases) {
  $book=$excel.Workbooks.Open((Join-Path $root ($case.id+'.xlsx')),0,$false)
  try {
   $s=$book.Worksheets.Item(3)
   $r=$case.first
   $price=$s.Range($case.base+$r)
   $cost=$s.Range($case.unitCost+$r)
   $sale=$s.Range($case.input+$r)
   $sale.Value2=20000
   $excel.CalculateFullRebuild()
   $before=$cost.Value2
   $profitBefore=$s.Range($case.profits+$case.summary).Value2
   $oldPrice=$price.Value2
   $price.Value2=[double]$oldPrice*2
   $excel.CalculateFullRebuild()
   $after=$cost.Value2
   $profitAfter=$s.Range($case.profits+$case.summary).Value2
   $changed=($before -is [double]) -and ($after -is [double]) -and ([Math]::Abs($after-$before) -gt 0.00001)
   $profitChanged=($profitBefore -is [double]) -and ($profitAfter -is [double]) -and ([Math]::Abs($profitAfter-$profitBefore) -gt 0.00001)
   $price.Value2=$oldPrice
   $excel.CalculateFullRebuild()
   $goodsBefore=$s.Range($case.goods).Value2
   $quantitySalesBefore=$s.Range($case.sales+$case.summary).Value2
   $quantityProfitBefore=$s.Range($case.profits+$case.summary).Value2
   $qty=$s.Range($case.qty+$r);$oldQty=$qty.Value2
   $qty.Value2=[double]$oldQty*2
   $excel.CalculateFullRebuild()
   $goodsAfter=$s.Range($case.goods).Value2
   $quantitySalesLinked=[Math]::Abs($s.Range($case.sales+$case.summary).Value2-$quantitySalesBefore) -gt 0.00001
   $quantityProfitLinked=[Math]::Abs($s.Range($case.profits+$case.summary).Value2-$quantityProfitBefore) -gt 0.00001
   $quantityLinked=([Math]::Abs($goodsAfter-$goodsBefore-[double]$oldQty*[double]$oldPrice) -lt 0.001)
   $qty.Value2=$oldQty
   $fx=$s.Range($case.fx);$oldFx=$fx.Value2
   $fx.Value2=[double]$oldFx+15
   $excel.CalculateFullRebuild()
   $fxLinked=($cost.Value2 -is [double]) -and ([Math]::Abs($cost.Value2-$before) -gt 0.00001)
   $errors=0
   foreach($sheet in $book.Worksheets){try{$bad=$sheet.UsedRange.SpecialCells(-4123,16);$errors+=$bad.Count}catch{}}
   $results+= [pscustomobject]@{id=$case.id;before=$before;after=$after;priceLinked=$changed;profitLinked=$profitChanged;quantityLinked=$quantityLinked;quantitySalesLinked=$quantitySalesLinked;quantityProfitLinked=$quantityProfitLinked;fxLinked=$fxLinked;formulaErrors=$errors}
  } finally { $book.Close($false) }
 }
} finally { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
$results | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $root 'native-excel-results.json') -Encoding utf8
$results | Format-Table -AutoSize
if(@($results | Where-Object {-not $_.priceLinked -or -not $_.profitLinked -or -not $_.quantityLinked -or -not $_.quantitySalesLinked -or -not $_.quantityProfitLinked -or -not $_.fxLinked -or $_.formulaErrors}).Count) {exit 1}
