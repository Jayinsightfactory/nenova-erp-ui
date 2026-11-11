param([string]$Workbook='.verify/excel/real-history.xlsx')
$ErrorActionPreference='Stop'
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.AutomationSecurity=3
try{
 $book=$excel.Workbooks.Open((Resolve-Path $Workbook).Path,0,$false)
 try{
  $sheet=$book.Worksheets.Item($book.Worksheets.Count)
  if($book.Windows.Item(1).SelectedSheets.Count -ne 1){throw 'Grouped sheets could modify historical cells'}
  $excel.CalculateFullRebuild()
  $oldValues=New-Object 'System.Collections.Generic.List[object]'
  for($i=1;$i -le $book.Worksheets.Count-3;$i++){$oldValues.Add($book.Worksheets.Item($i).Range('F15').Value2)}
  $before=$sheet.Range('O15').Value2
  $sheet.Range('F15').Value2=[double]$sheet.Range('F15').Value2*2
  $excel.CalculateFullRebuild()
  $after=$sheet.Range('O15').Value2
  for($i=1;$i -le $oldValues.Count;$i++){if([string]$book.Worksheets.Item($i).Range('F15').Value2 -ne [string]$oldValues[$i-1]){throw 'Historical cell changed while editing current sheet'}}
  if(-not($before -is [double]) -or -not($after -is [double]) -or $before -eq $after){throw 'History calculation link failed'}
  [pscustomobject]@{sheetCount=$book.Worksheets.Count;selectedSheetCount=$book.Windows.Item(1).SelectedSheets.Count;activeSheet=$book.ActiveSheet.Name;newPriceLinked=($after -ne $before);before=$before;after=$after} | ConvertTo-Json
 }finally{$book.Close($false)}
}finally{$excel.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}
