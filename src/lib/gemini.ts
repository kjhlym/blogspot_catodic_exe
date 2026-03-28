import { chromium, BrowserContext, Page, Locator } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

export interface GeminiContent {
  title: string;
  description: string;
  thumbnail_title: string;
  mid_image_keyword: string;
  labels: string[];
  html: string;
}

export interface GeminiResult {
  content: GeminiContent;
  hasImage: boolean;
  imagePath?: string;
}

export class GeminiBot {
  private context: BrowserContext | null = null;
  private profileDir: string;
  private downloadPath: string = 'C:\\Users\\kks\\Downloads';
  private screenshotDir: string;
  private isCPContext: boolean = false;

  constructor() {
    this.profileDir = path.join(process.cwd(), 'playwright-profile-gemini-vibe');
    this.screenshotDir = path.join(process.cwd(), 'e2e-screenshots');
    if (!fs.existsSync(this.screenshotDir)) fs.mkdirSync(this.screenshotDir, { recursive: true });
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }

  private async screenshot(page: Page, name: string) {
    const fp = path.join(this.screenshotDir, `${String(Date.now()).slice(-6)}_${name}.png`);
    await page.screenshot({ path: fp, fullPage: true }).catch(() => {});
    console.log(`[GeminiBot] [SS] ${fp}`);
  }

  async generate(topic: string, options: { headless?: boolean; blogKey?: string } = {}): Promise<GeminiResult> {
    if (!this.context) {
      this.context = await chromium.launchPersistentContext(this.profileDir, {
        headless: options.headless ?? false,
        viewport: { width: 1280, height: 900 },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars'
        ],
        permissions: ['clipboard-read', 'clipboard-write']
      });
    }

