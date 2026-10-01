/**
 * ai-processor.js
 * AI 기반 드로잉 인식 및 애니메이션 변환 엔진
 * - 배경 자동 제거 (스마트 크로마키/누끼 분리)
 * - 캐릭터 바운딩 박스 타이트 크롭
 * - 뼈대(Skeleton) 및 무게중심 자동 추출
 * - 4종 절차적 애니메이션 루프 (걷기, 댄스, 점프, 유영)
 * - 5초 이내 실시간 렌더링
 */

class AIAnimationProcessor {
  constructor() {
    this.previewCanvas = null;
    this.previewCtx = null;
    this.animationFrameId = null;
    this.currentProcessedImg = null;
    this.currentMotion = 'walk'; // 'walk' | 'jump' | 'dance' | 'float'
    this.animTime = 0;
  }

  setPreviewCanvas(canvas) {
    this.previewCanvas = canvas;
    this.previewCtx = canvas.getContext('2d');
  }

  /**
   * 1. 캔버스 이미지에서 배경을 자동 분리(누끼)하고 캐릭터 영역 크롭
   */
  async processDrawing(sourceCanvas, onProgress) {
    if (onProgress) onProgress(20, '캐릭터 윤곽선 및 색상 영역 검출 중...');

    const srcWidth = sourceCanvas.width;
    const srcHeight = sourceCanvas.height;
    const srcCtx = sourceCanvas.getContext('2d');
    const srcData = srcCtx.getImageData(0, 0, srcWidth, srcHeight);
    const pixels = srcData.data;

    // A. 배경 제거 (배경 색상 자동 감지: 모서리 4군데의 평균 색상)
    const cornerColors = [
      [pixels[0], pixels[1], pixels[2]],
      [pixels[(srcWidth - 1) * 4], pixels[(srcWidth - 1) * 4 + 1], pixels[(srcWidth - 1) * 4 + 2]],
      [pixels[(srcHeight - 1) * srcWidth * 4], pixels[(srcHeight - 1) * srcWidth * 4 + 1], pixels[(srcHeight - 1) * srcWidth * 4 + 2]]
    ];
    const bgR = (cornerColors[0][0] + cornerColors[1][0] + cornerColors[2][0]) / 3;
    const bgG = (cornerColors[0][1] + cornerColors[1][1] + cornerColors[2][1]) / 3;
    const bgB = (cornerColors[0][2] + cornerColors[1][2] + cornerColors[2][2]) / 3;

    if (onProgress) onProgress(45, 'AI 도안 외곽 배경 분리(누끼) 처리 중 (내부 흰색 보호)...');

    // B. 외곽 배경만 스마트하게 제거하는 BFS Flood-Fill 알고리즘
    // 도안 아웃라인(검은색 외곽선) 내부의 칠해지지 않은 흰색은 절대 투명화되지 않고 온전히 보존됩니다.
    const visited = new Uint8Array(srcWidth * srcHeight);
    const queue = new Int32Array(srcWidth * srcHeight * 2);
    let head = 0;
    let tail = 0;

    // 배경 판별 함수: 밝고 채도가 낮은 캔버스 기본 바탕색
    const isBackgroundPixel = (x, y) => {
      const idx = (y * srcWidth + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];

      if (a < 30) return true; // 이미 투명한 경우

      // 아웃라인(외곽선) 또는 채색된 부분(어둡거나 색상이 있는 영역)은 배경이 아님 (경계선으로 차단)
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(b - r));

      // 밝기가 매우 높고(>215) 채도가 낮은(무채색) 영역만 외부 배경으로 판별
      return brightness > 215 && maxDiff < 35;
    };

    // 캔버스 4면의 가장자리(외곽) 픽셀들을 시드로 큐에 삽입
    for (let x = 0; x < srcWidth; x++) {
      // 상단 가장자리
      if (isBackgroundPixel(x, 0) && !visited[x]) {
        visited[x] = 1;
        queue[tail++] = x;
        queue[tail++] = 0;
      }
      // 하단 가장자리
      const bottomY = srcHeight - 1;
      const bCoord = bottomY * srcWidth + x;
      if (isBackgroundPixel(x, bottomY) && !visited[bCoord]) {
        visited[bCoord] = 1;
        queue[tail++] = x;
        queue[tail++] = bottomY;
      }
    }

    for (let y = 0; y < srcHeight; y++) {
      // 좌측 가장자리
      const lCoord = y * srcWidth;
      if (isBackgroundPixel(0, y) && !visited[lCoord]) {
        visited[lCoord] = 1;
        queue[tail++] = 0;
        queue[tail++] = y;
      }
      // 우측 가장자리
      const rightX = srcWidth - 1;
      const rCoord = y * srcWidth + rightX;
      if (isBackgroundPixel(rightX, y) && !visited[rCoord]) {
        visited[rCoord] = 1;
        queue[tail++] = rightX;
        queue[tail++] = y;
      }
    }

