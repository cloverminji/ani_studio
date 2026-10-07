/**
 * app.js
 * 메인 애플리케이션 통합 오케스트레이터
 * - 뷰 전환 (미디어월, 드로잉 스튜디오, 마스터 관리자)
 * - 도안 목록 로드 및 캔버스 연동
 * - AI 변환 파이프라인 및 모션 선택
 * - 원클릭 전송 및 네트워크 브로드캐스트
 */

// 전역 토스트 함수
window.showToast = function (message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>✨</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3000);
};

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 오디오 초기화 (첫 인터랙션 시 자동 활성화)
  const initAudioOnFirstUserAction = () => {
    if (window.soundEngine) window.soundEngine.init();
    window.removeEventListener('click', initAudioOnFirstUserAction);
    window.removeEventListener('touchstart', initAudioOnFirstUserAction);
  };
  window.addEventListener('click', initAudioOnFirstUserAction);
  window.addEventListener('touchstart', initAudioOnFirstUserAction);

  // 2. 미디어월 렌더러 인스턴스화
  const mediaWall = new MediaWallRenderer(
    'wallBgLayer1',
    'wallBgLayer2',
    'wallParticlesCanvas',
    'wallCharactersCanvas'
  );
  mediaWall.start();
  window.mediaWallInstance = mediaWall;

  // 3. 학생 드로잉 캔버스 인스턴스화
  const drawingCanvas = new DrawingCanvas('drawingCanvas');
  window.drawingCanvasInstance = drawingCanvas;

  // 4. AI 변환 프리뷰 캔버스 바인딩
  const aiPreviewCanvas = document.getElementById('aiPreviewCanvas');
  if (aiPreviewCanvas) {
    aiPreviewCanvas.width = 320;
    aiPreviewCanvas.height = 240;
    window.aiProcessor.setPreviewCanvas(aiPreviewCanvas);
  }

  // 5. 관리자 대시보드 인스턴스화
  const adminDashboard = new AdminDashboard();
  window.adminDashboardInstance = adminDashboard;

  // 6. 도안 목록 로드 (drawing 폴더)
  await loadDrawingsList(drawingCanvas);

  // 7. 색상 팔레트 및 도구 바인딩
  setupPaletteAndTools(drawingCanvas);

  // 8. AI 변환 모달 & 송출 버튼 바인딩
  setupAIConvertPipeline(drawingCanvas, mediaWall);

  // 8-1. 드로잉 스튜디오 Animated Drawings MP4 파일 업로드 및 송출 바인딩
  setupStudioVideoUpload(mediaWall);

  // 9. 네트워크 이벤트 바인딩
  setupNetworkSync(mediaWall, adminDashboard);

  // 10. 뷰 모드 라우팅 및 스위칭 바인딩
  setupViewModeSwitcher(mediaWall);

  // 11. 미디어월 컨트롤 버튼 (전체화면, HUD 토글, 음소거)
  setupWallControls(mediaWall);
});

/**
 * 기본 도안 목록 로드 및 그리드 구성
 */
async function loadDrawingsList(drawingCanvas, keepCurrent = false) {
  const grid = document.getElementById('drawingTemplatesGrid');
  if (!grid) return;

  try {
    const res = await fetch(`/api/drawings?_t=${Date.now()}`);
    const data = await res.json();

    if (data.success && data.drawings.length > 0) {
      grid.innerHTML = '';
      data.drawings.forEach((draw, idx) => {
        const card = document.createElement('div');
        card.className = `template-card ${idx === 0 ? 'active' : ''}`;
        card.innerHTML = `
          <img src="${draw.url}" alt="${draw.name}" />
          <span class="template-name">${draw.name}</span>
        `;

        card.addEventListener('click', () => {
          document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          drawingCanvas.loadTemplate(draw.url, draw.name);
          if (window.soundEngine) window.soundEngine.playPopSound();
        });

        grid.appendChild(card);
      });

      // 첫 번째 도안 기본 로드 (초기 진입 시에만)
      if (!keepCurrent) {
        drawingCanvas.loadTemplate(data.drawings[0].url, data.drawings[0].name);
      }
    }
  } catch (e) {
    console.warn('Failed to load drawings:', e);
  }

  // 백지 캔버스 버튼
  const btnBlank = document.getElementById('btnBlankCanvas');
  if (btnBlank) {
    btnBlank.addEventListener('click', () => {
      document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
      drawingCanvas.clearCanvas(true);
      drawingCanvas.currentTemplateName = '자유그리기';
      if (window.soundEngine) window.soundEngine.playPopSound();
    });
  }
}
window.loadDrawingsList = loadDrawingsList;

