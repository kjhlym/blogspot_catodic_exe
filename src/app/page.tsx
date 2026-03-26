"use client";

import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Send, 
  Settings, 
  Activity, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  RefreshCw,
  Bell,
  ExternalLink,
  Plus
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

async function readJsonSafely<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') ?? '';
  const bodyText = await res.text();

  if (!contentType.includes('application/json')) {
    const preview = bodyText.slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(`서버가 JSON이 아닌 응답을 반환했습니다. (${preview || 'empty response'})`);
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new Error('JSON 파싱에 실패했습니다. 응답 형식을 확인해주세요.');
  }
}

interface Job {
  id: string;
  data: { title: string; blogId: string };
  status: string;
  failedReason?: string;
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/jobs');
      const data = await readJsonSafely<{ jobs: Job[] }>(res);
      setJobs(data.jobs || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleTestPost = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blogId: '8613426021178496417', // 기본 블로그 ID
          title: `테스트 포스팅 - ${new Date().toLocaleString()}`,
          htmlContent: '<p>Next.js Dashboard를 통한 자동화 테스트입니다.</p>',
          publish: true
        })
      });
      if (res.ok) alert('큐에 작업이 등록되었습니다.');
    } catch (e) {
      alert('등록 실패');
    } finally {
      setIsSyncing(false);
      fetchJobs();
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (res.ok) {
        const data = await readJsonSafely<{ message: string }>(res);
        alert(`성공: ${data.message}`);
      }
    } catch (e) {
      alert('싱크 실패');
    } finally {
      setIsSyncing(false);
      fetchJobs();
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans selection:bg-purple-500/30">
      {/* Background Gradients */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-12 animate-in fade-in slide-in-from-top duration-700">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-tr from-purple-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-500/20">
              <LayoutDashboard className="text-white w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                Blogger RPA Control
              </h1>
              <p className="text-slate-500 text-sm font-medium">자동화 대시보드 v2.0</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSync}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/50 rounded-xl transition-all active:scale-95 group font-medium disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 text-blue-400 ${loading ? 'animate-spin' : ''}`} />
              <span>DB 싱크</span>
            </button>
            <button
              onClick={handleTestPost}
              disabled={isSyncing}
              className="flex items-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all active:scale-95 group font-medium disabled:opacity-50"
            >
              <Plus className="w-4 h-4 text-purple-400 group-hover:rotate-90 transition-transform" />
              <span>수동 테스트</span>
            </button>
            <button className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all relative">
              <Bell className="w-5 h-5 text-slate-400" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-[#0f172a]" />
            </button>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 border border-white/10 flex items-center justify-center overflow-hidden">
               <img src="https://ui-avatars.com/api/?name=Admin&background=random" alt="User" />
            </div>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
          {[
            { label: '활성 대기열', value: jobs.filter(j => j.status === 'waiting' || j.status === 'active').length, icon: Activity, color: 'text-blue-400', bg: 'bg-blue-500/10' },
            { label: '오늘 완료', value: jobs.filter(j => j.status === 'completed').length, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            { label: '실패 건수', value: jobs.filter(j => j.status === 'failed').length, icon: AlertCircle, color: 'text-rose-400', bg: 'bg-rose-500/10' },
            { label: '시스템 상태', value: '정상', icon: RefreshCw, color: 'text-purple-400', bg: 'bg-purple-500/10' },
          ].map((stat, i) => (
            <div 
              key={i} 
              className="p-6 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl hover:bg-white/[0.07] transition-all group animate-in fade-in slide-in-from-bottom duration-700"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className={cn("p-2 rounded-xl", stat.bg)}>
                  <stat.icon className={cn("w-5 h-5", stat.color)} />
                </div>
                <span className="text-slate-600 text-xs font-bold uppercase tracking-wider">Stats</span>
              </div>
              <p className="text-slate-400 text-sm font-medium mb-1">{stat.label}</p>
              <p className="text-2xl font-bold font-mono tracking-tight">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Jobs Table */}
          <div className="lg:col-span-2 p-8 rounded-[32px] bg-white/5 border border-white/10 backdrop-blur-xl animate-in fade-in slide-in-from-left duration-700">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Send className="w-5 h-5 text-purple-400" />
                최근 작업 이력
              </h2>
              <button 
                onClick={() => {setLoading(true); fetchJobs();}}
                className="text-xs font-bold text-slate-500 hover:text-slate-300 flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-lg border border-white/5 transition-all"
              >
                <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
                Refresh
              </button>
            </div>

            <div className="space-y-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-4">
                  <Loader2 className="w-10 h-10 animate-spin text-purple-500/30" />
                  <p className="text-sm font-medium italic">작업 데이터를 불러오는 중...</p>
                </div>
              ) : jobs.length === 0 ? (
                <div className="text-center py-20 text-slate-500 border-2 border-dashed border-white/5 rounded-3xl">
                  <p className="text-sm">현재 등록된 작업이 없습니다.</p>
                </div>
              ) : (
                jobs.map((job) => (
                  <div key={job.id} className="p-5 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between group hover:border-purple-500/30 transition-all">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold",
                        job.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                        job.status === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                        job.status === 'active' ? 'bg-blue-500/10 text-blue-400 animate-pulse' : 'bg-slate-500/10 text-slate-400'
                      )}>
                        {job.status === 'completed' ? 'DONE' : job.status === 'failed' ? 'FAIL' : 'RUN'}
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-200 line-clamp-1 group-hover:text-white transition-colors">
                          {job.data.title}
                        </h4>
                        <p className="text-xs text-slate-500 font-mono mt-1">
                          ID: {job.id.slice(0, 8)} • {job.data.blogId.slice(0, 6)}...
                        </p>
                      </div>
                    </div>
                    {job.status === 'failed' && (
                       <div className="px-3 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-bold max-w-[200px] truncate">
                         {job.failedReason}
                       </div>
                    )}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                       <button className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white">
                         <ExternalLink className="w-4 h-4" />
                       </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Sidebar / Quick Actions */}
          <div className="space-y-6 animate-in fade-in slide-in-from-right duration-700">
            <div className="p-8 rounded-[32px] bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-white/10 backdrop-blur-xl">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-purple-400" />
                설정
              </h2>
              <div className="space-y-4">
                 <div className="flex items-center justify-between p-4 rounded-2xl bg-black/20 border border-white/5">
                    <span className="text-sm font-medium text-slate-300">자동 게시 모드</span>
                    <div className="w-10 h-5 bg-purple-500 rounded-full relative">
                      <div className="absolute top-1 right-1 w-3 h-3 bg-white rounded-full shadow-lg" />
                    </div>
                 </div>
                 <div className="flex items-center justify-between p-4 rounded-2xl bg-black/20 border border-white/5">
                    <span className="text-sm font-medium text-slate-300">이미지 AI 생성</span>
                    <div className="w-10 h-5 bg-slate-700 rounded-full relative">
                      <div className="absolute top-1 left-1 w-3 h-3 bg-slate-400 rounded-full" />
                    </div>
                 </div>
                 <p className="text-[11px] text-slate-500 p-2 leading-relaxed italic">
                   * 모든 설정은 환경변수(.env.local)와 실시간 큐 상태에 따라 동기화됩니다.
                 </p>
              </div>
            </div>

            <div className="p-8 rounded-[32px] bg-white/5 border border-white/10 backdrop-blur-xl group overflow-hidden relative">
              <div className="relative z-10">
                <h3 className="font-bold mb-2">Notice</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  BullMQ 작업이 대기열에 쌓이면 순차적으로 처리됩니다. 재시도는 5초 간격으로 최대 3회 수행됩니다.
                </p>
              </div>
              <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-purple-500/5 blur-2xl group-hover:bg-purple-500/10 transition-colors" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
