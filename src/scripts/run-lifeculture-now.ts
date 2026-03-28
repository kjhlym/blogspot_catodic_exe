/**
 * run-lifeculture-now.ts
 * 생활문화 미발행 기사 중 첫 번째를 처음부터 끝까지 직접 발행합니다.
 * 대시보드 서버를 우회하여 직접 실행합니다.
 */
import { GeminiBot } from '../lib/gemini';
import { BloggerBot } from '../lib/blogger';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: '.env.local' });

// curation-db에서 미발행 기사 로드
function loadPendingItem() {
  const dbPath = path.join(process.cwd(), 'data', 'curation-db.json');
  const histPath = path.join(process.cwd(), 'history.json');

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  const history: string[] = fs.existsSync(histPath)
    ? JSON.parse(fs.readFileSync(histPath, 'utf-8'))
    : [];

  const group = db['life-culture'];
  if (!group?.items) throw new Error('life-culture 그룹이 없습니다.');

  const pending = group.items.filter((it: any) => !history.includes(it.link));
  if (pending.length === 0) throw new Error('발행할 미발행 기사가 없습니다.');

  return { item: pending[0], history };
}

function buildTopic(item: any): string {
  return [
    `[카테고리]: ${item.category || '생활문화'}`,
    `[주제/제목]: ${item.title}`,
    `[원본 링크]: ${item.link}`,
    `[요약 설명]: ${item.description || ''}`,
    '',
    '위의 글감(주제, 링크, 요약 설명) 내용을 바탕으로 구체적인 살을 붙여 정보성 블로그 포스팅 초본을 완성해줘.',
  ].join('\n');
}

function saveHistory(link: string) {
  const histPath = path.join(process.cwd(), 'history.json');
  const history: string[] = fs.existsSync(histPath)
    ? JSON.parse(fs.readFileSync(histPath, 'utf-8'))
    : [];
  if (!history.includes(link)) {
    history.push(link);
    fs.writeFileSync(histPath, JSON.stringify(history, null, 2), 'utf-8');
    console.log(`✅ history.json에 발행 기록 추가: ${link.slice(0, 60)}...`);
  }
}

async function main() {
  console.log('🚀 [생활문화 발행] 시작...');

  // 미발행 기사 로드
  const { item } = loadPendingItem();
  const topic = buildTopic(item);
  const blogId = process.env.BLOGGER_LIFECULTURE_BLOG_ID || '8772286578401026851';
  const email = process.env.GOOGLE_GEMINI_ID!;
  const password = process.env.GOOGLE_GEMINI_PW!;

  console.log(`\n📰 선택된 기사: ${item.title}`);
  console.log(`📌 카테고리: ${item.category}`);
  console.log(`🔗 링크: ${item.link}`);
  console.log(`📋 블로그 ID: ${blogId}\n`);

  const gemini = new GeminiBot();
  const blogger = new BloggerBot({ headless: false });

  try {
    // ─── 1단계: Gemini 콘텐츠 생성 ─────────────────────────────
    console.log('─'.repeat(50));
    console.log('1️⃣  Gemini 콘텐츠 생성 중...');
    const result = await gemini.generate(topic, { headless: false });
    console.log('✅ Gemini 생성 완료');
    console.log(`  ├─ 제목: ${result.content.title}`);
    console.log(`  ├─ 이미지: ${result.hasImage ? '생성됨 ✓' : '없음'}`);
    if (result.imagePath) console.log(`  ├─ 이미지 경로: ${result.imagePath}`);
    console.log(`  └─ 라벨: ${result.content.labels.join(', ')}`);

    // ─── 2단계: Blogger 게시 ─────────────────────────────────────
    console.log('\n' + '─'.repeat(50));
    console.log('2️⃣  Blogger 게시 중...');
    const publishResult = await blogger.execute(
      {
        blogId,
        email,
        password,
        title: result.content.title,
        htmlContent: result.content.html,
        imagePath: result.imagePath,
        labels: result.content.labels,
        publish: true,
      },
      `life-${Date.now()}`
    );

    console.log('\n' + '='.repeat(50));
    console.log('🎉 게시 성공!');
    console.log(`  └─ URL: ${publishResult.url}`);
    console.log('='.repeat(50));

    // ─── 3단계: history.json 업데이트 ───────────────────────────
    saveHistory(item.link);

  } catch (error: any) {
    console.error('\n❌ 오류 발생:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  } finally {
    await gemini.close().catch(() => {});
    await blogger.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
