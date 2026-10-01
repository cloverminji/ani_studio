/**
 * drawing-canvas.js
 * 학생 드로잉 스튜디오 캔버스 인터랙션 엔진
 * - 펜 / 브러시 / 지우개
 * - 고속 Flood Fill (페인트통 채우기)
 * - 도안 로드 및 스케일링
 * - Undo / Redo 히스토리
 * - 터치 & 펜 압력 지원
 */

class DrawingCanvas {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    
    this.isDrawing = false;
    this.currentTool = 'brush'; // 'brush' | 'bucket' | 'eraser'
    this.currentColor = '#f72585';
    this.brushSize = 8;
    this.eraserSize = 24;

    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 25;

    this.currentTemplateImg = null;
    this.lastX = 0;
    this.lastY = 0;

    this.initCanvasSize();
    this.bindEvents();
    this.saveState();
  }

  initCanvasSize() {
    // 캔버스 기본 해상도 800x800 유지 (고화질 유지)
    this.canvas.width = 800;
    this.canvas.height = 800;
    this.clearCanvas(true);
  }

  clearCanvas(whiteBg = true) {
    this.ctx.fillStyle = whiteBg ? '#ffffff' : 'transparent';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  saveState() {
    if (this.undoStack.length >= this.maxHistory) {
      this.undoStack.shift();
    }
    this.undoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    this.redoStack = []; // 새 작업 시 redo 스택 초기화
  }

  undo() {
    if (this.undoStack.length > 1) {
      this.redoStack.push(this.undoStack.pop());
      const previousState = this.undoStack[this.undoStack.length - 1];
      this.ctx.putImageData(previousState, 0, 0);
    }
  }

  redo() {
    if (this.redoStack.length > 0) {
      const nextState = this.redoStack.pop();
      this.undoStack.push(nextState);
      this.ctx.putImageData(nextState, 0, 0);
    }
  }

  // 도안 이미지 로드 (아웃라인 빈 공백 약 4cm를 자동 제거하여 캐릭터를 캔버스에 큼직하게 렌더링)
  loadTemplate(imgUrl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.currentTemplateImg = img;
      this.clearCanvas(true);

      // 1. 임시 오프스크린 캔버스에 그려서 외곽 여백(아웃라인 공백 약 4cm) 자동 트리밍
      const offCanvas = document.createElement('canvas');
      offCanvas.width = img.width;
      offCanvas.height = img.height;
      const offCtx = offCanvas.getContext('2d');
      offCtx.drawImage(img, 0, 0);

      let srcX = 0;
      let srcY = 0;
      let srcW = img.width;
      let srcH = img.height;

      try {
        const imgData = offCtx.getImageData(0, 0, img.width, img.height);
        const data = imgData.data;
        let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
        let found = false;

        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            const i = (y * img.width + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            // 흰색(#fafafa 이상)이 아니거나 반투명/불투명인 실제 캐릭터 윤곽선 검출
            if (a > 30 && (r < 242 || g < 242 || b < 242)) {
              found = true;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (found && maxX > minX && maxY > minY) {
          // 캐릭터 테두리에 적절한 여백(12px)만 남기고 외곽 4cm 아웃라인 공백 제거
          const margin = 12;
          srcX = Math.max(0, minX - margin);
          srcY = Math.max(0, minY - margin);
          srcW = Math.min(img.width - srcX, (maxX - minX) + margin * 2);
          srcH = Math.min(img.height - srcY, (maxY - minY) + margin * 2);
        }
      } catch (e) {
        console.warn('Auto outline trimming fallback:', e);
      }

      // 2. 외곽 여백이 제거된 캐릭터를 800x800 캔버스에 큼직하게 꽉 차도록 렌더링
      const padding = 16;
      const maxWidth = this.canvas.width - padding * 2;
      const maxHeight = this.canvas.height - padding * 2;

      const ratio = Math.min(maxWidth / srcW, maxHeight / srcH);
      const renderW = srcW * ratio;
      const renderH = srcH * ratio;

      const renderX = (this.canvas.width - renderW) / 2;
      const renderY = (this.canvas.height - renderH) / 2;

      this.ctx.drawImage(img, srcX, srcY, srcW, srcH, renderX, renderY, renderW, renderH);
      this.saveState();
    };
    img.src = imgUrl;
  }

  // 마우스/터치 좌표 변환
  getCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: Math.round((clientX - rect.left) * scaleX),
      y: Math.round((clientY - rect.top) * scaleY)
    };
  }

  bindEvents() {
    const start = (e) => {
      e.preventDefault();
      const { x, y } = this.getCoords(e);

      if (this.currentTool === 'bucket') {
        this.floodFill(x, y, this.currentColor);
        this.saveState();
        if (window.soundEngine) window.soundEngine.playPopSound();
        return;
      }

      this.isDrawing = true;
      this.lastX = x;
      this.lastY = y;

      this.draw(x, y, true);
    };

    const move = (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      const { x, y } = this.getCoords(e);
      this.draw(x, y);
    };

    const end = (e) => {
      if (this.isDrawing) {
        this.isDrawing = false;
        this.saveState();
      }
    };

    // 마우스 이벤트
    this.canvas.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);

    // 터치 이벤트
    this.canvas.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
  }

  draw(x, y, isStart = false) {
    this.ctx.beginPath();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (this.currentTool === 'eraser') {
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = this.eraserSize;
    } else {
      this.ctx.strokeStyle = this.currentColor;
      this.ctx.lineWidth = this.brushSize;
    }

    if (isStart) {
      this.ctx.moveTo(x - 0.5, y - 0.5);
      this.ctx.lineTo(x, y);
    } else {
      this.ctx.moveTo(this.lastX, this.lastY);
      this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();

    this.lastX = x;
    this.lastY = y;
  }

  // 페인트통 채우기 (고속 BFS Flood Fill)
  floodFill(startX, startY, fillHex) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;

    const imgData = this.ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // 타겟 색상 추출
    const targetIdx = (startY * width + startX) * 4;
    const tr = data[targetIdx];
    const tg = data[targetIdx + 1];
    const tb = data[targetIdx + 2];
    const ta = data[targetIdx + 3];

    // 채울 RGB 계산
    const fillR = parseInt(fillHex.slice(1, 3), 16);
    const fillG = parseInt(fillHex.slice(3, 5), 16);
    const fillB = parseInt(fillHex.slice(5, 7), 16);
    const fillA = 255;

    // 같은 색이면 채울 필요 없음
    if (Math.abs(tr - fillR) < 5 && Math.abs(tg - fillG) < 5 && Math.abs(tb - fillB) < 5) {
      return;
    }

    // 허용 임계값 (도안 외곽선/안티에일리어싱 영역 침범 방지)
    const tolerance = 40;
    const match = (idx) => {
      const dr = Math.abs(data[idx] - tr);
      const dg = Math.abs(data[idx + 1] - tg);
      const db = Math.abs(data[idx + 2] - tb);
      const da = Math.abs(data[idx + 3] - ta);
      return (dr + dg + db + da) <= tolerance;
    };

    const queue = [startX, startY];
    const visited = new Uint8Array(width * height);
    visited[startY * width + startX] = 1;

    let head = 0;
    while (head < queue.length) {
      const cx = queue[head++];
      const cy = queue[head++];
      const idx = (cy * width + cx) * 4;

      data[idx] = fillR;
      data[idx + 1] = fillG;
      data[idx + 2] = fillB;
      data[idx + 3] = fillA;

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

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nCoord = ny * width + nx;
          if (!visited[nCoord]) {
            visited[nCoord] = 1;
            const nIdx = nCoord * 4;
            if (match(nIdx)) {
              queue.push(nx, ny);
            }
          }
        }
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
  }

  // 캔버스 이미지 DataURL 추출
  getDataURL() {
    return this.canvas.toDataURL('image/png');
  }
}
