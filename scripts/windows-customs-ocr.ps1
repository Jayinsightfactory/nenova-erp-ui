param([Parameter(Mandatory=$true)][string]$ImagePath,[Parameter(Mandatory=$true)][int]$FullWidth,[Parameter(Mandatory=$true)][int]$FullHeight,[Parameter(Mandatory=$true)][int]$CropTop)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language,Windows.Foundation,ContentType=WindowsRuntime]
$asTaskGeneric=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]
function Await($operation,$type){$task=$asTaskGeneric.MakeGenericMethod($type).Invoke($null,@($operation));$task.Wait();return $task.Result}
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('ko'))
if(!$engine){throw 'Korean Windows OCR is unavailable'}
$source=(Resolve-Path -LiteralPath $ImagePath).Path
$file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($source)) ([Windows.Storage.StorageFile])
$stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$bitmap=$null
try {
 $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
 $bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
 $result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
 $out=@();foreach($line in $result.Lines){foreach($word in $line.Words){$r=$word.BoundingRect;$y=$FullHeight-$CropTop-$r.Y-$r.Height;if($y -ge $FullHeight*.32 -and $y -le $FullHeight*.76){$out+=@{str=$word.Text;x=$r.X;y=$y;width=$r.Width;height=$r.Height}}}}
 [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
 @{page=1;width=$FullWidth;height=$FullHeight;items=$out}|ConvertTo-Json -Depth 6 -Compress
} finally {if($bitmap){$bitmap.Dispose()};$stream.Dispose()}
