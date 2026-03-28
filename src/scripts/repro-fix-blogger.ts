import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { BloggerBot } from '../lib/blogger';

dotenv.config({ path: '.env.local' });

async function runRepro() {
  const email = process.env.GOOGLE_GEMINI_ID;
  const password = process.env.GOOGLE_GEMINI_PW;
  const blogId = process.env.BLOGGER_BLOG_ID;

  if (!email || !password || !blogId) {
    console.error("환경 변수가 설정되지 않았습니다 (GOOGLE_GEMINI_ID, GOOGLE_GEMINI_PW, BLOGGER_BLOG_ID)");
    return;
  }

  // 기존 HTML 파일 중 하나 선택 (가장 최근 것)
  const playwrightDir = path.join(process.cwd(), 'output', 'playwright');
  let htmlContent = "";
  let sourceFileName = "DummyContent";

  if (fs.existsSync(playwrightDir)) {
    const files = fs.readdirSync(playwrightDir)
      .filter(f => f.startsWith('final_post_') && f.endsWith('.html'))
      .map(f => ({ name: f, time: fs.statSync(path.join(playwrightDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (files.length > 0) {
      const testFile = path.join(playwrightDir, files[0].name);
      htmlContent = fs.readFileSync(testFile, 'utf8');
      sourceFileName = files[0].name;
    }
  }

  if (!htmlContent) {
    console.log("[Repro] 기존 HTML 파일을 찾지 못해 샘플 콘텐츠를 생성합니다.");
    htmlContent = `
      <p>Blogger 자동화 수정 및 검증 테스트입니다.</p>
      <h2>에포크 2026 로드맵</h2>
      <ul>
        <li>셀렉터 안정화</li>
        <li>게시 확인 로직 강화</li>
        <li>본문 유실 방지</li>
      </ul>
      <p>MathJax 테스트: $E = mc^2$</p>
    `;
  }

  const title = `[Fix Test] ${new Date().toLocaleString('ko-KR')}`;
  console.log(`[Repro] 테스트 시작: ${title}`);
  console.log(`[Repro] 소스: ${sourceFileName}`);

  // Headless false로 시각적 확인 가능하게 설정, slowMo 제거
  const bot = new BloggerBot({ headless: false });
  
  try {
    const jobId = `repro-${Date.now()}`;
    const result = await bot.execute({
      email,
      password,
      blogId,
      title,
      htmlContent,
      publish: true,
      labels: ["자동화테스트", "FixVerification"]
    }, jobId);

    console.log("[Repro] 결과:", result);
  } catch (e) {
    console.error("[Repro] 오류 발생:", e);
  }
}

runRepro();
