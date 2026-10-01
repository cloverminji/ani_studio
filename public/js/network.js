/**
 * network.js
 * 실시간 하이브리드 동기화 모듈
 * 1. 로컬 WebSocket (Node.js 백엔드)
 * 2. 브라우저 내장 BroadcastChannel & LocalStorage (탭 간 0ms 통신)
 * 3. Supabase Realtime (선택적 클라우드 연동)
 */

class MediaWallNetwork {
  constructor() {
    this.ws = null;
    this.wsConnected = false;
    this.broadcastChannel = null;
    this.listeners = {
      character_spawn: [],
      theme_change: [],
      character_remove: [],
      config_update: [],
      clear_all: [],
      init_state: []
    };

    this.initBroadcastChannel();
    this.initLocalStorageFallback();
    this.initWebSocket();
  }

  // 1. 브라우저 탭 간 BroadcastChannel 초기화
  initBroadcastChannel() {
    if ('BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('media_wall_sync_v1');
        this.broadcastChannel.onmessage = (event) => {
          this.handleIncomingMessage(event.data, 'broadcast');
        };
      } catch (e) {
        console.warn('BroadcastChannel failed:', e);
      }
    }
  }

  // 2. LocalStorage 스토리지 이벤트 동기화 (구형/호환성 폴백)
  initLocalStorageFallback() {
    window.addEventListener('storage', (event) => {
      if (event.key === 'media_wall_sync_event' && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          this.handleIncomingMessage(data, 'storage');
        } catch (e) {}
      }
    });
  }

  // 3. 로컬 WebSocket 연결
  initWebSocket() {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      if (!host) return;

      this.ws = new WebSocket(`${protocol}//${host}`);

      this.ws.onopen = () => {
        this.wsConnected = true;
        console.log('✅ WebSocket 연결 성공:', `${protocol}//${host}`);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleIncomingMessage(data, 'ws');
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      this.ws.onclose = () => {
        this.wsConnected = false;
        // 3초 후 재연결 시도
        setTimeout(() => this.initWebSocket(), 3000);
      };

      this.ws.onerror = (err) => {
        this.wsConnected = false;
      };
    } catch (e) {
      console.warn('WebSocket init error (will use BroadcastChannel):', e);
    }
  }

  // 메시지 수신 처리 및 등록된 리스너 발동
  handleIncomingMessage(data, source = 'unknown') {
    if (!data || !data.type) return;
    const callbacks = this.listeners[data.type] || [];
    callbacks.forEach(cb => {
      try {
        cb(data, source);
      } catch (err) {
        console.error('Error in network callback:', err);
      }
    });
  }

  // 외부 전송 메서드
  emit(type, payload = {}) {
    const message = { type, timestamp: Date.now(), ...payload };

    // 1. WebSocket 전송
    if (this.ws && this.wsConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }

    // 2. BroadcastChannel 전송 (다른 탭에 전달)
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(message);
    }

    // 3. LocalStorage 이벤트 발생 (타 윈도우/탭에 전달)
    try {
      localStorage.setItem('media_wall_sync_event', JSON.stringify({ ...message, _salt: Math.random() }));
    } catch (e) {}

    // 로컬 탭 자신에게도 이벤트 발동
    this.handleIncomingMessage(message, 'local');
  }

  // 이벤트 리스너 등록 헬퍼
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  // 구체적인 비즈니스 송신 메서드들
  sendCharacter(character) {
    this.emit('character_spawn', { character });
  }

  sendThemeChange(theme) {
    this.emit('theme_change', { theme });
  }

  sendCharacterRemove(characterId) {
    this.emit('character_remove', { characterId });
  }

  sendConfigUpdate(config) {
    this.emit('config_update', { config });
  }

  sendClearAll() {
    this.emit('clear_all', {});
  }
}

// 싱글톤 인스턴스
window.mediaWallNet = new MediaWallNetwork();
