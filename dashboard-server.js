/**
 * 블로그 자동화 대시보드 서버 v2
 * 수정사항:
 * - /api/run/selected  선택한 itemId 목록만 실행
 * - /api/history/clear history.json 초기화 (전체)
 * - /api/history/clear-item 단일 아이템 history 제거 (재발행용)
 * - abort 호출 시 isRunning 강제 false 처리
 * - test-group 더미 아이템 지원
 */
require('dotenv').config({ path: './.env.local' });

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const PORT = 3131;

// ────────── 상태 ──────────────────────────────────────────────────────────────
const state = {
  running: false,
  aborted: false,
  currentItemIndex: -1,
  currentItemTitle: '',
  clients: [],
  geminiContext: null,
  geminiPage: null,
  logBuffer: [], // 최근 로그 저장 (최대 300줄)
};

// ────────── SSE ───────────────────────────────────────────────────────────────
function broadcast(type, message, extra = {}) {
  const payloadData = { type, message, time: new Date().toISOString(), ...extra };
  const payload = JSON.stringify(payloadData);

  // 로그 버퍼에 저장 (type이 log, error, status인 경우)
  if (['log', 'error', 'status', 'done'].includes(type)) {
    state.logBuffer.push(payloadData);
    if (state.logBuffer.length > 300) state.logBuffer.shift();
  }

  state.clients.forEach((res) => {
    try { res.write(`data: ${payload}\n\n`); } catch (_) {}
  });
  if (type === 'error') console.error(`[${type}] ${message}`);
  else console.log(`[${type}] ${message}`);
}

// ────────── DB 로드 ───────────────────────────────────────────────────────────
function loadAllItems() {
  const dbPath = path.join(__dirname, 'data', 'curation-db.json');
  if (!fs.existsSync(dbPath)) return [];
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  const items = [];
  for (const key of Object.keys(db)) {
    const group = db[key];
    if (group?.items) {
      group.items.forEach((item, idx) => {
        items.push({
          id: `${key}-${idx}`,
          groupId: key,
          groupLabel: group.group?.label || key,
          isTestItem: group.group?.isTest === true,
          ...item,
        });
      });
    }
  }
  return items;
}

// ────────── history ───────────────────────────────────────────────────────────
const HIST_PATH = path.join(__dirname, 'history.json');

function loadHistory() {
  if (!fs.existsSync(HIST_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(HIST_PATH, 'utf-8')); }
  catch (_) { return []; }
}

function saveHistory(arr) {
  fs.writeFileSync(HIST_PATH, JSON.stringify(arr, null, 2), 'utf-8');
}

function addHistory(link) {
  const h = loadHistory();
  if (!h.includes(link)) { h.push(link); saveHistory(h); }
}

function removeHistory(link) {
  const h = loadHistory().filter(l => l !== link);
  saveHistory(h);
}

function isPublished(item) {
  return loadHistory().includes(item.link);
}

// ────────── article.txt ───────────────────────────────────────────────────────
function writeArticleTxt(item) {
  const content = [
    `[카테고리]: ${item.category || '뉴스'}`,
    `[주제/제목]: ${item.title}`,
    `[원본 링크]: ${item.link}`,
    `[요약 설명]: ${item.description}`,
    '',
    '위의 글감(주제, 링크, 요약 설명) 내용을 바탕으로 구체적인 살을 붙여 정보성 블로그 포스팅 초본을 완성해줘.',
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, 'article.txt'), content, 'utf-8');
}

// ────────── 단일 항목 처리 ─────────────────────────────────────────────────────
async function processSingleItem(item, isFirstOfSession, isDryRun = false) {
  const { runGeminiPost } = require('./gemini-runner.js');

  broadcast('log', `▶ 시작: ${item.title}`, { itemId: item.id });
  broadcast('status', 'running', { itemId: item.id, step: 'start' });

  writeArticleTxt(item);
  broadcast('log', `  [1/4] article.txt 작성 완료`, { itemId: item.id });

  // Dry-run 모드: 실제 실행하지 않고 로그만 출력
  if (isDryRun) {
    broadcast('log', `  [TEST] DRY RUN 모드 — Gemini/Blogger 실제 호출 없음`);
    await new Promise(r => setTimeout(r, 1500));
    broadcast('log', `  [TEST] Step 2/4: Gemini AI 글 생성 시뮬레이션...`);
    await new Promise(r => setTimeout(r, 1500));
    broadcast('log', `  [TEST] Step 3/4: 이미지 생성 시뮬레이션...`);
    await new Promise(r => setTimeout(r, 1500));
    broadcast('log', `  [TEST] Step 4/4: Blogger 발행 시뮬레이션...`);
    await new Promise(r => setTimeout(r, 1000));
    broadcast('log', `✅ [TEST] 테스트 완료 (실제 발행 없음)`, { itemId: item.id });
    broadcast('status', 'done', { itemId: item.id, url: '' });
    return { url: '', title: item.title, dryRun: true };
  }

  const result = await runGeminiPost({
    topic: fs.readFileSync(path.join(__dirname, 'article.txt'), 'utf-8').trim(),
    category: item.category || '뉴스',
    isFirstOfSession,
    sharedState: state,
    onLog: (msg) => broadcast('log', `  ${msg}`, { itemId: item.id }),
    onStep: (step) => broadcast('status', 'running', { itemId: item.id, step }),
  });

  addHistory(item.link);
  broadcast('log', `✅ 발행 완료: ${result.url || '(URL 없음)'}`, { itemId: item.id });
  broadcast('status', 'done', { itemId: item.id, url: result.url });
  return result;
}

