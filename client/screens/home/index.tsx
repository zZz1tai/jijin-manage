import { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Dimensions } from 'react-native';
import { Screen } from '@/components/Screen';
import { useApp } from '@/contexts/AppContext';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { computeAllPositions, computeSummary, getFullHoldings } from '@/db/calculations';
import { getAllInstruments } from '@/db/instruments';
import { refreshAllQuotes } from '@/db/quotes';
import { getSetting } from '@/db/settings';
import { recordDailySnapshot } from '@/db/calculations';
import { getAccounts } from '@/db/accounts';
import { formatMoney, formatPercent, getPnlColor } from '@/utils/format';
import { getInstrumentTypeColor, getInstrumentTypeLabel } from '@/utils/instrument';
import { LineChart, PieChart } from 'react-native-gifted-charts';
import * as Haptics from 'expo-haptics';
import { FontAwesome6 } from '@expo/vector-icons';

type Period = 'day' | 'week' | 'month' | 'year' | 'all';

const { width: SCREEN_W } = Dimensions.get('window');

const EMPTY_SUMMARY = {
  total_market_value: 0,
  total_cost: 0,
  total_floating_pnl: 0,
  total_floating_pct: 0,
  total_float_pnl: 0,
  float_pnl_pct: 0,
  today_pnl: 0,
  today_pnl_pct: 0,
  total_realized_pnl: 0,
  total_pnl: 0,
  total_pnl_pct: 0,
  history: [],
};

const UI = {
  primary: '#1677FF',
  primarySoft: '#EAF3FF',
  card: '#FFFFFF',
  cardSoft: '#F8FAFF',
  border: '#E6EEF8',
  borderSoft: '#EEF2F7',
  text: '#0F172A',
  subText: '#667085',
  muted: '#98A2B3',
};

const CARD_STYLE = {
  backgroundColor: UI.card,
  borderColor: UI.border,
  borderWidth: 1,
  shadowColor: UI.primary,
  shadowOpacity: 0.06,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 2,
};

