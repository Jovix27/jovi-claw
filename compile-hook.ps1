# compile-hook.ps1
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Get-Location }

Write-Host "Compiling jovi-hook.cs..." -ForegroundColor Cyan

$CsFile = Join-Path $ScriptDir "jovi-hook.cs"
$ExeFile = Join-Path $ScriptDir "jovi-listener.exe"

$Compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $Compiler)) {
    Write-Host "Error: C# compiler not found at $Compiler" -ForegroundColor Red
    exit 1
}

# Compile as Windows executable (no console window)
& $Compiler /nologo /target:winexe /out:"$ExeFile" "$CsFile"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ jovi-listener.exe compiled successfully!" -ForegroundColor Green
}
else {
    Write-Host "❌ Compilation failed." -ForegroundColor Red
    exit 1
}
