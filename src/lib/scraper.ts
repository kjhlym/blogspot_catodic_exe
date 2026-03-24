import * as cheerio from "cheerio";

export interface ScrapedArticle {
  title: string;
  link: string;
  content: string;
}

export async function scrapeNews(keyword: string, limit: number): Promise<ScrapedArticle[]> {
  try {
    // 1. Fetch search results from Daum News
    const encodedKeyword = encodeURIComponent(keyword);
    const searchUrl = `https://search.daum.net/search?w=news&q=${encodedKeyword}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      cache: "no-store",
    });
    if (!searchRes.ok) {
      throw new Error(`Daum 검색 페이지 요청 실패: ${searchRes.status}`);
    }
    const searchHtml = await searchRes.text();

    const $ = cheerio.load(searchHtml);
    const articles: { title: string, link: string }[] = [];
    const seenLinks = new Set<string>();

    // Extract Daum news links
    $('a[href*="v.daum.net/v/"]').each((i, el) => {
      if (articles.length >= limit) return false;
      const title = $(el).text().trim();
      const link = $(el).attr("href") || "";
      if (title.length > 10 && link && !seenLinks.has(link)) {
        seenLinks.add(link);
        articles.push({ title, link });
      }
    });

    // 2. Fetch content for each link
    const results: ScrapedArticle[] = [];
    for (const article of articles) {
      try {
        const articleRes = await fetch(article.link, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          },
          cache: "no-store",
        });
        if (!articleRes.ok) {
          throw new Error(`기사 본문 요청 실패: ${articleRes.status}`);
        }
        const articleHtml = await articleRes.text();
        const $art = cheerio.load(articleHtml);
        
        let content = "";
        $art("p, div.article_view, section").each((i, el) => {
          const text = $art(el).text().trim();
          if (text.length > 50) {
             content += text + "\\n\\n";
          }
        });

        if (content.trim().length > 100) {
          results.push({
            title: article.title,
            link: article.link,
            content: content.slice(0, 5000) 
          });
        }

        // Slight delay to be polite
        await new Promise((res) => setTimeout(res, 500));
      } catch (err) {
        console.error(`Failed to fetch article content for ${article.link}`, err);
      }
    }

    return results;
  } catch (error) {
    console.error("Scraping error:", error);
    throw new Error("뉴스 스크래핑에 실패했습니다.");
  }
}
