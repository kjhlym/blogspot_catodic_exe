
import { BloggerBot } from '../src/lib/blogger';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function runTest() {
  console.log('🚀 Starting Verification Test...');
  
  const testHtmlPath = path.join('d:', 'rpa', 'blogspot_catodic_exe', 'output', 'playwright', 'final_post_1774558710548.html');
  let htmlContent = fs.readFileSync(testHtmlPath, 'utf-8');
  
  // 의도적으로 잘못된 포맷의 문자열 추가 (테스트용)
  // 예: literal \\n\\n 및 \n\n
  const dirtyPrefix = '테스트 글 서두입니다.\\n\\n이 부분은 줄 바꿈이 제대로 되어야 합니다.\n\n';
  htmlContent = dirtyPrefix + htmlContent;

  const bot = new BloggerBot({ headless: false });
  
  const jobData = {
    email: process.env.GOOGLE_GEMINI_ID,
    password: process.env.GOOGLE_GEMINI_PW,
    blogId: process.env.BLOGGER_BLOG_ID,
    title: '[검증 테스트] 2026 전기방식 산업 트렌드 분석',
    htmlContent: htmlContent,
    labels: ['전기방식', '테스트', '2026트렌드', 'RPA'],
    link: 'https://test-verification-link.com'
  };

  try {
    console.log('Job Data prepared. Executing BloggerBot...');
    const result = await bot.execute(jobData as any, 'verify-job-1');
    console.log('✅ Test Successful:', result);
  } catch (err: any) {
    console.error('❌ Test Failed:', err.message);
    if (bot['page']) {
      const errorDir = path.join('d:', 'rpa', 'blogspot_catodic_exe', 'output', 'playwright');
      if (!fs.existsSync(errorDir)) fs.mkdirSync(errorDir, { recursive: true });
      await bot['page'].screenshot({ path: path.join(errorDir, 'verify-debug-final.png'), fullPage: true });
      console.log('📸 Debug screenshot saved to output/playwright/verify-debug-final.png');
    }
  } finally {
    console.log('Closing bot...');
    await bot.close();
  }
}

runTest();
