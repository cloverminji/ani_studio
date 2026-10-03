/**
 * admin.js
 * 현장 마스터 관리자 대시보드 컨트롤러
 * - 기본 테마 프리셋(bgimage) 원클릭 변경
 * - 웹 이미지 검색 및 즉각 반영 소싱
 * - 캐릭터 실시간 모니터링 & 강제 퇴장
 * - 수명(15분) 및 최대 수량(20마리) 제어
 * - BGM 및 시스템 사운드 제어
 */

class AdminDashboard {
  constructor() {
    this.themes = [];
    this.currentTheme = null;
    this.characters = [];
    this.config = {
      characterLifespan: 900,
      maxCharacters: 12
    };

    this.initElements();
    this.bindEvents();
    this.loadThemes();
    this.loadDrawings();
    this.startMonitorLoop();
  }

  initElements() {
    this.themesGrid = document.getElementById('adminThemesGrid');
    this.activeCharList = document.getElementById('adminActiveCharList');
    this.lifespanSlider = document.getElementById('settingLifespan');
    this.lifespanVal = document.getElementById('settingLifespanVal');
    this.maxCharsSlider = document.getElementById('settingMaxChars');
    this.maxCharsVal = document.getElementById('settingMaxCharsVal');
    if (this.maxCharsSlider) this.maxCharsSlider.value = this.config.maxCharacters;
    if (this.maxCharsVal) this.maxCharsVal.textContent = `${this.config.maxCharacters}개`;
    this.btnClearAll = document.getElementById('btnClearAllChars');

    // 1. 테마 추가/업로드 요소
    this.btnToggleAddTheme = document.getElementById('btnToggleAddTheme');
    this.addThemeFormSection = document.getElementById('addThemeFormSection');
    this.inputNewThemeName = document.getElementById('inputNewThemeName');
    this.inputThemeFile = document.getElementById('inputThemeFile');
    this.btnSelectThemeFile = document.getElementById('btnSelectThemeFile');
    this.btnUploadThemeSubmit = document.getElementById('btnUploadThemeSubmit');
    this.themeFilePreviewBox = document.getElementById('themeFilePreviewBox');
    this.themeFilePreviewImg = document.getElementById('themeFilePreviewImg');
    this.themeFileStatus = document.getElementById('themeFileStatus');
    this.currentNewThemeFile = null;
    this.currentNewThemeBase64 = null;

    // 2. 캐릭터 도안 관리 요소
    this.adminDrawingsGrid = document.getElementById('adminDrawingsGrid');
    this.btnToggleAddDrawing = document.getElementById('btnToggleAddDrawing');
    this.addDrawingFormSection = document.getElementById('addDrawingFormSection');
    this.inputNewDrawingName = document.getElementById('inputNewDrawingName');
    this.inputDrawingFile = document.getElementById('inputDrawingFile');
    this.btnSelectDrawingFile = document.getElementById('btnSelectDrawingFile');
    this.btnUploadDrawingSubmit = document.getElementById('btnUploadDrawingSubmit');
    this.drawingFilePreviewBox = document.getElementById('drawingFilePreviewBox');
    this.drawingFilePreviewImg = document.getElementById('drawingFilePreviewImg');
    this.drawingFileStatus = document.getElementById('drawingFileStatus');
    this.currentNewDrawingFile = null;
    this.currentNewDrawingBase64 = null;
    this.drawings = [];

    // 비디오 업로드 요소 (하위 호환성 유지)
    this.videoInput = document.getElementById('adminVideoInput');
    this.btnSelectVideo = document.getElementById('btnSelectVideo');
    this.videoDropZone = document.getElementById('videoDropZone');
    this.videoFileStatus = document.getElementById('videoFileStatus');
    this.videoPreviewSection = document.getElementById('videoPreviewSection');
    this.videoPreview = document.getElementById('adminVideoPreview');
    this.videoCharName = document.getElementById('adminVideoCharName');
    this.videoChromaKey = document.getElementById('adminVideoChromaKey');
    this.videoMotionStyle = document.getElementById('adminVideoMotionStyle');
    this.btnSendVideoToWall = document.getElementById('btnSendVideoToWall');
    this.currentVideoFile = null;
    this.currentVideoBase64 = null;
  }

