import fs from 'fs';
import path from 'path';
import { CURATION_PRESET_GROUPS } from './curation-presets';
import { getHistory } from './history';

// 1. RSS에서 여러 아이템을 파싱하여 히스토리에 없는 새로운 링크를 찾음
async function getNewArticleLink(query: string, history: string[]) {
  try {
    const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`);
    if (!res.ok) return null;
    
    const text = await res.text();
    // RSS의 모든 <item> 블록 추출
    const itemMatches = text.matchAll(/<item>([\s\S]*?)<\/item>/g);
    
    for (const match of itemMatches) {
      const itemContent = match[1];
      const linkMatch = itemContent.match(/<link>(.*?)<\/link>/);
      const titleMatch = itemContent.match(/<title>(.*?)<\/title>/);
      
      if (linkMatch && linkMatch[1]) {
        const link = linkMatch[1].trim();
        const title = titleMatch ? titleMatch[1].trim() : query;
        
        // 히스토리에 없는 링크라면 당첨!
        if (!history.includes(link)) {
          return { link, title };
        }
      }
    }
  } catch(e) {
    console.error(`[CRAWLER] RSS fetch error for ${query}:`, e);
  }
  return null;
}

// 2. OpenAlex 논문 검색 (여러 결과 중 새로운 것 선택)
async function getNewAcademicPaperLink(query: string, history: string[]) {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=10`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    
    if (json.results && json.results.length > 0) {
      for (const result of json.results) {
        const link = result.doi || result.id;
        if (!history.includes(link)) {
          return {
            link: link,
            title: result.title
          };
        }
      }
    }
  } catch(e) {
    console.error(`[CRAWLER] OpenAlex fetch error for ${query}:`, e);
  }
  return null;
}

export async function runCurationCrawler() {
  console.log('🚀 [CRAWLER] 최신 데이터 수집 시작 (미발행 위주)...');
  const db: Record<string, any> = {};
  const history = getHistory(); // d:/rpa/blogspot_catodic_exe/history.json

  for (const group of CURATION_PRESET_GROUPS) {
    console.log(`\n📌 카테고리 기사 수집: ${group.label}`);
    const groupItems = [];

    for (const preset of group.queries) {
      const query = preset.query;
      const searchQuery = preset.domain ? `site:${preset.domain} ${query}` : query;
      
      let article = null;
      let displayTitle = '';
      let realLink = '';
      let description = `${group.label} 관련 최신 전문 기술 자료입니다.`;

      if (group.id === 'cp-academic') {
        article = await getNewAcademicPaperLink(searchQuery, history);
        if (article) {
          realLink = article.link;
          displayTitle = `[학술논문] ${article.title}`;
          description = '학술 저널(OpenAlex)에서 수집된 미발행 연구 자료입니다.';
        }
      } 
      
      // 학술 정보가 없거나 다른 카테고리인 경우 RSS 검색
      if (!realLink) {
        article = await getNewArticleLink(searchQuery, history);
        if (article) {
          realLink = article.link;
          displayTitle = `[${group.label}] ${article.title}`;
        } else {
          // 백업: 만약 새로운 기사가 하나도 없다면 Google 검색 링크라도 생성
          realLink = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
          displayTitle = `[검색결과] ${query}`;
          description = '해당 키워드에 대한 새로운 기사를 찾지 못해 검색 결과로 대체합니다.';
        }
      }

      console.log(`  -> 수집 대상: ${displayTitle}`);
      
      groupItems.push({
        title: displayTitle,
        link: realLink,
        description: description,
        category: group.label,
        keyword: query,
        searchType: preset.searchType,
      });

      await new Promise(resolve => setTimeout(resolve, 300));
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
  console.log(`\n✅ [CRAWLER] 수집 완료! (미발행 기사 우선 저장)`);
  return db;
}
