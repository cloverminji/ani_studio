@echo off
chcp 65001 >nul
echo ================================================================
echo  🔐 AI 미디어월 로컬 SSL 인증서 생성 도구 (mkcert / Node.js)
echo ================================================================
echo.

REM 1. mkcert 설치 여부 확인
where mkcert >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [1/2] mkcert가 감지되었습니다. 로컬 CA 신뢰 인증서를 생성합니다...
    mkcert -install
    if not exist "certs" mkdir certs
    node -e "const { getAllLocalIps } = require('./scripts/generate-cert'); console.log(getAllLocalIps().filter(i=>i!=='localhost'&&i!=='127.0.0.1').join(' '));" > temp_ips.txt
    set /p LOCAL_IPS=<temp_ips.txt
    del temp_ips.txt
    echo [2/2] 인증서 발급 중: localhost 127.0.0.1 %LOCAL_IPS%
    mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost 127.0.0.1 %LOCAL_IPS%
    echo ✅ mkcert를 통한 100%% 신뢰 인증서 생성이 완료되었습니다!
    goto :done
)

REM 2. mkcert가 없을 경우 Node.js 내장 스크립트 실행
echo [안내] mkcert가 설치되어 있지 않습니다.
echo Node.js 내장 도구로 로컬 SAN 인증서를 생성합니다...
node scripts/generate-cert.js

:done
echo.
echo ================================================================
echo  인증서 생성 작업이 완료되었습니다. (certs/cert.pem, certs/key.pem)
echo  'npm run start' 또는 'npm run start:https'로 서버를 실행하세요.
echo ================================================================
pause
