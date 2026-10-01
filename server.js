const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));
app.use('/bgimage', express.static(path.join(__dirname, 'bgimage')));
app.use('/drawing', express.static(path.join(__dirname, 'drawing')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// 현재 미디어월 상태 (메모리 저장 - PRD 요구사항에 따라 영구 DB 미저장, 휘발성)
let currentTheme = {
  id: 'sea',
  name: '바다나라',
  type: 'preset',
  url: '/bgimage/' + encodeURIComponent('바다나라.png')
};

let serverConfig = {
  characterLifespan: 900, // 15분 (초 단위) - PRD 기본값 15~20분
  maxCharacters: 1        // 미디어월 전송 시 캐릭터 1개 유지
};

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

// 2. 기본 도안(drawing) 목록 조회 API
app.get('/api/drawings', (req, res) => {
  try {
    const drawDir = path.join(__dirname, 'drawing');
    if (!fs.existsSync(drawDir)) {
      return res.json({ success: true, drawings: [] });
    }
    const files = fs.readdirSync(drawDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
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

    broadcast({ type: 'theme_list_update' });

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
      broadcast({ type: 'theme_change', theme: currentTheme });
    }

    broadcast({ type: 'theme_list_update' });
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
      broadcast({ type: 'theme_change', theme: currentTheme });
    }

    broadcast({ type: 'theme_list_update' });
    res.json({ success: true });
  } catch (err) {
    console.error('Theme delete error:', err);
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

    broadcast({ type: 'drawings_update' });

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
    broadcast({ type: 'drawings_update' });

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

    broadcast({ type: 'drawings_update' });
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

    const base64Data = videoData.replace(/^data:video\/\w+;base64,/, '');
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

// WebSocket 브로드캐스트
function broadcast(data, excludeWs = null) {
  const message = typeof data === 'string' ? data : JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  // 연결 시 현재 상태 전달
  ws.send(JSON.stringify({
    type: 'init_state',
    currentTheme,
    config: serverConfig
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      switch (data.type) {
        case 'character_spawn':
          // 학생이 캐릭터를 송출했을 때 미디어월에 브로드캐스트
          broadcast({
            type: 'character_spawn',
            character: data.character
          });
          break;

        case 'theme_change':
          // 관리자가 테마를 변경했을 때
          currentTheme = data.theme;
          broadcast({
            type: 'theme_change',
            theme: currentTheme
          });
          break;

        case 'config_update':
          // 관리자가 설정을 변경했을 때 (수명, 최대 개수 등)
          serverConfig = { ...serverConfig, ...data.config };
          broadcast({
            type: 'config_update',
            config: serverConfig
          });
          break;

        case 'character_remove':
          // 관리자가 캐릭터를 강제 퇴장시켰을 때
          broadcast({
            type: 'character_remove',
            characterId: data.characterId
          });
          break;

        case 'clear_all':
          // 전체 캐릭터 초기화
          broadcast({
            type: 'clear_all'
          });
          break;

        default:
          break;
      }
    } catch (err) {
      console.error('WS message error:', err);
    }
  });
});

// 로컬 IP 주소 검색 유틸
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

server.listen(PORT, () => {
  const localIp = getLocalIp();
  console.log('========================================================');
  console.log('🚀 AI 미디어월 & 드로잉 인터랙티브 시스템 서버 실행 완료!');
  console.log(`📡 로컬 접속 주소:   http://localhost:${PORT}`);
  console.log(`📱 현장 단말기(태블릿): http://${localIp}:${PORT}`);
  console.log(`🖼️ 미디어월 대형화면: http://localhost:${PORT}/wall.html`);
  console.log(`🎨 학생 드로잉 스튜디오: http://${localIp}:${PORT}/draw.html`);
  console.log(`⚙️ 마스터 관리자 패널: http://localhost:${PORT}/admin.html`);
  console.log('========================================================');
});
