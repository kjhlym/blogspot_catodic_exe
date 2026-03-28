import { BloggerBot } from '../lib/blogger';
import { GeminiBot } from '../lib/gemini';
import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });

async function main() {
  const email = process.env.GOOGLE_GEMINI_ID;
  const password = process.env.GOOGLE_GEMINI_PW;
  const blogId = process.env.BLOGGER_BLOG_ID_CATHODIC_PROTECTION || process.env.BLOGGER_BLOG_ID;

  if (!email || !password || !blogId) {
    console.error('❌ 환경 변수가 설정되지 않았습니다 (ID, PW, BLOG_ID).');
    process.exit(1);
  }

  const topic = "전기방식 효율성 향상을 위한 최신 기술 트렌드 (E2E Test)";
  const jobId = `e2e-test-${Date.now()}`;

  console.log(`🚀 E2E 테스트 시작 (Job: ${jobId})`);
  console.log(`  Topic: ${topic}`);

  // 1. Gemini 콘텐츠 생성
  console.log('--- 1. Gemini 콘텐츠 생성 중 ---');
  const gemini = new GeminiBot();
  let content;
  try {
    const geminiResult = await gemini.generate(topic, { headless: false });
    content = geminiResult.content;
    console.log(`  ✅ Gemini 생성 성공: ${content.title}`);
  } catch (err: any) {
    console.error(`  ❌ Gemini 실패: ${err.message}`);
    process.exit(1);
  } finally {
    await gemini.close();
  }

  // 2. Blogger 포스팅
  console.log('\n--- 2. Blogger 포스팅 중 ---');
  const blogger = new BloggerBot({ headless: false });
  try {
    const result = await blogger.execute({
      blogId: blogId,
      email,
      password,
      title: content.title,
      htmlContent: content.html,
      publish: true,
      headless: false
    }, jobId);

    console.log(`\n✅ 최종 성공!`);
    console.log(`  URL: ${result.url}`);
  } catch (err: any) {
    console.error(`\n❌ Blogger 실패: ${err.message}`);
    
    // 에러 발생 시 스크린샷 확인 유도
    const screenshotPath = path.join(process.cwd(), `error-e2e-${Date.now()}.png`);
    // 실제 blogger 인스턴스의 page를 가져올 방법이 없으므로, execute 내부에서 찍도록 유도하거나 
    // 여기서는 실패 메시지만 출력
  } finally {
    await blogger.close();
  }
}

main().catch(console.error);
