import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useApp } from '@/contexts/AppContext';
import { useFocusEffect } from 'expo-router';
import { deleteInstrument, getAllInstruments, updateInstrumentGroup, updateInstrumentMeta } from '@/db/instruments';
import { refreshAllQuotes, isTradingHours, fetchMarketBoards, fetchHotList, fetchMarketIndices } from '@/db/quotes';
import { getSetting, setSetting } from '@/db/settings';
import { formatMoney, formatPercent, getPnlColor } from '@/utils/format';
import { getInstrumentTypeShortLabel } from '@/utils/instrument';
import type { Instrument } from '@/db/types';
import type { HotListItem, HotListPeriod, MarketBoardCategory, MarketBoardItem, MarketBoardSort, MarketIndexItem } from '@/db/quotes';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const UI = {
  primary: '#1D4ED8',
  primarySoft: '#EAF0FF',
  card: '#FFFFFF',
  border: '#E6EEF8',
  text: '#0F172A',
  subText: '#667085',
  muted: '#98A2B3',
};

const CARD_STYLE = {
  backgroundColor: UI.card,
  borderColor: UI.border,
  borderWidth: 1,
  shadowColor: UI.primary,
  shadowOpacity: 0.04,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 5 },
  elevation: 1,
};

const BOARD_PAGE_SIZE = 50;
const HOT_LIST_PAGE_SIZE = 100;
const INDEX_PAGE_SIZE = 100;
const MARKET_AUTO_REFRESH_MS = 5000;

type BoardLoadMode = 'replace' | 'append';

type BoardLoadOptions = {
  silent?: boolean;
  preserveLoaded?: boolean;
};

type CachedMarketBoards = {
  savedAt: string;
  items: MarketBoardItem[];
};

const marketBoardsCacheKey = (category: MarketBoardCategory, sort: MarketBoardSort) =>
  `market_boards_cache_${category}_${sort}`;

function mergeBoardItems(head: MarketBoardItem[], tail: MarketBoardItem[]): MarketBoardItem[] {
  const seen = new Set(head.map(item => item.code));
  return [...head, ...tail.filter(item => !seen.has(item.code))];
}

function formatHeat(value: number): string {
  if (!Number.isFinite(value)) return '--';
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return String(Math.round(value));
}

async function readCachedBoards(category: MarketBoardCategory, sort: MarketBoardSort): Promise<MarketBoardItem[]> {
  try {
    const raw = await getSetting(marketBoardsCacheKey(category, sort));
    if (!raw) return [];
    const cached = JSON.parse(raw) as Partial<CachedMarketBoards>;
    return Array.isArray(cached.items) ? cached.items : [];
  } catch (e) {
    console.warn('读取板块排行缓存失败:', e);
    return [];
  }
}

async function writeCachedBoards(category: MarketBoardCategory, sort: MarketBoardSort, items: MarketBoardItem[]) {
  try {
    await setSetting(marketBoardsCacheKey(category, sort), JSON.stringify({
      savedAt: new Date().toISOString(),
      items,
    } satisfies CachedMarketBoards));
  } catch (e) {
    console.warn('保存板块排行缓存失败:', e);
  }
}

