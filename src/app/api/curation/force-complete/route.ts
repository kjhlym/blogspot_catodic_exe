import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { addHistoryEntries, HistoryItem } from '@/lib/history';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { items } = await req.json() as { items: Array<{ link: string; title: string; presetGroupId: string }> };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: '선택된 항목이 없습니다.' }, { status: 400 });
    }

    // 1. 히스토리에 추가
    const historyEntries: HistoryItem[] = items.map(item => ({
      link: item.link,
      title: item.title,
      time: new Date().toISOString()
    }));
    addHistoryEntries(historyEntries);

    // 2. 큐레이션 DB에서 해당 카테고리 내용 비우기
    const dbPath = path.join(process.cwd(), 'data', 'curation-db.json');
    if (fs.existsSync(dbPath)) {
      const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      
      // 선택된 항목들의 모든 presetGroupId 추출
      const groupIds = Array.from(new Set(items.map(item => item.presetGroupId)));
      
      let updated = false;
      for (const groupId of groupIds) {
        if (dbData[groupId]) {
          // 해당 카테고리의 아이템 목록을 비움
          dbData[groupId].items = [];
          updated = true;
        }
      }

      if (updated) {
        fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf-8');
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `${items.length}개 항목이 발행 완료 처리되었으며, 관련 카테고리가 비워졌습니다.` 
    });
  } catch (error) {
    console.error('[API] force-complete POST error:', error);
    return NextResponse.json({ error: '강제 완료 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
