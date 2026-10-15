import { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useApp } from '@/contexts/AppContext';
import { useFocusEffect } from 'expo-router';
import { getAllDcaPlans, setDcaStatus } from '@/db/dca';
import { getAllInstruments, getInstrumentById } from '@/db/instruments';
import { refreshAllQuotes } from '@/db/quotes';
import { computeDcaStats } from '@/db/calculations';
import { getSetting } from '@/db/settings';
import { formatMoney, formatPercent, getPnlColor } from '@/utils/format';
import type { DcaPlan } from '@/db/types';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Alert } from 'react-native';

const UI = {
  primary: '#1D4ED8',
  primarySoft: '#EAF0FF',
  gold: '#F59E0B',
  goldSoft: '#FFF7E6',
  card: '#FFFFFF',
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
  shadowOpacity: 0.04,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 5 },
  elevation: 1,
};

interface DcaView extends DcaPlan {
  instrument_name: string;
  instrument_code: string;
  latest_price: number;
  stats: {
    total_invested: number;
    total_shares: number;
    market_value: number;
    profit: number;
    profit_pct: number;
    annualized_pct: number;
    exec_count: number;
  };
}

export default function DcaScreen() {
  const router = useSafeRouter();
  const { refreshTrigger, triggerRefresh } = useApp();
  const [plans, setPlans] = useState<DcaView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reversed, setReversed] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'terminated'>('all');

  const loadData = useCallback(async (refreshQuote = false) => {
    try {
      const all = await getAllDcaPlans();
      if (refreshQuote && all.length > 0) {
        const instruments = await getAllInstruments();
        await refreshAllQuotes(instruments);
      }
      const rg = await getSetting('red_green_reversed');
      setReversed(rg === '1');
      const views: DcaView[] = [];
      for (const p of all) {
        const inst = await getInstrumentById(p.instrument_id);
        if (!inst) continue;
        const stats = await computeDcaStats(p.id, inst.latest_price || 0);
        views.push({ ...p, instrument_name: inst.name, instrument_code: inst.code, latest_price: inst.latest_price || 0, stats });
      }
      setPlans(views);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [refreshTrigger]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.selectionAsync();
    await loadData(true);
  }, [loadData]);

  const handleTerminate = (id: number) => {
    Alert.alert('终止定投', '确定终止该定投计划？历史记录会保留。', [
      { text: '取消', style: 'cancel' },
      { text: '终止', style: 'destructive', onPress: async () => { await setDcaStatus(id, 'terminated'); triggerRefresh(); } },
    ]);
  };
  const handlePauseResume = async (id: number, current: string) => {
    await setDcaStatus(id, current === 'paused' ? 'active' : 'paused');
    triggerRefresh();
  };

  const filtered = plans.filter(p => filter === 'all' || p.status === filter);

  const totalInvested = plans.reduce((s, p) => s + p.stats.total_invested, 0);
  const totalMv = plans.reduce((s, p) => s + p.stats.market_value, 0);
  const totalProfit = totalMv - totalInvested;

  if (loading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={UI.primary} /></View>
      </Screen>
    );
  }

  const cycleLabel = (p: DcaPlan) => {
    if (p.cycle === 'daily') return '每日';
    if (p.cycle === 'weekly') return `每周${'日一二三四五六'[p.weekday ?? 1]}`;
    if (p.cycle === 'monthly') return `每月${p.monthday}日`;
    if (p.cycle === 'custom_days') return `每${p.interval_days}天`;
    return '';
  };

  return (
    <Screen safeAreaEdges={['top']}>
      <View className="px-4 pt-2 pb-3">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-xl font-bold" style={{ color: UI.text }}>定投计划</Text>
          <TouchableOpacity
            className="px-4 py-2 rounded-full flex-row items-center gap-2"
            style={{ backgroundColor: UI.primary }}
            onPress={() => router.push('/add-dca')}
          >
            <FontAwesome6 name="plus" size={12} color="#fff" />
            <Text className="text-white text-sm font-semibold">新建</Text>
          </TouchableOpacity>
        </View>

        {/* 汇总卡 */}
        <View className="rounded-2xl p-4 flex-row justify-between mb-3" style={CARD_STYLE}>
          <View style={{ minWidth: 0 }}>
            <Text className="text-xs" style={{ color: UI.subText }}>定投累计投入</Text>
            <Text className="text-lg font-bold mt-1" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>¥{formatMoney(totalInvested)}</Text>
          </View>
          <View className="items-end" style={{ minWidth: 0 }}>
            <Text className="text-xs" style={{ color: UI.subText }}>定投总市值</Text>
            <Text className="text-lg font-bold mt-1" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>¥{formatMoney(totalMv)}</Text>
          </View>
          <View className="items-end" style={{ minWidth: 0 }}>
            <Text className="text-xs" style={{ color: UI.subText }}>累计收益</Text>
            <Text className="text-lg font-bold mt-1" style={{ color: getPnlColor(totalProfit, reversed), fontVariant: ['tabular-nums'] }}>
              {formatMoney(totalProfit, 2, true)}
            </Text>
          </View>
        </View>

        {/* 筛选 */}
        <View className="flex-row flex-wrap gap-2">
          {[
            { k: 'all', label: '全部' },
            { k: 'active', label: '进行中' },
            { k: 'paused', label: '已暂停' },
            { k: 'terminated', label: '已终止' },
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
      </View>

      {filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-16 h-16 rounded-2xl items-center justify-center" style={{ backgroundColor: UI.goldSoft }}>
            <FontAwesome6 name="coins" size={34} color={UI.gold} />
          </View>
          <Text className="text-sm mt-4" style={{ color: UI.subText }}>还没有定投计划</Text>
          <TouchableOpacity
            className="mt-6 px-6 py-3 rounded-full"
            style={{ backgroundColor: UI.primary }}
            onPress={() => router.push('/add-dca')}
          >
            <Text className="text-white text-sm font-semibold">创建第一个定投计划</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          contentContainerClassName="px-4 pb-6"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={UI.primary} />}
          renderItem={({ item }) => {
            const statusColor = item.status === 'active' ? '#22C55E' : item.status === 'paused' ? '#F59E0B' : '#64748B';
            const statusLabel = item.status === 'active' ? '进行中' : item.status === 'paused' ? '已暂停' : '已终止';
            const pnlColor = getPnlColor(item.stats.profit, reversed);
            return (
              <TouchableOpacity
                className="rounded-2xl p-4 mb-2"
                style={CARD_STYLE}
                activeOpacity={0.7}
                onPress={() => router.push('/dca-detail', { id: item.id })}
              >
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-1 flex-row items-center gap-2">
                    <Text className="text-base font-semibold" style={{ color: UI.text }} numberOfLines={1}>{item.instrument_name}</Text>
                    <Text className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: `${statusColor}20`, color: statusColor }}>
                      {statusLabel}
                    </Text>
                  </View>
                </View>
                <Text className="text-xs mb-3" style={{ color: UI.subText }}>
                  {item.instrument_code} · {item.name} · {cycleLabel(item)} · ¥{formatMoney(item.amount)}/次 · T+{item.confirm_days}
                </Text>

                <View className="flex-row justify-between pt-3" style={{ borderTopWidth: 1, borderTopColor: UI.borderSoft }}>
                  <View>
                    <Text className="text-xs" style={{ color: UI.subText }}>已定投</Text>
                    <Text className="text-sm mt-0.5" style={{ color: UI.text }}>{item.stats.exec_count}次</Text>
                  </View>
                  <View>
                    <Text className="text-xs" style={{ color: UI.subText }}>总投入</Text>
                    <Text className="text-sm mt-0.5 text-right" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>¥{formatMoney(item.stats.total_invested)}</Text>
                  </View>
                  <View>
                    <Text className="text-xs" style={{ color: UI.subText }}>市值</Text>
                    <Text className="text-sm mt-0.5 text-right" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>¥{formatMoney(item.stats.market_value)}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-xs" style={{ color: UI.subText }}>收益</Text>
                    <Text className="text-sm font-semibold mt-0.5" style={{ color: pnlColor }}>
                      {formatPercent(item.stats.profit_pct)}
                    </Text>
                  </View>
                </View>

                {item.status !== 'terminated' && (
                  <View className="flex-row gap-2 mt-3">
                    <TouchableOpacity
                      className="flex-1 py-2 rounded-lg items-center"
                      style={{ backgroundColor: UI.primarySoft }}
                      onPress={() => handlePauseResume(item.id, item.status)}
                    >
                      <Text className="text-xs font-medium" style={{ color: UI.primary }}>{item.status === 'paused' ? '恢复' : '暂停'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="flex-1 py-2 rounded-lg items-center"
                      style={{ backgroundColor: 'rgba(239,68,68,0.15)' }}
                      onPress={() => handleTerminate(item.id)}
                    >
                      <Text className="text-xs text-[#EF4444]">终止</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </Screen>
  );
}