export default function HomeScreen() {
  const router = useSafeRouter();
  const { refreshTrigger } = useApp();
  const [data, setData] = useState<any>(null);
  const [reversed, setReversed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<Period>('month');
  const [holdings, setHoldings] = useState<any[]>([]);
  const [accountHoldings, setAccountHoldings] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [showTypePie, setShowTypePie] = useState<'type' | 'account'>('type');

  const load = useCallback(async (refreshQuote = false) => {
    try {
      const rg = await getSetting('red_green_reversed');
      setReversed(rg === '1');
      const accs = await getAccounts();
      setAccounts(accs);
      let insts = await getAllInstruments();
      if (refreshQuote && insts.length > 0) {
        await refreshAllQuotes(insts);
        insts = await getAllInstruments();
      }
      const hs = await getFullHoldings(insts);
      setHoldings(hs);
      const byAccount = [];
      for (const account of accs) {
        const positions = await computeAllPositions(account.id);
        byAccount.push(...positions.map(position => ({ ...position, account_id: account.id, account_name: account.name })));
      }
      setAccountHoldings(byAccount);
      const summary = await computeSummary(hs);
      setData(summary);
      await recordDailySnapshot();
    } catch (e) {
      console.error(e);
      setData(EMPTY_SUMMARY);
    }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    load(false);
  }, [load, refreshTrigger]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.selectionAsync();
    await load(true);
  }, [load]);

  const snapshots = useMemo(() => {
    if (!data?.history) return [];
    const now = Date.now();
    const periodMs: Record<Period, number> = {
      day: 86400_000, week: 7*86400_000, month: 30*86400_000, year: 365*86400_000, all: Infinity,
    };
    const cutoff = now - periodMs[period];
    return data.history.filter((s: any) => new Date(s.date).getTime() >= cutoff);
  }, [data?.history, period]);

  const chartData = useMemo(() => {
    if (snapshots.length < 2) return [];
    return snapshots.map((s: any) => ({ value: s.total_value }));
  }, [snapshots]);

  const chartMax = useMemo(() => {
    if (chartData.length === 0) return 100;
    const max = Math.max(...chartData.map((d: any) => d.value));
    return max * 1.01;
  }, [chartData]);

  // 区间收益
  const periodReturn = useMemo(() => {
    if (snapshots.length < 2) return { start: 0, end: 0, profit: 0, pct: 0, max_drawdown: 0 };
    const vals = snapshots.map((s: any) => s.total_value);
    const start = vals[0];
    const end = vals[vals.length - 1];
    let peak = vals[0], maxDD = 0;
    for (const v of vals) {
      if (v > peak) peak = v;
      const dd = (peak - v) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    return {
      start, end, profit: end - start,
      pct: start > 0 ? (end - start) / start : 0,
      max_drawdown: maxDD,
    };
  }, [snapshots]);

  // 资产分布
  const typeDist = useMemo(() => {
    const dist: Record<string, number> = {
      stock: 0,
      stock_hk: 0,
      stock_us: 0,
      stock_global: 0,
      index: 0,
      fund_etf: 0,
      fund_open: 0,
    };
    for (const h of holdings) {
      const mv = h.quantity * (h.instrument?.latest_price || h.cost_price);
      dist[h.instrument?.type || 'stock'] = (dist[h.instrument?.type || 'stock'] || 0) + mv;
    }
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    return Object.entries(dist).filter(([, v]) => v > 0).map(([k, v]) => ({
      value: v, color: getInstrumentTypeColor(k), text: getInstrumentTypeLabel(k),
      pct: total > 0 ? v / total : 0,
    }));
  }, [holdings]);

  const accountDist = useMemo(() => {
    const dist: Record<number, number> = {};
    const nameMap: Record<number, string> = {};
    for (const a of accounts) { dist[a.id] = 0; nameMap[a.id] = a.name; }
    dist[-1] = 0; nameMap[-1] = '默认账户';
    for (const h of accountHoldings) {
      const mv = h.quantity * (h.instrument?.latest_price || h.cost_price);
      const aid = h.account_id ?? -1;
      dist[aid] = (dist[aid] || 0) + mv;
      if (!nameMap[aid]) nameMap[aid] = '未知账户';
    }
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    const palette = [UI.primary, '#22C55E', '#F59E0B', '#A855F7', '#EF4444', '#06B6D4', '#EC4899'];
    return Object.entries(dist).filter(([, v]) => v > 0).map(([k, v], i) => ({
      value: v, color: palette[i % palette.length], text: nameMap[Number(k)],
      pct: total > 0 ? v / total : 0,
    }));
  }, [accountHoldings, accounts]);

  const pieData = showTypePie === 'type' ? typeDist : accountDist;

  const holdingsSorted = useMemo(() => {
    return [...holdings].sort((a, b) => b.floating_pnl - a.floating_pnl);
  }, [holdings]);

  const totalCash = data?.cash_balance || 0;
  const totalAsset = (data?.total_market_value || 0) + totalCash;

  if (!data) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={UI.primary} /></View>
      </Screen>
    );
  }

  const profitColor = getPnlColor(data.total_pnl, reversed);
  const periodColor = getPnlColor(periodReturn.profit, reversed);

  return (
    <Screen safeAreaEdges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-8"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={UI.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* 顶部总览卡 */}
        <View className="px-4 pt-4">
          <View className="rounded-3xl p-5 overflow-hidden" style={{ backgroundColor: UI.primary }}>
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-xs text-white/80">总资产 (CNY)</Text>
              <View className="px-2 py-1 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.16)' }}>
                <Text className="text-[10px] text-white/90">本地账本</Text>
              </View>
            </View>
            <Text className="text-4xl font-black text-white" style={{ fontVariant: ['tabular-nums'] }}>
              ¥{formatMoney(totalAsset)}
            </Text>
            <View className="flex-row gap-4 mt-3">
              <View className="flex-1 rounded-2xl p-3" style={{ backgroundColor: 'rgba(255,255,255,0.14)', minWidth: 0 }}>
                <Text className="text-[10px] text-white/70">今日盈亏</Text>
                <Text className="text-base font-bold mt-0.5" style={{ color: '#FFFFFF', fontVariant: ['tabular-nums'] }}>
                  {formatMoney(data.today_pnl, 2, true)} ({formatPercent(data.today_pnl_pct)})
                </Text>
              </View>
              <View className="flex-1 rounded-2xl p-3" style={{ backgroundColor: 'rgba(255,255,255,0.14)', minWidth: 0 }}>
                <Text className="text-[10px] text-white/70">累计盈亏</Text>
                <Text className="text-base font-bold mt-0.5" style={{ color: '#FFFFFF', fontVariant: ['tabular-nums'] }}>
                  {formatMoney(data.total_pnl, 2, true)} ({formatPercent(data.total_pnl_pct)})
                </Text>
              </View>
            </View>
            <View className="flex-row gap-3 mt-4">
              <TouchableOpacity
                className="flex-1 py-3 rounded-2xl flex-row items-center justify-center gap-2"
                style={{ backgroundColor: '#FFFFFF', minWidth: 0 }}
                onPress={() => router.push('/add-holding')}
              >
                <FontAwesome6 name="plus" size={10} color={UI.primary} />
                <Text className="text-xs font-semibold" style={{ color: UI.primary }}>记持仓</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 py-3 rounded-2xl flex-row items-center justify-center gap-2"
                style={{ backgroundColor: 'rgba(255,255,255,0.16)', minWidth: 0 }}
                onPress={() => router.push('/add-transaction')}
              >
                <FontAwesome6 name="arrow-right-arrow-left" size={10} color="#FFFFFF" />
                <Text className="text-xs text-white font-semibold">记交易</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 资产分布 */}
          <View className="flex-row mt-3 gap-2">
            <View className="flex-1 rounded-2xl p-3" style={[CARD_STYLE, { minWidth: 0 }]}>
              <Text className="text-[10px]" style={{ color: UI.subText }}>持仓市值</Text>
              <Text className="text-base font-bold mt-1" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>¥{formatMoney(data.total_market_value)}</Text>
            </View>
            <View className="flex-1 rounded-2xl p-3" style={[CARD_STYLE, { minWidth: 0 }]}>
              <Text className="text-[10px]" style={{ color: UI.subText }}>浮动盈亏</Text>
              <Text className="text-base font-bold mt-1" style={{ color: profitColor, fontVariant: ['tabular-nums'] }}>
                {formatMoney(data.total_float_pnl, 2, true)}
              </Text>
            </View>
            <View className="flex-1 rounded-2xl p-3" style={[CARD_STYLE, { minWidth: 0 }]}>
              <Text className="text-[10px]" style={{ color: UI.subText }}>账户现金</Text>
              <Text className="text-base font-bold mt-1" style={{ color: totalCash >= 0 ? UI.text : '#EF4444', fontVariant: ['tabular-nums'] }}>
                ¥{formatMoney(totalCash)}
              </Text>
            </View>
          </View>
        </View>

        {/* 净值走势图 */}
        <View className="mx-4 mt-3 rounded-2xl p-4" style={CARD_STYLE}>
          <View className="flex-row items-center justify-between mb-1 gap-2 flex-wrap">
            <Text className="text-sm font-semibold" style={{ color: UI.text }}>净值走势</Text>
            <View className="flex-row gap-1 flex-wrap justify-end">
              {[
                { k: 'day', l: '日' },
                { k: 'week', l: '周' },
                { k: 'month', l: '月' },
                { k: 'year', l: '年' },
                { k: 'all', l: '全部' },
              ].map(p => (
                <TouchableOpacity
                  key={p.k}
                  className="px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: period === p.k ? UI.primary : UI.primarySoft }}
                  onPress={() => { setPeriod(p.k as Period); Haptics.selectionAsync(); }}
                >
                  <Text className="text-[10px] font-medium" style={{ color: period === p.k ? '#fff' : UI.primary }}>{p.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View className="flex-row items-baseline gap-2 mb-0">
            <Text className="text-xl font-bold" style={{ color: periodColor, fontVariant: ['tabular-nums'] }}>
              {formatMoney(periodReturn.profit, 2, true)}
            </Text>
            <Text className="text-sm" style={{ color: periodColor }}>{formatPercent(periodReturn.pct)}</Text>
            <Text className="text-[10px] ml-1" style={{ color: UI.subText }}>最大回撤 {formatPercent(-periodReturn.max_drawdown)}</Text>
          </View>
          {chartData.length > 1 ? (
            <View style={{ marginHorizontal: -12, marginTop: 4 }}>
              <LineChart
                data={chartData}
                width={SCREEN_W - 56}
                height={160}
                spacing={Math.max(2, (SCREEN_W - 56) / Math.max(chartData.length - 1, 1))}
                initialSpacing={12}
                endSpacing={12}
                noOfSections={3}
                yAxisLabelWidth={0}
                hideYAxisText
                hideDataPoints
                thickness={2}
                color={periodColor}
                startFillColor={periodColor}
                endFillColor={periodColor}
                startOpacity={0.15}
                endOpacity={0}
                curved
                isAnimated
                animationDuration={600}
                rulesType="solid"
                rulesColor={UI.borderSoft}
                adjustToWidth
                maxValue={chartMax}
              />
            </View>
          ) : (
            <View className="h-40 items-center justify-center">
              <Text className="text-xs" style={{ color: UI.subText }}>数据积累中，每日自动记录一次净值快照</Text>
            </View>
          )}
        </View>

        {/* 资产分布饼图 */}
        {holdings.length > 0 && (
          <View className="mx-4 mt-3 rounded-2xl p-4" style={CARD_STYLE}>
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-sm font-semibold" style={{ color: UI.text }}>资产分布</Text>
              <View className="flex-row gap-1 rounded-full p-0.5" style={{ backgroundColor: UI.primarySoft }}>
                <TouchableOpacity
                  className="px-3 py-1 rounded-full"
                  style={{ backgroundColor: showTypePie === 'type' ? UI.primary : 'transparent' }}
                  onPress={() => setShowTypePie('type')}
                >
                  <Text className="text-[10px]" style={{ color: showTypePie === 'type' ? '#fff' : UI.primary }}>按类型</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="px-3 py-1 rounded-full"
                  style={{ backgroundColor: showTypePie === 'account' ? UI.primary : 'transparent' }}
                  onPress={() => setShowTypePie('account')}
                >
                  <Text className="text-[10px]" style={{ color: showTypePie === 'account' ? '#fff' : UI.primary }}>按账户</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View className="flex-row items-center">
              <PieChart
                data={pieData.map(d => ({ value: d.value, color: d.color }))}
                radius={60}
                innerRadius={38}
                innerCircleColor="#FFFFFF"
                strokeColor="#FFFFFF"
                strokeWidth={2}
                donut
              />
              <View className="flex-1 ml-4 gap-2">
                {pieData.map(d => (
                  <View key={d.text} className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                      <Text className="text-xs" style={{ color: UI.subText }}>{d.text}</Text>
                    </View>
                    <Text className="text-xs font-semibold" style={{ color: UI.text }}>{(d.pct * 100).toFixed(1)}%</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* 持仓盈亏排行 */}
        {holdings.length > 0 && (
          <View className="mx-4 mt-3 rounded-2xl p-4" style={CARD_STYLE}>
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-sm font-semibold" style={{ color: UI.text }}>持仓盈亏排行</Text>
              <TouchableOpacity onPress={() => router.push('/holdings')}>
                <Text className="text-xs" style={{ color: UI.primary }}>查看全部 →</Text>
              </TouchableOpacity>
            </View>
            {holdingsSorted.slice(0, 5).map((h, i) => {
              const pnlColor = getPnlColor(h.floating_pnl, reversed);
              return (
                <TouchableOpacity
                  key={h.instrument.id}
                  className="flex-row items-center justify-between py-2.5"
                  style={i < Math.min(4, holdingsSorted.length - 1) ? { borderBottomWidth: 1, borderBottomColor: UI.borderSoft } : undefined}
                  activeOpacity={0.7}
                  onPress={() => router.push('/instrument-detail', { id: h.instrument.id })}
                >
                  <View className="flex-row items-center gap-3 flex-1">
                    <Text className="text-xs w-4" style={{ color: UI.muted }}>{i + 1}</Text>
                    <View className="flex-1">
                      <Text className="text-sm" style={{ color: UI.text }} numberOfLines={1}>{h.instrument?.name}</Text>
                      <Text className="text-[10px] mt-0.5" style={{ color: UI.subText }}>{h.instrument?.code}</Text>
                    </View>
                  </View>
                  <View className="items-end">
                    <Text className="text-sm font-semibold" style={{ color: pnlColor }}>
                      {formatMoney(h.floating_pnl, 2, true)}
                    </Text>
                    <Text className="text-[10px] mt-0.5" style={{ color: pnlColor }}>{formatPercent(h.floating_pnl_pct)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* 空状态 */}
        {holdings.length === 0 && (
          <View className="mx-4 mt-6 rounded-2xl p-8 items-center" style={CARD_STYLE}>
            <View className="w-14 h-14 rounded-2xl items-center justify-center" style={{ backgroundColor: UI.primarySoft }}>
              <FontAwesome6 name="chart-pie" size={28} color={UI.primary} />
            </View>
            <Text className="text-sm mt-3 text-center font-semibold" style={{ color: UI.text }}>开始记录你的第一笔持仓</Text>
            <Text className="text-xs mt-1 text-center" style={{ color: UI.subText }}>所有数据仅保存在本地，绝不上传</Text>
            <TouchableOpacity
              className="mt-5 px-6 py-3 rounded-full"
              style={{ backgroundColor: UI.primary }}
              onPress={() => router.push('/add-holding')}
            >
              <Text className="text-white text-sm font-semibold">添加持仓</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
