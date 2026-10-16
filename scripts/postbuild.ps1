# Copies a freshly built binary into the project root.
#
# Invoked by wails.json -> postBuildHooks. Wails runs hooks with the working
# directory set to build/bin and replaces ${bin} with the compiled binary path,
# so the same build also leaves a copy in build/bin.
#
#   usage: powershell -NoProfile -File scripts/postbuild.ps1 <path-to-binary>
#
# An optional second argument overrides the output directory (defaults to the
# project root).

param(
    [Parameter(Mandatory = $true)][string]$Binary,
    [string]$Destination = ''
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Binary -PathType Leaf)) {
    throw "postbuild: built binary not found: $Binary"
}

# $PSScriptRoot is <project>/scripts, so the parent is the project root.
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = $root
}
if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
}

$target = Join-Path $Destination (Split-Path -Leaf $Binary)
Copy-Item -LiteralPath $Binary -Destination $target -Force

# Notify Explorer about both updated executables; do not delete the user's cache.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class XsshShellNotify {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHChangeNotify(uint eventId, uint flags, string item1, IntPtr item2);
}
'@
foreach ($path in @($target, (Resolve-Path -LiteralPath $Binary).Path)) {
    [XsshShellNotify]::SHChangeNotify(0x00002000, 0x1005, $path, [IntPtr]::Zero)
}

$size = [math]::Round((Get-Item -LiteralPath $target).Length / 1MB, 2)
Write-Host "postbuild: $target ($size MB)"
