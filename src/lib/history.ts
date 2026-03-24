import fs from 'fs';
import path from 'path';

const historyFilePath = path.join(process.cwd(), 'history.json');

export interface HistoryItem {
  link: string;
  title: string;
  time: string;
}

// 히스토리 파일 읽기
export function getHistory(): HistoryItem[] {
  try {
    if (fs.existsSync(historyFilePath)) {
      const data = fs.readFileSync(historyFilePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      // 하위 호환성: 만약 문자열 배열이라면 객체 배열로 변환
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
        return (parsed as string[]).map(link => ({
          link,
          title: '기존 발행 글',
          time: new Date().toISOString()
        }));
      }
      
      return parsed as HistoryItem[];
    }
  } catch (err) {
    console.error('Failed to read history.json:', err);
  }
  return [];
}

// 히스토리에 URL 또는 ID 추가
export function addHistory(link: string, title?: string): void {
  try {
    const history = getHistory();
    // 이미 있는 링크인지 확인
    if (!history.find(h => h.link === link)) {
      history.unshift({
        link,
        title: title || '제목 없음',
        time: new Date().toISOString()
      });
      // 최신 50개만 유지 (사이드바 성능 고려)
      const limitedHistory = history.slice(0, 50);
      fs.writeFileSync(historyFilePath, JSON.stringify(limitedHistory, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('Failed to update history.json:', err);
  }
}

// 히스토리에 여러 항목 대량 추가 (동기화용)
export function addHistoryEntries(entries: HistoryItem[]): void {
  try {
    const history = getHistory();
    let updated = false;

    for (const entry of entries) {
      if (!history.find(h => h.link === entry.link)) {
        history.push(entry);
        updated = true;
      }
    }

    if (updated) {
      // 시간순 정렬 (최신순)
      history.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      // 최신 50개만 유지
      const limitedHistory = history.slice(0, 50);
      fs.writeFileSync(historyFilePath, JSON.stringify(limitedHistory, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('Failed to update history.json entries:', err);
  }
}

// 제공된 목록에서 이미 히스토리에 있는 항목 필터링
export function filterNewItems<T extends { link: string }>(items: T[]): T[] {
  const history = getHistory();
  const historyLinks = history.map(h => h.link);
  return items.filter(item => !historyLinks.includes(item.link));
}
