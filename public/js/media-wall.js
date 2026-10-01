/**
 * media-wall.js
 * 대형 LED 미디어월 스크린 캔버스 렌더러
 * - 테마 배경 크로스페이드 및 미디어아트 앰비언트 파티클
 * - 자율 이동 물리 시뮬레이션 (걷기/점프/댄스/유영)
 * - 캐릭터 클릭/터치 인터랙션 (점프 + 하트/파티클 + 말풍선)
 * - 캐릭터 생명주기 타이머 (기본 15분) 및 부드러운 페이드아웃 퇴장
 * - 메모리 완전 회수 및 60fps 최적화
 */

class MediaWallRenderer {
  constructor(bgLayer1Id, bgLayer2Id, particleCanvasId, charCanvasId) {
    this.bg1 = document.getElementById(bgLayer1Id);
    this.bg2 = document.getElementById(bgLayer2Id);
    this.activeBgIndex = 1;

    this.particleCanvas = document.getElementById(particleCanvasId);
    this.particleCtx = this.particleCanvas.getContext('2d');

    this.charCanvas = document.getElementById(charCanvasId);
    this.charCtx = this.charCanvas.getContext('2d');

    this.currentTheme = { id: 'sea', name: '바다나라', url: '/bgimage/' + encodeURIComponent('바다나라.png') };
    this.characters = []; // 활성 캐릭터 목록
    this.particles = [];  // 배경 미디어아트 파티클
    this.effectParticles = []; // 클릭/스폰 시 발생하는 인터랙션 파티클
    this.speechBubbles = [];   // 말풍선

    this.config = {
      characterLifespan: 900, // 기본 15분 (초)
      maxCharacters: 1 // 미디어월 전송 시 캐릭터 1개만 유지
    };

    this.isRunning = false;
    this.lastTime = performance.now();
    this.fps = 60;
    this.frameCount = 0;
    this.fpsTimer = performance.now();

    this.resizeCanvases();
    this.bindEvents();
    this.initThemeParticles();
  }

  resizeCanvases() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.particleCanvas.width = w;
    this.particleCanvas.height = h;

