import { NextResponse } from "next/server";
import { scrapeNews } from "@/lib/scraper";
import { refineNewsWithGemini, generateAndSaveThumbnail } from "@/lib/ai";
import { isBloggerReady, postToBlogger } from "@/lib/blogger";

export const dynamic = "force-dynamic";

function methodNotAllowed() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}

export async function POST(req: Request) {
  let body: { keyword?: string; count?: number; category?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문은 JSON 형식이어야 합니다." }, { status: 400 });
  }

  const { keyword, count, category } = body;

  if (!keyword || !count) {
    return NextResponse.json({ error: "키워드와 수량이 필요합니다." }, { status: 400 });
  }

  if (!isBloggerReady()) {
    return NextResponse.json(
      { error: "Blogger API 인증 정보가 없습니다. .env.local의 BLOGGER_ACCESS_TOKEN 또는 refresh token 설정이 필요합니다." },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const log = (msg: string) => {
        console.log(msg);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message: msg })}\n\n`));
      };

      const streamChunk = (chunk: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ stream: chunk })}\n\n`));
      };

      const error = (msg: string) => {
        console.error(msg);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
      };

      try {
        log(`[RPA] 스크래핑 시작: ${keyword} (${count}개)`);
        const articles = await scrapeNews(keyword, count);

        if (articles.length === 0) {
          error("스크래핑된 기사가 없습니다.");
          controller.close();
          return;
        }

        log(`[RPA] 총 ${articles.length}개의 기사 수집 완료. Gemini 정제 후 Blogger API 발행을 시작합니다...`);

        let successCount = 0;

        for (const [idx, article] of articles.entries()) {
          try {
            log(`[RPA] ${idx + 1}/${articles.length}: "${article.title}" AI 정제 중...`);

            const { title: aiTitle, html_content, image_prompt } = await refineNewsWithGemini(
              article.content,
              (chunk) => streamChunk(chunk)
            );

            log(`[RPA] ${idx + 1}/${articles.length}: 썸네일 생성 중...`);
            const thumbnailPath = await generateAndSaveThumbnail(image_prompt, aiTitle || article.title);

            log(`[RPA] ${idx + 1}/${articles.length}: Blogger API 발행 중...`);
            const title = aiTitle || `[AI 요약] ${article.title}`;
            await postToBlogger({
              title,
              htmlContent: html_content,
              imagePath: thumbnailPath,
              category: category || "뉴스",
            });

            successCount++;

            const delay = Math.floor(Math.random() * 2000) + 3000;
            log(`[RPA] 발행 성공. 다음 작업 전 대기 중... (${delay}ms)`);
            await new Promise((res) => setTimeout(res, delay));
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            error(`[RPA] 기사 처리 실패 (${article.title}): ${message}`);
          }
        }

        log(`[RPA] 작업 완료. 총 ${articles.length}개 중 ${successCount}개 성공.`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        error(`[RPA] 메인 프로세스 에러: ${message}`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;