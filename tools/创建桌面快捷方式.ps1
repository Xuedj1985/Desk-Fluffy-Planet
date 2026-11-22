$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot '糖绒星球.exe'
if (-not (Test-Path $exe)) {
  Write-Host '找不到 糖绒星球.exe，请把本脚本放回软件文件夹里再运行。'
  exit 1
}
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop '糖绒星球.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $exe
$s.WorkingDirectory = $PSScriptRoot
$s.IconLocation = $exe
$s.Description = '糖绒星球 · Windows 桌面层主题'
$s.Save()
Write-Host ''
Write-Host '已在桌面创建快捷方式：' $lnk
Write-Host '双击它就能启动糖绒星球。'