/**
 * 컬러 팔레트 & 툴바 설정
 */
function setupPaletteAndTools(drawingCanvas) {
  const colors = [
    '#000000', '#ffffff', '#ef476f', '#f72585', '#b5179e', '#7209b7',
    '#3a0ca3', '#4361ee', '#4cc9f0', '#00f2fe', '#06d6a0', '#2ec4b6',
    '#ffd166', '#ffb703', '#fb8500', '#e76f51', '#8d99ae', '#495057'
  ];

  const paletteGrid = document.getElementById('paletteGrid');
  if (paletteGrid) {
    paletteGrid.innerHTML = '';
    colors.forEach((color, idx) => {
      const swatch = document.createElement('div');
      swatch.className = `color-swatch ${idx === 3 ? 'active' : ''}`;
      swatch.style.backgroundColor = color;

      swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        drawingCanvas.currentColor = color;
        if (drawingCanvas.currentTool === 'eraser') {
          setTool('brush');
        }
        if (window.soundEngine) window.soundEngine.playBrushSound();
      });

      paletteGrid.appendChild(swatch);
    });
  }

  // 커스텀 컬러 피커
  const customColorInput = document.getElementById('customColorPicker');
  if (customColorInput) {
    customColorInput.addEventListener('input', (e) => {
      drawingCanvas.currentColor = e.target.value;
      if (drawingCanvas.currentTool === 'eraser') {
        setTool('brush');
      }
    });
  }

  // 툴 선택 (붓, 페인트통, 지우개)
  const toolBrush = document.getElementById('toolBrush');
  const toolBucket = document.getElementById('toolBucket');
  const toolEraser = document.getElementById('toolEraser');

  function setTool(toolName) {
    drawingCanvas.currentTool = toolName;
    [toolBrush, toolBucket, toolEraser].forEach(btn => {
      if (btn) btn.classList.remove('active');
    });

    if (toolName === 'brush' && toolBrush) toolBrush.classList.add('active');
    if (toolName === 'bucket' && toolBucket) toolBucket.classList.add('active');
    if (toolName === 'eraser' && toolEraser) toolEraser.classList.add('active');
    if (window.soundEngine) window.soundEngine.playPopSound();
  }

  if (toolBrush) toolBrush.addEventListener('click', () => setTool('brush'));
  if (toolBucket) toolBucket.addEventListener('click', () => setTool('bucket'));
  if (toolEraser) toolEraser.addEventListener('click', () => setTool('eraser'));

  // 브러시 크기 슬라이더
  const brushSlider = document.getElementById('brushSizeSlider');
  const brushVal = document.getElementById('brushSizeValue');
  if (brushSlider) {
    brushSlider.addEventListener('input', (e) => {
      const size = parseInt(e.target.value);
      drawingCanvas.brushSize = size;
      if (brushVal) brushVal.textContent = `${size}px`;
    });
  }

  // 실행 취소 & 다시 실행
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  if (btnUndo) btnUndo.addEventListener('click', () => {
    drawingCanvas.undo();
    if (window.soundEngine) window.soundEngine.playPopSound();
  });
  if (btnRedo) btnRedo.addEventListener('click', () => {
    drawingCanvas.redo();
    if (window.soundEngine) window.soundEngine.playPopSound();
  });

  // 캔버스 초기화 (전체 지우기)
  const btnClear = document.getElementById('btnClearCanvas');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (confirm('캔버스 그림을 모두 지우시겠습니까?')) {
        drawingCanvas.clearCanvas(true);
        drawingCanvas.saveState();
      }
    });
  }

  // 색칠한 도안 PNG 다운로드
  const btnDownload = document.getElementById('btnDownloadCanvas');
  if (btnDownload) {
    btnDownload.addEventListener('click', () => {
      try {
        const charNameInput = document.getElementById('inputCharName');
        const customName = charNameInput ? charNameInput.value.trim() : '';
        const savedFile = drawingCanvas.downloadImage(customName);
        if (savedFile) {
          if (window.soundEngine) window.soundEngine.playPopSound();
          if (window.showToast) {
            window.showToast(`💾 "${savedFile}" 파일로 도안이 저장되었습니다!`);
          }
        } else {
          alert('저장할 캔버스 이미지가 없습니다.');
        }
      } catch (err) {
        console.error('도안 다운로드 중 오류 발생:', err);
        alert('도안 다운로드 중 오류가 발생했습니다.');
      }
    });
  }

  // 도안(캔버스 프레임)과 하단 툴바의 너비 및 배치 균형 완벽 동기화
  const canvasFrame = document.querySelector('.canvas-frame');
  const toolbar = document.getElementById('drawingToolbar') || document.querySelector('.drawing-toolbar');
  if (canvasFrame && toolbar) {
    const syncToolbarWidth = () => {
      const frameWidth = canvasFrame.offsetWidth;
      if (frameWidth > 0) {
        // 도안 프레임 폭과 조화롭게 1:1 일치 (기본 최소 400px, 프레임이 더 넓으면 프레임 폭에 맞춤)
        const targetWidth = Math.max(frameWidth, 400);
        toolbar.style.width = `${targetWidth}px`;
        toolbar.style.maxWidth = `${targetWidth}px`;
      }
    };

    syncToolbarWidth();
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => syncToolbarWidth());
      ro.observe(canvasFrame);
    }
    window.addEventListener('resize', syncToolbarWidth);
  }
}

