/**
 * database.js
 * 로컬 SQLite 파일 기반 경량 데이터베이스 관리 모듈 (better-sqlite3)
 * - 로컬 서버 재부팅 시에도 현재 테마, 전시 설정(최대 표시수 12개, 수명 등),
 *   활성 캐릭터 목록이 영구 보존됩니다.
 */

let Database = null;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.warn('⚠️ better-sqlite3 모듈을 로드할 수 없습니다 (서버리스 환경). 인메모리 모드로 동작합니다.');
}

const path = require('path');
const fs = require('fs');

/**
 * 서버리스/Vercel 환경용 인메모리 데이터베이스 폴백
 */
class InMemoryDB {
  constructor() {
    this.settings = new Map();
    this.characters = new Map();
  }

  getSetting(key, defaultValue = null) {
    return this.settings.has(key) ? this.settings.get(key) : defaultValue;
  }

  setSetting(key, value) {
    this.settings.set(key, value);
  }

  getActiveCharacters() {
    return Array.from(this.characters.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  saveCharacter(char, maxLimit = 15) {
    this.characters.set(char.id, char);
    this.trimCharacters(maxLimit);
  }

  removeCharacter(characterId) {
    this.characters.delete(characterId);
  }

  clearCharacters() {
    this.characters.clear();
  }

  trimCharacters(maxLimit = 15) {
    while (this.characters.size > maxLimit) {
      const oldestKey = this.characters.keys().next().value;
      this.characters.delete(oldestKey);
    }
  }

  cleanupExpired(lifespanSeconds) {
    if (!lifespanSeconds || lifespanSeconds <= 0) return;
    const expireTime = Date.now() - (lifespanSeconds * 1000);
    for (const [id, char] of this.characters.entries()) {
      if ((char.createdAt || 0) < expireTime) {
        this.characters.delete(id);
      }
    }
  }

  close() {}
}

class MediaWallDB {
  constructor(dbPath) {
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL'); // 고성능 동시 읽기/쓰기 모드
    this.initTables();
  }

  initTables() {
    // 1. 시스템 설정 테이블 (테마, 최대 표시수, 수명 등)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // 2. 미디어월 활성 캐릭터 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // 3. 인덱스 생성
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chars_created ON characters(created_at);
    `);
  }

  // --- 설정(Settings) 관리 ---

  getSetting(key, defaultValue = null) {
    try {
      const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
      const row = stmt.get(key);
      if (row && row.value) {
        return JSON.parse(row.value);
      }
      return defaultValue;
    } catch (err) {
      console.error(`DB getSetting('${key}') error:`, err);
      return defaultValue;
    }
  }

  setSetting(key, value) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `);
      stmt.run(key, JSON.stringify(value), Date.now());
    } catch (err) {
      console.error(`DB setSetting('${key}') error:`, err);
    }
  }

  // --- 캐릭터(Characters) 관리 ---

  getActiveCharacters() {
    try {
      const stmt = this.db.prepare('SELECT data FROM characters ORDER BY created_at ASC');
      const rows = stmt.all();
      return rows.map(r => JSON.parse(r.data));
    } catch (err) {
      console.error('DB getActiveCharacters error:', err);
      return [];
    }
  }

  saveCharacter(char, maxLimit = 12) {
    try {
      const insert = this.db.prepare(`
        INSERT INTO characters (id, name, type, data, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          data = excluded.data
      `);

      const createdAt = char.createdAt || Date.now();
      insert.run(
        char.id,
        char.name || '무명 캐릭터',
        char.type || 'drawing',
        JSON.stringify(char),
        createdAt
      );

      // 최대 개수 초과 시 가장 오래된 캐릭터 자동 정리
      this.trimCharacters(maxLimit);
    } catch (err) {
      console.error('DB saveCharacter error:', err);
    }
  }

  removeCharacter(characterId) {
    try {
      const stmt = this.db.prepare('DELETE FROM characters WHERE id = ?');
      stmt.run(characterId);
    } catch (err) {
      console.error('DB removeCharacter error:', err);
    }
  }

  clearCharacters() {
    try {
      this.db.exec('DELETE FROM characters;');
    } catch (err) {
      console.error('DB clearCharacters error:', err);
    }
  }

  trimCharacters(maxLimit = 15) {
    try {
      const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM characters');
      const { count } = countStmt.get();
      if (count > maxLimit) {
        const excess = count - maxLimit;
        const deleteOldest = this.db.prepare(`
          DELETE FROM characters WHERE id IN (
            SELECT id FROM characters ORDER BY created_at ASC LIMIT ?
          )
        `);
        deleteOldest.run(excess);
      }
    } catch (err) {
      console.error('DB trimCharacters error:', err);
    }
  }

  cleanupExpired(lifespanSeconds) {
    try {
      if (!lifespanSeconds || lifespanSeconds <= 0) return;
      const expireTime = Date.now() - (lifespanSeconds * 1000);
      const stmt = this.db.prepare('DELETE FROM characters WHERE created_at < ?');
      stmt.run(expireTime);
    } catch (err) {
      console.error('DB cleanupExpired error:', err);
    }
  }

  close() {
    try {
      this.db.close();
    } catch (e) {}
  }
}

// 싱글톤 DB 인스턴스 생성 (로컬 환경: SQLite 파일 DB, Vercel/서버리스 환경: 인메모리 DB)
let mediaWallDB;
const isServerless = Boolean(process.env.VERCEL || process.env.NOW_REGION || process.env.LAMBDA_TASK_ROOT);

if (Database && !isServerless) {
  try {
    const dbFilePath = path.join(__dirname, 'data', 'media_wall.db');
    mediaWallDB = new MediaWallDB(dbFilePath);
  } catch (err) {
    console.warn('⚠️ SQLite DB 파일 생성 불가, 인메모리 DB로 전환합니다:', err.message);
    mediaWallDB = new InMemoryDB();
  }
} else {
  mediaWallDB = new InMemoryDB();
}

module.exports = mediaWallDB;
