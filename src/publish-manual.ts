
import { BloggerBot, BloggerJobData } from './lib/blogger';
import { Notifier } from './lib/notifier';
import dotenv from 'dotenv';
import path from 'path';

// .env.local 로드
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function main() {
  const blogId = process.env.BLOGGER_LIFECULTURE_BLOG_ID || '8772286578401026851';
  const email = process.env.GOOGLE_GEMINI_ID;
  const password = process.env.GOOGLE_GEMINI_PW;

  const bot = new BloggerBot({ headless: false }); // 수동 확인을 위해 headless: false

  const jobData: BloggerJobData = {
    blogId,
    email,
    password,
    title: "심장 건강을 지키는 5가지 필수 생활 습관",
    htmlContent: `
      <h2>심장 건강, 왜 중요한가요?</h2>
      <p>심장은 우리 몸의 엔진과 같습니다. 침묵의 살인자라고 불리는 심혈관 질환은 예방이 무엇보다 중요합니다. 일상에서 실천할 수 있는 5가지 습관을 소개합니다.</p>
      
      <h3>1. 규칙적인 유산소 운동</h3>
      <p>하루 30분, 주 5회 이상의 가벼운 조깅이나 산책은 심근을 강화하고 혈액 순환을 돕습니다.</p>
      
      <h3>2. 저염식과 채소 중심의 식단</h3>
      <p>나트륨 섭취를 줄이고 식이섬유가 풍부한 채소, 과일, 통곡물을 섭취하여 혈압을 조절하세요.</p>
      
      <h3>3. 충분한 수면 시간 확보</h3>
      <p>하루 7-8시간의 양질의 수면은 심장의 휴식을 돕고 스트레스 호르몬 수치를 낮춥니다.</p>
      
      <h3>4. 정기적인 혈압 및 콜레스테롤 체크</h3>
      <p>자신의 수치를 아는 것이 예방의 시작입니다. 가까운 보건소나 병원에서 정기 검진을 받으세요.</p>
      
      <h3>5. 금연과 절주</h3>
      <p>담배의 니코틴과 술은 혈관을 수축시키고 심장에 무리를 줍니다. 건강을 위해 멀리하세요.</p>
      
      <p>지금 바로 작은 습관부터 시작해 보세요. 당신의 심장이 고마워할 것입니다.</p>
    `,
    labels: ["생활건강", "심장관리", "건강습관", "자기관리"],
    publish: true
  };

  console.log('Manually publishing "Heart Health Tips" to Blogger...');
  
  try {
    const result = await bot.execute(jobData, 'manual-job-' + Date.now());
    console.log('Publication successful:', result);
  } catch (error) {
    console.error('Publication failed:', error);
  } finally {
    await bot.close();
  }
}

main();