/**
 * AI 변환 및 송출 파이프라인
 */
function setupAIConvertPipeline(drawingCanvas, mediaWall) {
  const btnConvert = document.getElementById('btnStartAIConvert');
  const modal = document.getElementById('aiModalOverlay');
  const btnCloseModal = document.getElementById('btnCloseAiModal');
  const btnSendToWall = document.getElementById('btnSendToWall');
  const inputCharName = document.getElementById('inputCharName');

  const aiStatusText = document.getElementById('aiStatusText');
  const motionCards = document.querySelectorAll('.motion-card');

  let currentProcessedResult = null;
  let selectedMotion = 'walk';

  // AI 변환 시작 버튼 클릭
  if (btnConvert) {
    btnConvert.addEventListener('click', async () => {
      modal.classList.add('active');
      if (window.soundEngine) window.soundEngine.playMagicChime();

      // AI 파이프라인 가동
      currentProcessedResult = await window.aiProcessor.processDrawing(
        drawingCanvas.canvas,
        (progress, message) => {
          if (aiStatusText) aiStatusText.textContent = message;
        }
      );

      // 미리보기 시작
      window.aiProcessor.startPreview(selectedMotion);
    });
  }

  // 모달 닫기
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
      modal.classList.remove('active');
      window.aiProcessor.stopPreview();
    });
  }

  // 모션 선택
  motionCards.forEach(card => {
    card.addEventListener('click', () => {
      motionCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedMotion = card.dataset.motion;
      window.aiProcessor.setMotion(selectedMotion);
      if (window.soundEngine) window.soundEngine.playPopSound();
    });
  });

  // [미디어월로 전송 🚀] 버튼 클릭
  if (btnSendToWall) {
    btnSendToWall.addEventListener('click', () => {
      if (!currentProcessedResult) return;

      const name = (inputCharName && inputCharName.value.trim()) || '행복한 친구';

      const characterData = {
        id: `char_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: name,
        motion: selectedMotion,
        dataUrl: currentProcessedResult.dataUrl,
        width: currentProcessedResult.width,
        height: currentProcessedResult.height
      };

      // 1. 발사 효과음
      if (window.soundEngine) window.soundEngine.playLaunchSound();

      // 2. 네트워크 브로드캐스트 (실시간 미디어월에 송출)
      if (window.mediaWallNet) {
        window.mediaWallNet.sendCharacter(characterData);
      }

      // 3. 모달 닫기 및 상태 정리
      modal.classList.remove('active');
      window.aiProcessor.stopPreview();

      // 4. 전송 완료 토스트
      window.showToast(`🚀 [${name}] 캐릭터가 대형 미디어월에 성공적으로 송출되었습니다!`);
    });
  }
}

/**
 * 실시간 네트워크 동기화 설정
 */
function setupNetworkSync(mediaWall, adminDashboard) {
  if (!window.mediaWallNet) return;

  // 1. 초기 상태 수신 (테마, 설정, 기존 캐릭터)
  window.mediaWallNet.on('init_state', (data) => {
    if (data.currentTheme) {
      mediaWall.setTheme(data.currentTheme);
    }
    if (data.config) {
      mediaWall.config = { ...mediaWall.config, ...data.config };
    }
    if (data.characters && Array.isArray(data.characters)) {
      data.characters.forEach(char => {
        mediaWall.spawnCharacter(char);
        if (adminDashboard) adminDashboard.trackCharacter(char);
      });
    }
  });

  // 2. 캐릭터 등장 수신
  window.mediaWallNet.on('character_spawn', (data) => {
    if (data.character) {
      mediaWall.spawnCharacter(data.character);
      adminDashboard.trackCharacter(data.character);
    }
  });

  // 3. 테마 변경 수신
  window.mediaWallNet.on('theme_change', (data) => {
    if (data.theme) {
      mediaWall.setTheme(data.theme);
      adminDashboard.currentTheme = data.theme;
      adminDashboard.renderThemeCards();
    }
  });

  // 4. 캐릭터 강제 퇴장 수신
  window.mediaWallNet.on('character_remove', (data) => {
    if (data.characterId) {
      mediaWall.removeCharacter(data.characterId);
    }
  });

  // 5. 설정 변경 수신
  window.mediaWallNet.on('config_update', (data) => {
    if (data.config) {
      mediaWall.config = { ...mediaWall.config, ...data.config };
    }
  });

  // 6. 전체 초기화 수신
  window.mediaWallNet.on('clear_all', () => {
    mediaWall.clearAllCharacters();
  });

  // 7. 테마 목록 실시간 동기화 (새 테마 등록/수정/삭제)
  window.mediaWallNet.on('theme_list_update', () => {
    if (adminDashboard) adminDashboard.loadThemes();
  });

  // 8. 캐릭터 도안 실시간 동기화 (도안 등록/수정/삭제)
  window.mediaWallNet.on('drawings_update', () => {
    if (window.drawingCanvasInstance && window.loadDrawingsList) {
      window.loadDrawingsList(window.drawingCanvasInstance, true);
    }
    if (adminDashboard) {
      adminDashboard.loadDrawings();
    }
  });
}

/**
 * 뷰 모드 라우팅 및 스위칭 (마스터 관리자 비밀번호 보호 포함)
 */
function setupViewModeSwitcher(mediaWall) {
  const ADMIN_PASSWORD = '2326';
  const modeBtns = document.querySelectorAll('.mode-btn');
  const views = {
    wall: document.getElementById('viewMediaWall'),
    draw: document.getElementById('viewDrawingStudio'),
    admin: document.getElementById('viewAdminDashboard')
  };

  // 관리자 인증 모달 요소
  const authModal = document.getElementById('adminAuthModalOverlay');
  const authForm = document.getElementById('adminAuthForm');
  const authPasswordInput = document.getElementById('inputAdminPassword');
  const authError = document.getElementById('adminAuthError');
  const btnCloseAuth = document.getElementById('btnCloseAdminAuthModal');
  const btnCancelAuth = document.getElementById('btnCancelAdminAuth');
  const btnLogout = document.getElementById('btnAdminLogout');

  let currentActiveMode = 'wall';

  function isAdminAuthenticated() {
    return sessionStorage.getItem('media_wall_admin_auth') === 'true';
  }

  function openAdminAuthModal() {
    if (!authModal) return;
    if (authError) authError.style.display = 'none';
    if (authPasswordInput) {
      authPasswordInput.value = '';
      authPasswordInput.style.borderColor = '';
    }
    authModal.classList.add('active');
    setTimeout(() => {
      if (authPasswordInput) authPasswordInput.focus();
    }, 120);
  }

  function closeAdminAuthModal() {
    if (!authModal) return;
    authModal.classList.remove('active');
    if (authPasswordInput) authPasswordInput.value = '';
    if (authError) authError.style.display = 'none';

    // 인증 취소 시 현재 화면 모드로 URL 동기화
    const url = new URL(window.location);
    url.searchParams.set('mode', currentActiveMode);
    window.history.replaceState({}, '', url);
  }

  function requestSwitchMode(mode) {
    if (mode === 'admin' && !isAdminAuthenticated()) {
      openAdminAuthModal();
      return;
    }
    performSwitchMode(mode);
  }

  function performSwitchMode(mode) {
    currentActiveMode = mode;

    modeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    Object.keys(views).forEach(key => {
      if (views[key]) {
        views[key].classList.toggle('active', key === mode);
      }
    });

    // 미디어월 뷰로 전환 시 캔버스 리사이징 재확인
    if (mode === 'wall') {
      mediaWall.resizeCanvases();
      mediaWall.initThemeParticles();
    } else if (mode === 'draw') {
      setTimeout(() => {
        const canvasFrame = document.querySelector('.canvas-frame');
        const toolbar = document.getElementById('drawingToolbar') || document.querySelector('.drawing-toolbar');
        if (canvasFrame && toolbar && canvasFrame.offsetWidth > 0) {
          const targetWidth = Math.max(canvasFrame.offsetWidth, 480);
          toolbar.style.width = `${targetWidth}px`;
          toolbar.style.maxWidth = `${targetWidth}px`;
        }
      }, 60);
    }

    // URL 쿼리 파라미터 갱신 (새로고침 없이)
    const url = new URL(window.location);
    url.searchParams.set('mode', mode);
    window.history.replaceState({}, '', url);
  }

  // 관리자 인증 폼 제출 이벤트
  if (authForm) {
    authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const entered = (authPasswordInput && authPasswordInput.value.trim()) || '';
      if (entered === ADMIN_PASSWORD) {
        sessionStorage.setItem('media_wall_admin_auth', 'true');
        closeAdminAuthModal();
        performSwitchMode('admin');
        if (window.soundEngine && typeof window.soundEngine.playPopSound === 'function') {
          window.soundEngine.playPopSound();
        }
        if (window.showToast) {
          window.showToast('🔓 관리자 인증이 완료되었습니다.');
        }
      } else {
        if (authError) authError.style.display = 'block';
        if (authPasswordInput) {
          authPasswordInput.style.borderColor = '#f72585';
          authPasswordInput.value = '';
          authPasswordInput.focus();
        }
        if (window.soundEngine && typeof window.soundEngine.playPopSound === 'function') {
          window.soundEngine.playPopSound();
        }
      }
    });
  }

  // 인증 모달 취소/닫기 이벤트
  if (btnCloseAuth) {
    btnCloseAuth.addEventListener('click', closeAdminAuthModal);
  }
  if (btnCancelAuth) {
    btnCancelAuth.addEventListener('click', closeAdminAuthModal);
  }
  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) {
        closeAdminAuthModal();
      }
    });
  }

  // 관리자 로그아웃 버튼 이벤트
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      sessionStorage.removeItem('media_wall_admin_auth');
      performSwitchMode('wall');
      if (window.soundEngine && typeof window.soundEngine.playPopSound === 'function') {
        window.soundEngine.playPopSound();
      }
      if (window.showToast) {
        window.showToast('🔒 관리자 로그아웃 되었습니다.');
      }
    });
  }

  // 상단 네비게이션 모드 전환 버튼
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      requestSwitchMode(btn.dataset.mode);
      if (window.soundEngine && typeof window.soundEngine.playPopSound === 'function') {
        window.soundEngine.playPopSound();
      }
    });
  });

  // URL 쿼리에 지정된 초기 모드 확인 (?mode=draw 또는 ?mode=wall 또는 ?mode=admin)
  const params = new URLSearchParams(window.location.search);
  const initialMode = params.get('mode') || 'wall';

  if (initialMode === 'admin') {
    if (isAdminAuthenticated()) {
      performSwitchMode('admin');
    } else {
      performSwitchMode('wall');
      openAdminAuthModal();
    }
  } else {
    performSwitchMode(initialMode);
  }

  // 전역 노출 (필요 시 외부 연동)
  window.switchAppMode = requestSwitchMode;
}

/**
 * 미디어월 전용 컨트롤 (전체화면, HUD 토글, 음소거)
 */
function setupWallControls(mediaWall) {
  const btnFullscreen = document.getElementById('btnWallFullscreen');
  const btnToggleHud = document.getElementById('btnWallToggleHud');
  const btnMute = document.getElementById('btnWallMute');
  const hud = document.getElementById('wallHud');
  const nav = document.getElementById('globalNav');

  // 전체화면 토글
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
        btnFullscreen.textContent = '🗗';
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
        btnFullscreen.textContent = '⛶';
      }
    });
  }

  // HUD & 네비게이션 숨김 (순수 미디어아트 전시 모드)
  let hudVisible = true;
  if (btnToggleHud) {
    btnToggleHud.addEventListener('click', () => {
      hudVisible = !hudVisible;
      if (hud) hud.classList.toggle('fade-out', !hudVisible);
      if (nav) nav.classList.toggle('hidden-mode', !hudVisible);
    });
  }

  // 음소거 토글
  if (btnMute) {
    btnMute.addEventListener('click', () => {
      if (window.soundEngine) {
        const isMuted = window.soundEngine.toggleMute();
        btnMute.textContent = isMuted ? '🔇' : '🔊';
      }
    });
  }
}

/**
 * 드로잉 스튜디오 내 Animated Drawings MP4 비디오 파일 업로드 및 미디어월 송출 핸들러
 */
function setupStudioVideoUpload(mediaWall) {
  const fileInput = document.getElementById('studioVideoInput');
  const btnSelect = document.getElementById('btnStudioSelectVideo');
  const statusText = document.getElementById('studioVideoStatus');
  const previewSection = document.getElementById('studioVideoPreviewSection');
  const videoPreview = document.getElementById('studioVideoPreview');
  const charNameInput = document.getElementById('studioVideoCharName');
  const chromaKeyCheck = document.getElementById('studioVideoChromaKey');
  const btnSendVideo = document.getElementById('btnStudioSendVideo');

  if (!btnSelect || !fileInput) return;

  let currentVideoFile = null;
  let currentVideoBase64 = null;

  btnSelect.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    currentVideoFile = file;
    if (statusText) {
      statusText.textContent = `🎬 ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
      statusText.style.color = 'var(--marker-yellow)';
    }

    const defaultName = file.name.replace(/\.[^/.]+$/, '');
    if (charNameInput && !charNameInput.value) {
      charNameInput.value = defaultName;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      currentVideoBase64 = evt.target.result;
      if (videoPreview) {
        videoPreview.src = currentVideoBase64;
        videoPreview.load();
        videoPreview.play().catch(() => {});
      }
      if (previewSection) {
        previewSection.style.display = 'flex';
      }
      if (window.soundEngine) window.soundEngine.playPopSound();
    };
    reader.readAsDataURL(file);
  });

  if (btnSendVideo) {
    btnSendVideo.addEventListener('click', async () => {
      if (!currentVideoFile || !currentVideoBase64) {
        alert('먼저 MP4 비디오 파일을 선택해주세요.');
        return;
      }

      const name = (charNameInput && charNameInput.value.trim()) || '비디오 캐릭터';
      const useChromaKey = chromaKeyCheck ? chromaKeyCheck.checked : true;

      btnSendVideo.disabled = true;
      const originalText = btnSendVideo.innerHTML;
      btnSendVideo.innerHTML = '<span>⏳</span> 미디어월로 전송 중...';

      try {
        let videoUrl = currentVideoBase64;
        try {
          const res = await fetch('/api/upload-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: currentVideoFile.name,
              videoData: currentVideoBase64
            })
          });
          const uploadResult = await res.json();
          if (uploadResult.success && uploadResult.url) {
            videoUrl = uploadResult.url;
          }
        } catch (uploadErr) {
          console.warn('Server upload failed, using DataURL fallback:', uploadErr);
        }

        let thumbUrl = '';
        try {
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = 120;
          thumbCanvas.height = 120;
          const tctx = thumbCanvas.getContext('2d');
          if (videoPreview) {
            tctx.drawImage(videoPreview, 0, 0, 120, 120);
            thumbUrl = thumbCanvas.toDataURL('image/png');
          }
        } catch (e) {}

        const videoChar = {
          id: `video_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          name: name,
          type: 'video',
          videoUrl: videoUrl,
          chromaKey: useChromaKey,
          motion: 'walk',
          thumb: thumbUrl || videoUrl,
          width: (videoPreview && videoPreview.videoWidth) || 300,
          height: (videoPreview && videoPreview.videoHeight) || 300
        };

        if (window.mediaWallNet) {
          window.mediaWallNet.sendCharacter(videoChar);
        }

        if (window.soundEngine) {
          if (typeof window.soundEngine.playFanfare === 'function') {
            window.soundEngine.playFanfare();
          } else if (typeof window.soundEngine.playLaunchSound === 'function') {
            window.soundEngine.playLaunchSound();
          }
        }
        if (window.showToast) {
          window.showToast(`🚀 '${name}' 애니메이션 비디오가 미디어월로 전송되었습니다!`);
        }

        btnSendVideo.innerHTML = '<span>✅</span> 전송 완료!';
        setTimeout(() => {
          btnSendVideo.disabled = false;
          btnSendVideo.innerHTML = originalText;
        }, 2000);
      } catch (err) {
        console.error('Failed to send video character:', err);
        alert('비디오 전송 중 오류가 발생했습니다.');
        btnSendVideo.disabled = false;
        btnSendVideo.innerHTML = originalText;
      }
    });
  }
}

/**
 * 서비스 워커(Service Worker) 등록 및 오프라인 PWA 지원
 * - localhost 또는 HTTPS 환경에서는 완벽 캐싱 활성화
 * - 사설 IP(192.168.x.x) HTTP 환경에서는 브라우저 보안 정책에 따라 조용히 폴백
 */
function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          console.log('✅ [ServiceWorker] 오프라인 캐싱 서비스 워커 등록 성공! (Scope:', reg.scope, ')');
        })
        .catch((err) => {
          if (!isSecure) {
            console.info('ℹ️ [ServiceWorker] 사설 IP HTTP 환경에서는 브라우저 보안 정책상 Service Worker가 비활성화되었습니다. (HTTPS 접속 시 자동 활성화됩니다)');
          } else {
            console.warn('⚠️ [ServiceWorker] 등록 실패:', err.message);
          }
        });
    });
  }
}

// 서비스 워커 초기화 실행
setupServiceWorker();


