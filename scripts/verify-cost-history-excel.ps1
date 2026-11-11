param([string]$Workbook='.verify/excel/real-history.xlsx')
$ErrorActionPreference='Stop'
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.AutomationSecurity=3
try{
 $book=$excel.Workbooks.Open((Resolve-Path $Workbook).Path,0,$false)
 try{
  $sheet=$book.Worksheets.Item($book.Worksheets.Count)
  $excel.CalculateFullRebuild()
  $before=$sheet.Range('O15').Value2
  $sheet.Range('F15').Value2=[double]$sheet.Range('F15').Value2*2
  $excel.CalculateFullRebuild()
  $after=$sheet.Range('O15').Value2
  if(-not($before -is [double]) -or -not($after -is [double]) -or $before -eq $after){throw 'History calculation link failed'}
  [pscustomobject]@{sheetCount=$book.Worksheets.Count;activeSheet=$book.ActiveSheet.Name;newPriceLinked=($after -ne $before);before=$before;after=$after} | ConvertTo-Json
 }finally{$book.Close($false)}
}finally{$excel.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}
