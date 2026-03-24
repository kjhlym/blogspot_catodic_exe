import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { CURATION_PRESET_GROUPS } from '@/lib/curation-presets';
import { getHistory } from '@/lib/history';

export const dynamic = 'force-dynamic';

function methodNotAllowed() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const presetGroupId = searchParams.get('presetGroup');

    if (presetGroupId) {
      // 로컬 DB (curation-db.json) 경로
      const dbPath = path.join(process.cwd(), 'data', 'curation-db.json');
      if (!fs.existsSync(dbPath)) {
         return NextResponse.json({ 
           error: '로컬 데이터베이스를 찾을 수 없습니다. 관리자가 수집 로봇(curation-crawler.ts)을 실행해야 합니다.' 
         }, { status: 404 });
      }

      const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const groupData = dbData[presetGroupId];

      if (!groupData) {
        return NextResponse.json({ error: '요청한 카테고리를 찾을 수 없습니다.' }, { status: 404 });
      }

      // 히스토리 데이터 가져오기 (이미 발행된 항목 표시용)
      const history = getHistory();
      
      // history.json에 있는 링크는 제외하고 새로운 글감만 필터링
      const filteredItems = groupData.items.filter((item: any) => !history.includes(item.link));

      return NextResponse.json({
        ...groupData,
        items: filteredItems,
      });
    }

    // 메인 페이지 노출용 데이터
    const presetGroups = CURATION_PRESET_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      description: group.description,
      audience: group.audience,
      queryCount: group.queries.length,
    }));

    return NextResponse.json({ news: [], trends: [], shopping: [], presetGroups });
  } catch (error) {
    console.error('[API] curation GET error:', error);
    return NextResponse.json({ error: '큐레이션 데이터를 불러오는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
