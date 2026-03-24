import { NextResponse } from 'next/server';
import { getHistory } from '@/lib/history';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const history = getHistory();
    return NextResponse.json(history);
  } catch (error) {
    console.error('[API] history GET error:', error);
    return NextResponse.json({ error: '히스토리 데이터를 불러오는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
