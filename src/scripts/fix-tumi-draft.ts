/**
 * fix-tumi-draft.ts
 * 기존 BloggerBot을 이용하여 투미(TUMI) Draft 포스트를 게시(Published)로 전환합니다.
 * postId=5312535114400992216 (임시보관 상태)
 */
import { BloggerBot } from '../lib/blogger';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const POST_ID = '5312535114400992216';
const BLOG_ID = '8772286578401026851';

async function main() {
  const email = process.env.GOOGLE_GEMINI_ID!;
  const password = process.env.GOOGLE_GEMINI_PW!;

  console.log('🚀 투미 Draft → Published 전환 시작...');
  console.log(`  blogId: ${BLOG_ID}, postId: ${POST_ID}`);
  
  // 기존 BloggerBot.execute는 postId가 있으면 업데이트 모드로 동작
  // 단, 업데이트 시에는 isUpdate=true로 '업데이트' 버튼을 누릅니다.
  // 여기서는 postId를 생략하고 새로 열어서 게시하는 방식 대신
  // 직접 에디터를 열어서 Publish 버튼을 클릭합니다.
  
  const blogger = new BloggerBot({ headless: false });
  const jobId = `fix-draft-${Date.now()}`;
  
  try {
    // postId를 제공하면 기존 포스트로 이동해서 업데이트 버튼을 누름
    // 빈 content/title은 현재 값 유지, publish=true로 강제 게시 시도
    const result = await blogger.execute(
      {
        blogId: BLOG_ID,
        email,
        password,
        title: '[실기로운 생활문화] 투미(TUMI), 지중해의 낭만을 입다: \'Mediterranean Escape\' 컬렉션 심층 리뷰',
        htmlContent: '', // 빈 문자열 → 현재 에디터 내용 유지 (setHtmlContent 스킵)
        labels: [],
        postId: POST_ID,
        publish: true,
      },
      jobId
    );

    console.log('\n🎉 완료!');
    console.log(`  URL: ${result.url}`);
  } catch (err: any) {
    console.error('❌ 오류:', err.message);
  } finally {
    await blogger.close().catch(() => {});
  }
}

main().catch(console.error);
