# Branchly - Windows'ta tek komutla derleme
# Kullanım (PowerShell):  powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
$ErrorActionPreference = "Stop"

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Eksik: $cmd  ->  $hint" -ForegroundColor Red
    exit 1
  }
}

Need "node"  "Node.js 20+ kurun: https://nodejs.org"
Need "cargo" "Rust kurun: https://rustup.rs  (Visual Studio C++ Build Tools ile birlikte)"
Need "git"   "Git for Windows kurun: https://git-scm.com"

Write-Host "Bağımlılıklar kuruluyor..." -ForegroundColor Cyan
npm ci

Write-Host "Derleniyor (ilk derleme 5-10 dk sürebilir)..." -ForegroundColor Cyan
npx tauri build

$out = "src-tauri\target\release\bundle"
Write-Host ""
Write-Host "Hazır! Kurulum dosyaları:" -ForegroundColor Green
Get-ChildItem "$out\msi\*.msi", "$out\nsis\*.exe" | ForEach-Object { Write-Host "  $($_.FullName)" }
Write-Host "Kurulum yapmadan çalıştırmak için: src-tauri\target\release\branchly.exe"