export default function MarketScreen() {
  const router = useSafeRouter();
  const { refreshTrigger, triggerRefresh } = useApp();
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'watchlist' | 'industry' | 'concept' | 'hot' | 'indices'>('watchlist');
  const [boardSort, setBoardSort] = useState<MarketBoardSort>('gain');
  const [boards, setBoards] = useState<MarketBoardItem[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [boardPage, setBoardPage] = useState(1);
  const [boardsHasMore, setBoardsHasMore] = useState(true);
  const [boardsLoadingMore, setBoardsLoadingMore] = useState(false);
  const [hotPeriod, setHotPeriod] = useState<HotListPeriod>('hour');
  const [hotItems, setHotItems] = useState<HotListItem[]>([]);
  const [hotLoading, setHotLoading] = useState(false);
  const [indexSort, setIndexSort] = useState<MarketBoardSort>('gain');
  const [indices, setIndices] = useState<MarketIndexItem[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(false);
  const autoRefreshInFlightRef = useRef(false);
  const boardLoadMoreInFlightRef = useRef(false);
  const [reversed, setReversed] = useState(false);
  const [filter, setFilter] = useState<'all' | 'stock' | 'stock_hk' | 'stock_us' | 'stock_global' | 'index' | 'fund_etf' | 'fund_open'>('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [editingGroup, setEditingGroup] = useState<Instrument | null>(null);
  const [groupName, setGroupName] = useState('');
  const [editingName, setEditingName] = useState<Instrument | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [deletingInstrument, setDeletingInstrument] = useState<Instrument | null>(null);
  const isBoardView = viewMode === 'industry' || viewMode === 'concept';
  const activeBoardCategory: MarketBoardCategory = viewMode === 'concept' ? 'concept' : 'industry';

  const loadBoards = useCallback(async (
    category = activeBoardCategory,
    page = 1,
    mode: BoardLoadMode = 'replace',
    options: BoardLoadOptions = {},
    sort = boardSort
  ) => {
    const isAppend = mode === 'append';
    if (isAppend) {
      setBoardsLoadingMore(true);
    } else if (!options.silent) {
      setBoardsLoading(true);
    }
    try {
      let items = await fetchMarketBoards(category, page, BOARD_PAGE_SIZE, sort);
      const canUseCache = !isAppend && page === 1;
      if (items.length > 0 && canUseCache) {
        void writeCachedBoards(category, sort, items);
      } else if (items.length === 0 && canUseCache) {
        items = await readCachedBoards(category, sort);
      }
      setBoards(prev => {
        if (isAppend) return mergeBoardItems(prev, items);
        if (options.preserveLoaded) return mergeBoardItems(items, prev);
        return items;
      });
      setBoardPage(prev => (isAppend || page > prev ? page : options.silent ? prev : page));
      setBoardsHasMore(prev => items.length >= BOARD_PAGE_SIZE || (options.silent ? prev : false));
    } catch (e) {
      console.error(e);
      if (!isAppend && !options.silent) {
        setBoards([]);
        setBoardPage(1);
        setBoardsHasMore(false);
      }
    } finally {
      if (isAppend) {
        setBoardsLoadingMore(false);
      } else if (!options.silent) {
        setBoardsLoading(false);
      }
    }
  }, [activeBoardCategory, boardSort]);

  const loadHotItems = useCallback(async (period = hotPeriod, options: { silent?: boolean } = {}) => {
    if (!options.silent) setHotLoading(true);
    try {
      const items = await fetchHotList(period, 1, HOT_LIST_PAGE_SIZE);
      setHotItems(items);
    } catch (e) {
      console.error(e);
      if (!options.silent) setHotItems([]);
    } finally {
      if (!options.silent) setHotLoading(false);
    }
  }, [hotPeriod]);

  const loadIndices = useCallback(async (sort = indexSort, options: { silent?: boolean } = {}) => {
    if (!options.silent) setIndicesLoading(true);
    try {
      const items = await fetchMarketIndices(1, INDEX_PAGE_SIZE, sort);
      setIndices(items);
    } catch (e) {
      console.error(e);
      if (!options.silent) setIndices([]);
    } finally {
      if (!options.silent) setIndicesLoading(false);
    }
  }, [indexSort]);

  const loadData = useCallback(async (refreshQuote = false) => {
    try {
      let insts = await getAllInstruments();
      const needsQuoteRefresh = insts.some(inst => (inst.latest_price ?? 0) <= 0);
      if ((refreshQuote || needsQuoteRefresh) && insts.length > 0) {
        await refreshAllQuotes(insts);
        insts = await getAllInstruments();
      }
      const rg = await getSetting('red_green_reversed');
      setReversed(rg === '1');
      setInstruments(insts);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(false); }, [loadData, refreshTrigger]));

  useEffect(() => {
    if (!isBoardView) return;
    boardLoadMoreInFlightRef.current = false;
    setBoardPage(1);
    setBoardsHasMore(true);
    setBoards([]);
    loadBoards(activeBoardCategory, 1, 'replace', {}, boardSort);
  }, [activeBoardCategory, boardSort, isBoardView, loadBoards]);

  useEffect(() => {
    if (viewMode !== 'hot') return;
    setHotItems([]);
    loadHotItems(hotPeriod);
  }, [hotPeriod, loadHotItems, viewMode]);

  useEffect(() => {
    if (viewMode !== 'indices') return;
    setIndices([]);
    loadIndices(indexSort);
  }, [indexSort, loadIndices, viewMode]);

  const loadMoreBoards = useCallback(() => {
    if (boardsLoading || boardsLoadingMore || boardLoadMoreInFlightRef.current || !boardsHasMore) return;
    boardLoadMoreInFlightRef.current = true;
    void loadBoards(activeBoardCategory, boardPage + 1, 'append', {}, boardSort).finally(() => {
      boardLoadMoreInFlightRef.current = false;
    });
  }, [activeBoardCategory, boardPage, boardSort, boardsHasMore, boardsLoading, boardsLoadingMore, loadBoards]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.selectionAsync();
    try {
      if (isBoardView) {
        await loadBoards(activeBoardCategory, 1, 'replace', {}, boardSort);
        return;
      }
      if (viewMode === 'hot') {
        await loadHotItems(hotPeriod);
        return;
      }
      if (viewMode === 'indices') {
        await loadIndices(indexSort);
        return;
      }
      await loadData(true);
    } finally {
      setRefreshing(false);
    }
  }, [activeBoardCategory, boardSort, hotPeriod, indexSort, isBoardView, loadBoards, loadData, loadHotItems, loadIndices, viewMode]);

  useFocusEffect(useCallback(() => {
    const timer = setInterval(() => {
      if (autoRefreshInFlightRef.current) return;
      autoRefreshInFlightRef.current = true;
      const task = isBoardView
        ? loadBoards(activeBoardCategory, 1, 'replace', { silent: true, preserveLoaded: true }, boardSort)
        : viewMode === 'hot'
          ? loadHotItems(hotPeriod, { silent: true })
          : viewMode === 'indices'
            ? loadIndices(indexSort, { silent: true })
        : loadData(true);
      Promise.resolve(task).finally(() => {
        autoRefreshInFlightRef.current = false;
      });
    }, MARKET_AUTO_REFRESH_MS);

    return () => clearInterval(timer);
  }, [activeBoardCategory, boardSort, hotPeriod, indexSort, isBoardView, loadBoards, loadData, loadHotItems, loadIndices, viewMode]));

  const groups = Array.from(new Set(instruments.map(i => i.group_name?.trim()).filter(Boolean))) as string[];
  const filtered = instruments.filter(item => {
    const typeOk = filter === 'all' || item.type === filter;
    const groupOk =
      groupFilter === 'all' ||
      (groupFilter === '__none__' ? !item.group_name : item.group_name === groupFilter);
    return typeOk && groupOk;
  });

  const openGroupEditor = (item: Instrument) => {
    setEditingGroup(item);
    setGroupName(item.group_name ?? '');
  };

  const saveGroup = async () => {
    if (!editingGroup) return;
    await updateInstrumentGroup(editingGroup.id, groupName.trim() || null);
    setEditingGroup(null);
    setGroupName('');
    await loadData(false);
  };

  const openNameEditor = (item: Instrument) => {
    setEditingName(item);
    setNameDraft(item.name);
  };

  const saveName = async () => {
    if (!editingName) return;
    const nextName = nameDraft.trim();
    if (!nextName) {
      Alert.alert('提示', '请输入名称');
      return;
    }
    await updateInstrumentMeta(editingName.id, { name: nextName });
    setEditingName(null);
    setNameDraft('');
    triggerRefresh();
    await loadData(false);
  };

  const handleDeleteInstrument = (item: Instrument) => {
    setDeletingInstrument(item);
  };

  const confirmDeleteInstrument = async () => {
    if (!deletingInstrument) return;
    await deleteInstrument(deletingInstrument.id);
    setDeletingInstrument(null);
    triggerRefresh();
    await loadData(false);
  };

  const emptyText = instruments.length === 0 ? '暂无自选标的' : '当前筛选下暂无标的';

  if (loading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={UI.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen safeAreaEdges={['top']}>
      <View className="px-4 pt-2 pb-3">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-xl font-bold" style={{ color: UI.text }}>行情</Text>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              className="px-3 py-2 rounded-full flex-row items-center justify-center gap-2"
              style={{
                backgroundColor: UI.primarySoft,
                borderColor: UI.border,
                borderWidth: 1,
                minWidth: 86,
                opacity: refreshing ? 0.72 : 1,
              }}
              onPress={onRefresh}
              disabled={refreshing}
              accessibilityLabel="刷新全部行情价格"
            >
              {refreshing ? (
                <ActivityIndicator size="small" color={UI.primary} />
              ) : (
                <FontAwesome6 name="arrows-rotate" size={12} color={UI.primary} />
              )}
              <Text className="text-sm font-medium" style={{ color: UI.primary }}>{refreshing ? '刷新中' : '刷新'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="px-4 py-2 rounded-full flex-row items-center gap-2"
              style={{ backgroundColor: UI.primary }}
              onPress={() => router.push('/search-quote')}
            >
              <FontAwesome6 name="plus" size={12} color="#fff" />
              <Text className="text-white text-sm">添加</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View className="flex-row p-1 rounded-full mb-3" style={{ backgroundColor: UI.primarySoft, borderColor: UI.border, borderWidth: 1 }}>
          {[
            { k: 'watchlist', label: '自选' },
            { k: 'industry', label: '行业榜' },
            { k: 'concept', label: '概念榜' },
            { k: 'indices', label: '指数榜' },
            { k: 'hot', label: '热门榜' },
          ].map(tab => (
            <TouchableOpacity
              key={tab.k}
              className="flex-1 py-2 rounded-full items-center"
              style={{ backgroundColor: viewMode === tab.k ? UI.primary : 'transparent' }}
              onPress={() => { setViewMode(tab.k as 'watchlist' | 'industry' | 'concept' | 'hot' | 'indices'); Haptics.selectionAsync(); }}
            >
              <Text className="text-sm font-semibold" style={{ color: viewMode === tab.k ? '#fff' : UI.primary }}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {viewMode === 'watchlist' ? (
          <>
            <View className="flex-row items-center justify-between mb-2 gap-2 flex-wrap">
          <View className="flex-row flex-wrap gap-2">
            {[
              { k: 'all', label: '全部' },
              { k: 'stock', label: 'A股' },
              { k: 'stock_hk', label: '港股' },
              { k: 'stock_us', label: '美股' },
              { k: 'stock_global', label: '海外' },
              { k: 'index', label: '指数' },
              { k: 'fund_etf', label: '场内基金' },
              { k: 'fund_open', label: '场外基金' },
            ].map(f => (
              <TouchableOpacity
                key={f.k}
                className="px-3 py-1.5 rounded-full"
                style={{ backgroundColor: filter === f.k ? UI.primary : UI.card, borderColor: filter === f.k ? UI.primary : UI.border, borderWidth: 1 }}
                onPress={() => { setFilter(f.k as any); Haptics.selectionAsync(); }}
              >
                <Text className="text-xs font-medium" style={{ color: filter === f.k ? '#fff' : UI.subText }}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View className="flex-row items-center">
            <View className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isTradingHours() ? 'bg-[#22C55E]' : 'bg-[#64748B]'}`} />
            <Text className="text-xs" style={{ color: UI.subText }}>{isTradingHours() ? '交易中' : '休市'}</Text>
          </View>
            </View>
            <View className="flex-row flex-wrap gap-2">
          {[
            { k: 'all', label: '全部分组' },
            { k: '__none__', label: '未分组' },
            ...groups.map(group => ({ k: group, label: group })),
          ].map(group => (
            <TouchableOpacity
              key={group.k}
              className="px-3 py-1.5 rounded-full"
              style={{ backgroundColor: groupFilter === group.k ? UI.primary : UI.card, borderColor: groupFilter === group.k ? UI.primary : UI.border, borderWidth: 1 }}
              onPress={() => { setGroupFilter(group.k); Haptics.selectionAsync(); }}
            >
              <Text className="text-xs font-medium" style={{ color: groupFilter === group.k ? '#fff' : UI.subText }}>{group.label}</Text>
            </TouchableOpacity>
          ))}
            </View>
          </>
        ) : isBoardView ? (
          <View className="gap-2">
            <View className="flex-row items-center justify-between gap-2">
            <View className="flex-row gap-2">
              {[
                { k: 'gain', label: '涨幅' },
                { k: 'loss', label: '跌幅' },
              ].map(sort => (
                <TouchableOpacity
                  key={sort.k}
                  className="px-3 py-1.5 rounded-full"
                  style={{
                    backgroundColor: boardSort === sort.k ? UI.primary : UI.card,
                    borderColor: boardSort === sort.k ? UI.primary : UI.border,
                    borderWidth: 1,
                  }}
                  onPress={() => { setBoardSort(sort.k as MarketBoardSort); Haptics.selectionAsync(); }}
                >
                  <Text className="text-xs font-medium" style={{ color: boardSort === sort.k ? '#fff' : UI.subText }}>{sort.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View className="flex-row items-center">
              <View className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isTradingHours() ? 'bg-[#22C55E]' : 'bg-[#64748B]'}`} />
              <Text className="text-xs" style={{ color: UI.subText }}>{isTradingHours() ? '交易中' : '休市'}</Text>
            </View>
            </View>
          </View>
        ) : viewMode === 'indices' ? (
          <View className="gap-2">
            <View className="flex-row items-center justify-between gap-2">
              <View className="flex-row gap-2">
                {[
                  { k: 'gain', label: '涨幅' },
                  { k: 'loss', label: '跌幅' },
                ].map(sort => (
                  <TouchableOpacity
                    key={sort.k}
                    className="px-3 py-1.5 rounded-full"
                    style={{
                      backgroundColor: indexSort === sort.k ? UI.primary : UI.card,
                      borderColor: indexSort === sort.k ? UI.primary : UI.border,
                      borderWidth: 1,
                    }}
                    onPress={() => { setIndexSort(sort.k as MarketBoardSort); Haptics.selectionAsync(); }}
                  >
                    <Text className="text-xs font-medium" style={{ color: indexSort === sort.k ? '#fff' : UI.subText }}>{sort.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View className="flex-row items-center">
                <View className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isTradingHours() ? 'bg-[#22C55E]' : 'bg-[#64748B]'}`} />
                <Text className="text-xs" style={{ color: UI.subText }}>{isTradingHours() ? '交易中' : '休市'}</Text>
              </View>
            </View>
          </View>
        ) : (
          <View className="gap-2">
            <View className="flex-row items-center justify-between gap-2">
              <View className="flex-row gap-2">
                {[
                  { k: 'hour', label: '小时榜' },
                  { k: 'day', label: '日榜' },
                ].map(period => (
                  <TouchableOpacity
                    key={period.k}
                    className="px-3 py-1.5 rounded-full"
                    style={{
                      backgroundColor: hotPeriod === period.k ? UI.primary : UI.card,
                      borderColor: hotPeriod === period.k ? UI.primary : UI.border,
                      borderWidth: 1,
                    }}
                    onPress={() => { setHotPeriod(period.k as HotListPeriod); Haptics.selectionAsync(); }}
                  >
                    <Text className="text-xs font-medium" style={{ color: hotPeriod === period.k ? '#fff' : UI.subText }}>{period.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View className="flex-row items-center">
                <View className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isTradingHours() ? 'bg-[#22C55E]' : 'bg-[#64748B]'}`} />
                <Text className="text-xs" style={{ color: UI.subText }}>{isTradingHours() ? '交易中' : '休市'}</Text>
              </View>
            </View>
          </View>
        )}
      </View>

      {isBoardView ? (
        boardsLoading && boards.length === 0 ? (
          <View className="py-10 items-center">
            <ActivityIndicator color={UI.primary} />
          </View>
        ) : boards.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <View className="w-16 h-16 rounded-2xl items-center justify-center" style={{ backgroundColor: UI.primarySoft }}>
              <FontAwesome6 name="chart-column" size={34} color={UI.primary} />
            </View>
            <Text className="text-sm mt-4" style={{ color: UI.subText }}>暂无板块排行数据</Text>
          </View>
        ) : (
          <FlatList
            data={boards}
            keyExtractor={item => item.code}
            contentContainerClassName="px-4 pb-6"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={UI.primary} />}
            onEndReached={loadMoreBoards}
            onEndReachedThreshold={0.35}
            ListFooterComponent={boardsLoadingMore ? (
              <View className="py-4 items-center">
                <ActivityIndicator color={UI.primary} />
              </View>
            ) : null}
            renderItem={({ item, index }) => {
              const color = getPnlColor(item.change_pct, reversed);
              return (
                <View className="rounded-2xl p-4 mb-2 flex-row items-center justify-between" style={CARD_STYLE}>
                  <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: UI.primarySoft }}>
                    <Text className="text-xs font-bold" style={{ color: UI.primary }}>{index + 1}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold" style={{ color: UI.text }} numberOfLines={1}>{item.name}</Text>
                    <Text className="text-xs mt-1" style={{ color: UI.subText }}>{item.code}</Text>
                    {item.leading_stock_name ? (
                      <Text className="text-xs mt-2" style={{ color: UI.subText }} numberOfLines={1}>
                        领涨：{item.leading_stock_name}
                        {typeof item.leading_stock_change_pct === 'number' ? ` ${formatPercent(item.leading_stock_change_pct)}` : ''}
                      </Text>
                    ) : null}
                  </View>
                  <View className="items-end px-3 py-2 rounded-lg" style={{ backgroundColor: `${color}20`, minWidth: 82 }}>
                    <Text className="text-sm font-bold" style={{ color, fontVariant: ['tabular-nums'] }}>{formatPercent(item.change_pct)}</Text>
                    {item.change_amount ? (
                      <Text className="text-xs mt-0.5" style={{ color }}>{formatMoney(item.change_amount, 2, true)}</Text>
                    ) : null}
                  </View>
                </View>
              );
            }}
          />
        )
      ) : viewMode === 'indices' ? (
        indicesLoading && indices.length === 0 ? (
          <View className="py-10 items-center">
            <ActivityIndicator color={UI.primary} />
          </View>
        ) : indices.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <View className="w-16 h-16 rounded-2xl items-center justify-center" style={{ backgroundColor: UI.primarySoft }}>
              <FontAwesome6 name="chart-simple" size={34} color={UI.primary} />
            </View>
            <Text className="text-sm mt-4" style={{ color: UI.subText }}>暂无指数榜数据</Text>
          </View>
        ) : (
          <FlatList
            data={indices}
            keyExtractor={item => item.code}
            contentContainerClassName="px-4 pb-6"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={UI.primary} />}
            renderItem={({ item, index }) => {
              const color = getPnlColor(item.change_pct, reversed);
              return (
                <View className="rounded-2xl p-4 mb-2 flex-row items-center justify-between" style={CARD_STYLE}>
                  <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: UI.primarySoft }}>
                    <Text className="text-xs font-bold" style={{ color: UI.primary }}>{index + 1}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold" style={{ color: UI.text }} numberOfLines={1}>{item.name}</Text>
                    <Text className="text-xs mt-1" style={{ color: UI.subText }}>{item.code}</Text>
                    <Text className="text-xs mt-2" style={{ color: UI.subText }} numberOfLines={1}>
                      成交额 {formatMoney(item.amount, 2)} · 成交量 {formatMoney(item.volume, 2)}
                    </Text>
                  </View>
                  <View className="items-end px-3 py-2 rounded-lg" style={{ backgroundColor: `${color}20`, minWidth: 86 }}>
                    <Text className="text-sm font-bold" style={{ color, fontVariant: ['tabular-nums'] }}>{formatPercent(item.change_pct)}</Text>
                    <Text className="text-xs mt-0.5" style={{ color }}>{formatMoney(item.change_amount, 2, true)}</Text>
                  </View>
                </View>
              );
            }}
          />
        )
      ) : viewMode === 'hot' ? (
        hotLoading && hotItems.length === 0 ? (
          <View className="py-10 items-center">
            <ActivityIndicator color={UI.primary} />
          </View>
        ) : hotItems.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <View className="w-16 h-16 rounded-2xl items-center justify-center" style={{ backgroundColor: UI.primarySoft }}>
              <FontAwesome6 name="fire" size={34} color={UI.primary} />
            </View>
            <Text className="text-sm mt-4" style={{ color: UI.subText }}>暂无热门榜数据</Text>
          </View>
        ) : (
          <FlatList
            data={hotItems}
            keyExtractor={item => item.code}
            contentContainerClassName="px-4 pb-6"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={UI.primary} />}
            renderItem={({ item, index }) => {
              const rankChange = item.rank_change ?? 0;
              const rankColor = rankChange > 0 ? '#EF4444' : rankChange < 0 ? '#22C55E' : UI.subText;
              const hasChangePct = typeof item.change_pct === 'number';
              const changePct = item.change_pct ?? 0;
              const changeColor = hasChangePct ? getPnlColor(changePct, reversed) : UI.primary;
              const tags = [item.popularity_tag, ...(item.concept_tags ?? [])].filter(Boolean).slice(0, 3);
              return (
                <View className="rounded-2xl p-4 mb-2 flex-row items-center justify-between" style={CARD_STYLE}>
                  <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: UI.primarySoft }}>
                    <Text className="text-xs font-bold" style={{ color: UI.primary }}>{item.rank || index + 1}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold" style={{ color: UI.text }} numberOfLines={1}>{item.name}</Text>
                    <Text className="text-xs mt-1" style={{ color: UI.subText }}>{item.code}</Text>
                    {tags.length > 0 ? (
                      <Text className="text-xs mt-2" style={{ color: UI.subText }} numberOfLines={1}>{tags.join(' · ')}</Text>
                    ) : item.analyse_title ? (
                      <Text className="text-xs mt-2" style={{ color: UI.subText }} numberOfLines={1}>{item.analyse_title}</Text>
                    ) : null}
                  </View>
                  <View className="items-end px-3 py-2 rounded-lg" style={{ backgroundColor: `${changeColor}20`, minWidth: 86 }}>
                    <Text className="text-sm font-bold" style={{ color: changeColor, fontVariant: ['tabular-nums'] }}>{hasChangePct ? formatPercent(changePct) : '--'}</Text>
                    <Text className="text-xs mt-0.5" style={{ color: UI.subText }}>{formatHeat(item.heat)}</Text>
                    {rankChange !== 0 ? (
                      <Text className="text-[10px] mt-0.5" style={{ color: rankColor }}>
                        {rankChange > 0 ? `升${rankChange}` : `降${Math.abs(rankChange)}`}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            }}
          />
        )
      ) : filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-16 h-16 rounded-2xl items-center justify-center" style={{ backgroundColor: UI.primarySoft }}>
            <FontAwesome6 name="chart-line" size={34} color={UI.primary} />
          </View>
          <Text className="text-sm mt-4" style={{ color: UI.subText }}>{emptyText}</Text>
          <TouchableOpacity
            className="mt-6 px-6 py-3 rounded-full"
            style={{ backgroundColor: UI.primary }}
            onPress={() => router.push('/search-quote')}
          >
            <Text className="text-white text-sm font-semibold">添加自选</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          contentContainerClassName="px-4 pb-6"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={UI.primary} />}
          renderItem={({ item }) => {
            const price = item.latest_price ?? 0;
            const prevClose = item.prev_close ?? price;
            const chg = item.change_pct ?? 0;
            const chgAmt = price - prevClose;
            const color = getPnlColor(chg, reversed);
            const typeLabel = getInstrumentTypeShortLabel(item.type);
            return (
              <TouchableOpacity
                className="rounded-2xl p-4 mb-2 flex-row items-center justify-between"
                style={CARD_STYLE}
                activeOpacity={0.7}
                onPress={() => router.push('/instrument-detail', { id: item.id })}
              >
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-base font-semibold" style={{ color: UI.text }} numberOfLines={1}>{item.name}</Text>
                    <Text className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: UI.primarySoft, color: UI.primary }}>{typeLabel}</Text>
                  </View>
                  <Text className="text-xs mt-1" style={{ color: UI.subText }}>{item.code}</Text>
                  <View className="flex-row items-center gap-2 mt-2">
                    <TouchableOpacity
                      className="w-7 h-7 rounded items-center justify-center"
                      style={{ backgroundColor: UI.primarySoft }}
                      onPress={(event) => { event.stopPropagation(); openNameEditor(item); }}
                      accessibilityLabel="修改标的名称"
                    >
                      <FontAwesome6 name="pen-to-square" size={11} color={UI.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="self-start px-2 py-1 rounded"
                      style={{ backgroundColor: UI.primarySoft }}
                      onPress={(event) => { event.stopPropagation(); openGroupEditor(item); }}
                    >
                      <Text className="text-[10px]" style={{ color: UI.primary }}>{item.group_name || '设置分组'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="w-7 h-7 rounded items-center justify-center"
                      style={{ backgroundColor: 'rgba(239,68,68,0.12)' }}
                      onPress={(event) => { event.stopPropagation(); handleDeleteInstrument(item); }}
                      accessibilityLabel="删除标的"
                    >
                      <FontAwesome6 name="trash" size={11} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
                <View className="items-end mr-2">
                  <Text className="text-lg font-bold" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>
                    {formatMoney(price, price < 10 ? 4 : 2)}
                  </Text>
                </View>
                <View className="items-end px-3 py-2 rounded-lg" style={{ backgroundColor: `${color}20`, minWidth: 76 }}>
                  <Text className="text-sm font-bold" style={{ color, fontVariant: ['tabular-nums'] }}>
                    {formatMoney(chgAmt, 2, true)}
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color }}>{formatPercent(chg)}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
      <Modal visible={!!editingName} transparent animationType="fade" onRequestClose={() => setEditingName(null)}>
        <TouchableOpacity className="flex-1 bg-black/50 items-center justify-center p-6" activeOpacity={1} onPress={() => setEditingName(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="w-full max-w-sm">
            <TouchableOpacity activeOpacity={1} className="rounded-2xl p-5" style={CARD_STYLE}>
              <Text className="text-base font-bold mb-3" style={{ color: UI.text }}>修改名称</Text>
              <Text className="text-xs mb-2" style={{ color: UI.subText }}>{editingName?.code}</Text>
              <TextInput
                className="rounded-xl px-4 py-3 text-sm mb-4"
                style={{ backgroundColor: '#F7FAFF', color: UI.text, borderColor: UI.border, borderWidth: 1 }}
                placeholder="输入新名称"
                placeholderTextColor={UI.muted}
                value={nameDraft}
                onChangeText={setNameDraft}
                autoFocus
                selectTextOnFocus
              />
              <View className="flex-row gap-3">
                <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: UI.primarySoft }} onPress={() => setEditingName(null)}>
                  <Text className="text-sm font-medium" style={{ color: UI.primary }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: UI.primary }} onPress={saveName}>
                  <Text className="text-sm text-white font-semibold">保存</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
      <Modal visible={!!deletingInstrument} transparent animationType="fade" onRequestClose={() => setDeletingInstrument(null)}>
        <TouchableOpacity className="flex-1 bg-black/50 items-center justify-center p-6" activeOpacity={1} onPress={() => setDeletingInstrument(null)}>
          <TouchableOpacity activeOpacity={1} className="w-full max-w-sm rounded-2xl p-5" style={CARD_STYLE}>
            <Text className="text-base font-bold mb-2" style={{ color: UI.text }}>删除标的</Text>
            <Text className="text-sm leading-5 mb-4" style={{ color: UI.subText }}>
              确定删除「{deletingInstrument?.name}」及其交易、历史价格、提醒和定投记录吗？此操作不可恢复。
            </Text>
            <View className="flex-row gap-3">
              <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: UI.primarySoft }} onPress={() => setDeletingInstrument(null)}>
                <Text className="text-sm font-medium" style={{ color: UI.primary }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: '#EF4444' }} onPress={confirmDeleteInstrument}>
                <Text className="text-sm text-white font-semibold">删除</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      <Modal visible={!!editingGroup} transparent animationType="fade" onRequestClose={() => setEditingGroup(null)}>
        <TouchableOpacity className="flex-1 bg-black/50 items-center justify-center p-6" activeOpacity={1} onPress={() => setEditingGroup(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="w-full max-w-sm">
            <TouchableOpacity activeOpacity={1} className="rounded-2xl p-5" style={CARD_STYLE}>
              <Text className="text-base font-bold mb-3" style={{ color: UI.text }}>设置分组</Text>
              <Text className="text-xs mb-2" style={{ color: UI.subText }}>{editingGroup?.name}</Text>
              <TextInput
                className="rounded-xl px-4 py-3 text-sm mb-4"
                style={{ backgroundColor: '#F7FAFF', color: UI.text, borderColor: UI.border, borderWidth: 1 }}
                placeholder="如：核心、观察、ETF"
                placeholderTextColor={UI.muted}
                value={groupName}
                onChangeText={setGroupName}
                autoFocus
              />
              <View className="flex-row gap-3">
                <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: UI.primarySoft }} onPress={() => setEditingGroup(null)}>
                  <Text className="text-sm font-medium" style={{ color: UI.primary }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: UI.primary }} onPress={saveGroup}>
                  <Text className="text-sm text-white font-semibold">保存</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
    </Screen>
  );
}
