/**
 * tistory-vibe.js
 */

require('dotenv').config({ path: './.env.local' });
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { chromium } = require('playwright');

// 환경 변수 확인
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY가 .env.local에 없습니다.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const TOPICS_PATH = path.join(process.cwd(), 'topics.json');
const DOWNLOADS_DIR = 'C:\\Users\\kks\\Downloads';
const BANANA_PNG = path.join(DOWNLOADS_DIR, 'banana.png');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// 나노바나나 SVG 생성 유틸
function escXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildBananaSvg(title) {
  const words = title.split('');
  const lines = [];
  let current = '';
  for (const ch of words) {
    current += ch;
    if (current.length >= 10) { lines.push(current); current = ''; }
  }
  if (current) lines.push(current);

  const lineCount = Math.min(lines.length, 6);
  const lineHeight = 42;
  const totalTextHeight = lineCount * lineHeight;
  const startY = Math.round((450 - totalTextHeight) / 2) + 16;

  const titleLines = lines
    .slice(0, 6)
    .map((line, i) =>
      `<text x="400" y="${startY + i * lineHeight}" font-family="'Noto Sans KR', Arial, sans-serif" font-size="34" font-weight="900" fill="#422006" text-anchor="middle">${escXml(line)}</text>`
    )
    .join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#FCD34D"/>
      <stop offset="100%" stop-color="#F59E0B"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" rx="20" fill="url(#bgGrad)"/>
  <circle cx="90"  cy="85" r="50" fill="#FDE68A" opacity="0.4"/>
  <circle cx="710" cy="365" r="70" fill="#FDE68A" opacity="0.3"/>
  ${titleLines}
  <text x="400" y="435" font-family="sans-serif" font-size="13" font-weight="bold" fill="#78350F" opacity="0.6" text-anchor="middle">Nanobanana Style</text>
</svg>`;
}

async function generateBananaPng(title) {
  const svg = buildBananaSvg(title);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const svgB64 = Buffer.from(svg).toString('base64');
  await page.setContent(`<html><body style="margin:0;padding:0;overflow:hidden;"><img src="data:image/svg+xml;base64,${svgB64}" width="800" height="450"/></body></html>`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: BANANA_PNG });
  await browser.close();
  console.log(`[Banana] 이미지 저장 완료: ${BANANA_PNG}`);
  return BANANA_PNG;
}

// Gemini API (Working Model!)
async function generatePost(topic) {
  const modelName = "gemini-2.5-flash"; // 이 환경에서 유일하게 작동하는 모델
  try {
    const prompt = `
주제: "${topic}"
위 주제로 블로그 포스팅을 작성해줘.
1. 제목은 클릭하고 싶게 자극적으로.
2. 본문은 HTML 형식으로 (h2, h3, p 태그 적극 활용).
3. 본문 중간에 반드시 [MID_IMAGE] 라는 텍스트를 정확히 한 번 포함해줘. (이 위치에 이미지가 삽입될 거야)
4. 결과는 반드시 아래 JSON 형식으로만 출력해줘:
{
  "title": "제목",
  "html": "본문 HTML",
  "image_text": "이미지 안에 들어갈 10자 내외의 짧은 글귀"
}
`;

    const result = await ai.models.generateContent({
      model: modelName,
      contents: prompt
    });

    const text = result.text.replace(/```json|```/g, "").trim();
    return JSON.parse(text);
  } catch (e) {
    console.error(`[Gemini] 모델 ${modelName} 호출 실패: ${e.message}`);
    throw e;
  }
}

// 메인 실행 함수
async function main() {
  try {
    const topicsData = JSON.parse(fs.readFileSync(TOPICS_PATH, 'utf-8'));
    const allTopics = [];
    Object.keys(topicsData).forEach(cat => {
      if (Array.isArray(topicsData[cat])) allTopics.push(...topicsData[cat]);
    });
    const randomTopic = allTopics[Math.floor(Math.random() * allTopics.length)];
    
    console.log(`[Topic] 선정된 주제: ${randomTopic}`);

    const post = await generatePost(randomTopic);
    console.log(`[Gemini] 글 생성 완료: ${post.title}`);

    await generateBananaPng(post.image_text || post.title.slice(0, 10));

    // 티스토리 포스팅 로직 호출
    const { postToTistory } = require('../lib/tistory');
    await postToTistory(post.title, post.html, BANANA_PNG);
    
    console.log("[Success] 모든 과정이 완료되었습니다.");
  } catch (error) {
    console.error("[Error] 실행 중 오류 발생:", error);
  }
}

main();
