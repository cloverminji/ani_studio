/**
 * scripts/optimize-drawings.js
 * drawing 폴더 내 도안 이미지를 원본 품질을 유지하면서 웹 최적화(최대 900x900, 고효율 PNG 압축)합니다.
 * 원본은 drawing_backup 폴더에 안전하게 백업합니다.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DRAW_DIR = path.join(__dirname, '..', 'drawing');
const BACKUP_DIR = path.join(__dirname, '..', 'drawing_backup');

async function main() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log('📁 백업 디렉토리 생성:', BACKUP_DIR);
  }

  const files = fs.readdirSync(DRAW_DIR).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
  console.log(`🔍 총 ${files.length}개 도안 최적화 시작...`);

  let totalBefore = 0;
  let totalAfter = 0;

  for (const file of files) {
    const srcPath = path.join(DRAW_DIR, file);
    const backupPath = path.join(BACKUP_DIR, file);

    // 1. 원본 백업 (백업본이 없을 때만 복사)
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(srcPath, backupPath);
    }

    const beforeStat = fs.statSync(backupPath);
    totalBefore += beforeStat.size;

    // 2. sharp 최적화: 가로세로 900 이내로 스마트 리사이즈 + PNG 압축
    try {
      const buffer = await sharp(backupPath)
        .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true,
          effort: 7,
          palette: true,
          quality: 90
        })
        .toBuffer();

      // 최적화된 결과가 원본보다 작을 때만 덮어쓰기
      if (buffer.length < beforeStat.size) {
        fs.writeFileSync(srcPath, buffer);
        totalAfter += buffer.length;
        console.log(`✅ [최적화] ${file}: ${(beforeStat.size / 1024 / 1024).toFixed(2)} MB ➔ ${(buffer.length / 1024).toFixed(1)} KB (-${(100 - (buffer.length / beforeStat.size * 100)).toFixed(1)}%)`);
      } else {
        totalAfter += beforeStat.size;
        console.log(`⏩ [유지] ${file}: 이미 충분히 최적화됨 (${(beforeStat.size / 1024).toFixed(1)} KB)`);
      }
    } catch (err) {
      console.error(`❌ ${file} 최적화 실패:`, err.message);
      totalAfter += beforeStat.size;
    }
  }

  console.log('====================================================');
  console.log(`🎉 전체 최적화 완료!`);
  console.log(`이전 총 용량: ${(totalBefore / 1024 / 1024).toFixed(2)} MB`);
  console.log(`이후 총 용량: ${(totalAfter / 1024 / 1024).toFixed(2)} MB`);
  console.log(`절감률: ${(100 - (totalAfter / totalBefore * 100)).toFixed(1)}% 절감`);
  console.log('====================================================');
}

main().catch(console.error);
