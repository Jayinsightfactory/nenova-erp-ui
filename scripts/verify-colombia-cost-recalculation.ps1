param([Parameter(Mandatory=$true)][string]$FilePath)
$ErrorActionPreference='Stop'
$excel=$null
$book=$null
try {
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false
 $excel.DisplayAlerts=$false
 $excel.AutomationSecurity=3
 $book=$excel.Workbooks.Open((Resolve-Path -LiteralPath $FilePath).Path,0,$true)
 $sheet=$book.Worksheets.Item(3)
 $sheet.Activate()
 $excel.CalculateFullRebuild()
 if($excel.CircularReference){throw 'CIRCULAR_REFERENCE'}
 $last=[int]$sheet.Range('AL14').Value2+14
 if($last -lt 15 -or $sheet.Range('AB12').HasFormula){throw 'ALLOCATION_INPUT_OVERWRITTEN'}
 $baseGW=[double]$sheet.Range('C8').Value2
 $baseTotal=[double]$sheet.Range('P10').Value2
 $baseCost=[double]$sheet.Range('AL12').Value2
 $baseSales=[double]$sheet.Range('U13').Value2
 $baseProfit=[double]$sheet.Range('V13').Value2
 $costs=@()
 for($r=15;$r -le $last;$r++){$costs+=,[double]$sheet.Range('M'+$r).Value2}
 $sheet.Range('C8').Value2=$baseGW+1
 $excel.CalculateFullRebuild()
 $changedTotal=[double]$sheet.Range('P10').Value2
 $changedCost=[double]$sheet.Range('AL12').Value2
 $changedSales=[double]$sheet.Range('U13').Value2
 $changedProfit=[double]$sheet.Range('V13').Value2
 if([math]::Abs($changedTotal-$baseTotal-460) -gt .001){throw 'CUSTOMS_RECALC_FAILED'}
 if([math]::Abs($changedCost-$baseCost-460) -gt .02){throw 'COST_TOTAL_RECALC_FAILED'}
 $changedRows=0
 for($r=15;$r -le $last;$r++){
  if([double]$sheet.Range('E'+$r).Value2 -gt 0){
   if([double]$sheet.Range('M'+$r).Value2 -le $costs[$r-15]){throw ('UNIT_COST_RECALC_FAILED_ROW_'+$r)}
   $changedRows++
  }
 }
 if($changedSales -eq $baseSales -or $changedProfit -eq $baseProfit){throw 'SALES_PROFIT_RECALC_FAILED'}
 $sheet.Range('C8').Value2=$baseGW
 $excel.CalculateFullRebuild()
 if([math]::Abs([double]$sheet.Range('AL12').Value2-$baseCost) -gt .02){throw 'RESTORE_FAILED'}
 foreach($s in $book.Worksheets){
  $bad=$null
  try{$bad=$s.UsedRange.SpecialCells(-4123,16)}catch{}
  if($bad){throw ('FORMULA_ERROR_SHEET_'+$s.Index)}
 }
 [pscustomobject]@{engine='Microsoft Excel';readOnly=$book.ReadOnly;rows=$changedRows;gwBefore=$baseGW;gwAfter=$baseGW+1;customsBefore=$baseTotal;customsAfter=$changedTotal;costBefore=$baseCost;costAfter=$changedCost;salesRecalculated=($changedSales -ne $baseSales);profitRecalculated=($changedProfit -ne $baseProfit);restored=$true;saved=$false}|ConvertTo-Json -Compress
} finally {
 if($book){$book.Close($false);[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($book)}
 if($excel){$excel.Quit();[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
