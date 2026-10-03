/**
 * audio.js
 * Web Audio API 기반 오디오 합성 엔진
 * 외부 사운드 에셋 파일 없이도 브라우저 신디사이저로 영롱한 미디어아트 사운드 및 효과음 생성
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.ambientGain = null;
    this.masterGain = null;
    this.currentThemeAmbient = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
      
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.6, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      this.ambientGain.connect(this.masterGain);

      this.initialized = true;
    } catch (e) {
      console.warn('Web Audio not supported:', e);
    }
  }

  ensureContext() {
    if (!this.initialized) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // 1. 송출 완료 로켓 효과음 (발사 및 상승 톤)
  playLaunchSound() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.6);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.85);

    // 반짝이는 마법 벨
    setTimeout(() => this.playMagicChime(), 600);
  }

  // 2. 미디어월 캐릭터 등장 마법 차임벨
  playMagicChime() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51]; // C E G C E
    const now = this.ctx.currentTime;

    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startTime = now + i * 0.08;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.2, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + 0.7);
    });
  }

  // 3. 톡! 물방울 / 터치 팝 효과음
  playPopSound() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.15);
  }

  // 4. 페인트/붓 칠하는 소리
  playBrushSound() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.linearRampToValueAtTime(360, now + 0.05);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.07);
  }

  // 5. 테마별 앰비언스 BGM 루프 합성
  setThemeAmbient(themeName) {
    if (!this.ctx || this.isMuted) return;
    this.stopAmbient();

    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();

    let rootFreq = 130.81; // 기본 C3
    if (themeName.includes('바다')) rootFreq = 146.83; // D
    if (themeName.includes('우주')) rootFreq = 110.00; // A
    if (themeName.includes('숲')) rootFreq = 164.81; // E
    if (themeName.includes('미래')) rootFreq = 174.61; // F

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(rootFreq, now);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(rootFreq * 1.5, now); // 5도 화음

    lfo.frequency.setValueAtTime(0.15, now); // 천천히 울렁이는 모듈레이션
    lfoGain.gain.setValueAtTime(5, now);
    lfo.connect(osc1.frequency);

    osc1.connect(this.ambientGain);
    osc2.connect(this.ambientGain);

    osc1.start(now);
    osc2.start(now);
    lfo.start(now);

    this.currentThemeAmbient = { osc1, osc2, lfo };
  }

  stopAmbient() {
    if (this.currentThemeAmbient) {
      try {
        this.currentThemeAmbient.osc1.stop();
        this.currentThemeAmbient.osc2.stop();
        this.currentThemeAmbient.lfo.stop();
      } catch (e) {}
      this.currentThemeAmbient = null;
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.6, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  playFanfare() {
    this.playLaunchSound();
  }
}

window.soundEngine = new SoundEngine();
