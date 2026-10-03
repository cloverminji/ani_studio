# scripts/generate-cert.ps1
# 로컬 HTTPS 인증서 생성 스크립트 (mkcert 또는 Node.js)

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " 🔐 AI 미디어월 로컬 SSL 인증서 생성 도구 (mkcert / Node.js)" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

$mkcertCmd = Get-Command mkcert -ErrorAction SilentlyContinue

if ($mkcertCmd) {
    Write-Host "[1/2] mkcert가 감지되었습니다. 로컬 CA 신뢰 인증서를 등록합니다..." -ForegroundColor Green
    & mkcert -install
    
    if (-not (Test-Path "certs")) {
        New-Item -ItemType Directory -Path "certs" | Out-Null
    }
    
    $localIps = node -e "const { getAllLocalIps } = require('./scripts/generate-cert'); console.log(getAllLocalIps().filter(i => i !== 'localhost' && i !== '127.0.0.1').join(' '));"
    Write-Host "[2/2] 인증서 발급 중: localhost 127.0.0.1 $localIps" -ForegroundColor Green
    
    $ipArgs = @("localhost", "127.0.0.1") + ($localIps -split " ")
    & mkcert -key-file certs/key.pem -cert-file certs/cert.pem $ipArgs
    
    Write-Host "✅ mkcert를 통한 브라우저 신뢰 인증서 생성이 완료되었습니다!" -ForegroundColor Green
} else {
    Write-Host "[안내] mkcert 명령어를 찾을 수 없습니다." -ForegroundColor Yellow
    Write-Host "Node.js 내장 도구로 로컬 SAN 인증서를 생성합니다..." -ForegroundColor Yellow
    node scripts/generate-cert.js
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " 작업이 완료되었습니다. 'npm run start' 또는 'npm run start:https'로 실행하세요." -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
