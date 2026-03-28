import { GeminiBot } from '../lib/gemini';
import { BloggerBot } from '../lib/blogger';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: '.env.local' });

async function main() {
  const topic = "[실기로운 생활문화] 봄철 환절기 면역력 강화 비법: 당신의 건강을 지키는 5가지 핵심 전략\nLink: https://news.google.com/rss/articles/CBMiC... (생략)\nKeyword: 봄철 환절기 건강 관리 비법";
  const blogId = process.env.BLOGGER_LIFECULTURE_BLOG_ID || "8772286578401026851";
  const email = process.env.GOOGLE_GEMINI_ID;
  const password = process.env.GOOGLE_GEMINI_PW;

  console.log(`🚀 [Test] 생활문화 기사 게시 시작...`);
  console.log(`- 주제: ${topic.split('\n')[0]}`);
  console.log(`- 블로그 ID: ${blogId}`);

  const gemini = new GeminiBot();
  const blogger = new BloggerBot({ headless: false });

  try {
    // 1. Gemini 콘텐츠 생성
    console.log('\n1️⃣ Gemini 콘텐츠 생성 중...');
    const result = await gemini.generate(topic, { headless: false });
    console.log('✅ Gemini 생성 완료');
    console.log(`- 제목: ${result.content.title}`);
    console.log(`- 이미지 생성 성공: ${result.hasImage ? 'YES' : 'NO'}`);
    if (result.imagePath) console.log(`- 이미지 경로: ${result.imagePath}`);
    console.log(`- 라벨: ${result.content.labels.join(', ')}`);

    // 2. Blogger 게시
    console.log('\n2️⃣ Blogger 게시 중...');
    const publishResult = await blogger.execute({
      blogId,
      email,
      password,
      title: result.content.title,
      htmlContent: result.content.html,
      imagePath: result.imagePath,
      labels: result.content.labels,
      publish: true
    }, `test-life-${Date.now()}`);

    console.log('\n🎉 게시 성공!');
    console.log(`- URL: ${publishResult.url}`);

  } catch (error: any) {
    console.error('\n❌ 오류 발생:', error.message);
    if (error.stack) console.error(error.stack);
  } finally {
    await gemini.close();
    await blogger.close();
  }
}

main().catch(console.error);