// ────────── 실행 큐 ───────────────────────────────────────────────────────────
async function runQueue(items, isDryRun = false) {
  state.running = true;
  state.aborted = false;
  // 세션 초기화 (새 실행 시작 = 새 Gemini 채팅)
  state.geminiPage = null;

  broadcast('log', `═══════════════════════════════════`);
  broadcast('log', `🚀 실행 시작 — 총 ${items.length}건${isDryRun ? ' [DRY RUN]' : ''}`);
  broadcast('log', `═══════════════════════════════════`);
  broadcast('status', 'queue-start', { total: items.length });

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < items.length; i++) {
    if (state.aborted) {
      broadcast('log', `⛔ 중단 신호 수신 — 실행을 종료합니다.`);
      break;
    }

    const item = items[i];
    state.currentItemIndex = i;
    state.currentItemTitle = item.title;

    broadcast('log', ``);
    broadcast('log', `── [${i + 1}/${items.length}] ${item.groupLabel} ──`);

    try {
      await processSingleItem(item, i === 0, isDryRun);
      successCount++;
    } catch (err) {
      failCount++;
      broadcast('error', `❌ 오류: ${err.message}`, { itemId: item.id });
      broadcast('status', 'error', { itemId: item.id, error: err.message });
      // 오류 후 Gemini 세션 리셋
      state.geminiPage = null;
    }

    if (i < items.length - 1 && !state.aborted) {
      broadcast('log', `  ⏳ 다음 아이템까지 20초 대기...`);
      // 1초마다 abort 체크하면서 대기
      for (let sec = 0; sec < 20; sec++) {
        if (state.aborted) break;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // 브라우저 컨텍스트 정리
  if (state.geminiContext) {
    try { await state.geminiContext.close(); } catch (_) {}
    state.geminiContext = null;
    state.geminiPage = null;
  }

  broadcast('log', ``);
  broadcast('log', `═══════════════════════════════════`);
  broadcast('log', `🏁 완료 — 성공: ${successCount}건, 실패: ${failCount}건`);
  broadcast('log', `═══════════════════════════════════`);
  broadcast('done', '실행 완료', { successCount, failCount });

  state.running = false;
  state.aborted = false;
  state.currentItemIndex = -1;
  state.currentItemTitle = '';
}

// ────────── API 라우트 ─────────────────────────────────────────────────────────

// SSE 스트림
app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  state.clients.push(res);
  // 연결 직후 현재 상태 전송
  res.write(`data: ${JSON.stringify({ type: 'connected', running: state.running, time: new Date().toISOString() })}\n\n`);
  
  // 기존 로그 버퍼가 있다면 'history' 타입으로 전송
  if (state.logBuffer.length > 0) {
    res.write(`data: ${JSON.stringify({ type: 'history', logs: state.logBuffer })}\n\n`);
  }

  req.on('close', () => { state.clients = state.clients.filter(c => c !== res); });
});

// 아이템 목록
app.get('/api/articles', (req, res) => {
  const { hidePublished = 'false' } = req.query;
  const items = loadAllItems();
  const history = loadHistory();
  
  let result = items.map(item => ({ 
    ...item, 
    published: history.includes(item.link) 
  }));

  if (hidePublished === 'true') {
    result = result.filter(item => !item.published);
  }

  res.json(result);
});

// 현재 상태
app.get('/api/status', (req, res) => {
  res.json({
    running: state.running,
    aborted: state.aborted,
    currentItemIndex: state.currentItemIndex,
    currentItemTitle: state.currentItemTitle,
  });
});

