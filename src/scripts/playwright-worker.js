const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function run() {
  const args = process.argv.slice(2);
  const dataPath = args[0];
  if (!dataPath) {
    console.error("No data path provided.");
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  } catch (e) {
    console.error("Failed to read temp data file.", e);
    process.exit(1);
  }

  const { email, password, blogUrl, title, thumbnailPath } = data;
  let { htmlContent } = data;

  // 썸네일이 있으면 base64 img 태그로 변환해 본문 최상단에 삽입
  // 단, [MID_IMAGE]가 포함된 경우 물리적인 업로드 방식을 사용하므로 이를 건너뜀
  if (!htmlContent.includes('[MID_IMAGE]') && thumbnailPath && fs.existsSync(thumbnailPath)) {
    try {
      const imgBuffer = fs.readFileSync(thumbnailPath);
      const base64 = imgBuffer.toString('base64');
      const thumbnailTag = `<p style="text-align:center;margin-bottom:24px;">`
        + `<img src="data:image/png;base64,${base64}" `
        + `alt="썸네일" style="max-width:100%;height:auto;border-radius:8px;" /></p>`;
      htmlContent = thumbnailTag + htmlContent;
      console.log('[썸네일] base64 변환 완료 → 본문 최상단 삽입 예약');
    } catch (e) {
      console.warn('[썸네일] base64 변환 실패 (발행 계속):', e.message);
    }
  }

  const userDataDir = path.join(process.cwd(), 'playwright-profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      permissions: ['clipboard-read', 'clipboard-write'],
      viewport: { width: 1280, height: 800 }
  });
  
  const page = await context.newPage();

  try {
    // 1. 글쓰기 페이지 진입 시도
    await page.goto(`${blogUrl}/manage/post`);
    await page.waitForTimeout(2000);

    const isLoginRequired = page.url().includes('/auth/login') || await page.locator('a.btn_login').isVisible();
    
    if (isLoginRequired) {
        console.log("로그인이 필요합니다. 카카오 계정으로 로그인을 시도합니다.");
        if (!page.url().includes('/auth/login')) {
            await page.goto("https://www.tistory.com/auth/login");
        }
        await page.click('a.btn_login.link_kakao_id'); 
        await page.waitForSelector('input#loginId--1', { state: 'visible' });

        await page.fill('input#loginId--1', email);
        await page.fill('input#password--2', password);
        await page.click('button.btn_g.highlight.submit'); 
        await page.waitForTimeout(5000); 

        await page.goto(`${blogUrl}/manage/post`);
    } else {
        console.log("기존 세션으로 로그인되어 있습니다. 바로 글쓰기를 시작합니다.");
    }

    await page.waitForSelector('#post-title-inp', { state: 'visible', timeout: 90000 });

    // 3. 제목 입력
    const titleLocator = page.locator('textarea#post-title-inp, textarea.textarea_tit').first();
    await titleLocator.fill(title);

    // 5. 에디터 타입 감지 후 본문 주입
    const hasProseMirror = await page.locator('div.ProseMirror').isVisible().catch(() => false);
    const hasIframe = await page.locator('iframe[id*="editor-tistory"]').isVisible().catch(() => false);
    console.log(`에디터 타입 - ProseMirror: ${hasProseMirror}, iframe(TinyMCE): ${hasIframe}`);

    const hasMidImagePlaceholder = htmlContent.includes('[MID_IMAGE]');

    if (hasProseMirror) {
        console.warn("ProseMirror 에디터에서는 [MID_IMAGE] 처리가 제한적입니다 (TinyMCE 권장).");
        const editorDiv = page.locator('div.ProseMirror, div[contenteditable="true"]').last();
        await editorDiv.focus();
        const finalHtml = htmlContent.replace('[MID_IMAGE]', '');
        await page.evaluate((html) => {
            const e = document.activeElement;
            const dt = new DataTransfer();
            dt.setData('text/html', html);
            dt.setData('text/plain', html.replace(/<[^>]*>?/gm, ''));
            e.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }, finalHtml);
    } else if (hasIframe) {
        const iframe = page.frameLocator('iframe[id*="editor-tistory_ifr"]');
        const editorBody = iframe.locator('body').first();
        await editorBody.waitFor({ state: 'visible', timeout: 5000 });
        await editorBody.click();

        if (hasMidImagePlaceholder && thumbnailPath && fs.existsSync(thumbnailPath)) {
            console.log("[MID_IMAGE] 감지됨. 분할 주입 및 업로드 시작...");
            const parts = htmlContent.split('[MID_IMAGE]');
            
            // 1. 첫 번째 파트 주입
            await editorBody.evaluate((body, html) => {
                body.focus();
                if (window.tinymce && window.tinymce.activeEditor) {
                    window.tinymce.activeEditor.setContent(html);
                } else {
                    document.execCommand('insertHTML', false, html);
                }
            }, parts[0]);

            // 2. 이미지 버튼 클릭 및 업로드 (#mceu_0-open)
            console.log("이미지 버튼(#mceu_0-open) 클릭...");
            const imageBtn = page.locator('#mceu_0-open').first();
            if (await imageBtn.isVisible({ timeout: 3000 })) {
                try {
                    const [fileChooser] = await Promise.all([
                        page.waitForEvent('filechooser', { timeout: 10000 }),
                        imageBtn.click(),
                    ]);
                    await fileChooser.setFiles(thumbnailPath);
                    console.log("이미지 파일 선택 완료.");
                } catch (err) {
                    console.log("직접적인 filechooser 탐지 실패. 메뉴/다이얼로그 확인 중...");
                    const screenshotDir = path.join(process.cwd(), 'e2e-screenshots');
                    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
                    await page.screenshot({ path: path.join(screenshotDir, 'image_upload_fail.png') });
                    
                    const uploadButton = page.locator('div[role="menuitem"]:has-text("내 PC"), .mce-floatpanel button:has-text("사진"), .mce-floatpanel i.mce-i-browse');
                    if (await uploadButton.isVisible({ timeout: 5000 })) {
                        console.log("업로드 관련 버튼 발견. 클릭...");
                        const [fileChooser2] = await Promise.all([
                            page.waitForEvent('filechooser'),
                            uploadButton.click(),
                        ]);
                        await fileChooser2.setFiles(thumbnailPath);
                        console.log("이미지 파일 선택 완료 (다이얼로그 경유).");
                    } else {
                        console.warn("업로드 버튼을 찾지 못했습니다.");
                        throw err;
                    }
                }
                await page.waitForTimeout(3000);
            }

            // 3. 두 번째 파트 주입
            await editorBody.evaluate((body, html) => {
                body.focus();
                if (window.tinymce && window.tinymce.activeEditor) {
                    window.tinymce.activeEditor.execCommand('mceInsertContent', false, html);
                } else {
                    document.execCommand('insertHTML', false, html);
                }
            }, parts[1]);
        } else {
            await editorBody.evaluate((body, html) => {
                body.focus();
                if (window.tinymce && window.tinymce.activeEditor) {
                    window.tinymce.activeEditor.setContent(html);
                } else {
                    document.execCommand('insertHTML', false, html);
                }
            }, htmlContent);
        }
    }

    // 8. 완료 버튼 클릭
    const doneSelectors = ['button#publish-layer-btn', 'button.btn_confirm', 'button:has-text("완료")', '.btn_done'];
    let doneClicked = false;
    for (const sel of doneSelectors) {
        try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 2000 })) {
                await btn.click();
                doneClicked = true;
                break;
            }
        } catch {}
    }
    if (!doneClicked) throw new Error('완료 버튼을 찾을 수 없습니다.');

    // 9. 발행 버튼 클릭
    await page.waitForTimeout(2000);
    const publishSelectors = ['button:has-text("공개 발행")', 'button#publish-btn', 'button:has-text("발행")', 'button.btn_public'];
    let published = false;
    for (const sel of publishSelectors) {
        try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 3000 })) {
                await btn.click();
                published = true;
                break;
            }
        } catch {}
    }
    if (!published) throw new Error('발행 버튼을 찾을 수 없습니다.');
    
    await page.waitForTimeout(3000);
    console.log("포스팅 완료");
  } catch (error) {
    console.error("[Worker] 자동화 오류:", error.message || error);
    try {
        await page.screenshot({ path: 'tistory_error_screenshot.png', fullPage: true });
    } catch {}
    throw error;
  } finally {
    await context.close();
  }
}

run();
