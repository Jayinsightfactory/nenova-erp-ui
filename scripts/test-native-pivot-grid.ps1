param([Parameter(Mandatory=$true)][string]$Candidate,[Parameter(Mandatory=$true)][string]$InstallDirectory,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Data
# Load existing dependencies only; never invoke Nenova Main, Load or GetData (no DB).
Get-ChildItem -LiteralPath $InstallDirectory -Filter 'DevExpress*.dll' | ForEach-Object {
  [void][Reflection.Assembly]::LoadFrom($_.FullName)
}
$assembly=[Reflection.Assembly]::LoadFile((Resolve-Path -LiteralPath $Candidate).Path)
$type=$assembly.GetType('Nenova.FormQuantityPivot',$true)
$form=[Activator]::CreateInstance($type)
try {
 $flags=[Reflection.BindingFlags]'Instance,NonPublic'
 $grid=$type.GetField('pgrdShipment',$flags).GetValue($form)
 $table=New-Object System.Data.DataTable
 foreach($name in @('OrderYear','OrderWeek','CounName','FlowerName','ProdName','CountryFlower','CustKey','CustName','CustArea','CustDescr','OrderNo','ShipmentDtm','ListType')){
  [void]$table.Columns.Add($name,[string])
 }
 foreach($name in @('Quantity','UPrice','TPrice')){[void]$table.Columns.Add($name,[decimal])}
 foreach($year in @('2025','2026')){ foreach($week in @('01-01','44-01','44-02')){ foreach($country in @('country-a','country-b','country-c')){ foreach($quantity in @(10,-3)){
  $row=$table.NewRow()
  $row.OrderYear=$year;$row.OrderWeek=$week;$row.CounName=$country;$row.FlowerName='fixture-flower'
  $row.ProdName='fixture-product';$row.CustName=if($quantity -lt 0){'negative'}else{'positive'}
  $row.ListType='02. order';$row.Quantity=$quantity;$row.UPrice=0;$row.TPrice=0
  [void]$table.Rows.Add($row)
 }
 }}}
 $grid.CreateControl()
 $grid.DataSource=$table
 $grid.RefreshData()
 # Locate the actual data-area field; native data binding may leave FieldName empty.
 $dataFields=@($grid.Fields | Where-Object {$_.Area.ToString() -eq 'DataArea'})
 if($dataFields.Count -ne 1){throw "Unexpected data field count: $($dataFields.Count)"}
 if($dataFields[0].SummaryType.ToString() -ne 'Sum'){throw 'Native quantity aggregation is not SUM'}
 $values=@()
 for($x=0;$x -lt $grid.Cells.ColumnCount;$x++){
  for($y=0;$y -lt $grid.Cells.RowCount;$y++){
   $value=$grid.GetCellValue($x,$y)
   if($null -ne $value -and $value -isnot [DBNull]){$values += [decimal]$value}
  }
 }
 if($values -notcontains -3 -or $values -notcontains 7 -or $values -notcontains 126){throw "Native grid did not retain negative/net totals: $($values -join ',')"}
 $options=New-Object DevExpress.XtraPrinting.XlsxExportOptionsEx
 $options.ExportType=[DevExpress.Export.ExportType]::WYSIWYG
 $grid.ExportToXlsx([IO.Path]::GetFullPath($Output),$options)
 [pscustomobject]@{rows=$grid.Cells.RowCount;columns=$grid.Cells.ColumnCount;negative=($values -contains -3);net=($values -contains 7);summary=$dataFields[0].SummaryType.ToString()} | ConvertTo-Json
} finally {$form.Dispose()}
