import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface RefinedContent {
  title: string;
  html_content: string;
  image_prompt: string;
}

export async function refineNewsWithGemini(
  rawNewsText: string,
  onProgress?: (chunk: string) => void
): Promise<RefinedContent> {
  try {
    const systemPrompt = `
      너는 친근한 30대 직장인 감성의 Blogger 운영자야.
      주어진 딱딱한 뉴스 기사를 읽기 편한 구어체 톤으로 변환해줘.

      [조건]
      1. 결과물은 반드시 Blogger에 바로 넣을 수 있는 부분 HTML 코드로 작성할 것 (<html>, <body> 제외, <p>, <h2>, <ul>, <strong> 등만 사용).
      2. 이 블로그 포스팅에 적합한 매력적이고 간결한 '포스팅 제목'을 하나 작성해.
      3. 이 글의 주제를 가장 잘 나타내는 '썸네일 이미지'를 생성하기 위한 고품질의 영문 프롬프트를 작성해.

      반드시 아래 형식으로 응답해. 각 섹션은 지정된 구분자로 시작해야 해:

      ---TITLE---
      작성한 포스팅 제목

      ---IMAGE_PROMPT---
      A realistic photo of...

      ---HTML_CONTENT---
      <p>당신이 작성한 HTML 코드...</p>
    `;

    const resultStream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: `${systemPrompt}\n\n[원본 뉴스]\n${rawNewsText}`,
    });

    let responseText = "";
    for await (const chunk of resultStream) {
      const chunkText = chunk.text;
      if (chunkText) {
        responseText += chunkText;
        if (onProgress) {
          onProgress(chunkText);
        }
      }
    }

    if (!responseText) throw new Error("Gemini returned empty response");

    const titleMatch = responseText.match(/---TITLE---[\s\S]*?([^\n]+)[\s\S]*?(?:---IMAGE_PROMPT---)/) || responseText.match(/---TITLE---\s*([\s\S]*?)\s*---IMAGE_PROMPT---/);
    const promptMatch = responseText.match(/---IMAGE_PROMPT---\s*([\s\S]*?)\s*---HTML_CONTENT---/);
    const htmlMatch = responseText.match(/---HTML_CONTENT---\s*([\s\S]*)$/);

    const title = titleMatch ? titleMatch[1].trim() : "AI 요약 뉴스";
    const image_prompt = promptMatch ? promptMatch[1].trim() : "";
    const html_content = htmlMatch ? htmlMatch[1].trim() : responseText;

    return { title, html_content, image_prompt };
  } catch (error) {
    console.error("Gemini AI 처리 중 오류 발생:", error);
    throw error;
  }
}

export async function generateAndSaveThumbnail(imagePrompt: string, articleTitle?: string): Promise<string> {
  try {
    const searchKeyword = imagePrompt.split(" ").slice(0, 3).join(" ");
    const safeTitle = (articleTitle || "AI 요약 뉴스").substring(0, 80);

    const svgContent = `
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0F766E" />
          <stop offset="100%" stop-color="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <foreignObject x="40" y="40" width="720" height="520">
        <div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; flex-direction: column; justify-content: center; align-items: center; width: 100%; height: 100%; text-align: center; color: white; font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;">
          <h1 style="font-size: 42px; font-weight: bold; line-height: 1.4; margin: 0 0 20px 0; word-break: keep-all; text-shadow: 0px 2px 4px rgba(0,0,0,0.5);">
            ${safeTitle}
          </h1>
          <p style="font-size: 24px; margin: 0; color: rgba(255,255,255,0.9); text-shadow: 0px 1px 2px rgba(0,0,0,0.5);">
            ${searchKeyword}
          </p>
        </div>
      </foreignObject>
    </svg>`;

    const tmpDir = path.join(process.cwd(), "tmp");
    await fs.mkdir(tmpDir, { recursive: true });

    const localImagePath = path.join(tmpDir, `thumbnail_${Date.now()}.png`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    await page.setContent(`<html><body style="margin:0;padding:0;overflow:hidden;">${svgContent}</body></html>`);
    await page.screenshot({ path: localImagePath });
    await browser.close();

    return localImagePath;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("이미지 생성/저장 실패 (무시하고 진행):", message);
    return "";
  }
}