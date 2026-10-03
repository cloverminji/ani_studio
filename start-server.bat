@echo off
chcp 65001 >nul
echo ================================================================
echo  🎨 AI 미디어월 10대 오프라인 실시간 동기화 서버 시작
echo ================================================================
echo.

REM 인증서 존재 여부 확인 후 없으면 자동 생성
if not exist "certs\cert.pem" (
    echo [1/2] 로컬 SSL 인증서 자동 생성 중...
    node scripts/generate-cert.js
)

echo [2/2] Node.js 호스트 서버 구동 중...
node server.js

pause