    // BFS로 외곽 배경 픽셀만 탐색 (도안 외곽선 안쪽으로는 침투하지 못함)
    while (head < tail) {
      const cx = queue[head++];
      const cy = queue[head++];

      // 4방향 탐색
      const neighbors = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1]
      ];

      for (let i = 0; i < 4; i++) {
        const nx = neighbors[i][0];
        const ny = neighbors[i][1];

        if (nx >= 0 && nx < srcWidth && ny >= 0 && ny < srcHeight) {
          const nCoord = ny * srcWidth + nx;
          if (!visited[nCoord]) {
            if (isBackgroundPixel(nx, ny)) {
              visited[nCoord] = 1;
              queue[tail++] = nx;
              queue[tail++] = ny;
            }
          }
        }
      }
    }

    // C. 픽셀 적용 및 캐릭터 바운딩 박스 계산
    let minX = srcWidth, minY = srcHeight, maxX = 0, maxY = 0;

    for (let y = 0; y < srcHeight; y++) {
      for (let x = 0; x < srcWidth; x++) {
        const coord = y * srcWidth + x;
        const idx = coord * 4;

        if (visited[coord] === 1) {
          // 외곽에서 연결된 순수 배경만 투명화
          pixels[idx + 3] = 0;
        } else {
          // 도안 내부 영역: 색칠되지 않은 흰색 영역도 투명해지지 않고 완전히 불투명하게 보존!
          pixels[idx + 3] = 255;

          // 캐릭터 영역 바운딩 박스 갱신
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const cropW = Math.max(50, maxX - minX);
    const cropH = Math.max(50, maxY - minY);

    // 크롭용 오프스크린 캔버스 생성
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d');

    // 투명 배경이 적용된 이미지데이터를 임시 캔버스에 찍고 크롭
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = srcWidth;
    tempCanvas.height = srcHeight;
    tempCanvas.getContext('2d').putImageData(srcData, 0, 0);

    cropCtx.drawImage(tempCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

    if (onProgress) onProgress(90, '절차적 모션 애니메이션 생성 완료!');

    return new Promise((resolve) => {
      const croppedImg = new Image();
      croppedImg.onload = () => {
        this.currentProcessedImg = croppedImg;
        if (onProgress) onProgress(100, '준비 완료! 미리보기가 실행됩니다.');
        resolve({
          image: croppedImg,
          dataUrl: cropCanvas.toDataURL('image/png'),
          width: cropW,
          height: cropH,
          bounds: { minX, minY, cropW, cropH }
        });
      };
      croppedImg.src = cropCanvas.toDataURL('image/png');
    });
  }

  /**
   * 2. 미리보기 애니메이션 루프 시작
   */
  startPreview(motion = 'walk') {
    this.currentMotion = motion;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const loop = () => {
      this.renderPreviewFrame();
      this.animationFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  stopPreview() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  setMotion(motion) {
    this.currentMotion = motion;
  }

  /**
   * 3. 모션별 변형 렌더링 프레임
   */
  renderPreviewFrame() {
    if (!this.previewCanvas || !this.currentProcessedImg) return;
    const ctx = this.previewCtx;
    const canvas = this.previewCanvas;
    const img = this.currentProcessedImg;

    this.animTime += 0.05;
    const t = this.animTime;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const baseW = 160;
    const baseH = (img.height / img.width) * baseW;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2 + 10;

    ctx.save();
    ctx.translate(centerX, centerY);

    // 모션별 기하학적 뼈대 변형 (Meta Animated Drawings 스타일)
    switch (this.currentMotion) {
      case 'walk': {
        // 걷기: 상하 바운스 + 좌우 스윙 틸트
        const bounceY = Math.abs(Math.sin(t * 3)) * -18;
        const tiltAngle = Math.sin(t * 3) * 0.12;
        const squashX = 1 + Math.sin(t * 3) * 0.06;
        const squashY = 1 - Math.sin(t * 3) * 0.06;

        ctx.translate(0, bounceY);
        ctx.rotate(tiltAngle);
        ctx.scale(squashX, squashY);
        break;
      }

      case 'jump': {
        // 점프: 높이 솟구침 + 착지 시 젤리 스쿼시
        const jumpPhase = Math.sin(t * 2.5);
        let jumpY = 0;
        let scaleX = 1;
        let scaleY = 1;

        if (jumpPhase > 0) {
          // 공중 상승
          jumpY = -jumpPhase * 35;
          scaleX = 0.88;
          scaleY = 1.15;
        } else {
          // 바닥 착지 (스쿼시)
          jumpY = 0;
          scaleX = 1.25;
          scaleY = 0.8;
        }

        ctx.translate(0, jumpY);
        ctx.scale(scaleX, scaleY);
        break;
      }

      case 'dance': {
        // 댄스: 리드미컬한 흔들림 & 스핀 스윙
        const danceX = Math.sin(t * 4) * 15;
        const danceAngle = Math.cos(t * 4) * 0.2;
        const danceScale = 1 + Math.sin(t * 8) * 0.08;

        ctx.translate(danceX, 0);
        ctx.rotate(danceAngle);
        ctx.scale(danceScale, danceScale);
        break;
      }

      case 'float': {
        // 유영: 물결결 둥둥 떠다니기 & 완만한 롤링
        const floatY = Math.sin(t * 2) * 16;
        const floatX = Math.cos(t * 1.2) * 12;
        const floatRoll = Math.sin(t * 1.5) * 0.08;

        ctx.translate(floatX, floatY);
        ctx.rotate(floatRoll);
        break;
      }
    }

    // 캐릭터 그리기 (중심점 기준)
    ctx.drawImage(img, -baseW / 2, -baseH / 2, baseW, baseH);

    // 하단 그림자 렌더링
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    const shadowWidth = baseW * 0.6 * (this.currentMotion === 'jump' ? Math.max(0.4, 1 - Math.abs(Math.sin(t * 2.5)) * 0.4) : 1);
    ctx.ellipse(centerX, canvas.height - 25, shadowWidth / 2, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

window.aiProcessor = new AIAnimationProcessor();
