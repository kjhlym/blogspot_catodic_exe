import fs from 'fs';
import path from 'path';
import { CURATION_PRESET_GROUPS } from './curation-presets';
import { getHistory } from './history';

// 1. RSS에서 여러 아이템을 파싱하여 히스토리에 없는 새로운 링크를 찾음
async function getNewArticleLink(query: string, history: string[]) {
  const trySearch = async (q: string) => {
    try {
      const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`);
      if (!res.ok) return null;
      
      const text = await res.text();
      const itemMatches = text.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const itemContent = match[1];
        const linkMatch = itemContent.match(/<link>(.*?)<\/link>/);
        const titleMatch = itemContent.match(/<title>(.*?)<\/title>/);
        
        if (linkMatch && linkMatch[1]) {
          const link = linkMatch[1].trim();
          const title = titleMatch ? titleMatch[1].trim() : q;
          
          if (!history.includes(link)) {
            return { link, title };
          }
        }
      }
    } catch(e) {
      console.error(`[CRAWLER] RSS fetch error for ${q}:`, e);
    }
    return null;
  };

  // 1차 시도: 원래의 쿼리 (site: 포함 가능)
  let result = await trySearch(query);
  if (result) return result;

  // 2차 시도: site: 연산자가 포함되어 있는데 결과가 없는 경우, site:를 제거하고 도메인 이름을 키워드로 포함하여 재검색
  if (query.includes('site:')) {
    const fallbackQuery = query.replace(/site:([^\s]+)/, '$1');
    console.log(`  [CRAWLER] '${query}' 결과 없음 -> '${fallbackQuery}'로 재시도...`);
    result = await trySearch(fallbackQuery);
  }

  return result;
}

// 2. OpenAlex 논문 검색 (최신순 정렬 추가 및 결과 정제)
async function getNewAcademicPaperLink(query: string, history: string[]) {
  try {
    // 최신순 정렬(publication_year:desc) 추가하여 더 유용한 자료 수집
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&sort=publication_year:desc&per-page=10`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    
    if (json.results && json.results.length > 0) {
      for (const result of json.results) {
        // DOI가 있으면 DOI를, 없으면 OpenAlex ID를 링크로 사용
        const link = result.doi || result.id;
        if (!history.includes(link)) {
          // 제목에서 불필요한 태그 등 제거 (필요시)
          const cleanTitle = result.title.replace(/<\/?[^>]+(>|$)/g, "");
          return {
            link: link,
            title: cleanTitle
          };
        }
      }
    }
  } catch(e) {
    console.error(`[CRAWLER] OpenAlex fetch error for ${query}:`, e);
  }
  return null;
}

export async function runCurationCrawler(groupId?: string) {
  console.log('🚀 [CRAWLER] 최신 데이터 수집 시작 (미발행 위주)...');
  const db: Record<string, any> = {};
  const historyItems = getHistory();
  const history = historyItems.map(h => h.link); // d:/rpa/blogspot_catodic_exe/history.json

  for (const group of CURATION_PRESET_GROUPS) {
    if (groupId && group.id !== groupId) continue;
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
