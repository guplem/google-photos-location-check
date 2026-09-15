# Draws the extension icons.
# Run from the project root:  powershell -ExecutionPolicy Bypass -File scripts/makeIcons.ps1
# The artwork matches the badge drawn on a thumbnail: a map pin with a stroke through it.

Add-Type -AssemblyName System.Drawing

$source = 512
$bitmap = New-Object System.Drawing.Bitmap($source, $source)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

# Dark rounded square background.
$radius = [int]($source * 0.22)
$background = New-Object System.Drawing.Drawing2D.GraphicsPath
$background.AddArc(0, 0, $radius * 2, $radius * 2, 180, 90)
$background.AddArc($source - $radius * 2, 0, $radius * 2, $radius * 2, 270, 90)
$background.AddArc($source - $radius * 2, $source - $radius * 2, $radius * 2, $radius * 2, 0, 90)
$background.AddArc(0, $source - $radius * 2, $radius * 2, $radius * 2, 90, 90)
$background.CloseFigure()
$backgroundBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 32, 33, 36))
$graphics.FillPath($backgroundBrush, $background)

$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 255, 143, 0)), 44
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

# The pin: a circle open at the bottom, closed by two lines meeting at the tip.
# The arc starts at 150 degrees and sweeps 240, so it ends at 30 degrees, and the
# two open ends are exactly where the lines to the tip begin.
$pin = New-Object System.Drawing.Drawing2D.GraphicsPath
$pin.AddArc(161, 105, 190, 190, 150, 240)
$pin.AddLine(338, 247, 256, 404)
$pin.AddLine(256, 404, 174, 247)
$pin.CloseFigure()
$graphics.DrawPath($pen, $pin)

# The stroke through it, in the same place as the badge's.
$graphics.DrawLine($pen, 96, 84, 416, 428)

$outputDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'icons'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

foreach ($size in 16, 32, 48, 128) {
  $scaled = New-Object System.Drawing.Bitmap($size, $size)
  $scaledGraphics = [System.Drawing.Graphics]::FromImage($scaled)
  $scaledGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $scaledGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $scaledGraphics.DrawImage($bitmap, 0, 0, $size, $size)
  $scaled.Save((Join-Path $outputDirectory "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $scaledGraphics.Dispose()
  $scaled.Dispose()
  Write-Host "wrote icon$size.png"
}

$graphics.Dispose()
$bitmap.Dispose()
