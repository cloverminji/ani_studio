/**
 * scripts/generate-cert.js
 * 로컬 HTTPS 구동을 위한 SSL 인증서 생성 스크립트
 * - mkcert 인증서(certs/cert.pem)가 있으면 우선 사용
 * - 없는 경우 pure-JS selfsigned 모듈로 로컬 IP와 localhost를 모두 포함한 SAN 인증서 자동 생성
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const selfsigned = require('selfsigned');

function getAllLocalIps() {
  const ips = ['127.0.0.1', 'localhost'];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return [...new Set(ips)];
}

async function generateCertificates() {
  const certsDir = path.join(__dirname, '..', 'certs');
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
  }

  const certPath = path.join(certsDir, 'cert.pem');
  const keyPath = path.join(certsDir, 'key.pem');

  const ips = getAllLocalIps();
  console.log('🔍 감지된 로컬 호스트 및 IP 목록:', ips);

  // SAN (Subject Alternative Name) 설정
  const altNames = ips.map(ip => {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)
      ? { type: 7, ip: ip } // IP Address
      : { type: 2, value: ip }; // DNS Name
  });

  const attrs = [{ name: 'commonName', value: ips.find(ip => ip !== '127.0.0.1' && ip !== 'localhost') || 'localhost' }];
  
  console.log('🔐 로컬 SSL 인증서(Key & Cert)를 생성합니다 (유효기간: 365일)...');
  const pems = await selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'basicConstraints',
        cA: true
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        keyEncipherment: true
      },
      {
        name: 'subjectAltName',
        altNames: altNames
      }
    ]
  });

  fs.writeFileSync(keyPath, pems.private, 'utf8');
  fs.writeFileSync(certPath, pems.cert, 'utf8');

  console.log('✅ 인증서 생성 완료:');
  console.log(`   - 개인키: ${keyPath}`);
  console.log(`   - 인증서: ${certPath}`);
  console.log('');
  console.log('💡 안내: 브라우저 경고 없이 완전히 신뢰된 인증서를 사용하려면 mkcert를 사용하세요:');
  console.log(`   1) mkcert -install`);
  console.log(`   2) mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost 127.0.0.1 ${ips.filter(i => i !== 'localhost' && i !== '127.0.0.1').join(' ')}`);
}

if (require.main === module) {
  generateCertificates().catch(err => {
    console.error('인증서 생성 실패:', err);
    process.exit(1);
  });
}

module.exports = { generateCertificates, getAllLocalIps };