  bindEvents() {
    // 테마 추가 폼 토글
    if (this.btnToggleAddTheme && this.addThemeFormSection) {
      this.btnToggleAddTheme.addEventListener('click', () => {
        const isHidden = this.addThemeFormSection.style.display === 'none';
        this.addThemeFormSection.style.display = isHidden ? 'flex' : 'none';
        this.btnToggleAddTheme.innerHTML = isHidden ? '<span>✖️</span> 닫기' : '<span>➕</span> 새 배경 테마 업로드';
      });
    }

    // 테마 파일 선택 & 미리보기
    if (this.btnSelectThemeFile && this.inputThemeFile) {
      this.btnSelectThemeFile.addEventListener('click', () => this.inputThemeFile.click());
    }
    if (this.inputThemeFile) {
      this.inputThemeFile.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        this.currentNewThemeFile = file;
        if (this.inputNewThemeName && !this.inputNewThemeName.value) {
          this.inputNewThemeName.value = file.name.replace(/\.[^/.]+$/, '');
        }
        const reader = new FileReader();
        reader.onload = (evt) => {
          this.currentNewThemeBase64 = evt.target.result;
          if (this.themeFilePreviewImg) this.themeFilePreviewImg.src = this.currentNewThemeBase64;
          if (this.themeFileStatus) this.themeFileStatus.textContent = `🖼️ ${file.name} (${(file.size / 1024).toFixed(0)}KB)`;
          if (this.themeFilePreviewBox) this.themeFilePreviewBox.style.display = 'flex';
          if (window.soundEngine) window.soundEngine.playPopSound();
        };
        reader.readAsDataURL(file);
      });
    }

    // 테마 업로드 제출
    if (this.btnUploadThemeSubmit) {
      this.btnUploadThemeSubmit.addEventListener('click', () => this.uploadTheme());
    }

    // 캐릭터 도안 추가 폼 토글
    if (this.btnToggleAddDrawing && this.addDrawingFormSection) {
      this.btnToggleAddDrawing.addEventListener('click', () => {
        const isHidden = this.addDrawingFormSection.style.display === 'none';
        this.addDrawingFormSection.style.display = isHidden ? 'flex' : 'none';
        this.btnToggleAddDrawing.innerHTML = isHidden ? '<span>✖️</span> 닫기' : '<span>➕</span> 새 캐릭터 도안 등록';
      });
    }

    // 도안 파일 선택 & 미리보기
    if (this.btnSelectDrawingFile && this.inputDrawingFile) {
      this.btnSelectDrawingFile.addEventListener('click', () => this.inputDrawingFile.click());
    }
    if (this.inputDrawingFile) {
      this.inputDrawingFile.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        this.currentNewDrawingFile = file;
        if (this.inputNewDrawingName && !this.inputNewDrawingName.value) {
          this.inputNewDrawingName.value = file.name.replace(/\.[^/.]+$/, '');
        }
        const reader = new FileReader();
        reader.onload = (evt) => {
          this.currentNewDrawingBase64 = evt.target.result;
          if (this.drawingFilePreviewImg) this.drawingFilePreviewImg.src = this.currentNewDrawingBase64;
          if (this.drawingFileStatus) this.drawingFileStatus.textContent = `✏️ ${file.name} (${(file.size / 1024).toFixed(0)}KB)`;
          if (this.drawingFilePreviewBox) this.drawingFilePreviewBox.style.display = 'flex';
          if (window.soundEngine) window.soundEngine.playPopSound();
        };
        reader.readAsDataURL(file);
      });
    }

    // 도안 업로드 제출
    if (this.btnUploadDrawingSubmit) {
      this.btnUploadDrawingSubmit.addEventListener('click', () => this.uploadDrawing());
    }

    // 비디오 파일 선택 (기존 코드 안전 유지)
    if (this.btnSelectVideo && this.videoInput) {
      this.btnSelectVideo.addEventListener('click', () => this.videoInput.click());
    }
    if (this.videoInput) {
      this.videoInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.handleVideoFile(e.target.files[0]);
        }
      });
    }

    // 수명 설정 슬라이더
    if (this.lifespanSlider) {
      this.lifespanSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        this.config.characterLifespan = val;
        const minutes = Math.floor(val / 60);
        const seconds = val % 60;
        this.lifespanVal.textContent = minutes > 0 ? `${minutes}분 ${seconds > 0 ? seconds + '초' : ''}` : `${val}초`;
        this.broadcastConfig();
      });
    }

    // 최대 캐릭터 수 설정
    if (this.maxCharsSlider) {
      this.maxCharsSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        this.config.maxCharacters = val;
        this.maxCharsVal.textContent = `${val}개`;
        this.broadcastConfig();
      });
    }

    // 전체 비우기
    if (this.btnClearAll) {
      this.btnClearAll.addEventListener('click', () => {
        if (confirm('미디어월의 모든 캐릭터를 화면에서 퇴장시키겠습니까?')) {
          if (window.mediaWallNet) {
            window.mediaWallNet.sendClearAll();
          }
          this.characters = [];
          this.renderCharacterList();
        }
      });
    }
  }

  // =========================================================================
  // 1. 테마 관리 (로드, 렌더링, 업로드, 이름수정, 삭제)
  // =========================================================================

  async loadThemes() {
    try {
      const res = await fetch('/api/themes');
      const data = await res.json();
      if (data.success) {
        this.themes = data.themes;
        this.currentTheme = data.currentTheme;
        if (data.config) {
          this.config = data.config;
          if (this.lifespanSlider) this.lifespanSlider.value = this.config.characterLifespan;
          if (this.maxCharsSlider) this.maxCharsSlider.value = this.config.maxCharacters;
          if (this.maxCharsVal) this.maxCharsVal.textContent = `${this.config.maxCharacters}개`;
        }
        this.renderThemeCards();
      }
    } catch (e) {
      console.warn('Load themes error:', e);
    }
  }

  renderThemeCards() {
    if (!this.themesGrid) return;
    this.themesGrid.innerHTML = '';

    this.themes.forEach(theme => {
      const card = document.createElement('div');
      card.className = `theme-card ${this.currentTheme && this.currentTheme.name === theme.name ? 'active' : ''}`;
      card.innerHTML = `
        <div class="theme-card-actions">
          <button type="button" class="card-action-btn edit" title="테마 이름 수정">✏️</button>
          <button type="button" class="card-action-btn delete" title="테마 삭제">🗑️</button>
        </div>
        <img src="${theme.url}" alt="${theme.name}" loading="lazy" />
        <div class="theme-card-overlay">
          <div class="theme-card-name">${theme.name}</div>
        </div>
      `;

      // 카드 클릭 시 미디어월 테마 변경
      card.addEventListener('click', (e) => {
        // 액션 버튼 클릭 시 전파 방지
        if (e.target.closest('.card-action-btn')) return;
        this.selectTheme(theme);
      });

      // ✏️ 테마 이름 수정
      const btnEdit = card.querySelector('.card-action-btn.edit');
      if (btnEdit) {
        btnEdit.addEventListener('click', (e) => {
          e.stopPropagation();
          const newName = prompt(`'${theme.name}' 테마의 새 이름을 입력하세요:`, theme.name);
          if (newName && newName.trim() && newName.trim() !== theme.name) {
            this.renameTheme(theme.filename, newName.trim());
          }
        });
      }

      // 🗑️ 테마 삭제
      const btnDelete = card.querySelector('.card-action-btn.delete');
      if (btnDelete) {
        btnDelete.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`'${theme.name}' 배경 테마를 삭제하시겠습니까?`)) {
            this.deleteTheme(theme.filename);
          }
        });
      }

      this.themesGrid.appendChild(card);
    });
  }

  selectTheme(theme) {
    this.currentTheme = theme;
    this.renderThemeCards();

    if (window.mediaWallNet) {
      window.mediaWallNet.sendThemeChange(theme);
    }

    if (window.showToast) {
      window.showToast(`🎨 테마가 [${theme.name}]으로 실시간 변경되었습니다!`);
    }
  }

  async uploadTheme() {
    if (!this.currentNewThemeFile || !this.currentNewThemeBase64) {
      alert('먼저 배경 이미지 파일을 선택해주세요.');
      return;
    }
    const name = (this.inputNewThemeName && this.inputNewThemeName.value.trim()) || '새 테마';

    this.btnUploadThemeSubmit.disabled = true;
    this.btnUploadThemeSubmit.innerHTML = '<span>⏳</span> 업로드 중...';

    try {
      const res = await fetch('/api/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          imageData: this.currentNewThemeBase64,
          fileName: this.currentNewThemeFile.name
        })
      });
      const data = await res.json();
      if (data.success) {
        if (window.showToast) window.showToast(`🎉 새 배경 테마 [${name}] 등록 완료!`);
        if (window.soundEngine) window.soundEngine.playFanfare();
        // 폼 초기화 및 닫기
        this.currentNewThemeFile = null;
        this.currentNewThemeBase64 = null;
        if (this.inputNewThemeName) this.inputNewThemeName.value = '';
        if (this.themeFilePreviewBox) this.themeFilePreviewBox.style.display = 'none';
        if (this.addThemeFormSection) this.addThemeFormSection.style.display = 'none';
        if (this.btnToggleAddTheme) this.btnToggleAddTheme.innerHTML = '<span>➕</span> 새 배경 테마 업로드';
        await this.loadThemes();
      } else {
        alert(data.error || '테마 등록에 실패했습니다.');
      }
    } catch (e) {
      console.error('Theme upload error:', e);
      alert('테마 업로드 중 오류가 발생했습니다.');
    } finally {
      this.btnUploadThemeSubmit.disabled = false;
      this.btnUploadThemeSubmit.innerHTML = '<span>🚀</span> 테마 등록';
    }
  }

  async renameTheme(filename, newName) {
    try {
      const res = await fetch(`/api/themes/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName })
      });
      const data = await res.json();
      if (data.success) {
        if (window.showToast) window.showToast(`✏️ 테마 이름이 [${data.newName}]으로 수정되었습니다.`);
        await this.loadThemes();
      } else {
        alert(data.error || '테마 이름 수정 실패');
      }
    } catch (e) {
      console.error('Rename theme error:', e);
      alert('테마 이름 수정 중 오류가 발생했습니다.');
    }
  }

  async deleteTheme(filename) {
    try {
      const res = await fetch(`/api/themes/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        if (window.showToast) window.showToast('🗑️ 테마가 성공적으로 삭제되었습니다.');
        await this.loadThemes();
      } else {
        alert(data.error || '테마 삭제 실패');
      }
    } catch (e) {
      console.error('Delete theme error:', e);
      alert('테마 삭제 중 오류가 발생했습니다.');
    }
  }

  // =========================================================================
  // 2. 캐릭터 도안 관리 (로드, 렌더링, 업로드, 이름수정, 삭제)
  // =========================================================================

  async loadDrawings() {
    try {
      const res = await fetch('/api/drawings');
      const data = await res.json();
      if (data.success) {
        this.drawings = data.drawings;
        this.renderDrawingCards();
      }
    } catch (e) {
      console.warn('Load drawings error:', e);
    }
  }

  renderDrawingCards() {
    if (!this.adminDrawingsGrid) return;
    this.adminDrawingsGrid.innerHTML = '';

    if (this.drawings.length === 0) {
      this.adminDrawingsGrid.innerHTML = '<div style="color:var(--sketch-ink-muted); grid-column:1/-1; text-align:center; padding:16px;">등록된 캐릭터 도안이 없습니다.</div>';
      return;
    }

    this.drawings.forEach(draw => {
      const card = document.createElement('div');
      card.className = 'admin-drawing-card';
      card.innerHTML = `
        <div class="admin-drawing-img-box">
          <img src="${draw.url}" alt="${draw.name}" />
        </div>
        <div class="admin-drawing-name" title="${draw.name}">${draw.name}</div>
        <div class="admin-drawing-actions">
          <button type="button" class="card-action-btn edit" title="도안 이름 수정">✏️</button>
          <button type="button" class="card-action-btn delete" title="도안 삭제">🗑️</button>
        </div>
      `;

      // ✏️ 도안 이름 수정
      const btnEdit = card.querySelector('.card-action-btn.edit');
      if (btnEdit) {
        btnEdit.addEventListener('click', () => {
          const newName = prompt(`'${draw.name}' 캐릭터 도안의 새 이름을 입력하세요:`, draw.name);
          if (newName && newName.trim() && newName.trim() !== draw.name) {
            this.renameDrawing(draw.filename, newName.trim());
          }
        });
      }

      // 🗑️ 도안 삭제
      const btnDelete = card.querySelector('.card-action-btn.delete');
      if (btnDelete) {
        btnDelete.addEventListener('click', () => {
          if (confirm(`'${draw.name}' 캐릭터 도안을 삭제하시겠습니까?\n삭제 시 학생 드로잉 스튜디오에서도 즉시 제거됩니다.`)) {
            this.deleteDrawing(draw.filename);
          }
        });
      }

      this.adminDrawingsGrid.appendChild(card);
    });
  }

  async uploadDrawing() {
    if (!this.currentNewDrawingFile || !this.currentNewDrawingBase64) {
      alert('먼저 도안 이미지 파일을 선택해주세요.');
      return;
    }
    const name = (this.inputNewDrawingName && this.inputNewDrawingName.value.trim()) || '새 도안';

    this.btnUploadDrawingSubmit.disabled = true;
    this.btnUploadDrawingSubmit.innerHTML = '<span>⏳</span> 등록 중...';

    try {
      const res = await fetch('/api/drawings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          imageData: this.currentNewDrawingBase64,
          fileName: this.currentNewDrawingFile.name
        })
      });
      const data = await res.json();
      if (data.success) {
        if (window.showToast) window.showToast(`🎉 새 캐릭터 도안 [${name}] 등록 완료!`);
        if (window.soundEngine) window.soundEngine.playFanfare();
        // 폼 초기화 및 닫기
        this.currentNewDrawingFile = null;
        this.currentNewDrawingBase64 = null;
        if (this.inputNewDrawingName) this.inputNewDrawingName.value = '';
        if (this.drawingFilePreviewBox) this.drawingFilePreviewBox.style.display = 'none';
        if (this.addDrawingFormSection) this.addDrawingFormSection.style.display = 'none';
        if (this.btnToggleAddDrawing) this.btnToggleAddDrawing.innerHTML = '<span>➕</span> 새 캐릭터 도안 등록';
        await this.loadDrawings();
      } else {
        alert(data.error || '도안 등록 실패');
      }
    } catch (e) {
      console.error('Drawing upload error:', e);
      alert('도안 업로드 중 오류가 발생했습니다.');
    } finally {
      this.btnUploadDrawingSubmit.disabled = false;
      this.btnUploadDrawingSubmit.innerHTML = '<span>🚀</span> 도안 등록';
    }
  }

  async renameDrawing(filename, newName) {
    try {
      const res = await fetch(`/api/drawings/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName })
      });
      const data = await res.json();
      if (data.success) {
        if (window.showToast) window.showToast(`✏️ 도안 이름이 [${data.newName}]으로 수정되었습니다.`);
        await this.loadDrawings();
      } else {
        alert(data.error || '도안 이름 수정 실패');
      }
    } catch (e) {
      console.error('Rename drawing error:', e);
      alert('도안 이름 수정 중 오류가 발생했습니다.');
    }
  }

  async deleteDrawing(filename) {
    try {
      const res = await fetch(`/api/drawings/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        if (window.showToast) window.showToast('🗑️ 캐릭터 도안이 성공적으로 삭제되었습니다.');
        await this.loadDrawings();
      } else {
        alert(data.error || '도안 삭제 실패');
      }
    } catch (e) {
      console.error('Delete drawing error:', e);
      alert('도안 삭제 중 오류가 발생했습니다.');
    }
  }

  // 1. 비디오 파일 선택 및 미리보기 처리
  handleVideoFile(file) {
    if (!file) return;
    const isVideoType = file.type && (file.type.includes('video/mp4') || file.type.includes('video/webm'));
    const isVideoExt = /\.(mp4|webm)$/i.test(file.name || '');
    if (!isVideoType && !isVideoExt) {
      alert('MP4 또는 WebM 형식의 비디오 파일만 지원됩니다.');
      return;
    }

    this.currentVideoFile = file;
    if (this.videoFileStatus) {
      this.videoFileStatus.textContent = `🎬 ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
    }

    // 파일명에서 기본 캐릭터 이름 자동 추출
    const defaultName = file.name.replace(/\.[^/.]+$/, "");
    if (this.videoCharName) {
      this.videoCharName.value = defaultName;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this.currentVideoBase64 = e.target.result;
      if (this.videoPreview) {
        this.videoPreview.src = this.currentVideoBase64;
      }
      if (this.videoPreviewSection) {
        this.videoPreviewSection.style.display = 'flex';
      }
      if (window.soundEngine) window.soundEngine.playPopSound();
    };
    reader.readAsDataURL(file);
  }

  // 2. 비디오 캐릭터 서버 업로드 및 미디어월 전송
  async sendVideoCharacterToWall() {
    if (!this.currentVideoFile || !this.currentVideoBase64) {
      alert('먼저 Animated Drawings MP4 비디오 파일을 선택해주세요.');
      return;
    }

    const charName = (this.videoCharName && this.videoCharName.value.trim()) || '비디오 캐릭터';
    const motion = (this.videoMotionStyle && this.videoMotionStyle.value) || 'walk';
    const useChromaKey = this.videoChromaKey ? this.videoChromaKey.checked : true;

    if (this.btnSendVideoToWall) {
      this.btnSendVideoToWall.disabled = true;
      this.btnSendVideoToWall.innerHTML = '<span>⏳</span> 비디오 캐릭터 전송 중...';
    }

    try {
      // 서버에 비디오 파일 업로드
      let videoUrl = this.currentVideoBase64; // 로컬 폴백용 dataUrl
      try {
        const res = await fetch('/api/upload-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: this.currentVideoFile.name,
            videoData: this.currentVideoBase64
          })
        });
        const uploadResult = await res.json();
        if (uploadResult.success && uploadResult.url) {
          videoUrl = uploadResult.url;
        }
      } catch (err) {
        console.warn('Server upload failed, using DataURL fallback:', err);
      }

      // 비디오 썸네일(첫 프레임) 캡처 (모니터링 리스트용)
      let thumbUrl = '';
      try {
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 100;
        thumbCanvas.height = 100;
        const tctx = thumbCanvas.getContext('2d');
        if (this.videoPreview) {
          tctx.drawImage(this.videoPreview, 0, 0, 100, 100);
          thumbUrl = thumbCanvas.toDataURL('image/png');
        }
      } catch (e) {}

      // 캐릭터 데이터 패킷 생성
      const videoCharacter = {
        id: `video_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: charName,
        type: 'video',
        videoUrl: videoUrl,
        chromaKey: useChromaKey,
        motion: motion,
        thumb: thumbUrl || videoUrl,
        width: (this.videoPreview && this.videoPreview.videoWidth) || 300,
        height: (this.videoPreview && this.videoPreview.videoHeight) || 300
      };

      // 실시간 네트워크 브로드캐스트
      if (window.mediaWallNet) {
        window.mediaWallNet.sendCharacter(videoCharacter);
      }

      // 효과음 & 토스트
      if (window.soundEngine) window.soundEngine.playLaunchSound();
      if (window.showToast) {
        window.showToast(`🎬 [${charName}] 비디오 캐릭터가 미디어월에 송출되었습니다!`);
      }
    } catch (e) {
      console.error('Send video character error:', e);
      alert('비디오 캐릭터 송출 중 오류가 발생했습니다.');
    } finally {
      if (this.btnSendVideoToWall) {
        this.btnSendVideoToWall.disabled = false;
        this.btnSendVideoToWall.innerHTML = '<span>🚀</span> 미디어월로 비디오 캐릭터 전송하기';
      }
    }
  }

  // 캐릭터 수신 동기화 (미디어월 전송 시 캐릭터 1개만 유지)
  trackCharacter(char) {
    this.characters = [{
      id: char.id,
      name: char.name,
      thumb: char.thumb || char.dataUrl || char.url,
      remainingTime: this.config.characterLifespan,
      totalLifespan: this.config.characterLifespan
    }];
    this.renderCharacterList();
  }

  // 캐릭터 삭제
  removeCharacter(id) {
    this.characters = this.characters.filter(c => c.id !== id);
    this.renderCharacterList();

    if (window.mediaWallNet) {
      window.mediaWallNet.sendCharacterRemove(id);
    }
  }

  renderCharacterList() {
    if (!this.activeCharList) return;
    this.activeCharList.innerHTML = '';

    if (this.characters.length === 0) {
      this.activeCharList.innerHTML = '<div style="color:var(--text-dim);font-size:0.9rem;padding:12px;text-align:center;">현재 스크린에 등장한 캐릭터가 없습니다.</div>';
      return;
    }

    this.characters.forEach(char => {
      const card = document.createElement('div');
      card.className = 'character-item-card';

      const min = Math.floor(char.remainingTime / 60);
      const sec = Math.floor(char.remainingTime % 60);
      const timeStr = `${min}:${sec < 10 ? '0' : ''}${sec}`;

      card.innerHTML = `
        <div class="char-info">
          <img src="${char.thumb}" class="char-thumb" alt="${char.name}" />
          <div>
            <div class="char-name">${char.name}</div>
            <div class="char-timer">⏱️ 남은 시간: ${timeStr}</div>
          </div>
        </div>
        <button class="btn-remove-char" title="즉시 퇴장">퇴장</button>
      `;

      card.querySelector('.btn-remove-char').addEventListener('click', () => {
        this.removeCharacter(char.id);
      });

      this.activeCharList.appendChild(card);
    });
  }

  startMonitorLoop() {
    setInterval(() => {
      let changed = false;
      for (let i = this.characters.length - 1; i >= 0; i--) {
        const c = this.characters[i];
        c.remainingTime -= 1;
        if (c.remainingTime <= 0) {
          this.characters.splice(i, 1);
          changed = true;
        }
      }
      if (changed || this.characters.length > 0) {
        this.renderCharacterList();
      }
    }, 1000);
  }

  broadcastConfig() {
    if (window.mediaWallNet) {
      window.mediaWallNet.sendConfigUpdate(this.config);
    }
  }
}
