import { chromium } from 'playwright';
import * as path from 'path';

async function inspectBloggerEditor() {
  const userDataDir = path.join(process.cwd(), 'playwright-profile-blogger');
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();
  const blogId = "8175487819803632040"; 
  
  try {
    console.log("에디터 직접 접속 (새 글)...");
    // 블로거에서 새 글 작성 URL은 보통 /blog/post/edit/{blogId} 형태 (postId 없이)
    // 또는 목록에서 대기 후 /blog/post/edit/{blogId}로 리다이렉트됨.
    // 여기서는 목록에서 새 글 버튼 클릭이 실패했으므로, 
    // 아예 에디터 진입이 보장된 상태에서 요소를 봅니다.
    
    await page.goto(`https://www.blogger.com/blog/posts/${blogId}`, { waitUntil: 'networkidle' });
    
    // "새 글 작성" 또는 "New Post" 버튼 클릭 강화
    const selectors = ['div[aria-label="새 글 작성"]', 'div[aria-label="New Post"]', 'div[role="button"]:has-text("새 글")'];
    let clicked = false;
    for (const sel of selectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click({ force: true });
          clicked = true;
          console.log(`버튼 클릭 성공: ${sel}`);
          break;
        }
      } catch (e) {}
    }

    if (!clicked) {
        console.log("버튼 클릭 실패, 텍스트 기반 검색 시도...");
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('div[role="button"]')) as HTMLElement[];
            const target = btns.find(b => b.innerText.includes('새 글') || b.innerText.includes('New Post'));
            if (target) target.click();
        });
    }

    await page.waitForTimeout(5000);
    console.log("현재 URL:", page.url());

    // 에디터 요소 덤프
    const dump = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('div[role="button"], div[role="listbox"], span[role="button"], button'));
      return buttons.map(b => ({
        text: (b as HTMLElement).innerText.trim().slice(0, 30),
        ariaLabel: b.getAttribute('aria-label'),
        class: b.className,
        role: b.getAttribute('role'),
        jsname: b.getAttribute('jsname')
      })).filter(b => b.ariaLabel || b.text);
    });

    console.log("인스펙션 결과:", JSON.stringify(dump, null, 2));

  } catch (e) {
    console.error("오류:", e);
  } finally {
    await browser.close();
  }
}

inspectBloggerEditor();
