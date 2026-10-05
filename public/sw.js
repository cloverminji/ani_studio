/**
 * sw.js - Service Worker for Offline Local PWA & Media Wall
 * 오프라인 사설 네트워크(10대 노트북) 환경을 위한 고성능 캐싱 및 네트워크 분기
 */

const CACHE_NAME = 'media-wall-offline-v7';

// 1. 초기 설치 시 사전 캐싱할 필수 정적 에셋 목록
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/wall.html',
  '/draw.html',
  '/admin.html',
  '/css/style.css',
  '/images/eraser.png',
  '/js/socket.io.min.js',
  '/js/audio.js',
  '/js/network.js',
  '/js/drawing-canvas.js',
  '/js/ai-processor.js',
  '/js/media-wall.js',
  '/js/admin.js',
  '/js/app.js'
];

// 설치 단계 (Install)
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install: 사전 캐시 등록 시작');
  self.skipWaiting(); // 새 서비스 워커 즉시 활성화

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 실패하더라도 나머지 캐시는 유지되도록 개별 캐싱
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn(`[ServiceWorker] Precache failed for ${asset}:`, err);
        }
      }
      console.log('[ServiceWorker] 사전 캐시 완료');
    })
  );
});

// 활성화 단계 (Activate)
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate: 이전 캐시 정리');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// 네트워크 요청 가로채기 (Fetch)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. HTTP/HTTPS 이외의 스킴(chrome-extension 등) 무시
  if (!url.protocol.startsWith('http')) return;

  // 2. 실시간 통신 및 백엔드 API 요청은 캐싱 없이 항상 네트워크 직행
  // - /socket.io/ (폴링 및 핸드셰이크)
  // - /api/ (데이터베이스/REST API 동적 조회 및 업로드)
  if (url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch((err) => {
        console.warn(`[ServiceWorker] Network error on API/Socket: ${url.pathname}`, err);
        return new Response(JSON.stringify({ error: 'offline', message: '오프라인 상태입니다.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 3. 페이지 내비게이션 (HTML 문서 요청): Network-First, 실패 시 Cache-First
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallbackIndex = await caches.match('/index.html');
          if (fallbackIndex) return fallbackIndex;
          return new Response('오프라인 상태입니다.', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        })
    );
    return;
  }

  // 4. 정적 자원 (CSS, JS, 이미지, 오디오, 폰트): Stale-While-Revalidate 전략
  // - 캐시에 있으면 먼저 즉시 응답(초고속 로딩)하고, 백그라운드에서 최신 버전 갱신
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // 네트워크 실패 시 무시 (이미 캐시 응답 반환 중)
        });

      return cachedResponse || fetchPromise;
    })
  );
});
