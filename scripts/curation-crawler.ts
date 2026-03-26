import fs from 'fs';
import path from 'path';
import { CURATION_PRESET_GROUPS } from '../src/lib/curation-presets';

/**
 * Google News RSS에서 최신 기사를 수집합니다.
 * 한글이 포함된 쿼리: 한국어 뉴스(hl=ko) 사용
 * 영어 쿼리: 영어 뉴스(hl=en) 사용 → 기술 전문 키워드 수집률 향상
 */
async function getRealArticleLink(query: string, domain?: string): Promise<{ link: string; title: string } | null> {
  try {
    // 한글 포함 여부 감지
    const isKorean = /[ㄱ-ㅎ가-힣]/.test(query);
    const lang = isKorean ? 'ko&gl=KR&ceid=KR:ko' : 'en&gl=US&ceid=US:en';
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const text = await res.text();
    const itemMatches = text.matchAll(/<item>([\s\S]*?)<\/item>/g);
    for (const match of itemMatches) {
      const itemContent = match[1];
      const linkMatch = itemContent.match(/<link>(.*?)<\/link>/);
      const titleMatch = itemContent.match(/<title>(.*?)<\/title>/);
      if (linkMatch?.[1]) {
        return {
          link: linkMatch[1].trim(),
          title: titleMatch ? titleMatch[1].trim() : query,
        };
      }
    }
  } catch (e) {
    console.error(`[CRAWLER] RSS fetch error for ${query}:`, e);
  }
  return null;
}

/**
 * OpenAlex 학술 논문 검색 (학술 카테고리 전용)
 */
async function getAcademicPaperLink(query: string): Promise<{ link: string; title: string } | null> {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=5`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.results?.length > 0) {
      const top = json.results[0];
      return { link: top.doi || top.id, title: top.title };
    }
  } catch (e) {
    console.error(`[CRAWLER] OpenAlex fetch error for ${query}:`, e);
  }
  return null;
}

async function runCrawler() {
  console.log('🚀 [CRAWLER] 수집 봇 가동 시작...');
  const db: Record<string, any> = {};

  for (const group of CURATION_PRESET_GROUPS) {
    console.log(`\n📌 카테고리 수집 중: ${group.label} (${group.id})`);
    const groupItems = [];

    for (const preset of group.queries) {
      const query = preset.query;
      let displayTitle = `[${group.label}] ${query}`;
      let realLink = '';
      let description = `${group.label} 주제에 따른 전문 기술 자료 및 최신 동향입니다.`;

      // 1순위: 학술 카테고리는 OpenAlex 사용
      if (group.id === 'cp-academic' || group.id === 'cp-research') {
        const paper = await getAcademicPaperLink(query);
        if (paper) {
          realLink = paper.link;
          displayTitle = `[학술논문] ${paper.title || query}`;
          description = 'OpenAlex를 통해 수집된 전기방식 학술 논문 소스입니다.';
        }
      }

      // 2순위: Google News RSS (domain 사용 안 함 — RSS는 site: 미지원)
      if (!realLink) {
        const article = await getRealArticleLink(query, preset.domain);
        if (article) {
          realLink = article.link;
          displayTitle = `[${group.label}] ${article.title}`;
        }
      }

      // 3순위(백업): 구글 검색 링크
      if (!realLink) {
        const fallbackQuery = preset.domain ? `site:${preset.domain} ${query}` : query;
        realLink = `https://www.google.com/search?q=${encodeURIComponent(fallbackQuery)}`;
        displayTitle = `[검색결과] ${query}`;
        description = '새로운 기사를 찾지 못해 Google 검색 결과로 대체했습니다.';
        console.log(`  ⚠️  RSS 수집 실패, 구글 검색 링크로 대체: ${query}`);
      }

      console.log(`  -> 수집 완료: ${displayTitle}`);

      groupItems.push({
        title: displayTitle,
        link: realLink,
        description,
        category: group.label,
        keyword: query,
        searchType: preset.searchType,
      });

      // API Rate Limit 방지
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    db[group.id] = {
      group: {
        id: group.id,
        label: group.label,
        description: group.description,
        audience: group.audience,
      },
      items: groupItems,
    };
  }

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'curation-db.json');
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
  console.log(`\n✅ [CRAWLER] 수집 완료! 데이터 저장: ${dbPath}`);
}

runCrawler().catch(console.error);
