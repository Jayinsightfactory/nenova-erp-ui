param([Parameter(Mandatory=$true)][string]$WorkbookPath,[Parameter(Mandatory=$true)][string]$PdfPath)
$ErrorActionPreference='Stop'
$excel=$null
$book=$null
$isolated=$false
try {
  $excel=New-Object -ComObject Excel.Application
  if($excel.Workbooks.Count -ne 0){throw 'Expected an isolated Excel instance'}
  $isolated=$true
  $excel.Visible=$false
  $excel.DisplayAlerts=$false
  $excel.AskToUpdateLinks=$false
  $excel.AutomationSecurity=3
  $book=$excel.Workbooks.Open([IO.Path]::GetFullPath($WorkbookPath),0,$true)
  $book.ExportAsFixedFormat(0,[IO.Path]::GetFullPath($PdfPath),0,$false,$false)
} finally {
  if($book){$book.Close($false);[Runtime.InteropServices.Marshal]::FinalReleaseComObject($book)|Out-Null}
  if($excel){if($isolated){$excel.Quit()};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)|Out-Null}
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
