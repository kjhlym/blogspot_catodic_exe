/**
 * gemini-runner.js
 * Gemini AI 실행의 핵심 로직을 캡슐화한 모듈.
 * - Gemini 세션(브라우저 컨텍스트 + 탭)을 외부 sharedState로 관리하여
 *   같은 프로세스 실행 중에는 동일 채팅 탭을 재사용한다.
 * - 이미지 생성 실패 시 텍스트만 Blogger에 발행한다.
 */
require('dotenv').config({ path: './.env.local' });

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { runBloggerEditorWorker } = require('./src/lib/blogger-worker-runner.js');
const { resolveBloggerTarget } = require('./src/lib/blogger-targets.js');

const PROFILE_DIR = path.join(__dirname, 'playwright-profile-gemini-vibe');
const SS_DIR = path.join(__dirname, 'e2e-screenshots');
const DOWNLOAD_PATH = 'C:\\Users\\kks\\Downloads';
const GEMINI_IMAGE_PATH = path.join(DOWNLOAD_PATH, 'gemini_image.jpg');

const GOOGLE_ID = process.env.GOOGLE_GEMINI_ID?.replace(/^[\"']|[\"']$/g, '').trim();
const GOOGLE_PW = process.env.GOOGLE_GEMINI_PW?.replace(/^[\"']|[\"']$/g, '').trim();

if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function isCdpDisconnectedError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('target closed') ||
    msg.includes('browser closed') ||
    msg.includes('browser has been closed') ||
    msg.includes('page has been closed') ||
    msg.includes('cdp session closed') ||
    msg.includes('connection closed')
  );
}

async function screenshot(page, name) {
  const fp = path.join(SS_DIR, `${String(Date.now()).slice(-6)}_${name}.png`);
  await page.screenshot({ path: fp, fullPage: true }).catch(() => {});
}

// ─── Gemini 응답 대기 ─────────────────────────────────────────────────────────

async function waitForGeminiResponse(page, onLog, timeoutMs = 120000) {
  const startedAt = Date.now();
  let idleStableCount = 0;
  let lastHeartbeat = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (Date.now() - lastHeartbeat > 15000) {
      if (onLog) onLog(`[GEMINI] AI 응답 대기 중... (${Math.floor((Date.now() - startedAt) / 1000)}초 경과)`);
      lastHeartbeat = Date.now();
    }
    let status;
    try {
      status = await page.evaluate(() => {
        const lastTurn =
          document.querySelector('message-turn:last-of-type') ||
          document.querySelector('model-response:last-of-type') ||
          document.querySelector('.model-response:last-of-type') ||
          document.querySelector('[role="log"] div:last-child') ||
          document.querySelector('.conversation-container .turn:last-child');

        const lastText = (lastTurn?.textContent || lastTurn?.innerText || '').trim();
        const hasJsonCandidate =
          /```(?:json)?/i.test(lastText) ||
          /"title"\s*:/.test(lastText) ||
          /"html"\s*:/.test(lastText);

        const text = document.body.innerText || '';
        const isWorking =
          document.querySelectorAll(
            'mat-progress-spinner, [aria-label*="로딩"], .loading-indicator, generate-image-progress, .prediction-streaming'
          ).length > 0 ||
          text.includes('생성 중...') ||
          text.includes('생성하는 중') ||
          text.includes('이미지 생성 중');

        return { hasJsonCandidate, hasResponseText: lastText.length > 40, isWorking };
      });
    } catch (err) {
      if (isCdpDisconnectedError(err)) throw err;
      status = { hasJsonCandidate: false, hasResponseText: false, isWorking: true };
    }

    if ((status.hasJsonCandidate || status.hasResponseText) && !status.isWorking) {
      idleStableCount += 1;
      if (idleStableCount >= 2) return true;
    } else {
      idleStableCount = 0;
    }

    await page.waitForTimeout(1200);
  }

  return false;
}

// ─── 이미지 생성 대기 ─────────────────────────────────────────────────────────

async function waitForGeneratedImage(page, timeoutMs = 100000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const imageState = await page.evaluate(() => {
      const selectors = [
        'img[src*="googleusercontent.com/drawings"]',
        'img[src*="googleusercontent.com/chat_attachments"]',
        'img[src*="content-advisory"]',
        'div.image-container img',
        '.generated-image-container img',
        'img[alt*="생성된 이미지"]',
        'img[alt*="Generated image"]',
        'img[alt*="image"]',
        '.fluid-image-container img',
      ];

      for (const selector of selectors) {
        const images = Array.from(document.querySelectorAll(selector));
        if (images.length === 0) continue;
        const lastImage = images[images.length - 1];
        const rect = lastImage.getBoundingClientRect();
        if (rect.width > 80 && rect.height > 80) {
          return { found: true, denied: false };
        }
      }

      const text = document.body.innerText || '';
      const denied =
        text.includes('도움을 드릴 수 없습니다') ||
        text.includes('I cannot create images') ||
        text.includes('제한된 내용');

      return { found: false, denied };
    }).catch(() => ({ found: false, denied: false }));

    if (imageState.found || imageState.denied) return imageState;
    await page.waitForTimeout(400);
  }

  return { found: false, denied: false };
}

// ─── 프롬프트 제출 ─────────────────────────────────────────────────────────────

async function submitGeminiPrompt(page, fallbackInput = null) {
  const sendSelectors = [
    'button[aria-label*="전송"]',
    'button[aria-label*="Send"]',
    'button.send-button',
    'button[data-test-id="send-button"]',
  ];

  await page.waitForTimeout(250);

  for (const sel of sendSelectors) {
    const buttons = page.locator(sel);
    const count = await buttons.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const visible = await btn.isVisible({ timeout: 1200 }).catch(() => false);
      if (!visible) continue;
      const disabled = await btn.isDisabled().catch(() => false);
      if (disabled) continue;
      await btn.click({ force: true });
      return 'button';
    }
  }

  if (fallbackInput) {
    await fallbackInput.press('Enter').catch(() => {});
  } else {
    await page.keyboard.press('Enter').catch(() => {});
  }

  return 'enter';
}

// ─── 구글 로그인 ─────────────────────────────────────────────────────────────

async function googleLogin(page, id, pw) {
  if (!page.url().includes('ServiceLogin')) {
    await page.goto(
      'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp',
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );
  }
  await page.waitForTimeout(2000);

  const emailInput = page.locator('input[type="email"], input[name="identifier"], #identifierId');
  const accountItem = page.locator(`div[role="link"]:has-text("${id}"), div[data-identifier="${id}"]`);

  if (await accountItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    await accountItem.click();
  } else if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await emailInput.fill(id);
    await page.click('button:has-text("다음"), button:has-text("Next"), #identifierNext');
  } else {
    return; // 이미 로그인된 상태
  }

  await page.waitForTimeout(3000);

  const pwInput = page.locator('input[type="password"], input[name="Passwd"]');
  if (await pwInput.isVisible({ timeout: 10000 }).catch(() => false)) {
    await pwInput.fill(pw);
    await page.click('button:has-text("다음"), button:has-text("Next"), #passwordNext');
    await page.waitForTimeout(5000);

    try {
      const skipButtons = [
        'button:has-text("나중에 하기")',
        'button:has-text("Skip")',
        'button:has-text("Not now")',
        'button:has-text("Confirm")',
        'a:has-text("나중에 하기")',
        'div[role="button"]:has-text("Confirm")',
      ];
      for (const sel of skipButtons) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(2000);
        }
      }
    } catch (_) {}

    await page.waitForTimeout(3000);
  }
}

// ─── Gemini 탭 초기화 (로그인 + 페이지 이동) ─────────────────────────────────

async function initGeminiPage(context, onLog) {
  const page = await context.newPage();
  onLog('[GEMINI] Gemini 새 탭 열기...');
  await page.goto('https://gemini.google.com/app?hl=ko', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const checkLogin = async () =>
    page.evaluate(() => {
      const profileSelectors = [
        'a[href*="SignOut"]',
        'img[src*="googleusercontent.com/a/"]',
        '.gb_i',
        'button[aria-label*="Google 계정"]',
        'button[aria-label*="Google Account"]',
      ];
      const hasProfile = profileSelectors.some((sel) => !!document.querySelector(sel));
      const hasNewChat =
        document.body.innerText.includes('새 채팅') ||
        document.body.innerText.includes('New chat') ||
        !!document.querySelector('button[aria-label*="새 대화"]');
      return hasProfile || hasNewChat;
    });

  const isLoginVisible = await page.evaluate(() => {
    const texts = ['로그인', 'Sign in'];
    const els = Array.from(document.querySelectorAll('a, button, [role="button"]'));
    return els.some(
      (el) => {
        const t = el.innerText?.trim();
        return texts.includes(t) || (el.href && el.href.includes('ServiceLogin'));
      }
    );
  }).catch(() => false);

  let loggedIn = await checkLogin();

  if (!loggedIn || isLoginVisible) {
    onLog('[GEMINI] 로그인 필요 — 자동 로그인 시도...');
    const exactLoginBtn = page.locator('a.gb_Va.gb_Wd.gb_Od.gb_Ed.gb_H, a[href*="ServiceLogin"]').first();
    if (await exactLoginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await exactLoginBtn.click();
      await page.waitForTimeout(3000);
    }

    if (!GOOGLE_ID || !GOOGLE_PW) throw new Error('구글 계정 정보가 없습니다.');
    await googleLogin(page, GOOGLE_ID, GOOGLE_PW);

    await page.goto('https://gemini.google.com/app?hl=ko', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    loggedIn = await checkLogin();
    if (!loggedIn) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      loggedIn = await checkLogin();
    }
  }

  if (!loggedIn) {
    await screenshot(page, 'login_failed');
    throw new Error('Gemini 로그인 실패');
  }

  onLog('[GEMINI] ✅ 로그인 확인 완료');
  return page;
}

// ─── JSON 추출 ────────────────────────────────────────────────────────────────

async function extractJsonFromPage(page, onLog) {
  const result = await page.evaluate(() => {
    const selectors = [
      'message-turn:last-of-type',
      'model-response:last-of-type',
      '.model-response',
      '[role="log"] div:last-child',
      '.conversation-container .turn:last-child',
    ];

    let lastTurn = null;
    for (const s of selectors) {
      lastTurn = document.querySelector(s);
      if (lastTurn && (lastTurn.textContent || lastTurn.innerText).trim().length > 0) break;
    }

    if (!lastTurn) return { text: '', codes: [] };

    const text = lastTurn.textContent || lastTurn.innerText || '';
    const codeBlocks = Array.from(
      lastTurn.querySelectorAll('pre, code, .code-block, [role="textbox"]')
    ).map((el) => el.textContent || el.innerText || '');

    return { text, codes: codeBlocks };
  });

  onLog(`[GEMINI] 응답 길이: ${result.text.length}자, 코드블록: ${result.codes.length}개`);

  function tryParse(s, passName) {
    if (!s || !s.includes('{')) return null;
    try {
      const p = JSON.parse(s);
      if (p.title && p.html) return { ...p, tags: p.tags || [] };
    } catch (e) {
      // Pass 2: LaTeX/Backslash fix (Negative lookahead for valid escapes)
      const c2 = s.replace(/\\(?![/bfnrt"\\/]|u[0-9a-fA-F]{4})/g, '\\\\');
      try {
        const p = JSON.parse(c2);
        if (p.title && p.html) return { ...p, tags: p.tags || [] };
      } catch (e2) {
        // Pass 3: Normalization
        const c3 = c2.replace(/[\n\r\t]/g, ' ');
        try {
          const p = JSON.parse(c3);
          if (p.title && p.html) return { ...p, tags: p.tags || [] };
        } catch (e3) {}
      }
    }
    return null;
  }

  // 1. Try code blocks
  for (const block of result.codes) {
    const candidate = block.trim().replace(/^(JSON|json)\s*/i, '').trim();
    const parsed = tryParse(candidate, 'CodeBlock');
    if (parsed) return parsed;
  }

  // 2. Try text matching (Greedy first to catch the whole block)
  const m1 = result.text.match(/\{[\s\S]*\}/);
  if (m1) {
    const parsed = tryParse(m1[0].trim(), 'GreedyText');
    if (parsed) return parsed;
  }

  // 3. Try non-greedy fragments (In case of multiple blocks)
  const m2 = result.text.matchAll(/\{[\s\S]+?\}/g);
  for (const match of m2) {
    const parsed = tryParse(match[0].trim(), 'Fragment');
    if (parsed) return parsed;
  }

  // Final failure logging
  const debugPath = path.join(__dirname, 'debug-last-json.txt');
  fs.writeFileSync(debugPath, `--- RAW --- \n${result.text}`, 'utf-8');
  onLog(`[GEMINI] ❌ 모든 JSON 추출/파싱 시도 실패. 상세 데이터: ${debugPath}`);
  throw new Error('JSON parsing failed after all attempts');
}

// ─── 이미지 생성 및 캡처 ──────────────────────────────────────────────────────

async function generateAndCaptureImage(page, keyword, topic, onLog) {
  const findImage = async () => {
    const imageSelectors = [
      'img[src*="googleusercontent.com/drawings"]',
      'img[src*="googleusercontent.com/chat_attachments"]',
      'img[src*="content-advisory"]',
      'div.image-container img',
      '.generated-image-container img',
      'img[alt*="생성된 이미지"]',
      'img[alt*="Generated image"]',
      'img[alt*="image"]',
      '.fluid-image-container img',
    ];
    for (const sel of imageSelectors) {
      try {
        const imgs = page.locator(sel);
        const count = await imgs.count();
        if (count > 0) {
          const last = imgs.last();
          if (await last.isVisible({ timeout: 2000 })) return last;
        }
      } catch (_) {}
    }
    return null;
  };

  const requestImage = async (kw) => {
    const selectors = [
      'div.ql-editor.textarea.new-input-ui',
      'div[data-placeholder*="Gemini"]',
      'div[aria-label*="Gemini"]',
      'div[role="textbox"][contenteditable="true"]',
      '.ql-editor',
    ];
    let targetInput = null;
    for (const sel of selectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        targetInput = el;
        break;
      }
    }

    const imagePrompt = `Please create a high-quality, ultra-realistic, photorealistic image of: ${kw}. NO TEXT, NO LABELS, NO CAPTIONS. Professional artistic engineering style.`;

    if (targetInput) {
      onLog(`[GEMINI] 이미지 생성 프롬프트 입력창 클릭 및 초기화...`);
      await targetInput.click();
      await page.waitForTimeout(1000); // 입력창 활성화 대기
      
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.waitForTimeout(500);

      onLog(`[GEMINI] 이미지 생성 프롬프트 전송 시도: ${kw.slice(0, 30)}...`);
      onLog(`[GEMINI] 이미지 프롬프트 준비: ${imagePrompt.slice(0, 50)}...`);
      const pasted = await page
        .evaluate((t) => navigator.clipboard.writeText(t).then(() => true).catch(() => false), imagePrompt)
        .catch(() => false);
      if (pasted) {
        onLog(`[GEMINI] 클립보드 복사 성공 — 붙여넣기 실행`);
        await page.keyboard.press('Control+v');
      } else {
        onLog(`[GEMINI] ⚠️ 클립보드 복사 실패 — 직접 타이핑 중...`);
        await page.keyboard.type(imagePrompt, { delay: 5 });
      }
      await page.waitForTimeout(1000);
      onLog(`[GEMINI] 이미지 생성 프롬프트 전송 버튼 클릭`);
      await submitGeminiPrompt(page, targetInput);
    } else {
      onLog(`[GEMINI] ⚠️ 입력창을 직접 찾지 못해 강제 입력 시도...`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await page.keyboard.type(imagePrompt);
      await submitGeminiPrompt(page);
    }
  };

  onLog('[GEMINI] 이미지 생성 요청 중...');
  await requestImage(keyword);

  let imgEl = null;
  for (let retry = 0; retry <= 1; retry++) {
    const imageState = await waitForGeneratedImage(page);
    imgEl = imageState.found ? await findImage() : null;

    if (imgEl) break;

    if (imageState.denied && retry === 0) {
      onLog('[GEMINI] ⚠️ 이미지 거부됨 — 다른 키워드로 재시도...');
      await requestImage(topic.slice(0, 30));
      continue;
    }

    if (imageState.denied) onLog('[GEMINI] ❌ 이미지 생성 두 번 모두 거부됨');
    break;
  }

  if (!imgEl) {
    onLog('[GEMINI] ⚠️ 이미지를 찾지 못했습니다 — 텍스트만 발행합니다.');
    return false;
  }

  try {
    if (fs.existsSync(GEMINI_IMAGE_PATH)) fs.unlinkSync(GEMINI_IMAGE_PATH);
    await imgEl.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await imgEl.screenshot({ path: GEMINI_IMAGE_PATH, type: 'jpeg', quality: 95 });
    onLog(`[GEMINI] 🖼️ 이미지 저장 완료`);
    return true;
  } catch (err) {
    onLog(`[GEMINI] 이미지 캡처 오류: ${err.message} — 텍스트만 발행합니다.`);
    return false;
  }
}

// ─── 메인 실행 함수 ───────────────────────────────────────────────────────────

/**
 * 단일 아이템을 Gemini로 글 생성 후 Blogger에 발행한다.
 *
 * @param {object} options
 * @param {string} options.topic - article.txt 내용 전체
 * @param {string} options.category - 카테고리 문자열
 * @param {boolean} options.isFirstOfSession - true면 새 탭 열어서 로그인, false면 기존 탭 재사용
 * @param {object} options.sharedState - 서버에서 공유하는 상태 객체 { geminiContext, geminiPage }
 * @param {function} options.onLog - 로그 콜백
 * @param {function} options.onStep - 단계 변경 콜백
 * @returns {Promise<{url: string}>}
 */
async function runGeminiPost({ topic, category, isFirstOfSession, sharedState, onLog, onStep }) {
  onStep('gemini-init');

  // 브라우저 컨텍스트 준비
  if (!sharedState.geminiContext) {
    onLog('[2/4] Playwright 브라우저 실행 중...');
    sharedState.geminiContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: process.env.HEADLESS === 'true',
      viewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
      permissions: ['clipboard-read', 'clipboard-write'],
    });

    // CDP 단절 감지
    sharedState.geminiContext.on('close', () => {
      onLog('[브라우저] 컨텍스트가 닫혔습니다.');
      sharedState.geminiContext = null;
      sharedState.geminiPage = null;
    });
  }

  // Gemini 페이지 준비
  let page = sharedState.geminiPage;
  let pageAlive = page
    ? await page.evaluate(() => true).catch(() => false)
    : false;

  // 세션 유지 중이라도 로그인 상태가 풀렸을 수 있으므로 항상 체크
  if (pageAlive) {
    const stillLoggedIn = await page.evaluate(() => {
      const profileSelectors = [
        'a[href*="SignOut"]',
        'img[src*="googleusercontent.com/a/"]',
        'button[aria-label*="Google 계정"]',
        'button[aria-label*="Google Account"]',
      ];
      return profileSelectors.some(sel => !!document.querySelector(sel));
    }).catch(() => false);

    if (!stillLoggedIn) {
      onLog('[3/4] ⚠️ 세션 만료 감지 (로그아웃됨) — 재로그인 시도...');
      pageAlive = false;
    }
  }

  if (!pageAlive) {
    onLog('[3/4] Gemini 탭 초기화 (로그인 포함)...');
    page = await initGeminiPage(sharedState.geminiContext, onLog);
    sharedState.geminiPage = page;
  } else {
    onLog('[3/4] ♻️ 기존 Gemini 탭 재사용 (세션 유지 중)');
  }

  // 프롬프트 입력창 찾기
  const inputSelectors = [
    'div.ql-editor.textarea.new-input-ui',
    'div[contenteditable="true"]',
    'div[role="textbox"]',
    '.ql-editor',
    'textarea[aria-label*="프롬프트"]',
  ];

  let inputEl = null;
  await page.waitForTimeout(2000);

  for (const sel of inputSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
      inputEl = el;
      break;
    }
  }

  if (!inputEl) throw new Error('Gemini 입력창을 찾을 수 없습니다.');

  // 프롬프트 생성 및 전송
  onStep('gemini-prompt');
  onLog('[GEMINI] 블로그 글 생성 프롬프트 전송 중...');

  const prompt = `[검색 키워드 및 확인된 원본 소재]\n${topic}\n\n[목표]\n당신은 글로벌 전기방식(Cathodic Protection) 기술 및 검색엔진(SEO) 최적화 전문가입니다. \n구글 SEO 랭킹 1위를 달성할 수 있도록, 기계 번역투나 AI 특유의 딱딱한 문장을 철저히 배제하고 '현업 엔지니어가 직접 자신의 경험과 지식을 녹여서 쓴 듯한 자연스럽고 깊이 있는 문장'으로 블로그 포스팅을 작성하세요.\n\n[작성 가이드라인]\n1. **SEO 및 분량 최적화**: 구글 검색 노출에 최적화되도록 핵심 키워드를 자연스럽게 전진 배치하며, 전문가의 통찰이 담긴 충분한 정보량(공백 포함 2000자 이상)으로 아주 상세하게 풍성한 내용을 작성하세요.\n2. **페르소나 및 어조**: 10년 차 이상 수석 엔지니어가 노하우를 공유하듯, 확신에 차 있으면서도 가독성이 높은 자연스러운 어투를 사용하여 '진짜 사람이 쓴 글'처럼 다듬어주세요.\n3. **구조**: <h2>, <h3> 태그를 적극 사용하여 H 태그 계층구조를 체계적으로 구성하여 SEO 점수와 가독성을 높이세요.\n4. **원본 이미지 최우선 활용**: 검색된 원본 웹페이지에 설명 이미지가 있을 경우, 그 URL을 찾아 본문 적절한 위치에 \`<img src="URL" alt="[핵심 키워드가 포함된 이미지 설명]" style="max-width:100%; height:auto;" />\` 태그로 직접 삽입하세요.\n5. **AI 이미지 플레이스홀더 삽입**: 원본에서 유효한 이미지를 발견하지 못한 경우, 본론의 시각적 환기가 필요한 곳에 \`[MID_IMAGE]\` 플레이스홀더를 정확히 삽입하세요.\n6. **원본 소스 링크 제외**: 본문 하단 등에 원본 출처를 암시하는 어떠한 링크나 출처 표기도 추가하지 마세요.\n7. **전문적 수식 및 단위 작성**: 수학적 수식이나 물리 공식(예: Nernst 식, 전위차 계산 등)은 반드시 LaTeX 형식을 사용하여 전문적으로 작성하세요. **또한, $cm$, $\\rho$, $I$, $\\Omega \\cdot cm$와 같은 모든 물리적 단위, 변수, 기호는 반드시 인라인 수식 \`$내용$\` 형식을 사용하여 작성하세요.** 블로그 렌더링을 위해 \`$$수식$$\` (블록 스타일) 또는 \`$수식$\` (인라인 스타일) 형식을 엄격히 준수하세요.\n8. **SEO 태그 생성**: 주제와 밀접하게 연관된 SEO 최적화 태그(Keywords)를 5~10개 추출하세요. 이 태그들은 블로그의 유입률을 높이는 데 사용됩니다.\n\n[출력 형식]\n오직 아래의 JSON 포맷만 포함하는 코드 블록(\`\`\`json ... \`\`\`)을 출력하세요.\n\`\`\`json\n{\n  "title": "클릭을 유도하는 전문적이고 매력적인 SEO 최적화 제목",\n  "thumbnail_title": "CP 기술 리포트",\n  "mid_image_keyword": "A high-quality, ultra-realistic, photorealistic engineering photo of [SUBJECT] with detailed textures, professional lighting, industrial aesthetic, 8k resolution, NO TEXT",\n  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],\n  "html": "<h2>기술 분석 요약</h2><p>실제 현장에서 우리가 겪는 부식 문제는 생각보다...</p>[MID_IMAGE]<h3>현업 적용 가이드</h3><p>이론뿐만 아니라 실무적인 관점에서는...</p>"\n}\n\`\`\`\n\n지금 바로 JSON을 분석하고 생성해 주세요.`;

  await inputEl.click();
  const pasted = await page
    .evaluate((t) => navigator.clipboard.writeText(t).then(() => true).catch(() => false), prompt)
    .catch(() => false);
  if (pasted) {
    await page.keyboard.press('Control+v');
  } else {
    await page.keyboard.type(prompt, { delay: 5 });
  }
  await page.waitForTimeout(400);

  await submitGeminiPrompt(page, inputEl);
  onLog('[GEMINI] 프롬프트 전송 완료 — AI 응답 대기 중...');

  onStep('gemini-waiting');
  const settled = await waitForGeminiResponse(page, onLog);
  onLog(settled ? '[GEMINI] ✅ 응답 완료' : '[GEMINI] ⚠️ 응답 시간 초과 — 현재 결과로 진행');

  // JSON 파싱
  onStep('json-parse');
  onLog('[GEMINI] JSON 데이터 추출 중...');
  const parsed = await extractJsonFromPage(page, onLog);
  onLog(`[GEMINI] 제목: ${parsed.title}`);

  // 이미지 생성
  onStep('image-gen');
  const imageKeyword = parsed.mid_image_keyword || topic.slice(0, 60);
  const hasImage = await generateAndCaptureImage(page, imageKeyword, topic, onLog);

  if (!hasImage) {
    parsed.html = (parsed.html || '').replace('[MID_IMAGE]', '');
  }

  // Blogger 발행
  onStep('blogger-publish');
  const target = resolveBloggerTarget(category);
  onLog(`[Blogger] 카테고리 '${target.category}' → blogId ${target.blogId}`);

  let published;

  if (hasImage) {
    onLog('[Blogger] 이미지 포함 에디터 워커 발행 중...');
    published = await runBloggerEditorWorker({
      blogId: target.blogId,
      title: parsed.title,
      htmlContent: parsed.html,
      imagePath: GEMINI_IMAGE_PATH,
      labels: [...(parsed.tags || []), target.category],
    });
  } else {
    onLog('[Blogger] 에디터 워커 발행 중 (이미지 없음)...');
    published = await runBloggerEditorWorker({
      blogId: target.blogId,
      title: parsed.title,
      htmlContent: parsed.html,
      imagePath: null,
      labels: [...(parsed.tags || []), target.category],
    });
  }

  onStep('done');

  return {
    url: published?.url || published?.postUrl || '',
    postId: published?.postId || published?.id || '',
    title: parsed.title,
  };
}

module.exports = { runGeminiPost };
