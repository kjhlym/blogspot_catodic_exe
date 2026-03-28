import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { Notifier } from './notifier';

export interface BloggerJobData {
  email?: string;
  password?: string;
  blogId: string;
  title?: string;
  htmlContent?: string;
  imagePath?: string;
  postId?: string;
  publish?: boolean;
  labels?: string[];
  // 자동 생성용 필드
  topic?: string;
  keyword?: string;
  category?: string;
  summary?: string;
  link?: string;
  headless?: boolean;
}

const TITLE_SELECTORS = [
  'input[aria-label="제목"]',
  'input[placeholder="제목"]',
  'input[aria-label="Title"]',
  'input[placeholder="Title"]',
  'input[name="title"]',
  'input[name="Title"]',
  'input.title',
  'h3[contenteditable="true"]',
  'div[contenteditable="true"][aria-label*="제목"]',
  'div[contenteditable="true"][aria-label*="Title"]',
  '[data-field-id="post-title"]',
  '[data-placeholder*="제목"]',
  '[data-placeholder*="Title"]',
].join(', ');

export class BloggerBot {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private options: { headless?: boolean; slowMo?: number };

  constructor(options: { headless?: boolean; slowMo?: number } = {}) {
    this.options = options;
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }

  async execute(data: BloggerJobData, jobId: string) {
    const { email, password, blogId, title, htmlContent, imagePath, postId, publish = true } = data;
    const userDataDir = path.join(process.cwd(), 'playwright-profile-blogger');
    
    if (!this.context) {
      this.context = await chromium.launchPersistentContext(userDataDir, {
        headless: this.options.headless ?? false,
        slowMo: this.options.slowMo ?? 0,
        viewport: { width: 1280, height: 900 },
        args: ['--disable-blink-features=AutomationControlled'],
      });
    }

    this.page = await this.context.newPage();
    const page = this.page;

    try {
      if (!title || !htmlContent) {
        throw new Error('포스팅을 위한 제목(title) 또는 본문(htmlContent)이 누락되었습니다.');
      }

      await Notifier.logStep(jobId, 'START', `Blogger 작업 시작: ${title}`);
      
      const targetUrl = postId
        ? `https://www.blogger.com/blog/post/edit/${blogId}/${postId}`
        : `https://www.blogger.com/blog/posts/${blogId}`;
      
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000); 
      await this.ensureLoggedIn(page, email, password, targetUrl);
      
      await this.openEditor(page, blogId, postId);
      await this.takeStepScreenshot(jobId, '01_editor_opened');

      await this.setTitle(page, title);
      await this.takeStepScreenshot(jobId, '02_title_set');

      // 본문 구성 (이미지 삽입 + MathJax 래핑)
      const finalHtml = this.buildFinalHtml(htmlContent, imagePath);

      await Notifier.logStep(jobId, 'HTML_MODE', 'HTML 보기 모드 전환 중...');
      const swOk = await this.switchEditorMode("HTML");
      if (!swOk) throw new Error("에디터 모드 전환 실패 (HTML)");
      await this.takeStepScreenshot(jobId, '03_html_mode');
      
      await Notifier.logStep(jobId, 'CONTENT', '본문 주입 중...');
      await this.setHtmlContent(finalHtml);
      await this.takeStepScreenshot(jobId, '04_content_injected');

      await Notifier.logStep(jobId, 'SAVE', '변경사항 저장 중...');
      await this.forceSave(page);
      await this.waitForSaved(page, 30000);
      await this.takeStepScreenshot(jobId, '05_after_save');

      await Notifier.logStep(jobId, 'COMPOSE_MODE', '작성 보기 모드 전환 중...');
      await this.switchEditorMode("COMPOSE");
      await page.waitForTimeout(3000);
      await this.takeStepScreenshot(jobId, '06_compose_mode_check');

      // 본문 유실 여부 확인
      const bodyText = await page.evaluate(() => {
        const editor = document.querySelector('div[role="textbox"][aria-label="게시물 본문"]') as HTMLElement;
        return editor ? editor.innerText.trim() : "";
      });
      if (!bodyText && !finalHtml.includes("<img")) {
         console.warn("[BloggerBot] 작성 모드 전환 후 본문이 비어 있는 것으로 보입니다. 재시도 중...");
      }

      if (publish) {
        if (data.labels && data.labels.length > 0) {
          await Notifier.logStep(jobId, 'LABEL', '레이블(태그) 입력 중...');
          await this.setLabels(data.labels);
          await this.takeStepScreenshot(jobId, '07_labels_set');
        }

        await Notifier.logStep(jobId, 'PUBLISH', '게시/업데이트 버튼 클릭 중...');
        await this.commitPost(jobId);
      }

      let publicUrl = page.url();
      try {
        await Notifier.logStep(jobId, 'VERIFY_URL', '실제 포스트 URL 추출 중...');
        await page.waitForTimeout(3000);
        const viewLinkSelector = 'a[aria-label="보기"], a[aria-label="View"], a[data-tooltip="보기"], a[data-tooltip="View"]';
        const viewLink = page.locator(viewLinkSelector).first();
        if (await viewLink.isVisible({ timeout: 5000 })) {
          const href = await viewLink.getAttribute('href');
          if (href) publicUrl = href;
        }
      } catch (e: any) {
        console.warn(`[BloggerBot] 실제 URL 추출 실패:`, e.message);
      }

      await this.takeStepScreenshot(jobId, '09_final_result');
      await Notifier.logStep(jobId, 'SUCCESS', '작업 완료');
      await Notifier.sendDiscord(`Blogger 포스팅 성공: **${title}**\n최종 URL: ${publicUrl}`);
      
      return { success: true, url: publicUrl };
    } catch (error: any) {
      console.error(`[Worker Error] [${title || 'Unknown'}] ${error.message}`);
      const errorDir = path.join(process.cwd(), 'output', 'playwright');
      if (!fs.existsSync(errorDir)) fs.mkdirSync(errorDir, { recursive: true });
      const errorPath = path.join(errorDir, `error-${jobId}.png`);
      await page.screenshot({ path: errorPath });
      await Notifier.sendDiscord(`Blogger 포스팅 실패: **${title || 'Untitled'}**\n사유: ${error.message}`, true);
      throw error;
    } finally {
      await this.context.close();
      this.context = null;
    }
  }

  private async takeStepScreenshot(jobId: string, stepName: string) {
    if (!this.page) return;
    const screenshotDir = path.join(process.cwd(), 'e2e-screenshots');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `${jobId}_${stepName}.png`);
    await this.page.screenshot({ path: screenshotPath });
    console.log(`[BloggerBot] 스크린샷 저장: ${screenshotPath}`);
  }

  private async forceSave(page: Page) {
    await page.keyboard.down("Control");
    await page.keyboard.press("s");
    await page.keyboard.up("Control");
    await page.waitForTimeout(2000);
  }

  private buildFinalHtml(htmlContent: string, imagePath?: string): string {
    let content = this.stripExistingInlineDataImages(htmlContent);
    content = content.replace(/\[MID_IMAGE\]|\[MIDDLE_IMAGE\]/gi, "");

    let imageHtml = "";
    if (imagePath && fs.existsSync(imagePath)) {
      const ext = path.extname(imagePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const base64 = fs.readFileSync(imagePath).toString('base64');
      imageHtml = `<div style="text-align:center; padding:20px 0;"><img src="data:${mime};base64,${base64}" alt="본문 이미지" style="width:100%; max-width:none; height:auto; display:block; margin:0 auto;" /></div>`;
    }

    const combined = imageHtml ? `${imageHtml}\n${content.trim()}` : content.trim();
    return this.wrapWithMathJax(combined);
  }

  private stripExistingInlineDataImages(html: string): string {
    if (!html) return "";
    return html
      .replace(/<div[^>]*>\s*<img[^>]+src=["']data:image[^"']+["'][^>]*>\s*<\/div>/gi, "")
      .replace(/<img[^>]+src=["']data:image[^"']+["'][^>]*>/gi, "");
  }

  private wrapWithMathJax(html: string): string {
    if (html.includes("MathJax-script")) return html;
    const config = `
<script>
(function() {
  if (window.location.hostname.indexOf('blogger.com') !== -1) return;
  window.MathJax = {
    tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']] },
    options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] }
  };
})();
</script>
<script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
    `;
    return (config.trim() + "\n" + html).trim();
  }

  private async ensureLoggedIn(page: Page, email?: string, password?: string, targetUrl?: string) {
    const isIdentityVerification = await page.evaluate(() => 
      document.body.innerText.includes('본인 인증') || 
      document.body.innerText.includes('Identity verification') ||
      document.body.innerText.includes('Confirm it\'s you') ||
      document.body.innerText.includes('다시 로그인')
    );

    if (isIdentityVerification) {
      console.log('[BloggerBot] 본인 인증/재로그인 화면 감지됨');
      try {
        await page.waitForTimeout(3000);
        const nextBtnSelectors = ['button:has-text("다음")', 'button:has-text("Next")', '#identifierNext', '#passwordNext'];
        for (const sel of nextBtnSelectors) {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            await el.click({ force: true });
            break;
          }
        }
        await page.waitForTimeout(5000);
      } catch (e) {}
    }

    const emailInput = page.locator('input[type="email"], #identifierId').first();
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      if (!email || !password) throw new Error('로그인이 필요합니다.');
      await emailInput.fill(email);
      await page.click('button:has-text("다음"), #identifierNext');
      await page.waitForTimeout(3000);
    }

    const pwInput = page.locator('input[type="password"]').first();
    if (await pwInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      if (!password) throw new Error('비밀번호가 필요합니다.');
      await pwInput.fill(password);
      await page.click('button:has-text("다음"), #passwordNext');
      await page.waitForTimeout(5000);
    }

    if (targetUrl && !page.url().includes('blogger.com')) {
      await page.goto(targetUrl, { waitUntil: 'networkidle' });
    }
  }

  async openEditor(page: Page, blogId: string, postId?: string) {
    if (postId) {
      await page.goto(`https://www.blogger.com/blog/post/edit/${blogId}/${postId}`, { waitUntil: 'networkidle' });
    } else {
      await page.goto(`https://www.blogger.com/blog/posts/${blogId}`, { waitUntil: 'networkidle' });
      const newPostSelectors = ['div[role="button"]:has-text("새 글")', 'div[role="button"]:has-text("New Post")', '.UpT69c'];
      let clicked = false;
      for (const sel of newPostSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        await page.evaluate(() => {
          const btn = (Array.from(document.querySelectorAll('div[role="button"]')) as HTMLElement[]).find(b => b.innerText.includes('새 글') || b.innerText.includes('New Post'));
          if (btn) btn.click();
        });
      }
      await page.waitForURL(/\/blog\/post\/edit\//, { timeout: 30000 });
    }
    await page.waitForSelector(TITLE_SELECTORS, { timeout: 30000 });
  }

  private async setTitle(page: Page, title: string) {
    const titleEl = page.locator(TITLE_SELECTORS).first();
    await titleEl.waitFor({ state: 'visible' });
    await titleEl.click();
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await titleEl.fill(title);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1000);
  }

  private async switchEditorMode(mode: "HTML" | "COMPOSE") {
    if (!this.page) return false;

    // 1. 에디터 영역이 로드될 때까지 대기
    try {
      await this.page.waitForSelector('.CodeMirror, textarea.Gw96ee, iframe.blogger-iframe, .CodeMirror-scroll, div[role="textbox"]', { state: 'attached', timeout: 15000 });
      await this.page.waitForTimeout(1500); // DOM 안정화를 위해 약간 더 대기
    } catch(e) {
      console.warn("[BloggerBot] 에디터 로드 대기 타임아웃. 강제 진행합니다.");
    }

    // 이미 올바른 모드인지 확인 (CodeMirror와 .CodeMirror-scroll이 HTML 모드의 핵심 증거)
    const isHtmlMode = await this.page.evaluate(() => {
        const hasCodeMirror = !!document.querySelector(".CodeMirror");
        const hasCmScroll = !!document.querySelector(".CodeMirror-scroll");
        const hasRawTextArea = !!document.querySelector("textarea.Gw96ee");
        return hasCodeMirror || hasCmScroll || hasRawTextArea;
    });
    
    console.log(`[BloggerBot] 현재 모드 확인: ${isHtmlMode ? 'HTML' : 'COMPOSE'} (목표: ${mode})`);

    if (mode === "HTML" && isHtmlMode) {
        console.log(`[BloggerBot] 이미 HTML 모드입니다. 전환을 생략합니다.`);
        return true;
    }
    if (mode === "COMPOSE" && !isHtmlMode) {
        console.log(`[BloggerBot] 이미 작성(COMPOSE) 모드입니다. 전환을 생략합니다.`);
        return true;
    }

    // dump 결과에 따르면 '보기 전환'이 메뉴 버튼의 aria-label임
    const targetLabel = mode === "HTML" ? "HTML 보기" : "새 글 작성 보기";
    console.log(`[BloggerBot] 모드 전환 시도: ${mode} (${targetLabel})`);

    try {
      // 1. 메뉴 버튼 클릭 (보기 전환)
      const menuBtnSelector = 'div[aria-label="보기 전환"], div[aria-label="편집 보기 선택"], div[jsname="o2UTnc"]';
      const menuBtn = this.page.locator(menuBtnSelector).first();
      
      await menuBtn.waitFor({ state: 'visible', timeout: 10000 });
      await menuBtn.click();
      await this.page.waitForTimeout(1000);

      // 2. 옵션 선택
      const optionSelector = `div[role="menuitem"]:has-text("${targetLabel}"), div[role="option"]:has-text("${targetLabel}"), span:has-text("${targetLabel}"), [aria-label="${targetLabel}"]`;
      const option = this.page.locator(optionSelector).first();
      
      if (await option.isVisible({ timeout: 5000 })) {
        await option.click();
      } else {
        throw new Error(`모드 옵션을 찾을 수 없습니다: ${targetLabel}`);
      }

      // 3. 전환 대기
      await this.page.waitForFunction((m) => {
        const hasHtmlElements = !!document.querySelector(".CodeMirror") || !!document.querySelector("textarea.Gw96ee") || !!document.querySelector(".CodeMirror-scroll");
        if (m === "HTML") return hasHtmlElements;
        return !hasHtmlElements;
      }, mode, { timeout: 15000 }).catch(() => console.warn(`[BloggerBot] 모드 전환 대기 타임아웃 (${mode})`));

      await this.page.waitForTimeout(2000);
      return true;
    } catch (e) {
      console.error(`[BloggerBot] 모드 전환 실패:`, e);
      return false;
    }
  }


  private async setHtmlContent(content: string) {
    if (!this.page) return;
    console.log("[BloggerBot] 본문 주입 중...");

    const cmLocator = this.page.locator(".CodeMirror-scroll, textarea.Gw96ee, .CodeMirror").first();
    if (await cmLocator.isVisible({ timeout: 10000 }).catch(() => false)) {
      
      // 1. 에디터 클릭하여 포커스
      await cmLocator.click({ force: true });
      await this.page.waitForTimeout(1000);

      // 2. 기존 내용 전체 선택 후 삭제 (Ctrl+A -> Backspace)
      await this.page.keyboard.down("Control");
      await this.page.keyboard.press("a");
      await this.page.keyboard.up("Control");
      await this.page.waitForTimeout(500);
      await this.page.keyboard.press("Backspace");
      await this.page.waitForTimeout(500);

      // 3. 네이티브 DOM 레벨에서 텍스트 삽입
      console.log("[BloggerBot] insertText를 이용한 본문 삽입 시도...");
      await this.page.keyboard.insertText(content);
      
      // 4. 에디터 이벤트 인식을 위한 추가 액션 (스페이스 입력 후 삭제)
      await this.page.waitForTimeout(1000);
      await this.page.keyboard.press("End");
      await this.page.keyboard.type(" ");
      await this.page.keyboard.press("Backspace");

      // 5. 강제 저장을 위해 Ctrl+S 수행
      await this.page.keyboard.down("Control");
      await this.page.keyboard.press("s");
      await this.page.keyboard.up("Control");
      await this.page.waitForTimeout(3000);
      return;
    }
    
    console.warn("[BloggerBot] CodeMirror 스크롤 영역 또는 textarea를 찾을 수 없습니다.");
    throw new Error("본문을 삽입할 에디터 영역을 찾지 못했습니다.");
  }


  private async waitForSaved(page: Page, timeoutMs = 30000) {
    const startedAt = Date.now();
    console.log("[BloggerBot] 저장 상태 대기 중...");
    while (Date.now() - startedAt < timeoutMs) {
      const status = await page.evaluate(() => {
        const text = document.body.innerText;
        // '저장됨' 또는 'Saved'가 포함되어 있고 '저장 중'이 아닐 때
        const isSaved = (text.includes("저장됨") || text.includes("Saved") || text.includes("저장되었습니다")) && 
                        !(text.includes("저장 중") || text.includes("Saving"));
        return isSaved;
      });
      if (status) {
        console.log("[BloggerBot] 저장 완료 확인됨");
        return true;
      }
      await page.waitForTimeout(1500);
    }
    console.warn("[BloggerBot] 저장 확인 타임아웃");
    return false;
  }

  private async commitPost(jobId?: string) {
    if (!this.page) return;
    console.log("[BloggerBot] 게시 시도...");

    const publishSelectors = [
      'div[role="button"][aria-label="게시"]',
      'div[role="button"][aria-label="업데이트"]',
      'div[role="button"][aria-label="Publish"]',
      'div[role="button"][aria-label="Update"]',
      'div[role="button"][jsname="vdQQuc"]',
      'span.RveJvd.snByac:has-text("게시")',
      'span.RveJvd.snByac:has-text("업데이트")',
      'span.RveJvd.snByac:has-text("Publish")',
      'span:has-text("게시")',
      'span:has-text("업데이트")'
    ];
    
    let clicked = false;
    for (const s of publishSelectors) {
      const btn = this.page.locator(s).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click({ force: true });
        clicked = true;
        console.log(`[BloggerBot] 게시 버튼 클릭 성공 (selector: ${s})`);
        break;
      }
    }
    if (!clicked) throw new Error("게시/업데이트 버튼을 찾지 못했습니다.");

    await this.page.waitForTimeout(3000);
    if (jobId) await this.takeStepScreenshot(jobId, '08_publish_clicked');
    
    // 사용자가 제공한 '확인' 버튼 셀렉터 우선 적용
    const confirms = [
      '.CwaK9 .snByac:has-text("확인")', 
      '.RveJvd.snByac:has-text("확인")',
      'div[role="dialog"] .snByac:has-text("확인")',
      'text="확인"'
    ];
    
    let confirmed = false;
    for (const c of confirms) {
      const btn = this.page.locator(c).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click({ force: true });
        confirmed = true;
        console.log(`[BloggerBot] 확인 완료 (selector: ${c})`);
        break;
      }
    }
    
    if (!confirmed) {
      console.warn("[BloggerBot] 확인 버튼 검색 실패, 엔터키 시도");
      await this.page.keyboard.press("Enter");
    }
    
    await this.page.waitForTimeout(5000);
  }

  private async setLabels(labels: string[]) {
    if (!this.page || !labels.length) return;
    try {
      // 1. 사이드바의 '라벨' 섹션 열기
      const labelSection = this.page.locator('div[aria-label="라벨"], div[aria-label="Labels"]').first();
      await labelSection.waitFor({ state: 'visible', timeout: 5000 });
      
      const isExpanded = await labelSection.evaluate(el => el.getAttribute("aria-expanded") === "true");
      if (!isExpanded) {
        await labelSection.click({ force: true });
        await this.page.waitForTimeout(1000);
      }

      // 2. 입력창 찾기
      const inputSelector = 'textarea[aria-label="라벨"], textarea[aria-label="Labels"]';
      const input = this.page.locator(inputSelector).first();
      await input.waitFor({ state: 'visible', timeout: 5000 });
      
      // 3. 기존 내용 지우고 입력
      await input.focus();
      await this.page.keyboard.down("Control");
      await this.page.keyboard.press("a");
      await this.page.keyboard.up("Control");
      await this.page.keyboard.press("Backspace");
      await this.page.waitForTimeout(500);

      // type을 사용하여 이벤트 트리거 유도
      await this.page.keyboard.type(labels.join(", "), { delay: 50 });
      await this.page.keyboard.press("Enter");
      await this.page.waitForTimeout(1500);
      
      console.log(`[BloggerBot] 라벨 입력 완료: ${labels.join(", ")}`);
    } catch (e: any) {
      console.warn("[BloggerBot] 라벨 입력 실패:", e.message);
    }
  }

}