    this.charCanvas.width = w;
    this.charCanvas.height = h;
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.resizeCanvases();
      this.initThemeParticles();
    });

    // 캐릭터 클릭/터치 상호작용
    const handleTouchOrClick = (clientX, clientY) => {
      const rect = this.charCanvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      let hitChar = null;
      for (let i = this.characters.length - 1; i >= 0; i--) {
        const c = this.characters[i];
        const halfW = (c.renderW * c.scale) / 2;
        const halfH = (c.renderH * c.scale) / 2;

        if (x >= c.x - halfW && x <= c.x + halfW &&
            y >= c.y - halfH && y <= c.y + halfH) {
          hitChar = c;
          break;
        }
      }

      if (hitChar) {
        this.interactWithCharacter(hitChar);
      }
    };

    this.charCanvas.addEventListener('click', (e) => {
      handleTouchOrClick(e.clientX, e.clientY);
    });

    this.charCanvas.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        handleTouchOrClick(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });
  }

  // 캐릭터 클릭 시 반응 (점프 + 하트 파티클 + 말풍선 + 사운드)
  interactWithCharacter(c) {
    c.vy = -12; // 깜짝 점프
    c.spinAngle += Math.PI * 2;
    if (window.soundEngine) window.soundEngine.playPopSound();

    // 하트 & 별가루 파티클 방출
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      this.effectParticles.push({
        x: c.x,
        y: c.y - 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1.0,
        decay: 0.02 + Math.random() * 0.02,
        color: ['#f72585', '#00f2fe', '#ffd166', '#06d6a0'][Math.floor(Math.random() * 4)],
        size: 8 + Math.random() * 8,
        type: Math.random() > 0.5 ? 'heart' : 'star'
      });
    }

    // 말풍선 추가
    const messages = ['안녕! ✨', '우와 신난다! 🎉', '나 멋지지? 💖', '반가워! 🌟', '야호~ 🎈'];
    const text = messages[Math.floor(Math.random() * messages.length)];
    this.speechBubbles.push({
      characterId: c.id,
      text: `${c.name}: ${text}`,
      life: 1.0,
      decay: 0.015
    });
  }

  // 테마 배경 변경 (크로스페이드)
  setTheme(theme) {
    this.currentTheme = theme;
    const targetBg = this.activeBgIndex === 1 ? this.bg2 : this.bg1;
    const oldBg = this.activeBgIndex === 1 ? this.bg1 : this.bg2;

    targetBg.style.backgroundImage = `url("${theme.url}")`;
    targetBg.classList.remove('prev');
    targetBg.classList.add('active');

    oldBg.classList.remove('active');
    oldBg.classList.add('prev');

    this.activeBgIndex = this.activeBgIndex === 1 ? 2 : 1;

    // 파티클 & 사운드 전환
    this.initThemeParticles();
    if (window.soundEngine) {
      window.soundEngine.setThemeAmbient(theme.name);
    }

    // UI 헤더 정보 갱신
    const themeNameEl = document.getElementById('wallThemeName');
    if (themeNameEl) themeNameEl.textContent = theme.name;
  }

  // 테마별 파티클 초기화
  initThemeParticles() {
    this.particles = [];
    const count = 70;
    const w = this.particleCanvas.width;
    const h = this.particleCanvas.height;
    const name = this.currentTheme.name;

    for (let i = 0; i < count; i++) {
      if (name.includes('바다')) {
        // 물방울 및 심해 빛가루
        this.particles.push({
          type: 'bubble',
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -1 - Math.random() * 1.5,
          radius: 3 + Math.random() * 12,
          alpha: 0.2 + Math.random() * 0.4
        });
      } else if (name.includes('우주')) {
        // 별무리 및 별똥별
        this.particles.push({
          type: 'star',
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.2,
          vy: (Math.random() - 0.5) * 0.2,
          radius: 1 + Math.random() * 3,
          twinkleSpeed: 0.02 + Math.random() * 0.05,
          phase: Math.random() * Math.PI * 2
        });
      } else if (name.includes('숲')) {
        // 반딧불이 빛포자
        this.particles.push({
          type: 'firefly',
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 1.2,
          vy: (Math.random() - 0.5) * 0.8,
          radius: 2 + Math.random() * 4,
          glowColor: Math.random() > 0.4 ? '#a7ff83' : '#ffe882',
          pulse: Math.random() * Math.PI
        });
      } else {
        // 마법/네온/환상 비트
        this.particles.push({
          type: 'magic',
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.8,
          vy: -0.5 - Math.random() * 0.8,
          radius: 2 + Math.random() * 5,
          color: ['#00f2fe', '#f72585', '#7209b7', '#ffd166'][Math.floor(Math.random() * 4)],
          alpha: 0.3 + Math.random() * 0.4
        });
      }
    }
  }

  // 새 캐릭터 스폰 (송출 - 이미지 또는 MP4 비디오 지원)
  spawnCharacter(charData) {
    // 요구사항: 미디어월에 전송하면 캐릭터도 1개만으로 수정
    // 기존에 있던 모든 캐릭터를 즉시 빠른 페이드아웃(0.35초)으로 퇴장시켜 항상 1개만 유지
    this.characters.forEach(old => {
      old.remainingTime = Math.min(old.remainingTime, 0.35);
    });

    const w = this.charCanvas.width;
    const h = this.charCanvas.height;

    // X 좌표: 항상 내부 80% (10% ~ 90%) 움직이는 공간 내에서 스폰
    const minSpawnX = w * 0.15;
    const maxSpawnX = w * 0.85;
    const spawnX = minSpawnX + Math.random() * (maxSpawnX - minSpawnX);

    // Y 좌표: 1~2개일 때는 y좌표의 가운데 지점 (h * 0.50), 많아지면 내부 70% 대역 (0.15~0.85)
    const activeChars = this.characters.filter(c => c.remainingTime > 0.4);
    let spawnY = h * 0.50; // 기본 가운데 지점
    if (activeChars.length >= 2) {
      spawnY = h * 0.20 + Math.random() * (h * 0.60);
    }

    // 1. Animated Drawings MP4 비디오 캐릭터인 경우
    if (charData.type === 'video') {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.src = charData.videoUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      const chromaCanvas = document.createElement('canvas');
      const chromaCtx = chromaCanvas.getContext('2d', { willReadFrequently: true });

      const onReady = () => {
        video.play().catch(() => {});
        const vw = video.videoWidth || 320;
        const vh = video.videoHeight || 320;

        chromaCanvas.width = Math.min(vw, 360);
        chromaCanvas.height = Math.min(vh, 360);

        const targetW = 200 + Math.random() * 40;
        const targetH = (vh / vw) * targetW;

        const newChar = {
          id: charData.id || `video_${Date.now()}_${Math.random()}`,
          name: charData.name || '비디오 친구',
          type: 'video',
          video: video,
          chromaCanvas: chromaCanvas,
          chromaCtx: chromaCtx,
          useChromaKey: charData.chromaKey !== false,
          renderW: targetW,
          renderH: targetH,
          x: spawnX,
          y: spawnY,
          vx: (Math.random() > 0.5 ? 1 : -1) * (1.2 + Math.random() * 1.5),
          vy: (Math.random() - 0.5) * 1.2,
          motion: charData.motion || 'walk',
          scale: 0.1,
          targetScale: 1.0,
          opacity: 0,
          targetOpacity: 1.0,
          flipX: 1,
          spinAngle: 0,
          animTime: Math.random() * 10,
          createdAt: Date.now(),
          totalLifespan: this.config.characterLifespan,
          remainingTime: this.config.characterLifespan
        };

        this.characters.push(newChar);
        if (window.soundEngine) window.soundEngine.playMagicChime();
        this.emitSpawnParticles(spawnX, spawnY);
        this.updateStatsDisplay();
      };

      if (video.readyState >= 1) {
        onReady();
      } else {
        video.onloadeddata = onReady;
      }
      return;
    }

    // 2. 일반 드로잉 이미지 캐릭터인 경우
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const targetW = 180 + Math.random() * 40;
      const targetH = (charData.height / charData.width) * targetW;

      const newChar = {
        id: charData.id || `char_${Date.now()}_${Math.random()}`,
        name: charData.name || '친구의 도안',
        type: 'image',
        img: img,
        renderW: targetW,
        renderH: targetH,
        x: spawnX,
        y: spawnY,
        vx: (Math.random() > 0.5 ? 1 : -1) * (1.2 + Math.random() * 1.5),
        vy: (Math.random() - 0.5) * 1.2,
        motion: charData.motion || 'walk',
        scale: 0.1,
        targetScale: 1.0,
        opacity: 0,
        targetOpacity: 1.0,
        flipX: 1,
        spinAngle: 0,
        animTime: Math.random() * 10,
        createdAt: Date.now(),
        totalLifespan: this.config.characterLifespan,
        remainingTime: this.config.characterLifespan
      };

      this.characters.push(newChar);
      if (window.soundEngine) window.soundEngine.playMagicChime();
      this.emitSpawnParticles(spawnX, spawnY);
      this.updateStatsDisplay();
    };
    img.src = charData.dataUrl || charData.url;
  }

  // 스폰 축하 마법 파티클 헬퍼
  emitSpawnParticles(x, y) {
    for (let i = 0; i < 25; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 3 + Math.random() * 6;
      this.effectParticles.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 1.0,
        decay: 0.02,
        color: '#00f2fe',
        size: 10,
        type: 'sparkle'
      });
    }
  }

  // 캐릭터 강제 제거
  removeCharacter(id) {
    const target = this.characters.find(c => c.id === id);
    if (target) {
      target.remainingTime = Math.min(target.remainingTime, 2); // 2초 페이드아웃
    }
  }

  clearAllCharacters() {
    this.characters.forEach(c => {
      c.remainingTime = Math.min(c.remainingTime, 1.5);
    });
  }

  // 렌더링 루프 시작
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();

    const loop = (currentTime) => {
      if (!this.isRunning) return;
      const dt = Math.min(0.1, (currentTime - this.lastTime) / 1000);
      this.lastTime = currentTime;

      // FPS 계산
      this.frameCount++;
      if (currentTime - this.fpsTimer >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.fpsTimer = currentTime;
        this.updateStatsDisplay();
      }

      this.update(dt);
      this.render();

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  stop() {
    this.isRunning = false;
  }

  // 상태 업데이트 (물리 및 생명주기)
  update(dt) {
    const w = this.charCanvas.width;
    const h = this.charCanvas.height;

    // 1. 캐릭터 물리 및 생명주기 관리
    for (let i = this.characters.length - 1; i >= 0; i--) {
      const c = this.characters[i];

      // 생명주기 차감
      c.remainingTime -= dt;

      // 스폰 시 스무스 등장
      if (c.scale < c.targetScale) {
        c.scale += (c.targetScale - c.scale) * 0.15;
      }
      if (c.opacity < c.targetOpacity && c.remainingTime > 10) {
        c.opacity = Math.min(1.0, c.opacity + dt * 2);
      }

      // 만료 10초 전 자연스러운 페이드아웃 (Fade-out)
      if (c.remainingTime <= 10) {
        c.opacity = Math.max(0, c.remainingTime / 10);
      }

      // 수명 만료 시 완전 소멸 및 메모리 회수 (PRD 완벽 충족)
      if (c.remainingTime <= 0) {
        if (c.video) {
          try {
            c.video.pause();
            c.video.src = '';
            c.video.load();
          } catch (e) {}
          c.video = null;
          c.chromaCanvas = null;
          c.chromaCtx = null;
        }
        c.img = null; // 메모리 참조 해제
        this.characters.splice(i, 1);
        continue;
      }

      // 모션 및 자율 이동
      c.animTime += dt * 3;

      // 이동
      c.x += c.vx;
      c.y += c.vy;

      // 방향에 따른 플립(좌/우 시선)
      if (c.vx > 0.1) c.flipX = 1;
      else if (c.vx < -0.1) c.flipX = -1;

      // 요구사항: X 좌표는 항상 내부 80%를 움직이는 공간으로 설정 (좌우 여백 10%씩)
      const padX = (c.renderW * c.scale) / 2;
      const minX = w * 0.10 + padX;
      const maxX = w * 0.90 - padX;

      if (c.x < minX) {
        c.x = minX;
        c.vx = Math.abs(c.vx);
      } else if (c.x > maxX) {
        c.x = maxX;
        c.vx = -Math.abs(c.vx);
      }

      // 요구사항:
      // Y 좌표는 캐릭터가 1~2개일 때는 y좌표의 가운데 지점 (화면 높이의 50% 중심)
      // 캐릭터가 많아지면(3개 이상) y좌표 내부 안쪽 70% (15% ~ 85%)를 다 활용해 움직임
      const activeCount = this.characters.filter(char => char.opacity > 0.1).length;
      let minY, maxY, groundY;

      if (activeCount <= 2) {
        // 1~2개일 때: y좌표의 가운데 지점 유지 (중앙 대역: 44% ~ 56%)
        minY = h * 0.44;
        maxY = h * 0.56;
        groundY = h * 0.53;
      } else {
        // 많아지면: y좌표 내부 안쪽 70% 대역 (상하 15% 여백)
        const padY = (c.renderH * c.scale) / 2;
        minY = h * 0.15 + padY;
        maxY = h * 0.85 - padY;
        groundY = h * 0.78;
      }

      // 모션 특화 동작
      if (c.motion === 'walk') {
        c.vy = Math.sin(c.animTime * 2) * (activeCount <= 2 ? 0.4 : 0.8);
      } else if (c.motion === 'jump') {
        c.vy += 0.35; // 중력
        if (c.y >= groundY) {
          c.y = groundY;
          c.vy = (activeCount <= 2) ? (-4 - Math.random() * 2) : (-8 - Math.random() * 3);
        }
      } else if (c.motion === 'float') {
        c.vy = Math.sin(c.animTime * 1.5) * (activeCount <= 2 ? 0.5 : 1.5);
        c.vx = Math.cos(c.animTime * 0.8) * 1.8;
      }

      if (c.y < minY) {
        c.y = minY;
        c.vy = Math.abs(c.vy);
      } else if (c.y > maxY) {
        c.y = maxY;
        c.vy = -Math.abs(c.vy);
      }
    }

    // 2. 이펙트 파티클 업데이트
    for (let i = this.effectParticles.length - 1; i >= 0; i--) {
      const p = this.effectParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) {
        this.effectParticles.splice(i, 1);
      }
    }

    // 3. 말풍선 업데이트
    for (let i = this.speechBubbles.length - 1; i >= 0; i--) {
      const b = this.speechBubbles[i];
      b.life -= b.decay;
      if (b.life <= 0) {
        this.speechBubbles.splice(i, 1);
      }
    }

    // 4. 배경 테마 파티클 업데이트
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.y < -20) p.y = h + 20;
      if (p.y > h + 20) p.y = -20;
      if (p.x < -20) p.x = w + 20;
      if (p.x > w + 20) p.x = -20;
    }
  }

  // 화면 렌더링
  render() {
    this.renderParticles();
    this.renderCharacters();
  }

  // 테마별 파티클 그리기
  renderParticles() {
    const ctx = this.particleCtx;
    const w = this.particleCanvas.width;
    const h = this.particleCanvas.height;
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      ctx.save();

      if (p.type === 'bubble') {
        // 반투명 기포
        ctx.strokeStyle = `rgba(180, 240, 255, ${p.alpha})`;
        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 기포 하이라이트
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(p.x - p.radius * 0.35, p.y - p.radius * 0.35, p.radius * 0.25, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'star') {
        // 반짝이는 별
        p.phase += p.twinkleSpeed;
        const currentAlpha = 0.3 + Math.abs(Math.sin(p.phase)) * 0.7;
        ctx.fillStyle = `rgba(255, 255, 255, ${currentAlpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'firefly') {
        // 빛나는 반딧불이
        p.pulse += 0.03;
        const glow = 0.4 + Math.sin(p.pulse) * 0.4;
        ctx.shadowColor = p.glowColor;
        ctx.shadowBlur = 15;
        ctx.fillStyle = p.glowColor;
        ctx.globalAlpha = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 마법 네온 파티클
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // 캐릭터 및 상호작용 그리기
  renderCharacters() {
    const ctx = this.charCtx;
    const w = this.charCanvas.width;
    const h = this.charCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // 1. 캐릭터 그리기
    for (let i = 0; i < this.characters.length; i++) {
      const c = this.characters[i];
      if (!c.img || c.opacity <= 0) continue;

      ctx.save();
      ctx.globalAlpha = c.opacity;
      ctx.translate(c.x, c.y);

      // 모션 변형
      const t = c.animTime;
      let bounceY = 0;
      let rotAngle = 0;
      let sqX = 1;
      let sqY = 1;

      if (c.motion === 'walk') {
        bounceY = Math.abs(Math.sin(t * 3)) * -14;
        rotAngle = Math.sin(t * 3) * 0.1;
      } else if (c.motion === 'jump') {
        const j = Math.sin(t * 2.5);
        if (j < 0) { sqX = 1.15; sqY = 0.85; }
        else { sqX = 0.9; sqY = 1.1; }
      } else if (c.motion === 'dance') {
        rotAngle = Math.sin(t * 4) * 0.25;
        sqX = 1 + Math.sin(t * 8) * 0.08;
        sqY = 1 + Math.sin(t * 8) * 0.08;
      } else if (c.motion === 'float') {
        rotAngle = Math.sin(t * 1.5) * 0.12;
      }

      ctx.translate(0, bounceY);
      ctx.scale(c.scale * c.flipX * sqX, c.scale * sqY);
      ctx.rotate(rotAngle + c.spinAngle);

      // 하단 부드러운 그림자
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.beginPath();
      ctx.ellipse(0, c.renderH / 2, (c.renderW * 0.5) / 2, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      // 캐릭터 렌더링 (비디오 또는 이미지)
      if (c.type === 'video' && c.video && c.video.readyState >= 2) {
        if (c.useChromaKey && c.chromaCanvas && c.chromaCtx) {
          const cw = c.chromaCanvas.width;
          const ch = c.chromaCanvas.height;
          c.chromaCtx.drawImage(c.video, 0, 0, cw, ch);
          const frame = c.chromaCtx.getImageData(0, 0, cw, ch);
          const d = frame.data;
          // 흰색 배경 자동 누끼 투명화 (Meta Animated Drawings 최적화)
          for (let p = 0; p < d.length; p += 4) {
            const r = d[p], g = d[p + 1], b = d[p + 2];
            if (r > 220 && g > 220 && b > 220) {
              d[p + 3] = 0;
            }
          }
          c.chromaCtx.putImageData(frame, 0, 0);
          ctx.drawImage(c.chromaCanvas, -c.renderW / 2, -c.renderH / 2, c.renderW, c.renderH);
        } else {
          ctx.drawImage(c.video, -c.renderW / 2, -c.renderH / 2, c.renderW, c.renderH);
        }
      } else if (c.img) {
        ctx.drawImage(c.img, -c.renderW / 2, -c.renderH / 2, c.renderW, c.renderH);
      }

      // 이름표 렌더링 (스케치 손글씨 & 스케치 뱃지)
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = c.opacity;
      ctx.font = 'bold 18px "Gaegu", "Pretendard", sans-serif';
      ctx.textAlign = 'center';

      const tagText = c.name;
      const tagWidth = ctx.measureText(tagText).width + 20;
      const tagY = c.y - (c.renderH * c.scale) / 2 - 18;

      // 스케치 그림자
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.roundRect(c.x - tagWidth / 2 + 2, tagY - 14 + 2, tagWidth, 26, 8);
      ctx.fill();

      // 스케치 배경 & 테두리
      ctx.fillStyle = 'rgba(18, 21, 38, 0.9)';
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(c.x - tagWidth / 2, tagY - 14, tagWidth, 26, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(tagText, c.x, tagY + 4);

      ctx.restore();
    }

    // 2. 이펙트 파티클 렌더링
    for (let i = 0; i < this.effectParticles.length; i++) {
      const p = this.effectParticles[i];
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);

      if (p.type === 'heart') {
        ctx.beginPath();
        const topCurveHeight = p.size * 0.3;
        ctx.moveTo(0, topCurveHeight);
        ctx.bezierCurveTo(0, 0, -p.size / 2, 0, -p.size / 2, topCurveHeight);
        ctx.bezierCurveTo(-p.size / 2, (p.size + topCurveHeight) / 2, 0, p.size, 0, p.size);
        ctx.bezierCurveTo(0, p.size, p.size / 2, (p.size + topCurveHeight) / 2, p.size / 2, topCurveHeight);
        ctx.bezierCurveTo(p.size / 2, 0, 0, 0, 0, topCurveHeight);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 3. 말풍선 렌더링 (스케치 만화 말풍선)
    for (let i = 0; i < this.speechBubbles.length; i++) {
      const b = this.speechBubbles[i];
      const c = this.characters.find(char => char.id === b.characterId);
      if (!c) continue;

      ctx.save();
      ctx.globalAlpha = b.life;
      ctx.font = 'bold 20px "Gaegu", "Pretendard", sans-serif';
      const bubbleW = ctx.measureText(b.text).width + 26;
      const bubbleX = c.x;
      const bubbleY = c.y - (c.renderH * c.scale) / 2 - 54;

      // 스케치 오프셋 그림자
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      ctx.roundRect(bubbleX - bubbleW / 2 + 3, bubbleY - 20 + 3, bubbleW, 38, 12);
      ctx.fill();

      // 말풍선 본체 & 굵은 잉크 테두리
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(bubbleX - bubbleW / 2, bubbleY - 20, bubbleW, 38, 12);
      ctx.fill();
      ctx.stroke();

      // 말풍선 꼬리표 (아래쪽 뾰족한 삼각형)
      ctx.beginPath();
      ctx.moveTo(bubbleX - 6, bubbleY + 18);
      ctx.lineTo(bubbleX, bubbleY + 28);
      ctx.lineTo(bubbleX + 6, bubbleY + 18);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#121526';
      ctx.textAlign = 'center';
      ctx.fillText(b.text, bubbleX, bubbleY + 7);

      ctx.restore();
    }
  }

  updateStatsDisplay() {
    const charCountEl = document.getElementById('wallCharCount');
    if (charCountEl) charCountEl.textContent = this.characters.length;

    const fpsEl = document.getElementById('wallFps');
    if (fpsEl) fpsEl.textContent = this.fps;
  }
}
