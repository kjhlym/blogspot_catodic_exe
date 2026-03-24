import { NextResponse } from 'next/server';
import { logManager } from '@/lib/log-manager';

export async function POST() {
  try {
    logManager.setAborted(true);
    return NextResponse.json({ success: true, message: 'Stop signal sent' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
