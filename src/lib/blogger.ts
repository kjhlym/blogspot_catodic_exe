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
      headless: false, // 사용자 요청에 따라 헤드리스 해제
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
      
      const currentUrl = await this.openEditor(page, blogId, postId);
      await this.setTitle(page, title);

      await Notifier.logStep(jobId, 'HTML_MODE', 'HTML 보기 모드 전환 중...');
      await this.switchEditorMode(page, 'html');
      
      await Notifier.logStep(jobId, 'CONTENT', '본문 주입 중...');
      await this.setHtmlContent(page, htmlContent, imagePath);

      // [핵심] 저장 대기 후 모드 전환
      await Notifier.logStep(jobId, 'SAVE', '변경사항 저장 대기 중...');
      await page.keyboard.press('Control+S');
      await this.waitForPendingBase64Upload(page, 20000);

      await Notifier.logStep(jobId, 'COMPOSE_MODE', '작성 보기 모드 전환 중...');
      await this.switchEditorMode(page, 'compose');
      await page.waitForTimeout(2000);

      if (publish) {
        await Notifier.logStep(jobId, 'PUBLISH', '게시/업데이트 버튼 클릭 중...');
        await this.commitPost(page, blogId, title, !!postId);
      }

      await Notifier.logStep(jobId, 'SUCCESS', '작업 완료');
      await Notifier.sendDiscord(`Blogger 포스팅 성공: **${title}**\nURL: ${page.url()}`);
      
      return { success: true, url: page.url() };
    } catch (error: any) {
      console.error(`[Worker Error] ${error.message}`);
      await page.screenshot({ path: path.join(process.cwd(), 'output', 'playwright', `error-${jobId}.png`) });
      await Notifier.sendDiscord(`Blogger 포스팅 실패: **${title}**\n사유: ${error.message}`, true);
      throw error;
    } finally {
      await this.context.close();
    }
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
    const toggle = page.locator('div[role="listbox"][aria-label*="보기"], div[aria-label*="View"], div[aria-label*="보기 모드"]').first();
    await toggle.waitFor({ state: 'visible', timeout: 10000 });
    await toggle.click();
    await page.waitForTimeout(1000);
    
    const item = mode === 'html' 
      ? page.locator('div[role="option"]:has-text("HTML")') 
      : page.locator('div[role="option"]:has-text("작성"), div[role="option"]:has-text("Compose"), div[role="option"]:has-text("새 글 작성")');
    
    if (await item.first().isVisible({ timeout: 5000 })) {
      await item.first().click();
      await page.waitForTimeout(3000);
      return true;
    }
    return false;
  }

  private async waitForPendingBase64Upload(page: Page, timeoutMs = 60000) {
    const startedAt = Date.now();
    let pendingSeen = false;

    console.log("[Worker] 저장 및 이미지 상태 모니터링 시작...");

    while (Date.now() - startedAt < timeoutMs) {
      const state = await page.evaluate(() => {
        const text = document.body.innerText || "";
        const isPending = text.includes("업로드 중") || text.includes("저장 중") || text.includes("Saving") || text.includes("Uploading");
        
        // 클라우드 저장 아이콘 상태 확인
        const cloudIcon = document.querySelector('div[aria-label*="저장됨"], div[aria-label*="Saved"], div[aria-label*="모든 변경사항이 저장되었습니다"]');
        const isSettled = !!cloudIcon;

        return { isPending, isSettled };
      });

      if (state.isPending) {
        pendingSeen = true;
        process.stdout.write(".");
      } else {
        // 한 번이라도 Pending을 봤거나, 이미 Settled 상태이면서 최소 3초 경과 시 종료
        if (state.isSettled && (pendingSeen || (Date.now() - startedAt > 5000))) {
          console.log("\n[Worker] ✅ 저장 및 업로드 완료 확인");
          return true;
        }
      }
      await page.waitForTimeout(1000);
    }
    console.warn("\n[Worker] ⚠️ 저장 완료 확인 타임아웃");
    return false;
  }

  private async setHtmlContent(page: Page, htmlContent: string, imagePath?: string) {
    // 본문 전용 textarea 찾기 (기존의 범용 textarea보다 정확함)
    const textarea = page.locator('textarea[dir="ltr"], .editable textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 30000 });
    
    await textarea.click({ force: true });
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");

    let finalHtml = htmlContent;
    if (imagePath && fs.existsSync(imagePath)) {
      const base64 = fs.readFileSync(imagePath).toString('base64');
      const ext = path.extname(imagePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      const imgHtml = `<div style="text-align:center"><img src="data:${mime};base64,${base64}" /></div>`;
      finalHtml = imgHtml + htmlContent;
    }

    await textarea.evaluate((el: any, content) => {
      el.value = content;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, finalHtml);
    
    await textarea.click({ force: true });
    await page.keyboard.press('End');
    await page.keyboard.insertText(' ');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(1000);
  }

  private async commitPost(page: Page, blogId: string, title: string, isUpdate: boolean) {
    const selectors = isUpdate ? UPDATE_SELECTORS : PUBLISH_SELECTORS;
    let clicked = false;
    for (const sel of selectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error('게시/업데이트 버튼을 찾을 수 없습니다.');
    
    await page.waitForTimeout(2000);
    await page.waitForTimeout(2000);
    const confirm = page.locator(CONFIRM_SELECTORS.join(', ')).first();
    if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirm.click();
      await page.waitForTimeout(5000); // 게시 완료 후 안정화
    }

    // 전반적인 게시 완료 여부를 텍스트로 추가 검증
    await page.waitForFunction(() => {
      const text = document.body.innerText || "";
      return text.includes("게시됨") || text.includes("Published") || text.includes("변경사항이 저장되었습니다");
    }, { timeout: 15000 }).catch(() => {});
  }
}
