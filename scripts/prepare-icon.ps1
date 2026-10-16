# Logo.png is the single source of truth for Windows and frontend branding.
# Wails generates the ICO from build/appicon.png during packaging. Keeping that
# conversion in Wails avoids a hand-written ICO that can be ignored by Windows.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'Logo.png'
$iconPath = Join-Path $root 'build/windows/icon.ico'

Copy-Item -LiteralPath $source -Destination (Join-Path $root 'build/appicon.png') -Force
if (Test-Path -LiteralPath $iconPath) {
    Remove-Item -LiteralPath $iconPath -Force
}

$image = [System.Drawing.Image]::FromFile($source)
$bitmap = New-Object System.Drawing.Bitmap(128, 128)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$png = New-Object System.IO.MemoryStream
try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $scale = [Math]::Min(128 / $image.Width, 128 / $image.Height)
    $width = [int]($image.Width * $scale)
    $height = [int]($image.Height * $scale)
    $graphics.DrawImage($image, [int]((128 - $width) / 2), [int]((128 - $height) / 2), $width, $height)
    $bitmap.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
    [System.IO.File]::WriteAllBytes((Join-Path $root 'frontend/src/assets/images/logo.png'), $png.ToArray())
    Write-Host 'Brand assets prepared from Logo.png; Wails will generate icon.ico.'
} finally {
    $png.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
    $image.Dispose()
}
