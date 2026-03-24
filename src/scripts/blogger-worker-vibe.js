/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

/**
 * CDP 단절 에러 여부를 판별합니다.
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

const TITLE_SELECTORS = [
  'input[aria-label="제목"]',
  'input[placeholder="제목"]',
  'input[aria-label="Title"]',
  'input[placeholder="Title"]',
  'input[name="title"]',
  'input[name="Title"]',
  'input.title',
  // 새 Blogger 에디터 (contenteditable)
  'h3[contenteditable="true"]',
  'div[contenteditable="true"][aria-label*="제목"]',
  'div[contenteditable="true"][aria-label*="Title"]',
  '[data-field-id="post-title"]',
  '[data-placeholder*="제목"]',
  '[data-placeholder*="Title"]',
].join(', ');

const PUBLISH_SELECTORS = [
  'div[aria-label="게시"][role="button"]',
  'div[aria-label="Publish"][role="button"]',
  'button[aria-label="게시"]',
  'button[aria-label="Publish"]',
  'button:has-text("게시")',
  'button:has-text("Publish")',
  'div[role="button"]:has-text("게시")',
  'div[role="button"]:has-text("Publish")'
];
const UPDATE_SELECTORS = [
  'div[aria-label="업데이트"][role="button"]',
  'div[aria-label="Update"][role="button"]',
  'button[aria-label="업데이트"]',
  'button[aria-label="Update"]',
  'button:has-text("업데이트")',
  'button:has-text("Update")',
  'div[role="button"]:has-text("업데이트")',
  'div[role="button"]:has-text("Update")'
];
const CONFIRM_SELECTORS = [
  'div[aria-label="확인"][role="button"]',
  'div[aria-label="Confirm"][role="button"]',
  'button:has-text("확인")',
  'button:has-text("Confirm")',
  'div[role="button"]:has-text("확인")',
  'div[role="button"]:has-text("Confirm")'
];
const POST_ID_PATTERN = /\/blog\/post\/edit\/\d+\/(\d+)/i;

function ensureArtifactDir() {
  const dir = path.join(process.cwd(), "output", "playwright");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stripImageMarkers(htmlContent) {
  return String(htmlContent || "").replace(/\[MID_IMAGE\]|\[MIDDLE_IMAGE\]/gi, "");
}

function stripExistingInlineDataImages(htmlContent) {
  return String(htmlContent || "")
    .replace(/<div[^>]*>\s*<img[^>]+src=["']data:image[^"']+["'][^>]*>\s*<\/div>/gi, "")
    .replace(/<img[^>]+src=["']data:image[^"']+["'][^>]*>/gi, "");
}

function buildInlineImageHtml(imagePath) {
  const ext = path.extname(String(imagePath || "")).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";
  const imageBase64 = fs.readFileSync(imagePath).toString("base64");
  // '매우 크게'를 실현하기 위해 width: 100%, max-width: none을 사용합니다.
  return `<div style="text-align:center; padding:20px 0;"><img src="data:${mime};base64,${imageBase64}" alt="본문 이미지" style="width:100%; max-width:none; height:auto; display:block; margin:0 auto;" /></div>`;
}

function wrapWithMathJax(html) {
  const mathJaxHeader = `
<script>
window.MathJax = {
  tex: {
    inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
    displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]
  },
  options: {
    skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
  }
};
</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
`;
  const content = String(html || "");
  if (content.includes("MathJax-script")) return content;
  return (mathJaxHeader.trim() + "\n" + content).trim();
}

function buildContentWithMidImage(htmlContent, imagePath) {
  // 인라인 수석 $cm$ 등이 HTML escape되지 않도록 보장
  const cleanedHtml = stripExistingInlineDataImages(String(htmlContent || ""));
  let combined;

  if (!imagePath || !fs.existsSync(imagePath)) {
    combined = stripImageMarkers(cleanedHtml).trim();
  } else {
    const inlineImageHtml = buildInlineImageHtml(imagePath);
    if (/\[MID_IMAGE\]|\[MIDDLE_IMAGE\]/i.test(cleanedHtml)) {
      let inserted = false;
      combined = cleanedHtml
        .replace(/\[MID_IMAGE\]|\[MIDDLE_IMAGE\]/gi, () => {
          if (inserted) return "";
          inserted = true;
          return inlineImageHtml;
        })
        .trim();
    } else {
      const withoutMarkers = stripImageMarkers(cleanedHtml).trim();
      combined = withoutMarkers ? `${inlineImageHtml}\n${withoutMarkers}` : inlineImageHtml;
    }
  }

  return wrapWithMathJax(combined);
}

function extractPostId(url) {
  const match = String(url || "").match(POST_ID_PATTERN);
  return match ? match[1] : "";
}

async function clickFirstVisible(page, selectors, timeout = 800) {
  for (const sel of selectors) {
    const items = page.locator(sel);
    const count = await items.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      if (await item.isVisible({ timeout }).catch(() => false)) {
        await item.click({ force: true });
        return true;
      }
    }
  }
  return false;
}

async function findVisibleBodyTextarea(page) {
  const list = page.locator("textarea");
  const count = await list.count().catch(() => 0);
  let fallback = null;
  let fallbackArea = -1;

  for (let i = 0; i < count; i++) {
    const ta = list.nth(i);
    const meta = await ta.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return {
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
        width: rect.width,
        height: rect.height,
        left: rect.left,
        ariaLabel: node.getAttribute("aria-label") || "",
        placeholder: node.getAttribute("placeholder") || ""
      };
    }).catch(() => null);

    if (!meta?.visible) {
      continue;
    }

    const area = meta.width * meta.height;
    const labelHint = `${meta.ariaLabel} ${meta.placeholder}`.toLowerCase();
    
    // 메인 에디터 판단: HTML 편집 모드일 때 보통 "HTML"이라는 단어가 라벨에 포함되거나, 크기가 매우 크고 왼쪽/중앙에 위치함.
    const isMainEditorHint = labelHint.includes("html") || labelHint.includes("편집") || labelHint.includes("editor");
    
    // 사이드바 판단: 너비가 좁거나(라벨 창), 우측에 치우쳐 있거나, "라벨/label/쉼표" 단어가 포함된 경우
    const looksSidebarField =
      /쉼표|라벨|label|tags|태그/.test(labelHint) || meta.left > 800 || meta.width < 500 || meta.height < 150;

    console.log(`[Worker] Textarea 점검: label="${meta.ariaLabel}", placeholder="${meta.placeholder}", pos=(${meta.left},${meta.width}x${meta.height}), isMainHint=${isMainEditorHint}, looksSidebar=${looksSidebarField}`);

    // 만약 메인 에디터 힌트가 있고 사이드바가 아니라면 즉시 반환
    if (isMainEditorHint && !looksSidebarField) {
      console.log(`[Worker] ✅ 메인 본문 에디터를 발견했습니다 (Hint 기반).`);
      return ta;
    }

    if (area > fallbackArea) {
      fallbackArea = area;
      fallback = ta;
    }

    if (!looksSidebarField && area > 50000) { // 최소 면적 기준 추가 (큰 영역인 경우)
      return ta;
    }
  }

  if (fallback) {
    console.log(`[Worker] ⚠️ 명확한 에디터를 찾지 못해 가장 큰 영역을 선택합니다.`);
  }
  return fallback;
}

async function waitVisibleBodyTextarea(page, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const textarea = await findVisibleBodyTextarea(page);
    if (textarea) {
      return textarea;
    }
    await page.waitForTimeout(400);
  }
  return null;
}

async function waitVisibleTitleInput(page, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = page.locator(TITLE_SELECTORS);
    const count = await list.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
        const input = list.nth(i);
        if (await input.isVisible({ timeout: 500 }).catch(() => false)) {
          return input;
        }
    }
    await page.waitForTimeout(400);
  }
  return null;
}

async function waitForPostId(page, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const postId = extractPostId(page.url());
    if (postId) return postId;
    await page.waitForTimeout(500);
  }
  return "";
}

async function verifyPostPublishedInList(page, blogId, title) {
  await page.goto(`https://www.blogger.com/blog/posts/${blogId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  return await page.evaluate((targetTitle) => {
    const pageText = (document.body.innerText || "").replace(/\s+/g, " ").trim();
    if (!pageText.includes(targetTitle)) return false;
    if (pageText.includes("임시저장") || pageText.includes("Draft")) return false;
    return pageText.includes("게시됨") || pageText.includes("Published") || pageText.includes("게시");
  }, title);
}

async function waitForPendingBase64Upload(page, timeoutMs = 60000) {
  const pendingPhrases = [
    "base64 이미지 업로드 중",
    "이미지 업로드 중",
    "업로드가 완료될 때까지 게시물 콘텐츠를 변경할 수 없습니다.",
    "Uploading image",
    "upload in progress",
    "You can't modify post content until upload is complete."
  ];
  const savingPhrases = ["저장 중", "Saving", "변경사항 저장 중"];
  const settledPhrases = ["저장됨", "All changes saved", "Saved", "저장 완료"];
  const startedAt = Date.now();
  let pendingSeen = false;

  console.log("[Worker] 변경사항 저장 및 업로드 상태 대기 중...");

  while (Date.now() - startedAt < timeoutMs) {
    const state = await page.evaluate(({ pending, saving, settled }) => {
      const text = document.body?.innerText || "";
      const isPending = pending.some((phrase) => text.includes(phrase));
      const isSaving = saving.some((phrase) => text.includes(phrase));
      const isSettled = settled.some((phrase) => text.includes(phrase));
      
      // 클라우드 아이콘 aria-label 확인
      const cloudIcon = document.querySelector('div[aria-label*="저장"], div[aria-label*="Save"], div[aria-label*="변경사항"]');
      const cloudLabel = cloudIcon ? cloudIcon.getAttribute("aria-label") : "";
      const isCloudSettled = cloudLabel.includes("저장됨") || cloudLabel.includes("saved");

      return {
        hasPendingUpload: isPending,
        hasSavingToast: isSaving,
        isSettled: isSettled || isCloudSettled
      };
    }, { pending: pendingPhrases, saving: savingPhrases, settled: settledPhrases }).catch(() => ({
      hasPendingUpload: false,
      hasSavingToast: false,
      isSettled: false
    }));

    if (state.hasPendingUpload || state.hasSavingToast) {
      pendingSeen = true;
      await page.waitForTimeout(1000);
      continue;
    }

    // 만약 한 번이라도 pending/saving을 봤다면, 이제 settled 상태면 종료
    if (pendingSeen && state.isSettled) {
      console.log("[Worker] ✅ 모든 변경사항이 저장되었습니다.");
      return true;
    }

    // 만약 5초 동안 아무런 pending/saving이 안 보이고 isSettled면 저장된 것으로 간주
    if (!pendingSeen && state.isSettled && (Date.now() - startedAt > 5000)) {
      return true;
    }

    await page.waitForTimeout(1000);
  }

  return true;
}

async function switchEditorMode(page, targetMode) {
  const toggleSelectors = [
    'div[role="listbox"][aria-label="보기 전환"]',
    'div[role="listbox"][aria-label="View"]',
    'div[aria-label="글쓰기 보기"]',
    'div[aria-label="Compose view"]',
    'div[aria-label="보기 전환"]',
    'div[aria-label="View"]',
    'div.MWQFLe.uLX2p'
  ];

  const htmlMenuSelectors = [
    'div[role="option"]:has-text("HTML 보기")',
    'div[role="option"]:has-text("HTML view")',
    'div[role="menuitem"]:has-text("HTML")',
    'span.vRMGwf.oJeWuf:has-text("HTML 보기")',
    'span:has-text("HTML view")'
  ];

  const composeMenuSelectors = [
    'div[role="option"]:has-text("새 글 작성 보기")',
    'div[role="option"]:has-text("Compose view")',
    'div[role="menuitem"]:has-text("작성")',
    'div[role="menuitem"]:has-text("Compose")',
    'span.vRMGwf.oJeWuf:has-text("작성")',
    'span:has-text("Compose view")'
  ];

  for (const sel of toggleSelectors) {
    const toggles = page.locator(sel);
    const count = await toggles.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const toggle = toggles.nth(i);
      if (await toggle.isVisible({ timeout: 700 }).catch(() => false)) {
        await toggle.click({ force: true });
        await page.waitForTimeout(900);
        const ok = await clickFirstVisible(
          page,
          targetMode === "html" ? htmlMenuSelectors : composeMenuSelectors,
          1000
        );
        if (ok) {
          await page.waitForTimeout(1500);
          if (targetMode === "html") {
             // 텍스트 영역을 찾을 때까지 대기
             const textarea = await waitVisibleBodyTextarea(page, 15000);
             return Boolean(textarea);
          }
          return true;
        }
      }
    }
  }
  return false;
}

async function ensureLoggedIn(page, { email, password, targetUrl }) {
  console.log("[Worker] 로그인 상태 확인...");
  const emailInput = page.locator('input[type="email"], input[name="identifier"], #identifierId');
  const isLoginRequired =
    page.url().includes("accounts.google.com") ||
    (await emailInput.isVisible({ timeout: 5000 }).catch(() => false));

  if (!isLoginRequired) {
    console.log("[Worker] 이미 로그인된 상태입니다.");
    return;
  }

  console.log("[Worker] 로그인이 필요합니다.");
  const accountItem = page.locator(`div[role="link"]:has-text("${email}"), div[data-identifier="${email}"]`);
  if (await accountItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    await accountItem.click();
  } else if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailInput.fill(email || "");
    await page.click('button:has-text("다음"), button:has-text("Next"), #identifierNext');
  }

  await page.waitForTimeout(3000);
  const pwInput = page.locator('input[type="password"], input[name="Passwd"]');
  if (await pwInput.isVisible({ timeout: 10000 }).catch(() => false)) {
    await pwInput.fill(password || "");
    await page.click('button:has-text("다음"), button:has-text("Next"), #passwordNext');
    await page.waitForTimeout(5000);
  }

  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

async function openEditor(page, { blogId, postId }) {
  if (postId) {
    const editUrl = `https://www.blogger.com/blog/post/edit/${blogId}/${postId}`;
    await page.goto(editUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    return editUrl;
  }
  const postsUrl = `https://www.blogger.com/blog/posts/${blogId}`;
  await page.goto(postsUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const selectors = ['[jsname="UOx8F"]', '[aria-label="새 글 작성"]', 'a[href*="post-create"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return; }
    }
  });
  await page.waitForURL(/\/post\/(edit|create)/i, { timeout: 15000 }).catch(() => {});
  return page.url();
}

async function setTitle(page, title) {
  const titleEl = await waitVisibleTitleInput(page, 30000);
  if (!titleEl) throw new Error("제목 입력창을 찾지 못했습니다.");
  await titleEl.click({ force: true });
  await titleEl.fill(title);
}

async function setHtmlContent(page, htmlContent) {
  const textarea = await waitVisibleBodyTextarea(page, 30000);
  if (!textarea) throw new Error("본문용 HTML textarea를 찾지 못했습니다.");
  
  console.log("[Worker] HTML 에디터에 내용 입력 중...");
  await textarea.click({ force: true });
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  
  // 대량의 HTML을 입력할 때는 evaluate와 함께 input 이벤트를 정확히 발생시켜야 함
  await textarea.evaluate((target, html) => {
    target.value = html;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.dispatchEvent(new Event("blur", { bubbles: true }));
  }, htmlContent);

  // 추가적으로 키 입력을 시뮬레이션하여 Blogger의 내부 상태 동기화 유도
  await textarea.click({ force: true });
  await page.keyboard.press("End");
  await page.keyboard.insertText(" ");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(500);
}

async function setLabels(page, labels) {
  if (!labels || labels.length === 0) return;
  const labelsText = labels.join(", ");
  const labelsSelectors = [
    'textarea[aria-label="라벨"]',
    'textarea[aria-label="Labels"]',
    'textarea[placeholder*="라벨"]',
    'textarea[placeholder*="Labels"]',
    'input[aria-label*="라벨"]',
    'input[aria-label*="Labels"]',
  ];

  // 사이드바 설정 영역이 닫혀있을 수 있으므로 "설정" 버튼 클릭 시도 (필요한 경우)
  const settingsToggle = page.locator('div[role="button"][aria-label="설정"], div[role="button"][aria-label="Settings"]').first();
  if (await settingsToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
    // 이미 열려있는지 확인하는 로직이 복잡할 수 있으므로 안전하게 클릭 시도
    // (Blogger UI 특성상 열려있을 때 누르면 닫히므로 주의가 필요하지만, 보통 라벨 textarea가 안 보이면 닫힌 것)
  }

  let labelsInput = null;
  for (const sel of labelsSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      labelsInput = el;
      break;
    }
  }

  if (labelsInput) {
    await labelsInput.click({ force: true });
    await labelsInput.fill(labelsText);
    await page.keyboard.press("Enter");
    console.log(`[Worker] 라벨 입력 완료: ${labelsText}`);
  } else {
    console.log("[Worker] ⚠️ 라벨 입력창을 찾을 수 없습니다.");
  }
}

async function commitPost(page, { blogId, title, isExistingPost }) {
  const actionSelectors = isExistingPost ? UPDATE_SELECTORS : PUBLISH_SELECTORS;
  await clickFirstVisible(page, actionSelectors, 1200);
  await page.waitForTimeout(1800);
  await clickFirstVisible(page, CONFIRM_SELECTORS, 1000);
  await page.waitForTimeout(isExistingPost ? 4000 : 6000);
}

async function runBloggerEditorWorker(data) {
  const { email, password, blogId, title, htmlContent, imagePath, postId, publish = true, onLog = console.log } = data;
  const finalHtml = buildContentWithMidImage(htmlContent, imagePath);
  const artifactDir = ensureArtifactDir();
  const userDataDir = path.join(process.cwd(), "playwright-profile-blogger");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // 사용자 요청에 따라 헤드리스 모드 비활성화
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const page = await context.newPage();
  const imageStrategy = imagePath && fs.existsSync(imagePath) ? "inline-base64" : "none";
  let resolvedPostId = String(postId || "");
  let base64UploadObserved = false;

  try {
    const targetUrl = postId
      ? `https://www.blogger.com/blog/post/edit/${blogId}/${postId}`
      : `https://www.blogger.com/blog/posts/${blogId}`;

    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await ensureLoggedIn(page, { email, password, targetUrl });
    await openEditor(page, { blogId, postId });
    if (title) {
      await setTitle(page, title);
      await page.screenshot({ path: path.join(artifactDir, "step_1_title_set.png") });
    }
    if (htmlContent) {
      console.log("[Worker] HTML 보기 모드 전환 시도...");
      const swOk = await switchEditorMode(page, "html");
      if (!swOk) {
        console.warn("[Worker] ⚠️ 'HTML 보기' 전환 실패 가능성. 현재 화면 기반으로 진행 중...");
      }
      
      await setHtmlContent(page, finalHtml);
      await page.screenshot({ path: path.join(artifactDir, "step_2_html_set.png") });

      // [핵심] HTML 모드에서 저장 완료 확인 후 모드 전환
      console.log("[Worker] HTML 모드에서 변경사항 저장 대기...");
      await page.keyboard.press("Control+S");
      await waitForPendingBase64Upload(page, 20000);

      console.log("[Worker] 새 글 작성(Compose) 보기 모드 전환 시도...");
      const modeOk = await switchEditorMode(page, "compose");
      if (!modeOk) {
        console.warn("[Worker] ⚠️ '새 글 작성 보기' 전환 실패 가능성.");
      }
      
      await page.waitForTimeout(2000); // 전환 후 안정화 시간
      await page.screenshot({ path: path.join(artifactDir, "step_3_compose_set.png") });

      // 다시 한번 저장 및 업로드 완료 대기 (이미지 렌더링 등)
      console.log("[Worker] 최종 저장 및 업로드 상태 대기...");
      await waitForPendingBase64Upload(page, 30000);
    }
    // 라벨(태그) 설정 추가
    if (data.labels && data.labels.length > 0) {
      await setLabels(page, data.labels);
    }
    if (publish) {
      console.log("[Worker] 게시(Publish) 시도 중...");
      await commitPost(page, { blogId, title, isExistingPost: Boolean(postId) });
      console.log("[Worker] 게시 완료 확약...");
      await page.screenshot({ path: path.join(artifactDir, "step_4_published.png") });
    }
    resolvedPostId = resolvedPostId || extractPostId(page.url()) || (await waitForPostId(page, 5000));
    await page.screenshot({ path: path.join(artifactDir, "blogger-worker-success.png"), fullPage: true });
    return { success: true, postId: resolvedPostId, base64UploadObserved };
  } catch (err) {
    onLog("[Error] " + err.message);
    await page.screenshot({ path: path.join(artifactDir, "blogger-worker-error.png"), fullPage: true }).catch(() => {});
    throw err;
  } finally {
    await context.close();
  }
}

async function run() {
  const dataPath = process.argv.slice(2)[0];
  if (!dataPath) { console.error("No data path provided."); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  await runBloggerEditorWorker(data).then(res => {
    console.log(`[WorkerResult] ${JSON.stringify(res)}`);
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runBloggerEditorWorker };

if (require.main === module) {
  run();
}
