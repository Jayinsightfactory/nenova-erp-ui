param([string]$Directory = 'outputs/alstro-pairs')
$ErrorActionPreference = 'Stop'
$directoryPath = (Resolve-Path -LiteralPath $Directory).Path
$excelTask = New-Object -ComObject Excel.Application
$excelTask.Visible = $false
$excelTask.DisplayAlerts = $false
function Assert-Equal($actual, $expected, $label) {
  if ($actual -ne $expected) { throw "$label expected=$expected actual=$actual" }
}
try {
  $bookTask = $excelTask.Workbooks.Open((Join-Path $directoryPath 'alstro-pairs.xlsx'))
  $sheetTask = $bookTask.Worksheets.Item('알스트로')
  $excelTask.CalculateFull()
  Assert-Equal $sheetTask.Range('C4').Text '(2)' 'Initial box'
  $sheetTask.Range('B4').Value2 = 48
  $excelTask.CalculateFull()
  Assert-Equal $sheetTask.Range('C4').Text '(3)' 'Edited box'
  Assert-Equal $sheetTask.Range('F4').Value2 48 'Edited total'
  $sheetTask.Range('B:C').Copy()
  [void]$sheetTask.Range('F:G').Insert(-4161)
  $excelTask.CutCopyMode = $false
  $sheetTask.Range('F3').Value2 = 'New customer'
  $sheetTask.Range('F4').Value2 = 16
  $excelTask.CalculateFull()
  Assert-Equal $sheetTask.Range('G4').Text '(1)' 'Inserted box'
  Assert-Equal $sheetTask.Range('H4').Value2 64 'Inserted customer total'
  Assert-Equal $sheetTask.Range('I4').Text '(4)' 'Inserted total boxes'
  Assert-Equal $sheetTask.Range('F6').Value2 16 'Copied column total'
  [void]$sheetTask.Range('B4').ClearContents()
  $excelTask.CalculateFull()
  Assert-Equal $sheetTask.Range('C4').Text '' 'Deleted quantity box'
  Assert-Equal $sheetTask.Range('H4').Value2 16 'Deleted quantity total'
  $sheetTask.Range('B5').Value2 = 8
  $sheetTask.Range('D4').Value2 = -4
  $excelTask.CalculateFull()
  Assert-Equal $sheetTask.Range('C5').Text '(0.5)' 'Initially blank quantity'
  Assert-Equal $sheetTask.Range('E4').Text '(-0.25)' 'Negative box'
  Assert-Equal $sheetTask.Range('H6').Value2 36 'Grand total'
  Assert-Equal $sheetTask.Range('I6').Text '(2.25)' 'Grand total boxes'
  $sheetTask.Range('Q4').Value2 = 80
  $excelTask.CalculateFull()
  Assert-Equal $sheetTask.Range('S4').Value2 80 'Farm sum'
  Assert-Equal $sheetTask.Range('J4').Value2 80 'Incoming linked to farms'
  Assert-Equal $sheetTask.Range('N4').Value2 68 'Remaining follows incoming'
  $bookTask.SaveAs((Join-Path $directoryPath 'alstro-edited.xlsx'), 51)
  $sheetTask.PageSetup.Orientation = 2
  $sheetTask.PageSetup.Zoom = $false
  $sheetTask.PageSetup.FitToPagesWide = 1
  $sheetTask.ExportAsFixedFormat(0, (Join-Path $directoryPath 'alstro-preview.pdf'))
  Write-Output 'Excel native recalculation: edit/delete/blank/negative/copied pair insertion/totals PASS'
} finally {
  if ($bookTask) { $bookTask.Close($false) }
  $excelTask.Quit()
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excelTask)
}
