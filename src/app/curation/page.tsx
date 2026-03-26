'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HistoryItem } from '@/lib/history';

type PresetGroupMeta = {
  id: string;
  label: string;
  description: string;
  audience: '40s' | '60s' | 'common';
  queryCount: number;
};

type FeaturedCurationItem = {
  title: string;
  link: string;
  description: string;
  category: string;
  groupLabel?: string;
  keyword: string;
  topic?: string;
  summary?: string;
  searchType: 'news' | 'blog' | 'shop';
  selected: boolean;
  publishStatus?: 'pending' | 'completed' | 'failed';
};

type FeaturedPayload = {
  group: Omit<PresetGroupMeta, 'queryCount'>;
  items: Array<Omit<FeaturedCurationItem, 'selected' | 'publishStatus'>>;
};

type FeaturedCachePayload = {
  group: Omit<PresetGroupMeta, 'queryCount'>;
  items: FeaturedCurationItem[];
};

type LogEntry = {
  type: 'log' | 'error' | 'status' | 'done' | 'connected' | 'history';
  message: string;
  time: string;
  itemId?: string;
  [key: string]: any;
};

const PAGE_TITLE = '📰 Blogger Spot 통합 대시보드';

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

export default function CurationPage() {
  const [presetGroups, setPresetGroups] = useState<PresetGroupMeta[]>([]);
  const [activePresetGroupId, setActivePresetGroupId] = useState<string | null>(null);
  const [featuredMeta, setFeaturedMeta] = useState<FeaturedCachePayload['group'] | null>(null);
  const [featuredItems, setFeaturedItems] = useState<FeaturedCurationItem[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(false);
  const [featuredError, setFeaturedError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(true);
  const [showBrowser, setShowBrowser] = useState(true);

  // 실시간 로그 상태
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogWindow, setShowLogWindow] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 발행 히스토리 상태
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const featuredItemsRef = useRef(featuredItems);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const featuredCacheRef = useRef<Record<string, FeaturedCachePayload>>({});

  const selectableItems = featuredItems.filter((item) => !item.publishStatus);
  const currentGroupSelectedCount = selectableItems.filter((item) => item.selected).length;

  const globalSelectedCount = Object.values(featuredCacheRef.current).reduce((acc, payload) => {
    return acc + payload.items.filter(item => item.selected && !item.publishStatus).length;
  }, 0);

  const globalSelectableCount = Object.values(featuredCacheRef.current).reduce((acc, payload) => {
    return acc + payload.items.filter(item => !item.publishStatus).length;
  }, 0);

  const isAllGroupsLoaded = presetGroups.length > 0 && Object.keys(featuredCacheRef.current).length === presetGroups.length;
  const isGlobalAllSelected = isAllGroupsLoaded && globalSelectableCount > 0 && globalSelectedCount === globalSelectableCount;

  const allSelectableSelected = selectableItems.length > 0 && currentGroupSelectedCount === selectableItems.length;
  const someSelectableSelected = currentGroupSelectedCount > 0 && !allSelectableSelected;

  // SSE 연결 및 자동 재연결 로직
  useEffect(() => {
    let eventSource: EventSource;
    let retryTimeout: NodeJS.Timeout;

    const connectSSE = () => {
      console.log('🔄 SSE 연결 시도 중...');
      eventSource = new EventSource('/api/logs/stream');
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'history') {
            setLogs(data.logs || []);
          } else if (data.type === 'connected') {
            console.log('✅ SSE Connected');
          } else {
            setLogs(prev => [...prev.slice(-199), data]);
          }
        } catch (e) {
          console.error('❌ SSE Parse Error:', e);
        }
      };

      eventSource.onerror = (err) => {
        console.error('⚠ SSE Connection Error:', err);
        eventSource.close();
        // 3초 후 재연결 시도
        retryTimeout = setTimeout(connectSSE, 3000);
      };
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);


  // 로그 자동 스크롤
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    featuredItemsRef.current = featuredItems;
  }, [featuredItems]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelectableSelected;
    }
  }, [someSelectableSelected]);

  const syncCurrentGroup = useCallback((groupId: string) => {
    const cached = featuredCacheRef.current[groupId];
    if (!cached) return;
    setFeaturedMeta(cached.group);
    setFeaturedItems([...cached.items]);
  }, []);

  const loadPresetGroup = useCallback(
    async (groupId: string, options?: { forceRefresh?: boolean }) => {
      setActivePresetGroupId(groupId);
      setFeaturedError(null);

      const cached = featuredCacheRef.current[groupId];
      if (cached && !options?.forceRefresh) {
        setFeaturedMeta(cached.group);
        setFeaturedItems([...cached.items]);
        return;
      }

      setFeaturedLoading(true);

      try {
        const res = await fetch(`/api/curation?presetGroup=${encodeURIComponent(groupId)}`);
        const data = await readJsonSafely<FeaturedPayload & { error?: string }>(res);

        if (!res.ok) {
          throw new Error(data.error || '추천 카테고리 데이터를 불러오지 못했습니다.');
        }

        const payload: FeaturedCachePayload = {
          group: data.group,
          items: (data.items || []).map((item) => ({
            ...item,
            selected: false,
          })),
        };

        featuredCacheRef.current[groupId] = payload;
        setFeaturedMeta(payload.group);
        setFeaturedItems([...payload.items]);
      } catch (err) {
        setFeaturedError(err instanceof Error ? err.message : '추천 카테고리 데이터를 불러오는 중 오류가 발생했습니다.');
        setFeaturedMeta(null);
        setFeaturedItems([]);
      } finally {
        setFeaturedLoading(false);
      }
    },
    []
  );

  const fetchPresetGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFeaturedError(null);
    featuredCacheRef.current = {};

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch('/api/curation', { signal: controller.signal });
      clearTimeout(timeoutId);

      const data = await readJsonSafely<{
        error?: string;
        presetGroups?: PresetGroupMeta[];
      }>(res);

      if (!res.ok) {
        throw new Error(data.error || '추천 카테고리를 불러오는데 실패했습니다.');
      }

      const groups = data.presetGroups || [];
      setPresetGroups(groups);

      if (groups[0]?.id) {
        await loadPresetGroup(groups[0].id);
      } else {
        setActivePresetGroupId(null);
        setFeaturedMeta(null);
        setFeaturedItems([]);
      }
    } catch (err: any) {
      console.error('Fetch Preset Groups Error:', err);
      const message = err.name === 'AbortError' ? '서버 응답 시간이 초과되었습니다. Redis 상태 혹은 서버 연결을 확인하세요.' : 
                     (err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [loadPresetGroup]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await readJsonSafely<HistoryItem[]>(res);
        setHistoryItems(data);
      }
    } catch (err) {
      console.error('Fetch history error:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const syncHistory = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/history/sync', { method: 'POST' });
      const data = await readJsonSafely<{ success: boolean; message: string; error?: string }>(res);
      if (data.success) {
        await fetchHistory();
        alert(data.message);
      } else {
        alert('동기화 실패: ' + data.error);
      }
    } catch (err) {
      console.error('Sync error:', err);
      alert('동기화 중 오류가 발생했습니다.');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    void fetchPresetGroups();
    void fetchHistory();
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [fetchPresetGroups, fetchHistory]);

  const refreshActivePresetGroup = useCallback(async () => {
    if (!activePresetGroupId) return;
    
    setFeaturedLoading(true);
    try {
      // 실시간 서버 수집(Crawl) 요청
      const res = await fetch('/api/curation/refresh', { method: 'POST' });
      const result = await readJsonSafely<{ ok?: boolean; message?: string; error?: string }>(res);
      
      if (!res.ok) throw new Error(result.error || '수집 중 오류 발생');

      // 수집 완료 후 새 데이터 로드
      await loadPresetGroup(activePresetGroupId, { forceRefresh: true });
    } catch (err) {
      console.error('Refresh Error:', err);
      alert('실시간 수집 실패: ' + (err instanceof Error ? err.message : '알 수 없는 오류'));
    } finally {
      setFeaturedLoading(false);
    }
  }, [activePresetGroupId, loadPresetGroup]);

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const startPolling = () => {
    if (pollingRef.current) return;

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/publish/status');
        if (!res.ok) return;

        const data = await readJsonSafely<{
          statuses: Record<string, 'pending' | 'completed' | 'failed'>;
        }>(res);
        const statuses = data.statuses || {};
        let hasAnyPending = false;

        const nextCache: Record<string, FeaturedCachePayload> = {};
        for (const [groupId, payload] of Object.entries(featuredCacheRef.current)) {
          nextCache[groupId] = {
            group: payload.group,
            items: payload.items.map((item) => {
              if (item.publishStatus !== 'pending') return item;

              const serverStatus = statuses[item.link];
              if (serverStatus === 'completed' || serverStatus === 'failed') {
                return {
                  ...item,
                  publishStatus: serverStatus,
                  selected: false,
                };
              }

              hasAnyPending = true;
              return item;
            }),
          };
        }

        featuredCacheRef.current = nextCache;

        if (activePresetGroupId && nextCache[activePresetGroupId]) {
          syncCurrentGroup(activePresetGroupId);
        }

        if (!hasAnyPending) {
          stopPolling();
          setPublishing(false);
        }
      } catch (err) {
        console.error('Failed to poll status:', err);
      }
    }, 3000);
  };

  const updateCurrentGroupItems = (nextItems: FeaturedCurationItem[]) => {
    setFeaturedItems(nextItems);

    if (!activePresetGroupId) return;
    const cached = featuredCacheRef.current[activePresetGroupId];
    if (!cached) return;

    featuredCacheRef.current[activePresetGroupId] = {
      ...cached,
      items: nextItems,
    };
  };

  const toggleSelect = (link: string) => {
    const nextItems = featuredItems.map((item) => {
      if (item.link !== link || item.publishStatus) return item;
      return { ...item, selected: !item.selected };
    });
    updateCurrentGroupItems(nextItems);
  };

  const toggleSelectAll = () => {
    const nextSelected = !allSelectableSelected;
    const nextItems = featuredItems.map((item) =>
      item.publishStatus ? item : { ...item, selected: nextSelected }
    );
    updateCurrentGroupItems(nextItems);
  };

  const selectAllAcrossGroups = async () => {
    setLoading(true);
    setFeaturedError(null);
    try {
      const targetState = !isGlobalAllSelected;
      const groupsToProcess = presetGroups.length > 0 ? presetGroups : [];
      
      for (const group of groupsToProcess) {
        if (!featuredCacheRef.current[group.id]) {
          const res = await fetch(`/api/curation?presetGroup=${encodeURIComponent(group.id)}`);
          if (res.ok) {
            const data = await readJsonSafely<FeaturedPayload>(res);
            featuredCacheRef.current[group.id] = {
              group: data.group,
              items: (data.items || []).map(item => ({ 
                ...item, 
                selected: targetState,
                publishStatus: undefined 
              }))
            };
          }
        } else {
          featuredCacheRef.current[group.id].items = featuredCacheRef.current[group.id].items.map(item => 
            item.publishStatus ? item : { ...item, selected: targetState }
          );
        }
      }

      if (activePresetGroupId && featuredCacheRef.current[activePresetGroupId]) {
        syncCurrentGroup(activePresetGroupId);
      }
    } catch (err) {
      console.error('Select All Error:', err);
      alert('전체 선택 처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async () => {
    const selectedItemsToPublish = [];
    for (const [groupId, payload] of Object.entries(featuredCacheRef.current)) {
      for (const item of payload.items) {
        if (item.selected && !item.publishStatus) {
          selectedItemsToPublish.push(item);
        }
      }
    }

    if (selectedItemsToPublish.length === 0) {
      alert('발행할 항목을 선택해주세요.');
      return;
    }

    setPublishing(true);
    setPublishResult(null);

    const activeGroupId = activePresetGroupId;
    for (const [groupId, payload] of Object.entries(featuredCacheRef.current)) {
      featuredCacheRef.current[groupId].items = payload.items.map(item =>
        item.selected && !item.publishStatus ? { ...item, publishStatus: 'pending' as const } : item
      );
    }
    if (activeGroupId) syncCurrentGroup(activeGroupId);

    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selectedItemsToPublish.map((item) => ({
            link: item.link,
            title: item.title,
            category: item.category,
            description: item.description,
            keyword: item.keyword,
            topic: item.topic,
            summary: item.summary,
          })),
          headless: !showBrowser,
        }),
      });

      if (!res.ok) {
        const data = await readJsonSafely<{ error?: string }>(res);
        throw new Error(data.error || '발행 프로세스 실행 중 오류가 발생했습니다.');
      }

      setPublishResult(`총 ${selectedItemsToPublish.length}개의 항목 발행 요청이 진행 중입니다... 실시간 로그 창을 통해 진행 과정을 확인하세요.`);
      startPolling();
    } catch (err) {
      alert(err instanceof Error ? err.message : '발행 처리 중 알 수 없는 오류가 발생했습니다.');
      setPublishing(false);
      
      for (const [groupId, payload] of Object.entries(featuredCacheRef.current)) {
        featuredCacheRef.current[groupId].items = payload.items.map(item =>
          item.publishStatus === 'pending' ? { ...item, publishStatus: undefined } : item
        );
      }
      if (activeGroupId) syncCurrentGroup(activeGroupId);
    }
  };

  const handleStop = async () => {
    if (!confirm('정말로 모든 진행 중인 작업을 중지하시겠습니까?')) return;
    try {
      const res = await fetch('/api/curation/stop', { method: 'POST' });
      const data = await readJsonSafely<{ error?: string }>(res);
      if (res.ok) {
        setPublishing(false);
        setFeaturedLoading(false);
        setPublishResult('작업 중지 신호를 보냈습니다.');
      } else {
        alert('중지 실패: ' + (data.error || '알 수 없는 오류'));
      }
    } catch (err) {
      console.error('Stop Error:', err);
      alert('중지 요청 중 오류가 발생했습니다.');
    }
  };

  const handleForceComplete = async () => {
    const selectedItemsToForce: Array<FeaturedCurationItem & { presetGroupId: string }> = [];
    const selectedGroupIds = new Set<string>();

    for (const [groupId, payload] of Object.entries(featuredCacheRef.current)) {
      for (const item of payload.items) {
        if (item.selected && !item.publishStatus) {
          selectedItemsToForce.push({ ...item, presetGroupId: groupId });
          selectedGroupIds.add(groupId);
        }
      }
    }

    if (selectedItemsToForce.length === 0) {
      alert('발행 완료 처리할 항목을 선택해주세요.');
      return;
    }

    if (!confirm(`선택한 ${selectedItemsToForce.length}개 항목을 강제 발행 완료 처리하고 해당 카테고리를 비우시겠습니까?`)) {
      return;
    }

    setPublishing(true);
    setPublishResult(null);

    try {
      const res = await fetch('/api/curation/force-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selectedItemsToForce.map((item) => ({
            link: item.link,
            title: item.title,
            presetGroupId: item.presetGroupId,
          })),
        }),
      });

      if (!res.ok) {
        const data = await readJsonSafely<{ error?: string }>(res);
        throw new Error(data.error || '처리 중 오류 발생');
      }

      const result = await readJsonSafely<{ message: string }>(res);
      
      // 로컬 상태 업데이트
      // 1. 히스토리 갱신
      await fetchHistory();

      // 2. 캐시 및 현재 아이템 갱신
      for (const groupId of Array.from(selectedGroupIds)) {
        if (featuredCacheRef.current[groupId]) {
          featuredCacheRef.current[groupId].items = [];
        }
      }
      
      if (activePresetGroupId && selectedGroupIds.has(activePresetGroupId)) {
        setFeaturedItems([]);
      }

      setPublishResult(result.message);
      alert(result.message);
    } catch (err) {
      alert(err instanceof Error ? err.message : '강제 완료 처리 중 오류 발생');
    } finally {
      setPublishing(false);
    }
  };

  const activePresetGroup = presetGroups.find((group) => group.id === activePresetGroupId) || null;

  return (
    <div className='min-h-screen bg-gray-50 p-8'>
      <main className='max-w-[1700px] mx-auto flex flex-col lg:flex-row gap-6'>
        {/* 왼쪽 메인 콘텐츠 영역 */}
        <div className='flex-1 min-w-0 flex flex-col gap-6'>
        
        {/* 상단 섹션 */}
        <div className='bg-white rounded-2xl shadow-sm p-8 border border-gray-100'>
          <h1 className='text-3xl font-bold text-gray-800 mb-2' suppressHydrationWarning>
            {PAGE_TITLE}
          </h1>
          <p className='text-sm text-gray-500 mb-6'>
            실시간 수집과 발행 로그가 통합된 차세대 블로그 자동화 대시보드입니다.
          </p>

          {error && (
            <div className='bg-red-50 text-red-600 p-4 rounded-lg mb-6 flex items-center'>
              <span className='mr-2'>⚠️</span>
              {error}
            </div>
          )}

          {publishResult && (
            <div className='bg-blue-50 text-blue-700 p-4 rounded-lg mb-6 flex items-center shadow-sm'>
              <span className='mr-2'>ℹ️</span>
              {publishResult}
            </div>
          )}

          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'>
              <div className='flex flex-col gap-3 flex-1'>
                <div className='flex flex-wrap items-center gap-3'>
                  <button
                    onClick={() => void refreshActivePresetGroup()}
                    disabled={!activePresetGroupId || loading || publishing || featuredLoading}
                    className='flex items-center px-4 py-2 bg-blue-600 border border-blue-600 rounded-lg text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors'
                  >
                    {featuredLoading ? '수집 중...' : '새 글 수집 (Crawler)'}
                  </button>
                  <button
                    onClick={() => void fetchPresetGroups()}
                    disabled={loading || publishing || featuredLoading}
                    className='flex items-center px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50'
                  >
                    {loading ? '목록 갱신 중...' : '목록 새로고침'}
                  </button>
                  <div className='h-6 w-px bg-gray-200 mx-1' />
                  <button
                    onClick={() => setShowLogWindow(!showLogWindow)}
                    className={`flex items-center px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${
                      showLogWindow ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {showLogWindow ? '실시간 로그 끄기' : '실시간 로그 켜기'}
                  </button>
                  <button
                    onClick={() => setShowBrowser(!showBrowser)}
                    className={`flex items-center px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${
                      showBrowser 
                        ? 'bg-amber-50 border-amber-200 text-amber-700 font-bold' 
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {showBrowser ? '브라우저 숨기기' : '브라우저 보기'}
                  </button>
                  <button
                    onClick={() => void selectAllAcrossGroups()}
                    disabled={loading || publishing || featuredLoading || globalSelectableCount === 0}
                    className={`flex items-center px-4 py-2 border rounded-lg text-sm font-bold transition-all ${
                      isGlobalAllSelected 
                        ? 'bg-blue-50 border-blue-200 text-blue-700' 
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {isGlobalAllSelected ? '모든 카테고리 선택 해제' : '모든 카테고리 전체 선택'}
                  </button>
                  {globalSelectableCount > 0 && (
                    <div className='flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg border border-gray-200'>
                      <span className='text-xs font-semibold text-gray-500'>전체 글감</span>
                      <span className='text-sm font-black text-gray-800'>{globalSelectableCount}개</span>
                    </div>
                  )}
                </div>

                <div className='flex flex-wrap gap-2'>
                  {presetGroups.map((group) => {
                    const isActive = group.id === activePresetGroupId;
                    return (
                      <button
                        key={group.id}
                        onClick={() => void loadPresetGroup(group.id)}
                        disabled={featuredLoading && isActive}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                          isActive
                            ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        {group.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className='flex items-center gap-3 w-full lg:w-auto mt-4 lg:mt-0'>
                {(publishing || featuredLoading) && (
                  <button
                    onClick={() => void handleStop()}
                    className='px-6 py-3 bg-red-100 border border-red-200 text-red-700 rounded-xl text-lg font-bold hover:bg-red-200 transition-all shadow-sm'
                  >
                    중지 (Stop) 🛑
                  </button>
                )}
                <button
                  onClick={() => void handleForceComplete()}
                  disabled={loading || publishing || globalSelectedCount === 0}
                  className='px-6 py-3 bg-gray-100 border border-gray-300 rounded-xl text-lg font-bold text-gray-700 hover:bg-gray-200 transition-all shadow-sm disabled:opacity-50'
                >
                   {globalSelectedCount}개 발행 완료 처리 📦
                </button>
                <button
                  onClick={() => void handlePublish()}
                  disabled={loading || publishing || globalSelectedCount === 0}
                  className='px-8 py-3 bg-blue-600 rounded-xl text-lg font-black text-white shadow-lg hover:bg-blue-700 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:bg-gray-400 transition-all flex-1 lg:flex-none'
                >
                  {publishing ? '발행 진행 중...' : `${globalSelectedCount}개 발행 시작 🚀`}
                </button>
              </div>
            </div>

            {/* 글감 테이블 */}
            <div className='rounded-2xl border border-gray-300 bg-white overflow-hidden'>
              <div className='border-b border-gray-200 bg-gray-50 px-5 py-4 flex justify-between items-center'>
                <div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <h2 className='text-lg font-bold text-gray-900'>{activePresetGroup?.label || '글감'} 탐색</h2>
                    {activePresetGroup && (
                      <span className='inline-flex rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-bold text-gray-600'>
                        {activePresetGroup.queryCount}개 키워드
                      </span>
                    )}
                  </div>
                  <p className='mt-1 text-xs text-gray-500'>
                    {featuredMeta?.description || '카테고리를 선택하여 글감을 탐색하세요.'}
                  </p>
                </div>
                <button
                   onClick={() => setShowDetails(!showDetails)}
                   className='text-xs font-bold text-blue-600 hover:underline'
                >
                  {showDetails ? '요약 설명 숨기기' : '요약 설명 보기'}
                </button>
              </div>

              <div className='overflow-x-auto'>
                <table className='w-full min-w-[880px] border-collapse text-left'>
                  <thead>
                    <tr className='border-b border-gray-300 bg-gray-100 text-sm font-bold text-black'>
                      <th className='w-24 p-4 text-center'>
                        <div className='flex flex-col items-center gap-1'>
                          <span className='text-[10px] text-gray-500'>ALL</span>
                          <input
                            ref={selectAllRef}
                            type='checkbox'
                            checked={allSelectableSelected}
                            onChange={toggleSelectAll}
                            disabled={selectableItems.length === 0 || featuredLoading}
                            className='h-5 w-5 cursor-pointer rounded border-gray-400 text-blue-600'
                          />
                        </div>
                      </th>
                      <th className='w-[200px] p-4 uppercase text-xs tracking-wider text-gray-500'>Keyword</th>
                      <th className='p-4 uppercase text-xs tracking-wider text-gray-500'>Topic / Title</th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-gray-200'>
                    {featuredLoading ? (
                      <tr>
                        <td colSpan={3} className='p-12 text-center'>
                          <div className='flex flex-col items-center gap-3'>
                            <div className='h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent'></div>
                            <span className='text-sm font-bold text-blue-600'>데이터를 갱신하고 있습니다...</span>
                          </div>
                        </td>
                      </tr>
                    ) : featuredItems.length === 0 ? (
                      <tr>
                        <td colSpan={3} className='p-10 text-center text-sm text-gray-500'>
                          표시할 글감이 없습니다. 새로고침을 해보세요.
                        </td>
                      </tr>
                    ) : (
                      featuredItems
                        .filter(item => {
                          const isAlreadyPublished = historyItems.some(h => h.link === item.link);
                          return item.publishStatus !== 'completed' && !isAlreadyPublished;
                        })
                        .map((item, index) => (
                        <tr key={`${item.link}-${index}`} className={item.selected ? 'bg-blue-50/50' : 'bg-white hover:bg-gray-50/50'}>
                          <td className='p-4 text-center'>
                            <div className='flex flex-col items-center gap-1'>
                              {item.publishStatus === 'pending' ? (
                                <div className='h-5 w-5 animate-spin rounded-full border-2 border-amber-600 border-t-transparent' />
                              ) : item.publishStatus === 'completed' ? (
                                <span title='발행 완료' className='text-xl'>✅</span>
                              ) : item.publishStatus === 'failed' ? (
                                <span title='실패' className='text-xl'>❌</span>
                              ) : (
                                <input
                                  type='checkbox'
                                  checked={item.selected}
                                  onChange={() => toggleSelect(item.link)}
                                  className='h-6 w-6 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500'
                                />
                              )}
                            </div>
                          </td>
                          <td className='p-4 align-top'>
                            <span className='px-2 py-0.5 bg-gray-100 text-[10px] font-bold text-gray-500 rounded border border-gray-200 mb-1 inline-block'>
                              {item.searchType.toUpperCase()}
                            </span>
                            <p className='text-sm font-bold text-gray-700'>{item.keyword}</p>
                          </td>
                          <td className='p-4 align-top'>
                            <div className='text-base font-bold text-gray-900 leading-snug mb-1' dangerouslySetInnerHTML={{ __html: item.title }} />
                            {showDetails && item.description && (
                              <p className='text-sm text-gray-500 line-clamp-2'>{item.description}</p>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* 하단 실시간 로그 창 */}
        {showLogWindow && (
          <div className='bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden'>
            <div className='bg-gray-800 px-5 py-3 flex justify-between items-center border-b border-gray-700'>
              <div className='flex items-center gap-2'>
                <div className='h-2 w-2 bg-green-500 rounded-full animate-pulse' />
                <span className='text-xs font-bold text-gray-300 tracking-widest uppercase'>Real-time System Logs</span>
              </div>
              <button 
                onClick={() => setLogs([])}
                className='text-[10px] font-bold text-gray-500 hover:text-white transition-colors'
              >
                CLEAR CONSOLE
              </button>
            </div>
            <div className='h-[250px] overflow-y-auto p-5 font-mono text-sm leading-relaxed'>
              {logs.length === 0 ? (
                <div className='text-gray-600 italic'>No logs yet. Waiting for interaction...</div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className={`mb-1 flex gap-3 ${
                    log.type === 'error' ? 'text-red-400' : 
                    log.type === 'status' ? 'text-blue-400' :
                    log.type === 'done' ? 'text-green-400 font-bold' :
                    'text-gray-300'
                  }`}>
                    <span className='text-gray-600 shrink-0'>[{log.time.split('T')[1].split('.')[0]}]</span>
                    <span className='break-all whitespace-pre-wrap'>{log.message}</span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        </div>

        {/* 오른쪽 사이드바: 발행 히스토리 */}
        <aside className='w-full lg:w-64 shrink-0'>
          <div className='bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden sticky top-6'>
            <div className='p-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/50'>
              <h2 className='font-bold text-gray-800 flex items-center gap-1 text-sm'>
                <span className='text-base'>📜</span> 히스토리
              </h2>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => void syncHistory()}
                  disabled={isSyncing}
                  className={`text-xs px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 transition-all ${isSyncing ? 'animate-pulse opacity-50' : ''}`}
                  title="모든 블로그에서 과거 글 가져오기"
                >
                  {isSyncing ? '🔄 동기화 중...' : '🔄 전체 동기화'}
                </button>
                <button 
                  onClick={() => void fetchHistory()}
                  className='text-xs text-gray-500 font-bold hover:underline'
                >
                  새로고침
                </button>
              </div>
            </div>
            
            <div className='max-h-[calc(100vh-150px)] overflow-y-auto px-1 py-1'>
              {historyLoading && historyItems.length === 0 ? (
                <div className='p-8 text-center text-sm text-gray-400'>불러오는 중...</div>
              ) : historyItems.length === 0 ? (
                <div className='p-10 text-center flex flex-col items-center gap-3'>
                  <div className='text-3xl grayscale opacity-30'>📭</div>
                  <p className='text-sm text-gray-400'>아직 발행 기록이 없습니다.</p>
                </div>
              ) : (
                <ul className='divide-y divide-gray-50'>
                  {historyItems.slice(0, 12).map((item, idx) => (
                    <li key={`${item.link}-${idx}`} className='p-2 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0'>
                      <a 
                        href={item.link} 
                        target='_blank' 
                        rel='noopener noreferrer'
                        className='group block'
                      >
                        <p className='text-[13px] font-bold text-gray-800 leading-tight group-hover:text-blue-600 transition-colors mb-1 line-clamp-2' dangerouslySetInnerHTML={{ __html: item.title }} />
                        <div className='flex items-center justify-between'>
                          <span className='text-[10px] text-gray-400'>
                            {new Date(item.time).toLocaleString('ko-KR', { 
                              month: 'short', 
                              day: 'numeric', 
                              hour: 'numeric', 
                              minute: 'numeric' 
                            })}
                          </span>
                          <span className='text-[10px] text-blue-500 font-bold opacity-0 group-hover:opacity-100 transition-opacity'>방문하기 →</span>
                        </div>
                      </a>
                    </li>
                  ))}
                  {historyItems.length > 12 && (
                    <li className='p-2 text-center text-[11px] text-gray-400'>
                      + {historyItems.length - 12}개 더 있음
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
