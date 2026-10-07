/**
 * server.js
 * AI 인터랙티브 미디어월 & 드로잉 스튜디오 로컬 호스트 서버
 * 
 * [확장 기능]
 * 1. Express 기반 정적 파일 & Service Worker(sw.js) 서빙
 * 2. Socket.io + WebSocket 하이브리드 실시간 동기화 (10대 노트북 0ms 양방향 연동)
 * 3. SQLite 파일 기반 경량 DB 연동 (서버 재시작 후에도 설정/테마/캐릭터 영구 보존)
 * 4. 사설 IP HTTPS 지원 (mkcert 및 자동 SSL 인증서 연동, HTTP/HTTPS 동시 서빙)
 */

const express = require('express');
const http = require('http');
const https = require('https');
const { Server: SocketIOServer } = require('socket.io');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('./database');

const app = express();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HTTPS_PORT = parseInt(process.env.PORT_HTTPS, 10) || 3443;

// --- CORS 및 보안/미디어 헤더 설정 ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// --- 정적 파일 서빙 ---
const staticOptions = {
  setHeaders: (res, filePath) => {
    res.set('Access-Control-Allow-Origin', '*');
    // Service Worker 파일의 경우 캐싱 방지 및 스코프 허용
    if (filePath.endsWith('sw.js')) {
      res.set('Service-Worker-Allowed', '/');
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.match(/\.(png|jpe?g|webp|svg|ico)$/i)) {
      // 이미지 에셋(도안, 배경)은 브라우저 캐싱 적용 (1일)하여 Render 무료 대역폭 95% 절약
      res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }
  }
};

// sw.js 단독 라우트 (최우선 서빙)
app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/bgimage', express.static(path.join(__dirname, 'bgimage'), staticOptions));
app.use('/drawing', express.static(path.join(__dirname, 'drawing'), staticOptions));
const uploadsDir = path.join(__dirname, 'public', 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  console.warn('⚠️ uploads 디렉토리 생성 건너뜀 (서버리스/읽기전용 환경):', e.message);
}
app.use('/uploads', express.static(uploadsDir, staticOptions));

// --- SQLite DB로부터 상태 복원 ---
const DEFAULT_THEME = {
  id: 'sea',
  name: '바다나라',
  type: 'preset',
  url: '/bgimage/' + encodeURIComponent('바다나라.png')
};

const DEFAULT_CONFIG = {
  characterLifespan: 1200, // 20분 (초)
  maxCharacters: 15       // 최대 동시 표시수 (기본 15개)
};

let currentTheme = db.getSetting('theme', DEFAULT_THEME);
let serverConfig = db.getSetting('config', DEFAULT_CONFIG);
// 혹시 maxCharacters가 15 미만 또는 미설정된 경우 15로 보장
if (!serverConfig.maxCharacters || serverConfig.maxCharacters < 15) serverConfig.maxCharacters = 15;
if (!serverConfig.characterLifespan || serverConfig.characterLifespan < 1200) serverConfig.characterLifespan = 1200;

// 만료된 캐릭터 1차 정리 후 활성 캐릭터 복원
db.cleanupExpired(serverConfig.characterLifespan);
let activeCharacters = db.getActiveCharacters();

console.log(`📦 [SQLite DB] 데이터 복원 완료: 현재 테마 '${currentTheme.name}', 최대 표시수: ${serverConfig.maxCharacters}개, 체류수명: ${Math.round(serverConfig.characterLifespan/60)}분, 복원된 캐릭터: ${activeCharacters.length}개`);

// --- REST API 엔드포인트 ---

// 시스템 및 로컬 IP 정보 조회
app.get('/api/system-info', (req, res) => {
  const localIps = getAllLocalIps();
  res.json({
    success: true,
    server: 'WagleWagle Studio Host',
    localIps,
    port: PORT,
    httpsPort: HTTPS_PORT,
    sslEnabled: Boolean(sslOptions),
    config: serverConfig,
    activeCharactersCount: activeCharacters.length,
    database: 'SQLite (media_wall.db)'
  });
});

