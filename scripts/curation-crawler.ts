import fs from 'fs';
import path from 'path';
import { CURATION_PRESET_GROUPS } from '../src/lib/curation-presets';

// 실제 뉴스/기사 링크를 Google News RSS에서 가져옴
async function getRealArticleLink(query: string) {
  try {
    const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`);
    if (!res.ok) return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const text = await res.text();
    const match = text.match(/<item>[\s\S]*?<link>(.*?)<\/link>/);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch(e) {
    console.error(`[CRAWLER] RSS fetch error for ${query}:`, e);
  }
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// OpenAlex 논문 검색 API 사용 (학술 자료용)
async function getAcademicPaperLink(query: string) {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.results && json.results.length > 0) {
      const topResult = json.results[0];
      return {
        link: topResult.doi || topResult.id,
        title: topResult.title
      };
    }
  } catch(e) {
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
      const title = preset.query;
      const searchQuery = preset.domain ? `site:${preset.domain} ${title}` : title;
      
      let realLink = '';
      let displayTitle = `[${group.label}] ${title}`;
      let description = `${group.label} 주제에 따른 전문 기술 자료 및 최신 동향입니다.`;

      if (group.id === 'cp-academic') {
        const paper = await getAcademicPaperLink(searchQuery);
        if (paper) {
          realLink = paper.link;
          displayTitle = `[학술논문] ${paper.title || title}`;
          description = 'OpenAlex를 통해 수집된 최신 전기방식 논문 소스입니다.';
        } else {
          realLink = await getRealArticleLink(searchQuery);
        }
      } else {
        realLink = await getRealArticleLink(searchQuery);
      }

      console.log(`  -> 수집 완료: ${displayTitle}`);
      
      groupItems.push({
        title: displayTitle,
        link: realLink,
        description: description,
        category: group.label,
        keyword: preset.query,
        searchType: preset.searchType,
      });

      // API Rate Limit 방지를 위해 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 500));
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

  // data 폴더 확인 및 생성
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'curation-db.json');
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
  console.log(`\n✅ [CRAWLER] 수집 완료! 데이터가 저장되었습니다: ${dbPath}`);
}

runCrawler().catch(console.error);
