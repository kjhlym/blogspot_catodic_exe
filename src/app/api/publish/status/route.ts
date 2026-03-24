import { NextResponse } from 'next/server';
import { getPublishStatuses } from '@/lib/status';

function methodNotAllowed() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 });
}

export async function GET() {
  try {
    const statuses = getPublishStatuses();
    return NextResponse.json({ statuses });
  } catch (error) {
    console.error('Failed to get publish status:', error);
    return NextResponse.json({ error: '상태를 불러오는데 실패했습니다.' }, { status: 500 });
  }
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