// 1. 기본 배경(bgimage) 목록 조회 API
app.get('/api/themes', (req, res) => {
  try {
    const bgDir = path.join(__dirname, 'bgimage');
    if (!fs.existsSync(bgDir)) {
      return res.json({ success: true, themes: [] });
    }
    const files = fs.readdirSync(bgDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
    const themes = files.map((file, idx) => {
      const name = path.parse(file).name;
      return {
        id: `theme-${idx}`,
        name: name,
        type: 'preset',
        filename: file,
        url: `/bgimage/${encodeURIComponent(file)}`
      };
    });
    res.json({ success: true, themes, currentTheme, config: serverConfig });
  } catch (err) {
    console.error('Error reading bgimage:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1-1. 배경 테마 업로드 API
app.post('/api/themes', (req, res) => {
  try {
    const { name, imageData, fileName } = req.body;
    if (!imageData) {
      return res.status(400).json({ success: false, error: '이미지 데이터가 없습니다.' });
    }
    const bgDir = path.join(__dirname, 'bgimage');
    if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true });

    const extMatch = (fileName && path.extname(fileName)) || '.png';
    const ext = /\.(png|jpe?g|webp)$/i.test(extMatch) ? extMatch : '.png';
    const cleanName = (name && name.trim().replace(/[\\/:*?"<>|]/g, '')) || `테마_${Date.now()}`;
    const targetFileName = `${cleanName}${ext}`;
    const filePath = path.join(bgDir, targetFileName);

    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    broadcastAll('theme_list_update', {});

    res.json({
      success: true,
      theme: {
        id: `theme_${Date.now()}`,
        name: cleanName,
        type: 'preset',
        filename: targetFileName,
        url: `/bgimage/${encodeURIComponent(targetFileName)}`
      }
    });
  } catch (err) {
    console.error('Theme upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1-2. 배경 테마 이름 수정 API
app.put('/api/themes/:filename', (req, res) => {
  try {
    const oldFileName = path.basename(decodeURIComponent(req.params.filename));
    const { newName } = req.body;
    if (!newName || !newName.trim()) {
      return res.status(400).json({ success: false, error: '새 테마 이름을 입력해주세요.' });
    }
    const bgDir = path.join(__dirname, 'bgimage');
    const oldPath = path.join(bgDir, oldFileName);
    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ success: false, error: '해당 테마 파일을 찾을 수 없습니다.' });
    }

    const ext = path.extname(oldFileName);
    const cleanNewName = newName.trim().replace(/[\\/:*?"<>|]/g, '');
    const newFileName = `${cleanNewName}${ext}`;
    const newPath = path.join(bgDir, newFileName);

    fs.renameSync(oldPath, newPath);

    // 현재 선택된 테마 이름도 업데이트된 경우
    if (currentTheme && (currentTheme.filename === oldFileName || currentTheme.name === path.parse(oldFileName).name)) {
      currentTheme.name = cleanNewName;
      currentTheme.filename = newFileName;
      currentTheme.url = `/bgimage/${encodeURIComponent(newFileName)}`;
      db.setSetting('theme', currentTheme);
      broadcastAll('theme_change', { theme: currentTheme });
    }

    broadcastAll('theme_list_update', {});
    res.json({ success: true, newFileName, newName: cleanNewName });
  } catch (err) {
    console.error('Theme rename error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1-3. 배경 테마 삭제 API
app.delete('/api/themes/:filename', (req, res) => {
  try {
    const fileName = path.basename(decodeURIComponent(req.params.filename));
    const bgDir = path.join(__dirname, 'bgimage');
    const filePath = path.join(bgDir, fileName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // 현재 적용 중인 테마가 삭제된 경우 첫 번째 남은 테마로 자동 교체
    if (currentTheme && (currentTheme.filename === fileName || currentTheme.name === path.parse(fileName).name)) {
      const remaining = fs.readdirSync(bgDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
      if (remaining.length > 0) {
        const fallbackFile = remaining[0];
        currentTheme = {
          id: 'theme-0',
          name: path.parse(fallbackFile).name,
          type: 'preset',
          filename: fallbackFile,
          url: `/bgimage/${encodeURIComponent(fallbackFile)}`
        };
      } else {
        currentTheme = { id: 'default', name: '기본 배경', type: 'preset', url: '' };
      }
      db.setSetting('theme', currentTheme);
      broadcastAll('theme_change', { theme: currentTheme });
    }

    broadcastAll('theme_list_update', {});
    res.json({ success: true });
  } catch (err) {
    console.error('Theme delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. 기본 도안(drawing) 목록 조회 API
app.get('/api/drawings', (req, res) => {
  try {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    const drawDir = path.join(__dirname, 'drawing');
    if (!fs.existsSync(drawDir)) {
      return res.json({ success: true, drawings: [] });
    }
    const files = fs.readdirSync(drawDir)
      .filter(f => /\.(png|jpe?g|webp)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));
    const drawings = files.map((file, idx) => {
      const name = path.parse(file).name;
      return {
        id: `drawing-${idx}`,
        name: name,
        filename: file,
        url: `/drawing/${encodeURIComponent(file)}`
      };
    });
    res.json({ success: true, drawings });
  } catch (err) {
    console.error('Error reading drawings:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2-1. 캐릭터 도안 업로드 API
app.post('/api/drawings', (req, res) => {
  try {
    const { name, imageData, fileName } = req.body;
    if (!imageData) {
      return res.status(400).json({ success: false, error: '도안 이미지 데이터가 없습니다.' });
    }
    const drawDir = path.join(__dirname, 'drawing');
    if (!fs.existsSync(drawDir)) fs.mkdirSync(drawDir, { recursive: true });

    const extMatch = (fileName && path.extname(fileName)) || '.png';
    const ext = /\.(png|jpe?g|webp)$/i.test(extMatch) ? extMatch : '.png';
    const cleanName = (name && name.trim().replace(/[\\/:*?"<>|]/g, '')) || `도안_${Date.now()}`;
    const targetFileName = `${cleanName}${ext}`;
    const filePath = path.join(drawDir, targetFileName);

    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    broadcastAll('drawings_update', {});

    res.json({
      success: true,
      drawing: {
        id: `drawing_${Date.now()}`,
        name: cleanName,
        filename: targetFileName,
        url: `/drawing/${encodeURIComponent(targetFileName)}`
      }
    });
  } catch (err) {
    console.error('Drawing upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2-2. 캐릭터 도안 이름 수정 API
app.put('/api/drawings/:filename', (req, res) => {
  try {
    const oldFileName = path.basename(decodeURIComponent(req.params.filename));
    const { newName } = req.body;
    if (!newName || !newName.trim()) {
      return res.status(400).json({ success: false, error: '새 도안 이름을 입력해주세요.' });
    }
    const drawDir = path.join(__dirname, 'drawing');
    const oldPath = path.join(drawDir, oldFileName);
    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ success: false, error: '해당 도안 파일을 찾을 수 없습니다.' });
    }

    const ext = path.extname(oldFileName);
    const cleanNewName = newName.trim().replace(/[\\/:*?"<>|]/g, '');
    const newFileName = `${cleanNewName}${ext}`;
    const newPath = path.join(drawDir, newFileName);

    fs.renameSync(oldPath, newPath);
    broadcastAll('drawings_update', {});

    res.json({ success: true, newFileName, newName: cleanNewName });
  } catch (err) {
    console.error('Drawing rename error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2-3. 캐릭터 도안 삭제 API
app.delete('/api/drawings/:filename', (req, res) => {
  try {
    const fileName = path.basename(decodeURIComponent(req.params.filename));
    const drawDir = path.join(__dirname, 'drawing');
    const filePath = path.join(drawDir, fileName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    broadcastAll('drawings_update', {});
    res.json({ success: true });
  } catch (err) {
    console.error('Drawing delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. 애니메이티드 드로잉 MP4 비디오 파일 업로드 API
app.post('/api/upload-video', (req, res) => {
  try {
    const { fileName, videoData } = req.body;
    if (!videoData) {
      return res.status(400).json({ success: false, error: '비디오 데이터가 없습니다.' });
    }

    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const commaIndex = videoData.indexOf(',');
    const base64Data = commaIndex !== -1 ? videoData.substring(commaIndex + 1) : videoData;
    const ext = path.extname(fileName || '') || '.mp4';
    const baseName = path.basename(fileName || 'character', ext).replace(/[^a-zA-Z0-9_\uAC00-\uD7A3\-]/g, '_');
    const cleanFileName = `anim_${Date.now()}_${baseName}${ext}`;
    const filePath = path.join(uploadDir, cleanFileName);

    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    const fileUrl = `/uploads/${encodeURIComponent(cleanFileName)}`;
    res.json({ success: true, url: fileUrl, fileName: cleanFileName });
  } catch (err) {
    console.error('Video upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- HTTP 및 HTTPS 서버 생성 ---
const httpServer = http.createServer(app);

// SSL 인증서 로드 확인
function loadSslCertificates() {
  const certPath = path.join(__dirname, 'certs', 'cert.pem');
  const keyPath = path.join(__dirname, 'certs', 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      return {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      };
    } catch (e) {
      console.warn('⚠️ SSL 인증서 파일 읽기 실패:', e.message);
    }
  }
  return null;
}

const sslOptions = loadSslCertificates();
let httpsServer = null;
if (sslOptions) {
  httpsServer = https.createServer(sslOptions, app);
}

// --- Socket.io & WebSocket 실시간 서버 바인딩 ---
const io = new SocketIOServer({
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e8 // 100MB (비디오 전송 지원)
});

// Socket.io를 HTTP 및 HTTPS 서버에 연결
io.attach(httpServer);
if (httpsServer) {
  io.attach(httpsServer);
}

// ws WebSocket 서버 (noServer: true 로 생성하여 Socket.io 충돌 방지)
const wss = new WebSocket.Server({ noServer: true });
wss.on('error', (err) => console.warn('WSS server warning:', err.message));

function handleWsUpgrade(request, socket, head) {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    // Socket.io 전용 경로는 Socket.io가 자체 처리하므로 통과
    if (url.pathname.startsWith('/socket.io/')) {
      return;
    }
    // 일반 WebSocket 연결 요청만 wss로 위임
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } catch (err) {
    socket.destroy();
  }
}

httpServer.on('upgrade', handleWsUpgrade);
if (httpsServer) {
  httpsServer.on('upgrade', handleWsUpgrade);
}

// 프로세스 예외 보호
process.on('uncaughtException', (err) => {
  console.warn('⚠️ [Safe Catch] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.warn('⚠️ [Safe Catch] Unhandled Rejection:', reason);
});

// 모든 채널(Socket.io + ws) 통합 브로드캐스트 유틸
function broadcastAll(event, payload, excludeSocket = null) {
  // 1. Socket.io 브로드캐스트
  if (excludeSocket) {
    excludeSocket.broadcast.emit(event, payload);
  } else {
    io.emit(event, payload);
  }

  // 2. ws WebSocket 브로드캐스트
  const wsMsg = JSON.stringify({ type: event, ...payload });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(wsMsg);
      } catch (e) {}
    }
  });
}

// --- 실시간 이벤트 핸들링 (Socket.io) ---
io.on('connection', (socket) => {
  // 1. 10대 노트북 중 한 대가 접속하면 현재 전체 상태 즉시 동기화
  socket.emit('init_state', {
    type: 'init_state',
    currentTheme,
    config: serverConfig,
    characters: db.getActiveCharacters()
  });

  // 2. 캐릭터 생성 (학생 노트북에서 드로잉/MP4 전송 시)
  socket.on('character_spawn', (data) => {
    const char = data.character;
    if (!char || !char.id) return;

    if (!activeCharacters.some(c => c.id === char.id)) {
      activeCharacters.push(char);
      while (activeCharacters.length > (serverConfig.maxCharacters || 15)) {
        activeCharacters.shift();
      }
      // SQLite DB에 즉시 영구 저장
      db.saveCharacter(char, serverConfig.maxCharacters || 15);
    }

    // 송신자(socket)를 제외한 나머지 9대 노트북 및 미디어월 화면에 즉각 실시간 반영
    broadcastAll('character_spawn', { character: char }, socket);
  });

  // 3. 테마 변경 (관리자/스튜디오 변경 시)
  socket.on('theme_change', (data) => {
    if (!data.theme) return;
    currentTheme = data.theme;
    db.setSetting('theme', currentTheme);
    broadcastAll('theme_change', { theme: currentTheme }, socket);
  });

  // 4. 전시 운영 설정 변경 (수명, 최대 개수 등)
  socket.on('config_update', (data) => {
    if (!data.config) return;
    serverConfig = { ...serverConfig, ...data.config };
    if (!serverConfig.maxCharacters) serverConfig.maxCharacters = 15;

    db.setSetting('config', serverConfig);
    db.trimCharacters(serverConfig.maxCharacters);
    activeCharacters = db.getActiveCharacters();

    broadcastAll('config_update', { config: serverConfig }, socket);
  });

  // 5. 캐릭터 강제 퇴장
  socket.on('character_remove', (data) => {
    if (!data.characterId) return;
    activeCharacters = activeCharacters.filter(c => c.id !== data.characterId);
    db.removeCharacter(data.characterId);
    broadcastAll('character_remove', { characterId: data.characterId }, socket);
  });

  // 6. 전체 캐릭터 퇴장
  socket.on('clear_all', () => {
    activeCharacters = [];
    db.clearCharacters();
    broadcastAll('clear_all', {}, socket);
  });
});

// ws WebSocket 이벤트 핸들링 (호환성 유지)
wss.on('connection', (ws) => {
  ws.on('error', (err) => {
    console.warn('WS client error:', err.message);
  });

  ws.send(JSON.stringify({
    type: 'init_state',
    currentTheme,
    config: serverConfig,
    characters: db.getActiveCharacters()
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      switch (data.type) {
        case 'character_spawn':
          activeCharacters.push(data.character);
          while (activeCharacters.length > (serverConfig.maxCharacters || 15)) {
            activeCharacters.shift();
          }
          db.saveCharacter(data.character, serverConfig.maxCharacters || 15);
          broadcastAll('character_spawn', { character: data.character });
          break;

        case 'theme_change':
          currentTheme = data.theme;
          db.setSetting('theme', currentTheme);
          broadcastAll('theme_change', { theme: currentTheme });
          break;

        case 'config_update':
          serverConfig = { ...serverConfig, ...data.config };
          if (!serverConfig.maxCharacters) serverConfig.maxCharacters = 15;
          db.setSetting('config', serverConfig);
          db.trimCharacters(serverConfig.maxCharacters);
          activeCharacters = db.getActiveCharacters();
          broadcastAll('config_update', { config: serverConfig });
          break;

        case 'character_remove':
          activeCharacters = activeCharacters.filter(c => c.id !== data.characterId);
          db.removeCharacter(data.characterId);
          broadcastAll('character_remove', { characterId: data.characterId });
          break;

        case 'clear_all':
          activeCharacters = [];
          db.clearCharacters();
          broadcastAll('clear_all', {});
          break;

        default:
          break;
      }
    } catch (err) {
      console.error('WS message error:', err);
    }
  });
});

const isServerless = Boolean(process.env.VERCEL || process.env.NOW_REGION || process.env.LAMBDA_TASK_ROOT);

// 주기적 만료 캐릭터 정리 (독립 실행 서버일 때만 1분마다)
if (!isServerless && require.main === module) {
  setInterval(() => {
    if (serverConfig && serverConfig.characterLifespan) {
      db.cleanupExpired(serverConfig.characterLifespan);
    }
  }, 60000);
}

// --- 로컬 IP 주소 검색 유틸 ---
function getAllLocalIps() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips.length > 0 ? ips : ['127.0.0.1'];
}

function getLocalIp() {
  return getAllLocalIps()[0] || 'localhost';
}

// --- 서버 구동 (독립 프로세스 실행 시에만 포트 리슨) ---
if (!isServerless && require.main === module) {
  httpServer.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log('================================================================');
    console.log('🚀 WagleWagle Studio - AI 미디어월 & 드로잉 실시간 동기화 호스트 서버 구동 완료!');
    console.log(`📡 HTTP 로컬 주소:       http://localhost:${PORT}`);
    console.log(`🌐 10대 노트북 접속 주소: http://${localIp}:${PORT}`);
    console.log(`🖼️ 미디어월 대형화면:    http://${localIp}:${PORT}/wall.html`);
    console.log(`🎨 학생 드로잉 스튜디오: http://${localIp}:${PORT}/draw.html`);
    console.log(`⚙️ 마스터 관리자 패널:   http://${localIp}:${PORT}/admin.html`);
    console.log(`💾 데이터베이스:         SQLite 파일 기반 (data/media_wall.db)`);
    console.log(`⏱️ 전시 표준 설정:       체류수명 20분(1200초) | 동시 최대 15개 수용`);
    console.log(`🔄 실시간 동기화:       Socket.io & WebSocket 하이브리드 지원`);
    console.log('💡 [로컬 필수 권장]      호스트 PC의 Windows 절전 모드를 해제해 주세요.');
    console.log('================================================================');
  });

  if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      const localIp = getLocalIp();
      console.log('🔐 [HTTPS] 보안 서버 구동 완료 (Service Worker 완벽 지원):');
      console.log(`   👉 https://${localIp}:${HTTPS_PORT}`);
      console.log('================================================================');
    });
  } else {
    console.log('💡 [HTTPS 안내] certs/cert.pem 인증서가 없습니다.');
    console.log('   Service Worker를 사설 IP(192.168.x.x)에서 완벽히 사용하려면:');
    console.log('   `npm run cert:gen` 실행 후 서버를 재시작하거나');
    console.log('   크롬 플래그(chrome://flags/#unsafely-treat-insecure-origin-as-secure)를 설정하세요.');
    console.log('================================================================');
  }
}

// Vercel / 서버리스 및 테스트 환경을 위한 모듈 내보내기
module.exports = app;
module.exports.app = app;
module.exports.httpServer = httpServer;

