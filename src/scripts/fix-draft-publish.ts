/**
 * fix-draft-publish.ts
 * 지정한 Draft 포스트를 직접 열어서 게시(Publish)로 전환합니다.
 */
import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// === 수정 대상 - Draft 포스트 에디터 URL ===
const POST_URL = 'https://www.blogger.com/blog/post/edit/8772286578401026851/5312535114400992216';

async function main() {
  const email = process.env.GOOGLE_GEMINI_ID!;
  const password = process.env.GOOGLE_GEMINI_PW!;
  
  console.log('🚀 Draft 포스트 게시 처리 시작...');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Google 로그인
    console.log('1️⃣ Google 로그인 중...');
    await page.goto('https://accounts.google.com/signin', { waitUntil: 'networkidle' });
    
    // 이메일 입력
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailInput.fill(email);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
    }
    
    // 비밀번호 입력
    const pwInput = page.locator('input[type="password"]');
    await pwInput.waitFor({ state: 'visible', timeout: 15000 });
    await pwInput.fill(password);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    
    console.log('✅ 로그인 완료');
    
    // 2. Draft 포스트 열기
    console.log(`\n2️⃣ Draft 포스트 열기: ${POST_URL}`);
    await page.goto(POST_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    console.log(`현재 URL: ${page.url()}`);
    
    // 3. 게시 버튼 찾기 및 클릭
    console.log('\n3️⃣ 게시 버튼 클릭...');
    
    // 게시 버튼 셀렉터들
    const publishSelectors = [
      'div[data-action="publish"]',
      'div[class*="publish"]',
      'button:has-text("게시")',
      'div[role="button"]:has-text("게시")',
      'div[jsaction*="publish"]',
      '[aria-label="게시"]',
      '[aria-label="Publish"]',
    ];
    
    let published = false;
    for (const sel of publishSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log(`  📍 버튼 발견: ${sel}`);
          await btn.click();
          published = true;
          break;
        }
      } catch (e) {}
    }
    
    if (!published) {
      // JavaScript로 직접 찾아 클릭
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
        const publishBtn = btns.find(el => (el.textContent || '').trim().includes('게시') || 
                                          (el.textContent || '').trim() === 'Publish');
        if (publishBtn) (publishBtn as HTMLElement).click();
      });
      published = true;
      console.log('  🔍 JavaScript로 게시 버튼 클릭');
    }
    
    await page.waitForTimeout(2000);
    
    // 4. 확인 모달 처리
    const confirmSelectors = [
      'button:has-text("확인")',
      'button:has-text("게시")', 
      'div[role="button"]:has-text("확인")',
      'div[role="button"]:has-text("게시")',
      '[aria-label="게시"]',
    ];
    
    for (const sel of confirmSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
          console.log(`  ✅ 확인 모달 클릭: ${sel}`);
          await btn.click();
          break;
        }
      } catch (e) {}
    }
    
    // 5. 게시 완료 대기
    console.log('\n4️⃣ 게시 완료 대기...');
    try {
      await page.waitForURL(/blogger\.com\/blog\/posts\//, { timeout: 20000 });
      console.log('🎉 게시 성공! 포스트 목록으로 이동됨.');
    } catch {
      console.log('⚠️ URL 전환 미감지, 현재 상태 확인...');
      const url = page.url();
      const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
      console.log(`현재 URL: ${url}`);
      if (bodyText.includes('게시됨') || bodyText.includes('Published')) {
        console.log('✅ 페이지에서 "게시됨" 확인');
      }
    }
    
    // 최종 스크린샷
    await page.screenshot({ path: 'tmp/publish-fix-result.png', fullPage: false });
    console.log('📸 스크린샷: tmp/publish-fix-result.png');
    
  } catch (err: any) {
    console.error('❌ 오류:', err.message);
    await page.screenshot({ path: 'tmp/publish-fix-error.png' }).catch(() => {});
  } finally {
    await page.waitForTimeout(3000);
    await browser.close();
  }
}

main().catch(console.error);