// 선택한 아이템만 실행 ★
app.post('/api/run/selected', async (req, res) => {
  if (state.running) return res.status(409).json({ error: '이미 실행 중입니다.' });
  const { itemIds, dryRun = false } = req.body;
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: '실행할 아이템을 선택해 주세요.' });
  }
  const all = loadAllItems();
  const items = itemIds.map(id => all.find(i => i.id === id)).filter(Boolean);
  if (items.length === 0) return res.status(404).json({ error: '유효한 아이템이 없습니다.' });
  res.json({ ok: true, count: items.length, dryRun });
  runQueue(items, dryRun).catch(err => broadcast('error', `예기치 않은 오류: ${err.message}`));
});

// 단일 아이템 실행
app.post('/api/run/single', async (req, res) => {
  if (state.running) return res.status(409).json({ error: '이미 실행 중입니다.' });
  const { itemId, dryRun = false } = req.body;
  const all = loadAllItems();
  const item = all.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: '아이템을 찾을 수 없습니다.' });
  res.json({ ok: true });
  runQueue([item], dryRun).catch(err => broadcast('error', `예기치 않은 오류: ${err.message}`));
});

// 전체 미발행 실행
app.post('/api/run/all', async (req, res) => {
  if (state.running) return res.status(409).json({ error: '이미 실행 중입니다.' });
  const pendings = loadAllItems().filter(i => !isPublished(i) && !i.isTestItem);
  if (pendings.length === 0) return res.json({ ok: true, message: '발행할 새 아이템이 없습니다.' });
  res.json({ ok: true, count: pendings.length });
  runQueue(pendings, false).catch(err => broadcast('error', `예기치 않은 오류: ${err.message}`));
});

// 테스트 실행 (테스트 전용 아이템 DRY RUN)
app.post('/api/run/test', async (req, res) => {
  if (state.running) return res.status(409).json({ error: '이미 실행 중입니다.' });
  const all = loadAllItems();
  // 테스트 전용 그룹 우선, 없으면 첫 번째 아이템으로 dry-run
  const testItem = all.find(i => i.isTestItem) || all[0];
  if (!testItem) return res.json({ ok: true, message: '아이템이 없습니다.' });
  res.json({ ok: true, item: testItem.title, dryRun: true });
  runQueue([testItem], true).catch(err => broadcast('error', `예기치 않은 오류: ${err.message}`));
});

// 중단 ★ (즉시 상태 변경)
app.post('/api/stop', (req, res) => {
  if (!state.running) return res.json({ ok: false, message: '실행 중이 아닙니다.' });
  state.aborted = true;
  broadcast('log', `⛔ 중단 신호 수신. 현재 작업 완료 후 종료합니다.`);
  broadcast('status', 'aborting', {});
  res.json({ ok: true });
});

// 새로운 아티클 수집 (Crawl) ★
app.post('/api/fetch-new', (req, res) => {
  if (state.running) return res.status(409).json({ error: '이미 다른 작업이 실행 중입니다.' });
  
  state.running = true;
  broadcast('log', '🔄 [CRAWL] 최신 아티클 수집 시작 (curation-crawler.ts)...');
  broadcast('status', 'running', { step: 'crawl-start' });

  // ts-node를 사용하여 크롤러 실행
  const crawlerPath = path.join(__dirname, 'scripts', 'curation-crawler.ts');
  const cmd = `npx tsx "${crawlerPath}"`;

  exec(cmd, (error, stdout, stderr) => {
    state.running = false;
    if (error) {
      broadcast('error', `❌ 수집 중 오류 발생: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }
    
    broadcast('log', '✅ [CRAWL] 수집 완료. 데이터베이스가 갱신되었습니다.');
    broadcast('done', '수집 완료');

    // 갱신된 목록 반환 (필터링 적용)
    const items = loadAllItems();
    const history = loadHistory();
    const filtered = items.filter(i => !history.includes(i.link));
    
    res.json({ ok: true, count: filtered.length, items: filtered });
  });
});

// history 전체 초기화 ★
app.post('/api/history/clear', (req, res) => {
  saveHistory([]);
  broadcast('log', `🗑 발행 기록(history.json)을 초기화했습니다.`);
  res.json({ ok: true });
});

// 단일 아이템 history 제거 (재발행 활성화)
app.post('/api/history/clear-item', (req, res) => {
  const { link } = req.body;
  if (!link) return res.status(400).json({ error: 'link 필요' });
  removeHistory(link);
  broadcast('log', `▲ 재발행 활성화: ${link.slice(0, 60)}...`);
  res.json({ ok: true });
});

// 로그 버퍼 초기화
app.post('/api/logs/clear', (req, res) => {
  state.logBuffer = [];
  res.json({ ok: true });
});

// ────────── 서버 기동 ──────────────────────────────────────────────────────────
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`\n Dashboard: http://localhost:${PORT}/dashboard.html\n`);
});
