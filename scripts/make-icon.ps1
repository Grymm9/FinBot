# Generates build/icon.png (512px) and build/icon.ico from the same geometry as
# src/renderer/src/components/BrandMark.tsx. Run from the project root:
#   powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
#
# The .ico stores uncompressed 32bpp BMP entries rather than PNG-compressed
# ones: Windows renders both, but NSIS (used by electron-builder) can only
# read BMP entries and otherwise fails with "unable to read icon from file".
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $build | Out-Null

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-MarkBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $scale = $size / 64.0
  $g.ScaleTransform($scale, $scale)

  $bgPath = New-RoundedPath 0 0 64 64 16
  $p1 = New-Object System.Drawing.PointF(6, 2)
  $p2 = New-Object System.Drawing.PointF(58, 64)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($p1, $p2, [System.Drawing.Color]::White, [System.Drawing.Color]::White)
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
  $blend.Colors = @(
    [System.Drawing.ColorTranslator]::FromHtml('#8fd2ff'),
    [System.Drawing.ColorTranslator]::FromHtml('#3ea6ff'),
    [System.Drawing.ColorTranslator]::FromHtml('#1769d2')
  )
  $blend.Positions = @(0.0, 0.38, 1.0)
  $brush.InterpolationColors = $blend
  $g.FillPath($brush, $bgPath)

  # Soft top-left sheen.
  $sheen = New-Object System.Drawing.Drawing2D.GraphicsPath
  $sheen.AddEllipse(-14, -22, 70, 52)
  $sheenBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($sheen)
  $sheenBrush.CenterColor = [System.Drawing.Color]::FromArgb(70, 255, 255, 255)
  $sheenBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
  $g.FillPath($sheenBrush, $sheen)

  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $soft = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210, 255, 255, 255))
  $faint = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 255, 255, 255))

  foreach ($bar in @(
    @(15.0, 37.0, 7.0, 13.0, 3.5, 210),
    @(28.5, 28.0, 7.0, 22.0, 3.5, 235),
    @(42.0, 17.0, 7.0, 33.0, 3.5, 255)
  )) {
    $barPath = New-RoundedPath $bar[0] $bar[1] $bar[2] $bar[3] $bar[4]
    $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb([int]$bar[5], 255, 255, 255))
    $g.FillPath($b, $barPath)
    $b.Dispose()
    $barPath.Dispose()
  }

  $dot = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#e6f6ff'))
  $g.FillEllipse($dot, 49.7, 10.7, 5.6, 5.6)

  $dot.Dispose()
  $white.Dispose()
  $soft.Dispose()
  $faint.Dispose()
  $sheenBrush.Dispose()
  $sheen.Dispose()
  $brush.Dispose()
  $bgPath.Dispose()
  $g.Dispose()
  return $bmp
}

function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $ms.Dispose()
  return ,$bytes
}

# One ICONIMAGE: BITMAPINFOHEADER + bottom-up BGRA pixels + a fully opaque
# AND mask. NSIS reads this; PNG-compressed entries are rejected.
function Get-IconBmpBytes([System.Drawing.Bitmap]$bmp) {
  $w = $bmp.Width
  $h = $bmp.Height
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $raw = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
  $bmp.UnlockBits($data)

  $xorSize = $w * 4 * $h
  $maskStride = [int]([math]::Floor(($w + 31) / 32) * 4)
  $maskSize = $maskStride * $h

  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([UInt32]40)
  $bw.Write([Int32]$w)
  $bw.Write([Int32]($h * 2))
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]0)
  $bw.Write([UInt32]($xorSize + $maskSize))
  $bw.Write([Int32]0)
  $bw.Write([Int32]0)
  $bw.Write([UInt32]0)
  $bw.Write([UInt32]0)
  for ($y = $h - 1; $y -ge 0; $y--) {
    $bw.Write($raw, $y * $stride, $w * 4)
  }
  $bw.Write((New-Object byte[] $maskSize), 0, $maskSize)
  $bw.Flush()
  $bytes = $ms.ToArray()
  $bw.Dispose()
  $ms.Dispose()
  return ,$bytes
}

$bmp512 = New-MarkBitmap 512
[System.IO.File]::WriteAllBytes((Join-Path $build 'icon.png'), (Get-PngBytes $bmp512))
$bmp512.Dispose()

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
  $bmp = New-MarkBitmap $size
  $images += ,(Get-IconBmpBytes $bmp)
  $bmp.Dispose()
}

$icoPath = Join-Path $build 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)

$offset = 6 + (16 * $sizes.Count)
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $size = $sizes[$i]
  $data = $images[$i]
  $dim = if ($size -ge 256) { 0 } else { $size }
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$data.Length)
  $bw.Write([UInt32]$offset)
  $offset += $data.Length
}
foreach ($data in $images) { $bw.Write($data) }
$bw.Flush()
$bw.Dispose()
$fs.Dispose()

Write-Host "Wrote build/icon.png (512x512) and build/icon.ico ($($sizes -join ', '), BMP entries)"
