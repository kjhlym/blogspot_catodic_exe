require('dotenv').config({ path: './.env.local' });

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createAndPublishPost, isBloggerApiConfigured } = require('./src/lib/blogger-api');
/**
 * CDP 단절 여부를 확인합니다.
 */
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

const { runBloggerEditorWorker } = require('./src/lib/blogger-worker-runner.js');
const { resolveBloggerTarget } = require('./src/lib/blogger-targets.js');

// --- 환경 설정 ---
const PROFILE_DIR = path.join(process.cwd(), 'playwright-profile-gemini-vibe');
const SS_DIR      = path.join(__dirname, 'e2e-screenshots');
const DOWNLOAD_PATH = 'C:\\Users\\kks\\Downloads';
const GEMINI_IMAGE_PATH = path.join(DOWNLOAD_PATH, 'gemini_image.jpg');
const ARTICLE_PATH = path.join(__dirname, 'article.txt');

const GOOGLE_ID = process.env.GOOGLE_GEMINI_ID?.replace(/^["']|["']$/g, '').trim();
const GOOGLE_PW = process.env.GOOGLE_GEMINI_PW?.replace(/^["']|["']$/g, '').trim();

if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

async function screenshot(page, name) {
  const fp = path.join(SS_DIR, `${String(Date.now()).slice(-6)}_${name}.png`);
  await page.screenshot({ path: fp, fullPage: true }).catch(() => {});
  console.log(`[SS] ${fp}`);
}

async function waitForGeminiResponse(page, timeoutMs = 120000) {
  const startedAt = Date.now();
  let idleStableCount = 0;

  while (Date.now() - startedAt < timeoutMs) {
    let status;
    try {
      status = await page.evaluate(() => {
        const text = document.body.innerText || '';
        
        // "지금 답변하기" 또는 "Answer now" 버튼이 있으면 클릭 시도
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], .action-button'));
        const answerNowBtn = buttons.find(b => {
          const t = (b.innerText || '').trim();
          return t.includes('지금 답변하기') || t.includes('Answer now') || t.includes('지금 응답하기');
        });
        
        if (answerNowBtn && answerNowBtn.offsetParent !== null) {
          answerNowBtn.click();
          return { isWorking: true, answerNowClicked: true };
        }

        const lastTurn =
          document.querySelector('message-turn:last-of-type') ||
          document.querySelector('model-response:last-of-type') ||
          document.querySelector('.model-response:last-of-type') ||
          document.querySelector('[role="log"] div:last-child') ||
          document.querySelector('.conversation-container .turn:last-child');

        const lastText = (lastTurn?.textContent || lastTurn?.innerText || '').trim();
        const hasJsonCandidate =
          (/```(?:json)?/i.test(lastText) && lastText.includes('}')) ||
          (/"title"\s*:/.test(lastText) && lastText.includes('"html"\s*:') && lastText.includes('}'));

        const isWorking =
          document.querySelectorAll('mat-progress-spinner, [aria-label*="로딩"], .loading-indicator, generate-image-progress, .prediction-streaming').length > 0 ||
          text.includes('생성 중...') ||
          text.includes('생성하는 중') ||
          text.includes('이미지 생성 중') ||
          document.querySelector('.prediction-streaming') !== null;

        return { hasJsonCandidate, hasResponseText: lastText.length > 100, isWorking };
      });
      
      if (status.answerNowClicked) {
        console.log("[GEMINI] '지금 답변하기' 버튼을 발견하여 클릭했습니다.");
        await page.waitForTimeout(3000);
        continue;
      }
    } catch (err) {
      if (isCdpDisconnectedError(err)) {
        console.error('[GEMINI] CDP 연결 단절 감지 - 브라우저가 예기치 않게 종료되었습니다.');
        throw err;
      }
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
        '.fluid-image-container img'
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

      const text = document.body.innerText || "";
      const denied =
        text.includes('도움을 드릴 수 없습니다') ||
        text.includes('I cannot create images') ||
        text.includes('제한된 내용') ||
        text.includes('정책상');

      const needsLogin = text.includes('로그인') || text.includes('Sign in') || !!document.querySelector('a[href*="ServiceLogin"]');

      return { found: false, denied, needsLogin };
    }).catch(() => ({ found: false, denied: false, needsLogin: false }));

    if (imageState.found || imageState.denied || imageState.needsLogin) return imageState;
    await page.waitForTimeout(2000);
  }

  return { found: false, denied: false };
}

async function submitGeminiPrompt(page, fallbackInput = null) {
  const sendSelectors = [
    'button[aria-label*="전송"]',
    'button[aria-label*="Send"]',
    'button.send-button',
    'button[data-test-id="send-button"]'
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

async function googleLogin(page, id, pw) {
  console.log(`[LOGIN] Google 로그인 로직 시작... (ID: ${id ? id.slice(0, 3) + '***' : '없음'})`);
  
  // 로그인 페이지로 강제 이동하여 세팅 (이미 로그인 페이지라면 생략)
  if (!page.url().includes('ServiceLogin')) {
    await page.goto('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await page.waitForTimeout(2000);

  const emailInput = page.locator('input[type="email"], input[name="identifier"], #identifierId');
  
  // 1. 계정 선택 화면 처리 ("계정을 선택하세요")
  const accountItem = page.locator(`div[role="link"]:has-text("${id}"), div[data-identifier="${id}"]`);
  if (await accountItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log("[LOGIN] 기존 계정 선택 중...");
    await accountItem.click();
  } else if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log("[LOGIN] 이메일 직접 입력 중...");
    await emailInput.fill(id);
    await page.click('button:has-text("다음"), button:has-text("Next"), #identifierNext');
  } else {
    console.log("[LOGIN] 이메일 입력창을 찾을 수 없습니다. 이미 로그인 상태인지 확인합니다.");
    return;
  }
  
  await page.waitForTimeout(3000);
  
  // 2. 비밀번호 입력
  const pwInput = page.locator('input[type="password"], input[name="Passwd"]');
  if (await pwInput.isVisible({ timeout: 10000 }).catch(() => false)) {
    console.log("[LOGIN] 비밀번호 입력 중...");
    await pwInput.fill(pw);
    await page.click('button:has-text("다음"), button:has-text("Next"), #passwordNext');
    console.log("[LOGIN] 로그인 제출 완료. 인증 후 리디렉션을 기다립니다.");
    await page.waitForTimeout(5000);

    // 3. 추가 인증/확인 화면 대응 (복구 이메일 확인, "나중에 하기" 등)
    try {
      // "복구 이메일 확인" 화면
      const recoveryEmailInput = page.locator('input[type="email"][name="knowledgePrereqResponse"], #knowledge-prereq-username-input');
      if (await recoveryEmailInput.isVisible({ timeout: 5000 })) {
        console.log("[LOGIN] 복구 이메일 확인이 필요합니다. 아이디(${id})를 다시 입력합니다.");
        await recoveryEmailInput.fill(id);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }

      // "계정 보호" 또는 "나중에 하기" 같은 버튼들
      const skipButtons = [
        'button:has-text("나중에 하기")',
        'button:has-text("Skip")',
        'button:has-text("Not now")',
        'button:has-text("Confirm")',
        'a:has-text("나중에 하기")',
        'div[role="button"]:has-text("Confirm")'
      ];
      for (const sel of skipButtons) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          console.log(`[LOGIN] 추가 확인 버튼(${sel}) 클릭 중...`);
          await btn.click();
          await page.waitForTimeout(2000);
        }
      }
    } catch (e) {
      console.log("[LOGIN] 추가 인증 단계 확인 중 시간 초과 (무시하고 진행)");
    }

    await page.waitForTimeout(3000); 
  }
  console.log('[LOGIN] ✅ Google 로그인 시도 완료');
}

async function ensureGeminiLoggedIn(page, shouldThrow = true) {
    const checkStatus = async () => {
        return await page.evaluate(() => {
            const profileSelectors = ['a[href*="SignOut"]', 'img[src*="googleusercontent.com/a/"]', '.gb_i', 'button[aria-label*="Google 계정"]', 'button[aria-label*="Google Account"]'];
            const hasProfile = profileSelectors.some(sel => !!document.querySelector(sel));
            const hasNewChat = document.body.innerText.includes('새 채팅') || document.body.innerText.includes('New chat') || !!document.querySelector('button[aria-label*="새 대화"]');
            return hasProfile || hasNewChat;
        });
    };

    const isCurrentlyOnApp = page.url().includes('gemini.google.com/app');
    console.log(`[GEMINI] 현재 URL: ${page.url()}, 앱 여부: ${isCurrentlyOnApp}`);
    const isLoginVisible = await page.evaluate(() => {
        const texts = ['로그인', 'Sign in'];
        const linksAndBtns = Array.from(document.querySelectorAll('a, button'));
        return linksAndBtns.some(el => texts.includes(el.innerText?.trim()) || (el.href && el.href.includes('ServiceLogin')));
    }).catch(() => false);
    console.log(`[GEMINI] 로그인 버튼 가시성: ${isLoginVisible}`);

    let loggedIn = await checkStatus();
    console.log(`[GEMINI] 로그인 상태 확인: ${loggedIn}`);
    
    if (!loggedIn || isLoginVisible) {
        console.log('[GEMINI] ⚠️ 로그인이 필요함을 감지했습니다.');
        const exactLoginBtn = page.locator('a.gb_Va.gb_Wd.gb_Od.gb_Ed.gb_H, a[href*="ServiceLogin"], button:has-text("로그인"), button:has-text("Sign in")').first();
        if (await exactLoginBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
            console.log('[GEMINI] 명시적 로그인 버튼 클릭 중...');
            await exactLoginBtn.click();
            await page.waitForTimeout(3000);
        }
        
        if (!process.env.GOOGLE_GEMINI_ID || !process.env.GOOGLE_GEMINI_PW) {
            throw new Error('구글 계정 정보(GOOGLE_GEMINI_ID/PW)가 환경변수에 없습니다.');
        }
        await googleLogin(page, process.env.GOOGLE_GEMINI_ID, process.env.GOOGLE_GEMINI_PW);
        
        // 로그인 완료 후, 앱 페이지가 아니면 이동
        if (!page.url().includes('gemini.google.com/app')) {
            await page.goto('https://gemini.google.com/app?hl=ko', { waitUntil: 'domcontentloaded', timeout: 60000 });
        }
        
        await page.waitForSelector('div[contenteditable="true"], div[role="textbox"], .ql-editor', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(5000);
        
        loggedIn = await checkStatus();
        if (!loggedIn) {
            console.log('[GEMINI] ⚠️ 로그인 확인 실패. 스크린샷 캡처 중...');
            await screenshot(page, 'gemini_login_failed');
        }
    }
    
    if (!loggedIn) {
        if (shouldThrow) throw new Error("Gemini 로그인 확인 실패");
        else {
            console.log("[GEMINI] ⚠️ 로그인 확인 실패했지만 소프트 핸들링으로 무시합니다.");
            return false;
        }
    }
    console.log('[GEMINI] ✅ 로그인 상태 확인 완료');
    return true;
}

async function interactWithGemini(context, topic) {
  const page = await context.newPage();
  console.log('[GEMINI] 새 페이지 생성 완료. gemini.google.com 접속 중...');
  
  // 네트워크 지연에 대비하여 재시도 로직 및 타임아웃 강화
  const maxRetries = 2;
  let success = false;
  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.goto('https://gemini.google.com/app?hl=ko', { 
        waitUntil: 'domcontentloaded', 
        timeout: 120000 // 120초로 확장
      });
      success = true;
      break;
    } catch (err) {
      console.warn(`[GEMINI] 접속 시도 ${i + 1} 실패: ${err.message}`);
      if (i === maxRetries - 1) throw err;
      await page.waitForTimeout(5000 * (i + 1));
    }
  }
  
  console.log('[GEMINI] 페이지 로드 완료. 대기 중...');
  await page.waitForTimeout(4000);

  console.log('[GEMINI] 로그인 체크 시작...');
  await ensureGeminiLoggedIn(page);

  // 글쓰기 창(Prompt box) 확인 - 여러 셀렉터 시도
  const inputSelectors = [
    'div.ql-editor.textarea.new-input-ui',
    'div[contenteditable="true"]',
    'div[role="textbox"]',
    '.ql-editor',
    'textarea[aria-label*="프롬프트"]'
  ];
  
  let inputEl = null;
  await page.waitForTimeout(3000);
  
  for (const sel of inputSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
          inputEl = el;
          break;
      }
  }

  if (!inputEl) throw new Error("Gemini 입력창을 찾을 수 없습니다. UI 구성을 확인하세요.");

    const prompt = `[검색 키워드 및 확인된 원본 소재]\n${topic}\n\n[목표]\n당신은 글로벌 전기방식(Cathodic Protection) 기술 및 검색엔진(SEO) 최적화 전문가입니다. \n구글 SEO 랭킹 1위를 달성할 수 있도록, 기계 번역투나 AI 특유의 딱딱한 문장을 철저히 배제하고 '현업 엔지니어가 직접 자신의 경험과 지식을 녹여서 쓴 듯한 자연스럽고 깊이 있는 문장'으로 블로그 포스팅을 작성하세요.\n\n[작성 가이드라인]\n1. **SEO 및 분량 최적화**: 구글 검색 노출에 최적화되도록 핵심 키워드를 자연스럽게 전진 배치하며, 전문가의 통찰이 담긴 충분한 정보량(공백 포함 2000자 이상)으로 아주 상세하게 풍성한 내용을 작성하세요.\n2. **페르소나 및 어조**: 10년 차 이상 수석 엔지니어가 노하우를 공유하듯, 확신에 차 있으면서도 가독성이 높은 자연스러운 어투를 사용하여 '진짜 사람이 쓴 글'처럼 다듬어주세요.\n3. **구조**: <h2>, <h3> 태그를 적극 사용하여 H 태그 계층구조를 체계적으로 구성하여 SEO 점수와 가독성을 높이세요.\n4. **원본 이미지 최우선 활용**: 검색된 원본 웹페이지에 설명 이미지가 있을 경우, 그 URL을 찾아 본문 적절한 위치에 \`<img src="URL" alt="[핵심 키워드가 포함된 이미지 설명]" style="max-width:100%; height:auto;" />\` 태그로 직접 삽입하세요.\n5. **AI 이미지 플레이스홀더 삽입**: 원본에서 유효한 이미지를 발견하지 못한 경우, 본론의 시각적 환기가 필요한 곳에 \`[MID_IMAGE]\` 플레이스홀더를 정확히 삽입하세요.\n6. **원본 소스 링크 제외**: 본문 하단 등에 원본 출처를 암시하는 어떠한 링크나 출처 표기도 추가하지 마세요.\n7. **전문적 수식 및 단위 작성**: 수학적 수식이나 물리 공식(예: Nernst 식, 전위차 계산 등)은 반드시 LaTeX 형식을 사용하여 전문적으로 작성하세요. **또한, $cm$, $\\rho$, $I$, $V_{off}$와 같은 모든 물리적 단위, 변수, 기호는 반드시 인라인 수식 \`$내용$\` 형식을 사용하여 작성하세요.** 블로그 렌더링을 위해 \`$$수식$$\` (블록 스타일) 또는 \`$수식$\` (인라인 스타일) 형식을 엄격히 준수하세요. 절대 \\\\( ... \\\\) 형식을 사용하지 마세요.\n   - **LaTeX 수식 보호**: JSON 출력 시 백슬래시(\\)가 유실되지 않도록 반드시 이중 백슬래시(\\\\)를 사용하세요 (예: \\\\\\\\frac, \\\\\\\\rho, \\\\\\\\sigma 등).\n   - **인라인 수식 예시**: $ \\\\\\\\frac{1}{2} $ \n   - **블록 수식 예시**: \`$$\\\\\\\\frac{-b \\\\\\\\pm \\\\\\\\sqrt{b^2-4ac}}{2a}$$\` 8. **태그 추출**: 포스팅 내용과 관련된 핵심 SEO 키워드 5~8개를 추출하여 'labels' 배열에 포함하세요.\n\n[출력 형식]\n오직 아래의 JSON 포맷만 포함하는 코드 블록(\`\`\`json ... \`\`\`)을 출력하세요. 어떤 부연 설명도 하지 마세요.\n- 'thumbnail_title': 핵심 키워드 중심의 클릭을 유도하는 짧은 문구 (띄어쓰기 포함 15자 내외)\n- 'mid_image_keyword': 이미지를 가져오지 못해 [MID_IMAGE]를 삽입한 경우 실사 이미지 생성용 영문 프롬프트. 자체 이미지 URL 삽입 시 빈 문자열("") 입력.\n- 'labels': SEO 태그 문자열 배열 (예: ["전기방식", "부식방지", "해양플랜트"])\n\n\`\`\`json\n{\n  "title": "클릭을 유도하는 전문적이고 매력적인 SEO 최적화 제목",\n  "thumbnail_title": "CP 기술 리포트",\n  "mid_image_keyword": "A high-quality realistic photo of industrial cathodic protection system on oil pipeline, professional engineering vibe",\n  "labels": ["태그1", "태그2", "태그3"],\n  "html": "<h2>기술 분석 요약</h2><p>실제 현장에서 우리가 겪는 부식 문제는 생각보다...</p>[MID_IMAGE]<h3>현업 적용 가이드</h3><p>이론뿐만 아니라 실무적인 관점에서는...</p>"\n}\n\`\`\`\n\n지금 바로 JSON을 분석하고 생성해 주세요.`;

  await inputEl.click();
  await page.evaluate((text) => navigator.clipboard.writeText(text), prompt).catch(() => {});
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);

  const initialSubmitMethod = await submitGeminiPrompt(page, inputEl);
  console.log(`[GEMINI] 프롬프트 전송 완료 (${initialSubmitMethod}). JSON 응답 대기 중...`);

  console.log("[GEMINI] AI 답변 완료까지 짧은 간격으로 확인 중...");
  const responseSettled = await waitForGeminiResponse(page);
  console.log(responseSettled ? '[GEMINI] 응답 완료 감지' : '[GEMINI] 응답 완료 대기 시간 초과, 현재 결과로 계속 진행');

  console.log("[GEMINI] JSON 데이터 추출 시도...");
  
  const result = await page.evaluate(() => {
    const selectors = [
      'message-turn:last-of-type',
      'model-response:last-of-type',
      '.model-response:last-child',
      '[role="log"] div:last-child',
      '.conversation-container .turn:last-child',
      '.markdown:last-child'
    ];
    
    let lastTurn = null;
    for (const s of selectors) {
      const elements = document.querySelectorAll(s);
      if (elements.length > 0) {
        lastTurn = elements[elements.length - 1];
        if ((lastTurn.textContent || lastTurn.innerText).trim().length > 10) break;
      }
    }

    // 만약 위 셀렉터로 못 찾으면 모든 대화 턴 중 마지막 것을 찾음
    if (!lastTurn) {
        const allMessages = document.querySelectorAll('message-turn, .model-response, .markdown');
        if (allMessages.length > 0) {
            lastTurn = allMessages[allMessages.length - 1];
        }
    }

    if (!lastTurn) return { text: document.body.innerText, codes: [] };

    const text = lastTurn.textContent || lastTurn.innerText || "";
    const codeBlocks = Array.from(lastTurn.querySelectorAll('pre, code, .code-block, .code-block-wrapper, [role="textbox"]'))
      .map(el => el.textContent || el.innerText || "");
    
    return { text, codes: codeBlocks };
  });

  console.log(`[GEMINI] 추출된 텍스트 길이: ${result.text.length}, 코드 블록 개수: ${result.codes.length}`);

  let jsonStr = "";
  for (const block of result.codes) {
    let cleanBlock = block.trim();
    // 마크다운 백틱 제거가 이미 되어 있을 수 있으므로 정규식으로 한번 더 정제
    cleanBlock = cleanBlock.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    
    if (cleanBlock.includes('"title"') && cleanBlock.includes('"html"')) {
      jsonStr = cleanBlock;
      break;
    }
  }

  if (!jsonStr) {
    // 텍스트 전체에서 가장 긴 JSON 형태의 블록을 찾음 (JSON 코드 블록이 아닌 텍스트에 포함된 경우 대비)
    const jsonContextMatch = result.text.match(/\{[\s\S]*?"title"[\s\S]*?"html"[\s\S]*?\}/g);
    if (jsonContextMatch) {
        // 가장 긴 매칭 결과 선택
        jsonStr = jsonContextMatch.sort((a, b) => b.length - a.length)[0].trim();
    } else {
        const anyJsonMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (anyJsonMatch) jsonStr = anyJsonMatch[1].trim();
    }
  }

  if (!jsonStr) {
    console.log("[GEMINI] AI 답변에서 JSON을 추출하지 못했습니다. (텍스트 일부: " + result.text.substring(0, 500) + "...)");
    await screenshot(page, 'json_extraction_fail');
    const html = await page.content();
    fs.writeFileSync('gemini_fail_debug.html', html);
    throw new Error("JSON 추출 실패");
  }


  function robustJsonParse(str) {
    let cleaned = str.trim();
    // 1. Markdown 코드 블록 기호 및 "JSON" 접두어 제거
    cleaned = cleaned.replace(/^JSON\s*/i, '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.log("[GEMINI] 표준 JSON 파싱 실패, 세밀한 세정 시도...");
      
      // 2. 제어 문자 제거 (공백 제외)
      cleaned = cleaned.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
      
      // 3. 따옴표 내부의 백슬래시 처리 (LaTeX 수식 보존 최우선)
      // JSON 문자열 내부의 \는 \\로 표현되어야 합니다. Gemini가 \frac 이라고 보내면 에러가 나므로 \\frac으로 바꿔야 하지만,
      // 이미 \\frac 인 것을 \\\frac으로 만들면 안 됩니다.
      cleaned = cleaned.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs, (match, p1) => {
        // 이미 적절히 이스케이프된 시퀀스(\", \\, \n, \r, \t, \/ 등)를 보호하고
        // 그 외의 단일 백슬래시만 찾아 이중으로 만듭니다.
        let fixed = p1;
        // 1단계: 기존의 유효한 이스케이프 보호 (토큰화)
        fixed = fixed.replace(/\\\\/g, "__DOUBLE_BS__")
                     .replace(/\\"/g, "__ESCAPED_QUOTE__");
        
        // 2단계: 남은 단일 백슬래시를 모두 이중화
        fixed = fixed.replace(/\\/g, "\\\\");
        
        // 3단계: 토큰 복원 (JSON 파싱을 위해 \\ 로 복원)
        fixed = fixed.replace(/__DOUBLE_BS__/g, "\\\\")
                     .replace(/__ESCAPED_QUOTE__/g, "\\\"");
        
        return `"${fixed}"`;
      });

      // 4. 마지막 쉼표 제거
      cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

      try {
        return JSON.parse(cleaned);
      } catch (e2) {
        console.error("[GEMINI] JSON 최종 파싱 실패:", e2.message);
        // 디버깅을 위해 실패한 문자열 저장
        fs.writeFileSync('json_fail_dump.txt', cleaned);
        throw e2;
      }
    }
  }

  const lastBrace = jsonStr.lastIndexOf('}');
  if (lastBrace !== -1) {
    jsonStr = jsonStr.substring(0, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = robustJsonParse(jsonStr);
  } catch (e) {
    console.log("원본 JSON String:", jsonStr);
    throw new Error(`JSON 파싱 결정적 실패: ${e.message}`);
  }

  const imageKeyword = parsed.mid_image_keyword || topic;
  console.log(`[GEMINI] '${imageKeyword}' 키워드로 이미지 생성 요청 중...`);

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
      'model-response img'
    ];
    for (const sel of imageSelectors) {
      try {
        const imgs = page.locator(sel);
        const count = await imgs.count();
        if (count > 0) {
          const lastImg = imgs.last();
          const isVisible = await lastImg.isVisible({ timeout: 2000 }).catch(() => false);
          if (isVisible) {
            const box = await lastImg.boundingBox();
            if (box && box.width > 50 && box.height > 50) return lastImg;
          }
        }
      } catch (e) {}
    }
    return null;
  };

  console.log("[GEMINI] 이미지 생성 대기 중 (최대 100초)...");
  let imgEl = null;
  let retryCount = 0;

  const requestImage = async (keyword) => {
    const selectors = [
      'div.ql-editor.textarea.new-input-ui',
      'div[data-placeholder*="Gemini"]',
      'div[aria-label*="Gemini"]',
      'div[role="textbox"][contenteditable="true"]',
      '.ql-editor'
    ];
    
    let targetInput = null;
    for (const sel of selectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`[GEMINI] 🎯 이미지 입력창 발견 (셀렉터: ${sel})`);
        targetInput = el;
        break;
      }
    }
    
    if (targetInput) {
      console.log(`[GEMINI] ⌨️ 이미지 생성 프롬프트 입력 중: ${keyword}`);
      await targetInput.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      const imagePrompt = `Imagine a high-quality realistic photo of ${keyword}. No text added to image.`;
      const pasted = await page.evaluate((text) => navigator.clipboard.writeText(text).then(() => true).catch(() => false), imagePrompt).catch(() => false);
      if (pasted) {
        await page.keyboard.press('Control+v');
      } else {
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
        await page.keyboard.type(imagePrompt, { delay: 20 });
      }
      const imageSubmitMethod = await submitGeminiPrompt(page, targetInput);
      console.log(`[GEMINI] 이미지 프롬프트 전송 완료 (${imageSubmitMethod})`);
    } else {
      console.log("[GEMINI] ⚠️ 이미지 생성 입력창을 찾을 수 없습니다. 전역 타이핑을 시도합니다.");
      await page.keyboard.press('Escape');
      const imagePrompt = `Imagine a high-quality realistic photo of ${keyword}.`;
      await page.keyboard.type(imagePrompt);
      const imageSubmitMethod = await submitGeminiPrompt(page);
      console.log(`[GEMINI] 이미지 프롬프트 전송 완료 (${imageSubmitMethod})`);
    }
  };

  await ensureGeminiLoggedIn(page);
  await requestImage(imageKeyword);

  while (retryCount <= 2) {
    const imageState = await waitForGeneratedImage(page);
    
    if (imageState.needsLogin) {
      console.log("[GEMINI] ⚠️ 이미지 생성 중 세션 만료 감지 (로그인 필요). 재로그인 시도...");
      await ensureGeminiLoggedIn(page, false);
      await requestImage(imageKeyword);
      retryCount++;
      continue;
    }

    imgEl = imageState.found ? await findImage() : null;

    if (imgEl) {
      console.log("[GEMINI] ✨ 이미지 요소 발견!");
      break;
    }

    if (imageState.denied && retryCount === 0) {
      console.log("[GEMINI] ⚠️ 이미지 생성이 거부됨. 다른 키워드로 재시도 중...");
      retryCount++;
      const fallbackKeyword = topic.slice(0, 30);
      await requestImage(fallbackKeyword);
      continue;
    }

    if (imageState.denied) {
      console.log("[GEMINI] ❌ 이미지 생성 재시도도 실패하였습니다.");
    }

    break;
  }

  let imageFound = false;
  if (imgEl) {
    console.log("[GEMINI] 생성된 이미지 캡처 중...");
    imageFound = true;
    if (fs.existsSync(GEMINI_IMAGE_PATH)) fs.unlinkSync(GEMINI_IMAGE_PATH);
    
    try {
      await imgEl.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await imgEl.screenshot({ path: GEMINI_IMAGE_PATH, type: 'jpeg', quality: 95 });
      console.log(`[GEMINI] 🖼️ 이미지 저장 완료: ${GEMINI_IMAGE_PATH}`);
      await screenshot(page, 'gemini_final_image_confirmed');
    } catch (e) {
      console.error("[GEMINI] 이미지 캡처 도중 오류 발생:", e.message);
      imageFound = false;
    }
  } else {
    console.log("[GEMINI] ⚠️ 최종적으로 이미지를 찾지 못했습니다. 텍스트만 발행합니다.");
    await screenshot(page, 'gemini_image_not_found');
  }

  await page.close();
  return { content: parsed, hasImage: imageFound };
}

(async () => {
  try {
    let topic = "";
    let category = "cathodicProtection"; // 기본 카테고리
    if (fs.existsSync(ARTICLE_PATH)) {
      const content = fs.readFileSync(ARTICLE_PATH, 'utf-8').trim();
      
      // 서버측 route.ts에서 작성하는 형식 파싱 (Keyword: ..., Topic: ..., Summary: ...)
      const lines = content.split('\n');
      const data = {};
      lines.forEach(line => {
        const [key, ...val] = line.split(':');
        if (key && val.length > 0) {
          data[key.trim().toLowerCase()] = val.join(':').trim();
        }
      });

      if (data.keyword || data.topic) {
        // 구조화된 데이터가 있는 경우
        topic = `키워드: ${data.keyword || '없음'}\n주제: ${data.topic || '없음'}\n요약: ${data.summary || '없음'}`;
        console.log(`[시작] 구조화된 소재 데이터 확인 (키워드: ${data.keyword})`);
      } else {
        // [카테고리] 형식이 있는 레거시 대응
        const categoryMatch = content.match(/\[카테고리\]:\s*(.+)/);
        if (categoryMatch?.[1]) {
          category = categoryMatch[1].trim();
          topic = content.replace(categoryMatch[0], '').trim();
        } else {
          topic = content;
        }
      }
      
      console.log(`[시작] article.txt 로드 완료 (카테고리: ${category}, 주제 길이: ${topic.length}자)`);
    } else {
      console.error(`[오류] ${ARTICLE_PATH} 파일이 없습니다. 큐레이션 페이지에서 발행을 먼저 눌러주세요.`);
      process.exit(1);
    }

    console.log(`\n================================`);
    console.log(`[시작] 주제: ${topic.slice(0, 50)}...`);
    console.log(`================================`);
    // 사용자 요청에 따라 보안 이슈 해결을 위해 헤드리스 모드를 제거하고 항상 헤디드(Headed) 모드로 실행합니다.
    const isHeadless = false; 
    console.log(`[Main] 브라우저 모드: Headed (화면 표시) - 보안 및 이미지 생성 안정성 확보`);

    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: isHeadless,
      viewport: { width: 1280, height: 900 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars'
      ],
      permissions: ['clipboard-read', 'clipboard-write']
    });

    const { content, hasImage } = await interactWithGemini(context, topic);
    console.log(`[Main] 생성 결과 확인 - 제목: ${content.title}`);

    if (!hasImage) {
        content.html = content.html.replace('[MID_IMAGE]', '');
    }

    const target = resolveBloggerTarget(category);
    const resolvedBlogId = target.blogId;
    console.log(`[Main] 카테고리 '${target.category}' -> blogKey '${target.blogKey}' -> blogId ${resolvedBlogId}`);

    await context.close();

    let published;
    console.log(`\n[Worker] Blogger 에디터 워커 실행 시도 (이미지: ${hasImage ? '있음' : '없음'})...`);
    const finalLabels = Array.isArray(content.labels) && content.labels.length > 0 
      ? [...new Set([...content.labels, target.category])]
      : [target.category];

    published = await runBloggerEditorWorker({
      blogId: resolvedBlogId,
      title: content.title,
      htmlContent: content.html,
      imagePath: hasImage ? GEMINI_IMAGE_PATH : null,
      labels: finalLabels
    });
    console.log(`[Worker] 발행 완료 - postId: ${published?.postId || 'unknown'} / url: ${published?.url || 'unknown'}`);

    console.log(`[PublishResult] ${JSON.stringify({ blogId: resolvedBlogId, postId: published?.postId || published?.id, url: published?.url || '', title: content.title })}`);

    console.log("\n[Main] 🎉 완료!");
  } catch (error) {
    console.error("\n[Main] ❌ 치명적 오류:", error.message);
  }
})();





