import { chromium } from 'playwright';
import * as path from 'path';

async function dumpEditorLabels() {
  const userDataDir = path.join(process.cwd(), 'playwright-profile-blogger');
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
  });

  const page = await browser.newPage();
  const blogId = "8175487819803632040";
  const postId = "524860143502214092"; // 위에서 확인된 ID
  
  try {
    console.log("에디터 직접 진입...");
    await page.goto(`https://www.blogger.com/blog/post/edit/${blogId}/${postId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
    
    console.log("에디터 URL 확인:", page.url());

    const dump = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[aria-label], [data-tooltip], button, [role="button"], [role="listbox"]'));
      return items.map(el => ({
        tag: el.tagName,
        text: (el as HTMLElement).innerText.trim().slice(0, 30),
        ariaLabel: el.getAttribute('aria-label'),
        class: el.className,
        role: el.getAttribute('role'),
        jsname: el.getAttribute('jsname')
      })).filter(item => item.ariaLabel || item.text);
    });

    console.log("Dump:", JSON.stringify(dump, null, 2));

  } catch (e) {
    console.error("오류:", e);
  } finally {
    await browser.close();
  }
}

dumpEditorLabels();
