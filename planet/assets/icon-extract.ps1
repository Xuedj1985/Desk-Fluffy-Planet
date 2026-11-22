# icon-extract.ps1 —— 从 exe / dll / ico 里按索引提取高分辨率图标，输出 base64 PNG。
# 入参：-InFile  JSON 数组 [{ "id": "...", "path": "...", "index": 0 }, ...]
# 出参：-OutFile JSON 对象 { "<id>": "<base64 png>" | null }
# 说明：用 PrivateExtractIconsW 按 256 → 48 → 32 逐级尝试，拿到最大可用图标；
#       index 支持负数（资源 ID，Windows 会按绝对值取资源）。
param([Parameter(Mandatory=$true)][string]$InFile, [Parameter(Mandatory=$true)][string]$OutFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ('PlanetIconEx' -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PlanetIconEx {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint PrivateExtractIconsW(string szFileName, int nIconIndex, int cxIcon, int cyIcon,
    IntPtr[] phicon, uint[] piconid, uint nIcons, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr hIcon);
}
"@
}

function Get-IconPng([string]$file, [int]$index) {
  if ([string]::IsNullOrWhiteSpace($file)) { return $null }
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  foreach ($size in @(256, 128, 64, 48, 32, 16)) {
    $h = New-Object IntPtr[] 1
    $ids = New-Object uint32[] 1
    try {
      $n = [PlanetIconEx]::PrivateExtractIconsW($file, $index, $size, $size, $h, $ids, 1, 0)
    } catch { $n = 0 }
    if ($n -ge 1 -and $h[0] -ne [IntPtr]::Zero) {
      try {
        $ico = [System.Drawing.Icon]::FromHandle($h[0])
        $bmp = $ico.ToBitmap()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $b64 = [Convert]::ToBase64String($ms.ToArray())
        $bmp.Dispose(); $ico.Dispose(); $ms.Dispose()
        return $b64
      } catch { }
      finally { [PlanetIconEx]::DestroyIcon($h[0]) | Out-Null }
    }
  }
  return $null
}

$items = Get-Content -Raw -LiteralPath $InFile | ConvertFrom-Json
if ($items -isnot [array]) { $items = @($items) }
$out = @{}
foreach ($it in $items) {
  $key = [string]$it.id
  try { $out[$key] = Get-IconPng ([string]$it.path) ([int]$it.index) }
  catch { $out[$key] = $null }
}
$json = $out | ConvertTo-Json -Compress -Depth 3
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
