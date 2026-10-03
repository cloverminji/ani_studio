/**
 * network.js
 * 실시간 하이브리드 멀티 디바이스 동기화 모듈 (10대 노트북 실시간 연동)
 * 1. Socket.io (Node.js 백엔드 기반 10대 기기간 0ms 양방향 실시간 동기화)
 * 2. 로컬 WebSocket (ws 폴백 지원)
 * 3. 브라우저 내장 BroadcastChannel & LocalStorage (동일 기기 탭 간 초고속 통신)
 */

class MediaWallNetwork {
  constructor() {
    this.socket = null;
    this.socketConnected = false;
    this.ws = null;
    this.wsConnected = false;
    this.broadcastChannel = null;

    this.listeners = {
      character_spawn: [],
      theme_change: [],
      character_remove: [],
      config_update: [],
      clear_all: [],
      init_state: [],
      theme_list_update: [],
      drawings_update: []
    };

    // 중복 수신 방지 캐시 (최근 5초 이내 동일 이벤트 ID 필터링)
    this.recentHandledKeys = new Set();

    this.initBroadcastChannel();
    this.initLocalStorageFallback();
    this.initSocketIO();
    this.initWebSocket();
  }

  // 1. Socket.io 실시간 연결 (10대 노트북 핵심 동기화 엔진)
  initSocketIO() {
    try {
      if (typeof io === 'undefined') {
        console.warn('⚠️ Socket.io 클라이언트 라이브러리가 로드되지 않았습니다. WebSocket 폴백을 사용합니다.');
        return;
      }

      // 현재 프로토콜 및 호스트 기준으로 자동 연결
      this.socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
      });

      this.socket.on('connect', () => {
        this.socketConnected = true;
        console.log('✅ [Socket.io] 10대 기기 실시간 동기화 채널 연결 성공! (ID:', this.socket.id, ')');
      });

      this.socket.on('disconnect', (reason) => {
        this.socketConnected = false;
        console.warn('⚠️ [Socket.io] 서버 연결 끊김:', reason);
      });

      // 서버로부터 수신되는 전체 동기화 이벤트 등록
      const syncEvents = [
        'init_state',
        'character_spawn',
        'theme_change',
        'config_update',
        'character_remove',
        'clear_all',
        'theme_list_update',
        'drawings_update'
      ];

      syncEvents.forEach(evt => {
        this.socket.on(evt, (data) => {
          const payload = (typeof data === 'object' && data !== null) ? data : {};
          this.handleIncomingMessage({ type: evt, ...payload }, 'socket.io');
        });
      });
    } catch (e) {
      console.error('Socket.io 초기화 오류:', e);
    }
  }

  // 2. 브라우저 탭 간 BroadcastChannel 초기화
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

  // 3. LocalStorage 스토리지 이벤트 동기화 (구형/호환성 폴백)
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

  // 4. 로컬 WebSocket (ws) 폴백 연결
  initWebSocket() {
    // Socket.io가 정상 연결된 경우 순수 WebSocket은 중복 연결 방지
    if (this.socketConnected) return;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      if (!host) return;

      this.ws = new WebSocket(`${protocol}//${host}`);

      this.ws.onopen = () => {
        this.wsConnected = true;
        console.log('✅ [WebSocket ws] 연결 성공:', `${protocol}//${host}`);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Socket.io로부터 이미 메시지를 받은 경우 중복 무시
          if (!this.socketConnected) {
            this.handleIncomingMessage(data, 'ws');
          }
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      this.ws.onclose = () => {
        this.wsConnected = false;
        setTimeout(() => this.initWebSocket(), 5000);
      };

      this.ws.onerror = () => {
        this.wsConnected = false;
      };
    } catch (e) {
      console.warn('WebSocket init fallback failed:', e);
    }
  }

  // 메시지 수신 처리 및 등록된 리스너 발동 (고유 키 기반 중복 수신 완벽 차단)
  handleIncomingMessage(data, source = 'unknown') {
    if (!data || !data.type) return;

    // 캐릭터 스폰/삭제 고유 키 기반 중복 실행 차단 (5초 이내 동일 이벤트 1회만 처리)
    const uniqueKey = (data.character && data.character.id)
      ? `spawn_${data.character.id}`
      : (data.characterId ? `remove_${data.characterId}` : null);

    if (uniqueKey) {
      if (this.recentHandledKeys.has(uniqueKey)) {
        // 이미 처리된 동일 메시지/이벤트이므로 중복 무시
        return;
      }
      this.recentHandledKeys.add(uniqueKey);
      setTimeout(() => this.recentHandledKeys.delete(uniqueKey), 5000);
    }

    const callbacks = this.listeners[data.type] || [];
    callbacks.forEach(cb => {
      try {
        cb(data, source);
      } catch (err) {
        console.error('Error in network callback:', err);
      }
    });
  }

  // 외부 전송 메서드 (10대 노트북 및 서버로 브로드캐스트)
  emit(type, payload = {}) {
    const message = { type, timestamp: Date.now(), ...payload };

    // 1. Socket.io 전송 (최우선)
    if (this.socket && this.socket.connected) {
      this.socket.emit(type, payload);
    } else if (this.ws && this.wsConnected && this.ws.readyState === WebSocket.OPEN) {
      // 2. ws WebSocket 폴백 전송
      this.ws.send(JSON.stringify(message));
    } else {
      // 3. 서버 오프라인일 때만 브라우저 탭 간 BroadcastChannel & LocalStorage 폴백 사용 (중복 전송 차단)
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage(message);
      }
      try {
        localStorage.setItem('media_wall_sync_event', JSON.stringify({ ...message, _salt: Math.random() }));
      } catch (e) {}
    }

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
