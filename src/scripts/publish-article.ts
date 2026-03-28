/**
 * publish-article.ts
 * 대시보드 서버(dashboard-server.js)에서 spawn으로 호출하는 범용 발행 스크립트.
 * 환경변수로 데이터를 받아 GeminiBot + BloggerBot을 실행합니다.
 *
 * 사용법 (dashboard-server.js에서 spawn):
 *   ARTICLE_JSON='{...}' npx tsx src/scripts/publish-article.ts
 */
import { GeminiBot } from '../lib/gemini';
import { BloggerBot } from '../lib/blogger';
import { resolveBloggerTarget } from '../lib/blogger-targets';
import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });

// ─── 데이터 수신 ──────────────────────────────────────────────────────────────
const articleJson = process.env.ARTICLE_JSON;
if (!articleJson) {
  console.error('[publish-article] ARTICLE_JSON 환경변수가 없습니다.');
  process.exit(1);
}

let article: {
  title: string;
  link: string;
  description?: string;
  category?: string;
  groupId?: string;
};

try {
  article = JSON.parse(articleJson);
} catch (e: any) {
  console.error('[publish-article] ARTICLE_JSON 파싱 실패:', e.message);
  process.exit(1);
}

const email = process.env.GOOGLE_GEMINI_ID!;
const password = process.env.GOOGLE_GEMINI_PW!;

// ─── 카테고리 → blogId 매핑 ───────────────────────────────────────────────────
const target = resolveBloggerTarget(article.category || article.groupId || '');
const { blogId } = target;

console.log(`[publish-article] 카테고리: ${article.category} → blogId: ${blogId}`);

// ─── 프롬프트 구성 ────────────────────────────────────────────────────────────
const topic = [
  `[카테고리]: ${article.category || '뉴스'}`,
  `[주제/제목]: ${article.title}`,
  `[원본 링크]: ${article.link}`,
  `[요약 설명]: ${article.description || ''}`,
  '',
  '위의 글감(주제, 링크, 요약 설명) 내용을 바탕으로 구체적인 살을 붙여 정보성 블로그 포스팅 초본을 완성해줘.',
].join('\n');

// ─── 발행 이력 저장 ───────────────────────────────────────────────────────────
function saveHistory(link: string) {
  const histPath = path.join(process.cwd(), 'history.json');
  const history: string[] = fs.existsSync(histPath)
    ? JSON.parse(fs.readFileSync(histPath, 'utf-8'))
    : [];
  if (!history.includes(link)) {
    history.push(link);
    fs.writeFileSync(histPath, JSON.stringify(history, null, 2), 'utf-8');
  }
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 발행 시작: ${article.title.slice(0, 50)}`);

  const gemini = new GeminiBot();
  const blogger = new BloggerBot({ headless: false });

  try {
    // 1. Gemini 콘텐츠 생성
    console.log('\n1️⃣ Gemini 콘텐츠 생성 중...');
    const result = await gemini.generate(topic, { headless: false, blogKey: target.blogKey });
    console.log(`✅ 생성 완료: ${result.content.title}`);
    console.log(`   이미지: ${result.hasImage ? '있음' : '없음'} | 라벨: ${result.content.labels.join(', ')}`);

    // 2. Blogger 게시
    console.log('\n2️⃣ Blogger 게시 중...');
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
      `dashboard-${Date.now()}`
    );

    console.log(`\n🎉 게시 성공! URL: ${publishResult.url}`);
    
    // 3. 이력 업데이트
    saveHistory(article.link);
    console.log(`✅ history.json 업데이트 완료`);
    
    // 대시보드가 파싱할 결과 출력
    console.log(`[PublishResult] ${JSON.stringify({ url: publishResult.url, title: result.content.title })}`);

  } finally {
    await gemini.close().catch(() => {});
    await blogger.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('❌ 발행 실패:', err.message);
  process.exit(1);
});
