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
      characterLifespan: 1200, // 기본 20분 (초)
      maxCharacters: 15 // 미디어월 최대 캐릭터 동시 참여 수 (기본 15개)
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
        const halfW = c.type === 'video' ? (c.renderW * c.scale * 0.35) / 2 : (c.renderW * c.scale) / 2;
        const halfH = c.type === 'video' ? (c.renderH * c.scale * 0.50) / 2 : (c.renderH * c.scale) / 2;

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
    if (c.type !== 'video') {
      c.vy = -12; // 깜짝 점프
      c.spinAngle += Math.PI * 2;
    }
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
    if (!charData || !charData.id) return;

    // 중복 스폰 방지: 이미 미디어월에 살아있는 캐릭터 ID인 경우 중복 생성 차단
    if (this.characters.some(c => c.id === charData.id)) {
      console.log(`[MediaWall] 중복 캐릭터 스폰 차단 (ID: ${charData.id})`);
      return;
    }

    // 최대 동시 표시 캐릭터 수 초과 시 가장 오래된 캐릭터 자연스러운 페이드아웃 퇴장
    const maxChars = this.config.maxCharacters || 15;
    while (this.characters.length >= maxChars) {
      const oldest = this.characters.find(c => c.remainingTime > 1.0);
      if (oldest) {
        oldest.remainingTime = Math.min(oldest.remainingTime, 1.0);
        break;
      } else {
        break;
      }
    }

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
      // data: URL의 경우 crossOrigin 설정 시 null origin 보안 에러가 날 수 있으므로 원격 URL일 때만 적용
      if (charData.videoUrl && !charData.videoUrl.startsWith('data:')) {
        video.crossOrigin = 'anonymous';
      }
      video.src = charData.videoUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      const chromaCanvas = document.createElement('canvas');
      const chromaCtx = chromaCanvas.getContext('2d', { willReadFrequently: true });

      let isReadyTriggered = false;
      const onReady = () => {
        if (isReadyTriggered) return;
        isReadyTriggered = true;

        video.play().catch(e => console.warn('Video auto-play suppressed:', e));
        const vw = video.videoWidth || 320;
        const vh = video.videoHeight || 320;

        chromaCanvas.width = Math.min(vw, 480);
        chromaCanvas.height = Math.min(vh, 480);

        // 요구사항: MP4 파일 캐릭터는 수정 전 사이즈의 2배로 재조절 (약 440px)
        const targetW = (200 + Math.random() * 40) * 2;
        const targetH = (vh / vw) * targetW;

        const newChar = {
          id: charData.id || `video_${Date.now()}_${Math.random()}`,
          name: charData.name || '비디오 친구',
          type: 'video',
          video: video,
          chromaCanvas: chromaCanvas,
          chromaCtx: chromaCtx,
          floodVisited: new Uint8Array(chromaCanvas.width * chromaCanvas.height),
          floodQueue: new Int32Array(chromaCanvas.width * chromaCanvas.height),
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

      video.onerror = (err) => {
        console.error('Video character load error:', err, charData.videoUrl);
      };

      if (video.readyState >= 1) {
        onReady();
      } else {
        video.onloadeddata = onReady;
        video.oncanplay = onReady;
        video.onloadedmetadata = onReady;
      }
      return;
    }

    // 2. 일반 드로잉 이미지 캐릭터인 경우
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // 요구사항: 드로잉스튜디오 캐릭터는 기존 사이즈에서 1/2로 축소 (약 100px)
      const targetW = (180 + Math.random() * 40) * 0.5;
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
      const padX = c.type === 'video' ? (c.renderW * c.scale * 0.35) / 2 : (c.renderW * c.scale) / 2;
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
      if (c.type === 'video') {
        // MP4 비디오 캐릭터는 자체 애니메이션이 기적용되어 있으므로 미디어월에서 외적 점프/요동 물리 모션을 추가하지 않음
        c.vy = 0;
      } else if (c.motion === 'walk') {
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
      if ((!c.img && !c.video) || c.opacity <= 0) continue;

      ctx.save();
      ctx.globalAlpha = c.opacity;
      ctx.translate(c.x, c.y);

      // 모션 변형
      const t = c.animTime;
      let bounceY = 0;
      let rotAngle = 0;
      let sqX = 1;
      let sqY = 1;

      // MP4 비디오는 기본 애니메이션이 기적용되어 있으므로 미디어월 외적 모션 변형(바운스/기울기/스쿼시)을 배제
      if (c.type !== 'video') {
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
      }

      ctx.translate(0, bounceY);
      ctx.scale(c.scale * c.flipX * sqX, c.scale * sqY);
      ctx.rotate(rotAngle + c.spinAngle);

      // 하단 부드러운 그림자
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.beginPath();
      const shadowY = c.type === 'video' ? c.renderH * 0.35 : c.renderH / 2;
      const shadowW = c.type === 'video' ? (c.renderW * 0.32) / 2 : (c.renderW * 0.5) / 2;
      ctx.ellipse(0, shadowY, shadowW, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      // 캐릭터 렌더링 (비디오 또는 이미지)
      if (c.type === 'video' && c.video && c.video.readyState >= 2) {
        let renderedWithChroma = false;
        if (c.useChromaKey && c.chromaCanvas && c.chromaCtx) {
          try {
            const cw = c.chromaCanvas.width;
            const ch = c.chromaCanvas.height;
            const totalPixels = cw * ch;
            c.chromaCtx.drawImage(c.video, 0, 0, cw, ch);
            const frame = c.chromaCtx.getImageData(0, 0, cw, ch);
            const d = frame.data;

            // 1. 하단 메타 애니메이티드 드로잉 로고/워터마크 영역 기준선 (하단 13% 영역)
            const watermarkStartY = Math.floor(ch * 0.87);
            const watermarkStartX = Math.floor(cw * 0.32);

            // 2. 외곽 플러드필 버퍼 준비 (할당 재사용으로 60fps 유지)
            if (!c.floodVisited || c.floodVisited.length !== totalPixels) {
              c.floodVisited = new Uint8Array(totalPixels);
              c.floodQueue = new Int32Array(totalPixels);
            }
            const visited = c.floodVisited;
            const queue = c.floodQueue;
            visited.fill(0);

            let head = 0;
            let tail = 0;

            // 배경 판별 헬퍼 (MP4 압축 노이즈 감안한 적응형 밝기/채도 판정)
            const isBgPixel = (x, y) => {
              // 워터마크 영역은 무조건 배경으로 간주하여 로고 텍스트 완전 제거
              if (y >= watermarkStartY && (x >= watermarkStartX || y >= ch * 0.91)) {
                return true;
              }

              const idx = (y * cw + x) * 4;
              const r = d[idx];
              const g = d[idx + 1];
              const b = d[idx + 2];

              const brightness = (r + g + b) / 3;
              const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(b - r));

              // 순수 흰색 또는 밝은 압축 노이즈 (무채색/오프화이트)
              return (brightness > 185 && maxDiff < 38) || (brightness > 218);
            };

            // 캔버스 4개 외곽 테두리 픽셀을 시작 시드로 큐에 삽입
            for (let x = 0; x < cw; x++) {
              if (isBgPixel(x, 0) && !visited[x]) {
                visited[x] = 1;
                queue[tail++] = x;
              }
              const bIdx = (ch - 1) * cw + x;
              if (isBgPixel(x, ch - 1) && !visited[bIdx]) {
                visited[bIdx] = 1;
                queue[tail++] = bIdx;
              }
            }
            for (let y = 1; y < ch - 1; y++) {
              const lIdx = y * cw;
              if (isBgPixel(0, y) && !visited[lIdx]) {
                visited[lIdx] = 1;
                queue[tail++] = lIdx;
              }
              const rIdx = y * cw + (cw - 1);
              if (isBgPixel(cw - 1, y) && !visited[rIdx]) {
                visited[rIdx] = 1;
                queue[tail++] = rIdx;
              }
            }

            // 4방향 외곽 BFS 플러드필: 외곽과 연결된 모든 배경만 투명화 (캐릭터 내부 흰색은 안전 보존)
            while (head < tail) {
              const curr = queue[head++];
              d[curr * 4 + 3] = 0; // 완전 투명화

              const cx = curr % cw;
              const cy = (curr / cw) | 0;

              if (cx > 0) {
                const n = curr - 1;
                if (!visited[n] && isBgPixel(cx - 1, cy)) {
                  visited[n] = 1;
                  queue[tail++] = n;
                }
              }
              if (cx < cw - 1) {
                const n = curr + 1;
                if (!visited[n] && isBgPixel(cx + 1, cy)) {
                  visited[n] = 1;
                  queue[tail++] = n;
                }
              }
              if (cy > 0) {
                const n = curr - cw;
                if (!visited[n] && isBgPixel(cx, cy - 1)) {
                  visited[n] = 1;
                  queue[tail++] = n;
                }
              }
              if (cy < ch - 1) {
                const n = curr + cw;
                if (!visited[n] && isBgPixel(cx, cy + 1)) {
                  visited[n] = 1;
                  queue[tail++] = n;
                }
              }
            }

            // 3. 하단 로고 워터마크 영역의 잔여 글자 픽셀 100% 강제 투명화
            for (let y = watermarkStartY; y < ch; y++) {
              for (let x = watermarkStartX; x < cw; x++) {
                d[(y * cw + x) * 4 + 3] = 0;
              }
            }
            // 하단 최하단 8% 라인은 전체 워터마크 밴드로 완전 투명화
            const bottomBandY = Math.floor(ch * 0.92);
            for (let y = bottomBandY; y < ch; y++) {
              for (let x = 0; x < cw; x++) {
                d[(y * cw + x) * 4 + 3] = 0;
              }
            }

            // 4. 사각 프레임 경계선 잔여물(최외곽 3px 테두리) 완전 소거 (다른 캐릭터 가림 방지)
            for (let y = 0; y < ch; y++) {
              for (let x = 0; x < cw; x++) {
                if (x < 3 || x >= cw - 3 || y < 3 || y >= ch - 3) {
                  const p = (y * cw + x) * 4;
                  const b = (d[p] + d[p + 1] + d[p + 2]) / 3;
                  if (b > 150) d[p + 3] = 0;
                }
              }
            }

            c.chromaCtx.putImageData(frame, 0, 0);
            ctx.drawImage(c.chromaCanvas, -c.renderW / 2, -c.renderH / 2, c.renderW, c.renderH);
            renderedWithChroma = true;
          } catch (chromaErr) {
            renderedWithChroma = false;
          }
        }
        if (!renderedWithChroma) {
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
      const tagY = c.type === 'video'
        ? c.y - (c.renderH * c.scale) * 0.28 - 18
        : c.y - (c.renderH * c.scale) / 2 - 18;

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