    const page = await this.context.newPage();
    try {
      console.log('[GeminiBot] Gemini 접속 중...');
      await page.goto('https://gemini.google.com/app?hl=ko', { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 
      });
      await page.waitForTimeout(3000);

      await this.ensureLoggedIn(page);

      // 프롬프트 구성: blogKey가 명시적으로 전달되면 그것을 우선, 없으면 topic 내용으로 추측
      const isCP = options.blogKey
        ? options.blogKey === 'cathodicProtection'
        : /전기|방식|cathodic|CP/i.test(topic);
      
      this.isCPContext = isCP;
      console.log(`[GeminiBot] blogKey=${options.blogKey || '(추측)'}, isCP=${isCP}`);
      const prompt = this.buildPrompt(topic, isCP);

      // 프롬프트 입력 및 전송
      await this.submitPrompt(page, prompt);

      // 응답 대기 및 추출
      const content = await this.waitForAndExtractJson(page);
      
      // 이미지 생성 시도
      let hasImage = false;
      let imagePath: string | undefined;

      if (content.mid_image_keyword) {
        const imageResult = await this.generateImage(page, content.mid_image_keyword, topic);
        if (imageResult.success && imageResult.path) {
          hasImage = true;
          imagePath = imageResult.path;
        }
      }

      return { content, hasImage, imagePath };
    } finally {
      await page.close();
    }
  }

  private buildPrompt(topic: string, isCP: boolean): string {
    const expertPersona = isCP ? "글로벌 전기방식(Cathodic Protection) 기술 및 검색엔진(SEO) 최적화 전문가" : "생활/문화 정보 큐레이션 및 검색엔진(SEO) 최적화 전문가";
    const writingStyle = isCP ? "10년 차 이상 수석 엔지니어가 노하우를 공유하듯, 확신에 차 있으면서도 가독성이 높은 자연스러운 어투" : "해당 분야의 깊은 식견을 가진 전문 칼럼니스트가 독자와 대화하듯, 친근하면서도 깊이 있는 통찰을 전하는 세련된 어투";
    const contentRequirement = isCP 
      ? "수학적 수식이나 물리 공식은 반드시 LaTeX 형식을 사용하여 전문적으로 작성하세요. 모든 물리적 단위, 변수, 기호는 반드시 인라인 수식 `$내용$` 형식을 사용하세요."
      : "현상에 대한 과학적/사회적 분석이나 관련 통계를 언급할 때 필요하다면 LaTeX 형식을 사용하여 전문성을 높이세요. 독자가 흥미를 느낄 수 있는 실용적인 팁과 트렌드 정보를 풍성하게 담아주세요.";

    return `[소재 및 주제]\n${topic}\n\n[목표]\n당신은 ${expertPersona}입니다. \n구글 SEO 랭킹 1위를 달성할 수 있도록, 기계 번역투나 AI 특유의 딱딱한 문장을 배제하고 '해당 분야의 전문가가 직접 쓴 듯한 자연스럽고 깊이 있는 문장'으로 블로그 포스팅을 작성하세요.\n\n[가이드라인]\n1. **SEO 및 분량**: 키워드를 자연스럽게 배치하며, 공백 포함 2000자 이상의 상세한 내용을 작성하세요.\n2. **메타 설명**: 150자 내외의 요약문을 포함하세요.\n3. **목표 어조**: ${writingStyle}\n4. **구조**: <h2>, <h3> 태그를 사용하여 SEO 계층 구조를 만드세요.\n5. **원본 이미지 최우선 활용**: 원본 소스에 이미지가 있다면 \`<img src="URL" ... />\` 태그로 직접 삽입하세요.\n6. **AI 이미지 플레이스홀더**: 원본 이미지가 없을 경우 시각적 환기가 필요한 곳에 \`[MID_IMAGE]\`를 삽입하세요.\n7. **LaTeX 형식**: 반드시 \`$$수식$$\` 또는 \`$수식$\` 형식을 사용하세요. \\\\( ... \\\\) 형식은 절대 사용하지 마세요.\n8. **태그 추출**: 포스팅 내용과 관련된 핵심 SEO 키워드 5~8개를 추출하여 'labels' 배열에 포함하세요.\n9. **JSON 형식 엄격 준수**: 오직 아래 JSON만 출력하세요.\n\n\`\`\`json\n{\n  "title": "SEO 최적화 제목",\n  "description": "메타 설명",\n  "thumbnail_title": "썸네일 문구",\n  "mid_image_keyword": "이미지 생성용 영문 프롬프트 (원본 이미지 사용 시 빈 문자열)",\n  "labels": ["태그1", "태그2"],\n  "html": "포스팅 본문 HTML"\n}\n\`\`\``.trim();
  }

  private async ensureLoggedIn(page: Page) {
    const checkStatus = async () => {
      return await page.evaluate(() => {
        const profileSelectors = ['a[href*="SignOut"]', 'img[src*="googleusercontent.com/a/"]', 'button[aria-label*="Google 계정"]', 'button[aria-label*="Google Account"]'];
        return profileSelectors.some(sel => !!document.querySelector(sel));
      });
    };

    let loggedIn = await checkStatus();
    if (!loggedIn) {
      console.log('[GeminiBot] 로그인이 필요합니다. 환경변수 계정으로 로그인을 시도합니다.');
      const id = process.env.GOOGLE_GEMINI_ID;
      const pw = process.env.GOOGLE_GEMINI_PW;
      if (!id || !pw) throw new Error('구글 계정 정보가 없습니다.');

      // 로그인 버튼 클릭 시도
      const loginBtn = page.locator('a[href*="ServiceLogin"], button:has-text("로그인")').first();
      if (await loginBtn.isVisible({ timeout: 5000 })) {
        await loginBtn.click();
        await page.waitForTimeout(3000);
      }

      // 이메일 입력
      const emailInput = page.locator('input[type="email"], #identifierId').first();
      if (await emailInput.isVisible({ timeout: 10000 })) {
        await emailInput.fill(id);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }

      // 비밀번호 입력
      const pwInput = page.locator('input[type="password"]').first();
      if (await pwInput.isVisible({ timeout: 10000 })) {
        await pwInput.fill(pw);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(5000);
      }

      // 앱 페이지로 재이동
      if (!page.url().includes('gemini.google.com/app')) {
        await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);
      }
      await page.waitForTimeout(5000);
      loggedIn = await checkStatus();
    }

    if (!loggedIn) throw new Error('Gemini 로그인 실패');
    console.log('[GeminiBot] 로그인 확인 완료');
  }

  private async submitPrompt(page: Page, prompt: string) {
    const inputSelectors = [
      'div.ql-editor.textarea.new-input-ui',
      'div[contenteditable="true"]',
      'div[role="textbox"]',
      '.ql-editor'
    ];
    
    let inputEl: Locator | null = null;
    for (const sel of inputSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
        inputEl = el;
        break;
      }
    }

    if (!inputEl) throw new Error("입력창을 찾을 수 없습니다.");

    await inputEl.click();
    await page.evaluate((text) => navigator.clipboard.writeText(text), prompt);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
  }

  private async waitForAndExtractJson(page: Page): Promise<GeminiContent> {
    const timeout = 180000;
    const start = Date.now();
    let responseText = "";

    console.log('[GeminiBot] AI 응답 대기 중...');
    let lastFoundText = "";
    let lastChangeTime = Date.now();

    while (Date.now() - start < timeout) {
      const result = await page.evaluate(() => {
        const text = document.body.innerText || '';
        
        // 1. "지금 답변하기" 버튼 체크
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], .action-button'));
        const answerNowBtn = buttons.find(b => {
          const t = ((b as HTMLElement).innerText || '').trim();
          return t.includes('지금 답변하기') || t.includes('Answer now') || t.includes('지금 응답하기');
        });
        
        if (answerNowBtn && (answerNowBtn as HTMLElement).offsetParent !== null) {
          (answerNowBtn as HTMLElement).click();
          return { working: true, text: "", action: 'clicked_answer_now' };
        }

        // 2. 응답 후보들 수집 (역순으로 확인)
        const selectors = [
          'message-turn', 
          'model-response', 
          '.model-response', 
          '.conversation-container .turn',
          'div[id*="message-content"]',
          '.response-container-inner',
          '[role="log"] div'
        ];
        
        let candidates: string[] = [];
        for (const sel of selectors) {
          const els = Array.from(document.querySelectorAll(sel));
          candidates.push(...els.map(el => (el.textContent || "").trim()));
        }
        
        // 3. 로딩 상태 체크
        // mat-progress-spinner가 있거나, .prediction-streaming가 있으면 작업 중
        // 단, .prediction-streaming가 있어도 텍스트가 이미 충분히 나왔다면 완료로 볼 수 있음
        const isWorking =
          document.querySelectorAll('mat-progress-spinner, [aria-label*="로딩"], .loading-indicator, generate-image-progress, mat-spinner').length > 0 ||
          text.includes('이미지 생성 중') ||
          (text.includes('생성 중...') && !text.includes('}')); // JSON이 닫혔다면 생성 중 메시지 무시

        // 역순으로 돌면서 JSON 형식을 갖춘 가장 최근 텍스트 반환
        for (let i = candidates.length - 1; i >= 0; i--) {
          const c = candidates[i];
          if (c.length > 200 && (c.includes('"title"') || c.includes('"제목"')) && (c.includes('"html"') || c.includes('"본문"'))) {
            return { working: isWorking, text: c, found: true, candidatesCount: candidates.length };
          }
        }

        return { working: isWorking, text: "", candidatesCount: candidates.length };
      });

      if (result.action === 'clicked_answer_now') {
        console.log("[GeminiBot] '지금 답변하기' 버튼 클릭됨");
        await page.waitForTimeout(3000);
        continue;
      }

      if (result.found) {
        if (!result.working) {
          responseText = result.text;
          break;
        } else {
          // 텍스트 변화가 없는지 체크 (quiescence check)
          if (result.text === lastFoundText) {
            if (Date.now() - lastChangeTime > 15000) { // 15초간 변화 없으면 강제 추출
              console.log("[GeminiBot] 로딩 중이나 텍스트 변화가 없어 강제 추출 시도");
              responseText = result.text;
              break;
            }
          } else {
            lastFoundText = result.text;
            lastChangeTime = Date.now();
          }
          console.log(`[GeminiBot] JSON 발견했으나 아직 생성 중... (후보 수: ${result.candidatesCount}, 변화 대기 중)`);
        }
      } else {
        // console.log(`[GeminiBot] 대기 중... (후보 수: ${result.candidatesCount})`);
      }
      
      await page.waitForTimeout(3000);
    }

    if (!responseText) {
      await this.screenshot(page, 'gemini_response_timeout');
      throw new Error("AI 응답 추출 실패 또는 시간 초과 (3분 경과)");
    }

    console.log(`[GeminiBot] AI 응답 추출 성공 (길이: ${responseText.length})`);
    return this.robustJsonParse(responseText);
  }

  private robustJsonParse(str: string): GeminiContent {
    let cleaned = str.trim();
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON 블록을 찾을 수 없습니다.");
    
    cleaned = match[1] || match[0];
    
    // 기본적인 이스케이프 수정
    cleaned = cleaned.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
    cleaned = cleaned.replace(/[\u201C\u201D]/g, '"');
    
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      try {
        let fixed = cleaned.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs, (m, p1) => {
          let inner = p1.replace(/\\\\/g, "__BS__").replace(/\\/g, "\\\\").replace(/__BS__/g, "\\\\");
          return `"${inner}"`;
        });
        return JSON.parse(fixed);
      } catch (e2) {
        console.warn("[GeminiBot] JSON 파싱 2차 시도 실패. 강제 정규식 추출 시도.");
        const titleMatch = cleaned.match(/"title"\s*:\s*"(.*?)"\s*,/s);
        const descriptionMatch = cleaned.match(/"description"\s*:\s*"(.*?)"\s*,/s);
        const thumbnailMatch = cleaned.match(/"thumbnail_title"\s*:\s*"(.*?)"\s*,/s);
        const midImageMatch = cleaned.match(/"mid_image_keyword"\s*:\s*"(.*?)"\s*,/s);
        const labelsMatch = cleaned.match(/"labels"\s*:\s*\[(.*?)\]/s);
        const htmlMatch = cleaned.match(/"html"\s*:\s*"(.*?)"\s*(?:,\s*"labels"|\})/s);
        
        if (titleMatch && htmlMatch) {
            let labels: string[] = [];
            if (labelsMatch) {
               labels = labelsMatch[1]
                 .split(',')
                 .map(s => s.replace(/["\n\r]/g, '').trim())
                 .filter(Boolean);
            }
            const unescapeStr = (str: string) => str ? str.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n') : '';
            return {
                title: unescapeStr(titleMatch[1]),
                description: descriptionMatch ? unescapeStr(descriptionMatch[1]) : '',
                thumbnail_title: thumbnailMatch ? unescapeStr(thumbnailMatch[1]) : '',
                mid_image_keyword: midImageMatch ? unescapeStr(midImageMatch[1]) : '',
                html: unescapeStr(htmlMatch[1]),
                labels: labels
            };
        }
        throw new Error(`JSON 파싱 실패 (복구 불가): ${cleaned.slice(0, 100)}...`);
      }
    }
  }

  private async generateImage(page: Page, keyword: string, originalTopic: string): Promise<{ success: boolean; path?: string }> {
    const finalKeyword = keyword || originalTopic.slice(0, 50);
    console.log(`[GeminiBot] 이미지 생성 요청: ${finalKeyword}`);
    
    const inputSelectors = [
      'div.ql-editor.textarea.new-input-ui',
      'div[contenteditable="true"]',
      'div[role="textbox"]',
      '.ql-editor'
    ];
    
    let inputEl: Locator | null = null;
    for (const sel of inputSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
        inputEl = el;
        break;
      }
    }

    if (!inputEl) {
      console.log("[GeminiBot] 이미지 입력창을 찾지 못했습니다. 전역 타이핑 시도.");
    } else {
      await inputEl.click();
    }

    const isCP = this.isCPContext;
    let imagePrompt = `Imagine a high-quality realistic photo of ${finalKeyword}. No text added to image.`;
    
    // 생활문화(isCP=false)인 경우 한국인/한국 배경 요소 강하게 추가
    if (!isCP) {
      imagePrompt = `Imagine a high-quality realistic photography of ${finalKeyword}. Set in Korea with Korean people, Korean background, Asian aesthetic, cinematic lighting, ultra-realistic. No text allowed.`;
    }

    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.keyboard.type(imagePrompt);
    await page.keyboard.press('Enter');

    // 이미지 생성 대기 (최대 120초)
    const start = Date.now();
    const imageSelectors = [
      'img[src*="googleusercontent.com/drawings"]',
      'img[src*="googleusercontent.com/chat_attachments"]',
      'img[src*="content-advisory"]',
      '.generated-image-container img',
      'model-response img',
      'img[alt*="image"]',
      'img[alt*="이미지"]'
    ];

    let foundImg: Locator | null = null;
    console.log("[GeminiBot] 이미지 생성 대기 중 (최대 120초)...");
    while (Date.now() - start < 120000) {
      // 거부됨 메시지 확인
      const text = await page.innerText('body').catch(() => "");
      if (text.includes("만들어 드릴 수 없습니다") || text.includes("I cannot create") || text.includes("이미지 생성이 거부")) {
        console.warn("[GeminiBot] 이미지 생성이 거부되었습니다.");
        break;
      }

      for (const sel of imageSelectors) {
        const imgs = page.locator(sel);
        const count = await imgs.count();
        if (count > 0) {
          const lastImg = imgs.last();
          if (await lastImg.isVisible({ timeout: 2000 }).catch(() => false)) {
            const box = await lastImg.boundingBox();
            if (box && box.width > 100 && box.height > 100) {
              foundImg = lastImg;
              break;
            }
          }
        }
      }
      if (foundImg) break;
      await page.waitForTimeout(4000);
    }

    if (foundImg) {
      const savePath = path.join(process.cwd(), 'tmp', `gemini-img-${Date.now()}.jpg`);
      if (!fs.existsSync(path.dirname(savePath))) fs.mkdirSync(path.dirname(savePath), { recursive: true });
      
      // 이미지가 완전히 로드될 때까지 잠시 대기
      await page.waitForTimeout(2000);
      await foundImg.screenshot({ path: savePath, type: 'jpeg', quality: 90 });
      console.log(`[GeminiBot] 이미지 생성 및 캡처 성공: ${savePath}`);
      return { success: true, path: savePath };
    }

    console.log("[GeminiBot] 이미지 생성 실패 또는 요소를 찾지 못함");
    return { success: false };
  }
}
