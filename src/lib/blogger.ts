import { chromium, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { Notifier } from './notifier';

export interface BloggerJobData {
  email?: string;
  password?: string;
  blogId: string;
  title: string;
  htmlContent: string;
  imagePath?: string;
  postId?: string;
  publish?: boolean;
  labels?: string[];
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

const PUBLISH_SELECTORS = ['div[aria-label="게시"][role="button"]', 'button:has-text("게시")', 'button:has-text("Publish")'];
const UPDATE_SELECTORS = ['div[aria-label="업데이트"][role="button"]', 'button:has-text("업데이트")', 'button:has-text("Update")'];
const CONFIRM_SELECTORS = ['div[aria-label="확인"][role="button"]', 'button:has-text("확인")', 'div[role="button"]:has-text("확인")'];

export class BloggerBot {
  private context: BrowserContext | null = null;

  async execute(data: BloggerJobData, jobId: string) {
    const { email, password, blogId, title, htmlContent, imagePath, postId, publish = true } = data;
    const userDataDir = path.join(process.cwd(), 'playwright-profile-blogger');
    
    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const page = await this.context.newPage();

    try {
      await Notifier.logStep(jobId, 'START', `Blogger 작업 시작: ${title}`);
      
      const targetUrl = postId
        ? `https://www.blogger.com/blog/post/edit/${blogId}/${postId}`
        : `https://www.blogger.com/blog/posts/${blogId}`;

      await page.goto(targetUrl, { waitUntil: 'networkidle' });
      await this.ensureLoggedIn(page, email, password, targetUrl);
      
      await this.openEditor(page, blogId, postId);
      await this.setTitle(page, title);

      // 본문 구성 (이미지 삽입 + MathJax 래핑)
      const finalHtml = this.buildFinalHtml(htmlContent, imagePath);

      await Notifier.logStep(jobId, 'HTML_MODE', 'HTML 보기 모드 전환 중...');
      const swOk = await this.switchEditorMode(page, 'html');
      if (!swOk) throw new Error("에디터 모드 전환 실패 (HTML)");
      
      await Notifier.logStep(jobId, 'CONTENT', '본문 주입 중...');
      await this.setHtmlContent(page, finalHtml);

      await Notifier.logStep(jobId, 'SAVE', '변경사항 저장 대기 중...');
      await page.keyboard.press('Control+S');
      await this.waitForPendingBase64Upload(page, 20000);

      await Notifier.logStep(jobId, 'COMPOSE_MODE', '작성 보기 모드 전환 중...');
      await this.switchEditorMode(page, 'compose');
      await page.waitForTimeout(2000);

      if (publish) {
        if (data.labels && data.labels.length > 0) {
          await Notifier.logStep(jobId, 'LABEL', '레이블(태그) 입력 중...');
          await this.setLabels(page, data.labels);
        }

        await Notifier.logStep(jobId, 'PUBLISH', '게시/업데이트 버튼 클릭 중...');
        await this.commitPost(page, blogId, title, !!postId);
      }

      await Notifier.logStep(jobId, 'SUCCESS', '작업 완료');
      await Notifier.sendDiscord(`Blogger 포스팅 성공: **${title}**\nURL: ${page.url()}`);
      
      return { success: true, url: page.url() };
    } catch (error: any) {
      console.error(`[Worker Error] ${error.message}`);
      const errorDir = path.join(process.cwd(), 'output', 'playwright');
      if (!fs.existsSync(errorDir)) fs.mkdirSync(errorDir, { recursive: true });
      await page.screenshot({ path: path.join(errorDir, `error-${jobId}.png`) });
      await Notifier.sendDiscord(`Blogger 포스팅 실패: **${title}**\n사유: ${error.message}`, true);
      throw error;
    } finally {
      await this.context.close();
    }
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
    const emailInput = page.locator('input[type="email"], #identifierId');
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      if (!email || !password) throw new Error('로그인이 필요하지만 계정 정보가 없습니다.');
      await emailInput.fill(email);
      await page.click('button:has-text("다음"), #identifierNext');
      await page.waitForTimeout(3000);
      const pwInput = page.locator('input[type="password"]');
      await pwInput.fill(password);
      await page.click('button:has-text("다음"), #passwordNext');
      await page.waitForTimeout(5000);
      if (targetUrl) await page.goto(targetUrl, { waitUntil: 'networkidle' });
    }
  }

  private async openEditor(page: Page, blogId: string, postId?: string) {
    if (postId) return page.url();
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('div[role="button"], button')).find(el => 
        (el.textContent || '').includes('새 글') || (el.textContent || '').includes('New post')
      ) as HTMLElement;
      if (btn) btn.click();
    });
    await page.waitForURL(/\/post\/(edit|create)/i, { timeout: 15000 });
    await page.waitForTimeout(3000);
    return page.url();
  }

  private async setTitle(page: Page, title: string) {
    const titleEl = page.locator(TITLE_SELECTORS).first();
    await titleEl.waitFor({ state: 'visible', timeout: 30000 });
    await titleEl.fill(title);
  }

  private async switchEditorMode(page: Page, mode: 'html' | 'compose') {
    // 실측 기반 모드 판단
    const mainTextarea = await this.findVisibleBodyTextarea(page);
    const currentMode = mainTextarea ? 'html' : 'compose';
    if (currentMode === mode) return true;

    const toggle = page.locator('div[role="listbox"][aria-label*="보기"], div[aria-label*="View"], button[aria-label*="보기"]').first();
    if (!await toggle.isVisible({ timeout: 5000 }).catch(() => false)) return false;

    await toggle.click();
    await page.waitForTimeout(1000);
    
    const item = mode === 'html' 
      ? page.locator('div[role="option"]:has-text("HTML")') 
      : page.locator('div[role="option"]:has-text("작성"), div[role="option"]:has-text("Compose"), span:has-text("새 글 작성")');
    
    if (await item.first().isVisible({ timeout: 5000 })) {
      await item.first().click();
      await page.waitForTimeout(4000);
      return true;
    }
    return false;
  }

  private async findVisibleBodyTextarea(page: Page) {
    const list = page.locator('textarea');
    const count = await list.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const ta = list.nth(i);
      const meta = await ta.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const isSidebar = !!el.closest('.vBy66d');
        const visible = rect.width > 500 && rect.height > 200;
        return { visible, isSidebar };
      });
      if (meta.visible && !meta.isSidebar) return ta;
    }
    return null;
  }

  private async setHtmlContent(page: Page, html: string) {
    const textarea = await this.findVisibleBodyTextarea(page);
    if (!textarea) throw new Error("본문 에디터(HTML)를 찾을 수 없습니다.");
    
    await textarea.click({ force: true });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');

    await textarea.evaluate((el: any, content) => {
      el.value = content;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, html);
    
    await page.keyboard.press('End');
    await page.keyboard.insertText(' ');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(1000);
  }

  private async waitForPendingBase64Upload(page: Page, timeoutMs = 60000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const state = await page.evaluate(() => {
        const text = document.body.innerText || "";
        const isPending = text.includes("업로드 중") || text.includes("저장 중") || text.includes("Uploading") || text.includes("Saving");
        const cloudIcon = document.querySelector('div[aria-label*="저장됨"], div[aria-label*="Saved"], div[aria-label*="모든 변경사항이 저장되었습니다"]');
        return { isPending, isSettled: !!cloudIcon };
      });
      if (!state.isPending && state.isSettled) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  }

  private async commitPost(page: Page, blogId: string, title: string, isUpdate: boolean) {
    const selectors = isUpdate ? UPDATE_SELECTORS : PUBLISH_SELECTORS;
    let clicked = false;
    for (const sel of selectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error('게시/업데이트 버튼을 찾을 수 없습니다.');
    
    await page.waitForTimeout(2000);
    const confirm = page.locator(CONFIRM_SELECTORS.join(', ')).first();
    if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirm.click();
      await page.waitForTimeout(5000);
    }
  }

  private async setLabels(page: Page, labels: string[]) {
    const findInput = async () => {
      const selectors = ['textarea[jsname="YPqjbf"]', 'textarea[aria-label*="라벨"]', 'textarea[aria-label*="Labels"]', 'input[aria-label*="라벨"]'];
      for (const sel of selectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1000 }).catch(() => false)) return el;
      }
      return null;
    };

    let input = await findInput();
    if (!input) {
      const expand = page.locator('div[role="button"]:has-text("라벨"), div[role="button"]:has-text("Labels"), button:has-text("라벨")').first();
      if (await expand.isVisible({ timeout: 2000 })) {
        await expand.click();
        await page.waitForTimeout(1500);
        input = await findInput();
      }
    }

    if (input) {
      await input.fill(labels.join(", ") + ", ");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);
    }
  }
}
