import { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Alert, Animated } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useApp } from '@/contexts/AppContext';
import { useFocusEffect } from 'expo-router';
import { computeAllPositions } from '@/db/calculations';
import { deleteInstrument, getAllInstruments } from '@/db/instruments';
import { refreshAllQuotes } from '@/db/quotes';
import { getSetting, setSetting } from '@/db/settings';
import { formatMoney, formatPercent, formatQuantity, getPnlColor } from '@/utils/format';
import type { PositionView } from '@/db/types';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Swipeable } from 'react-native-gesture-handler';

type SortKey = 'market_value' | 'pnl' | 'pnl_pct' | 'name';

const UI = {
  primary: '#1D4ED8',
  primarySoft: '#EAF0FF',
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
  shadowOpacity: 0.05,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
};

export default function HoldingsScreen() {
  const router = useSafeRouter();
  const { refreshTrigger, triggerRefresh } = useApp();
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [costMethod, setCostMethod] = useState<'avg' | 'fifo'>('avg');
  const [sortKey, setSortKey] = useState<SortKey>('market_value');
  const [reversed, setReversed] = useState(false);

  const loadData = useCallback(async (refreshQuote = false) => {
    try {
      const instruments = await getAllInstruments();
      if (refreshQuote && instruments.length > 0) {
        await refreshAllQuotes(instruments);
      }
      const [methodSetting, rgSetting] = await Promise.all([
        getSetting('cost_method'),
        getSetting('red_green_reversed'),
      ]);
      setCostMethod((methodSetting as 'avg' | 'fifo') || 'avg');
      setReversed(rgSetting === '1');
      const pos = await computeAllPositions();
      setPositions(pos);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(false); }, [refreshTrigger]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.selectionAsync();
    await loadData(true);
  }, [loadData]);

  const handleDelete = useCallback((pos: PositionView) => {
    Alert.alert(
      '删除持仓',
      `确定删除「${pos.instrument.name}」相关的全部记录吗？此操作不可恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除', style: 'destructive', onPress: async () => {
            await deleteInstrument(pos.instrument.id);
            triggerRefresh();
          }
        }
      ]
    );
  }, [triggerRefresh]);

  const toggleCostMethod = async () => {
    const next = costMethod === 'avg' ? 'fifo' : 'avg';
    await setSetting('cost_method', next);
    setCostMethod(next);
    Haptics.selectionAsync();
    loadData(false);
  };

  const sorted = [...positions].sort((a, b) => {
    switch (sortKey) {
      case 'pnl': return b.floating_pnl - a.floating_pnl;
      case 'pnl_pct': return b.floating_pnl_pct - a.floating_pnl_pct;
      case 'name': return a.instrument.name.localeCompare(b.instrument.name);
      default: return b.market_value - a.market_value;
    }
  });

  if (loading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={UI.primary} />
        </View>
      </Screen>
    );
  }

  const totalValue = sorted.reduce((s, p) => s + p.market_value, 0);
  const totalFloat = sorted.reduce((s, p) => s + p.floating_pnl, 0);
  const totalCost = sorted.reduce((s, p) => s + p.cost_amount, 0);
  const totalPct = totalCost > 0 ? (totalFloat / totalCost) * 100 : 0;

  const renderRightActions = (pos: PositionView, dragX: Animated.AnimatedInterpolation<number>) => {
    const trans = dragX.interpolate({
      inputRange: [-180, 0], outputRange: [0, 80], extrapolate: 'clamp',
    });
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', width: 180 }}>
        <Animated.View style={{ transform: [{ translateX: trans }] }}>
          <TouchableOpacity
            style={{ width: 60, height: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: UI.primary }}
            onPress={() => router.push('/add-transaction', { instrument_id: pos.instrument.id, instrument_name: pos.instrument.name })}
          >
            <FontAwesome6 name="pen" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, marginTop: 4 }}>记交易</Text>
          </TouchableOpacity>
        </Animated.View>
        <TouchableOpacity
          style={{ width: 60, height: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: '#F59E0B' }}
          onPress={() => router.push('/instrument-detail', { id: pos.instrument.id })}
        >
          <FontAwesome6 name="gear" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 11, marginTop: 4 }}>详情</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ width: 60, height: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: '#EF4444' }}
          onPress={() => handleDelete(pos)}
        >
          <FontAwesome6 name="trash" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 11, marginTop: 4 }}>删除</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Screen safeAreaEdges={['top']}>
      {/* 头部 */}
      <View className="px-4 pt-2 pb-3">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-xl font-bold" style={{ color: UI.text }}>我的持仓</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity
              className="px-3 py-1.5 rounded-full"
              style={{ backgroundColor: UI.primarySoft, borderColor: UI.border, borderWidth: 1 }}
              onPress={toggleCostMethod}
            >
              <Text className="text-xs font-medium" style={{ color: UI.primary }}>{costMethod === 'avg' ? '加权平均' : 'FIFO'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="w-9 h-9 rounded-full items-center justify-center"
              style={{ backgroundColor: UI.primary }}
              onPress={() => router.push('/add-transaction')}
            >
              <FontAwesome6 name="plus" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 汇总条 */}
        <View className="rounded-2xl p-4 flex-row justify-between" style={CARD_STYLE}>
          <View style={{ minWidth: 0 }}>
            <Text className="text-xs" style={{ color: UI.subText }}>总市值</Text>
            <Text className="text-lg font-bold mt-1" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>¥{formatMoney(totalValue)}</Text>
          </View>
          <View className="items-end" style={{ minWidth: 0 }}>
            <Text className="text-xs" style={{ color: UI.subText }}>总浮动盈亏</Text>
            <Text className="text-lg font-bold mt-1" style={{ color: getPnlColor(totalFloat, reversed), fontVariant: ['tabular-nums'] }}>
              {formatMoney(totalFloat, 2, true)}
            </Text>
            <Text className="text-xs" style={{ color: getPnlColor(totalPct, reversed) }}>{formatPercent(totalPct)}</Text>
          </View>
        </View>

        {/* 排序 */}
        <View className="flex-row flex-wrap gap-2 mt-3">
          {([
            { k: 'market_value', label: '市值' },
            { k: 'pnl', label: '盈亏额' },
            { k: 'pnl_pct', label: '盈亏率' },
            { k: 'name', label: '名称' },
          ] as { k: SortKey; label: string }[]).map(s => (
            <TouchableOpacity
              key={s.k}
              className={`px-3 py-1 rounded-full ${sortKey === s.k ? '' : ''}`}
              style={{ backgroundColor: sortKey === s.k ? UI.primary : UI.card, borderColor: sortKey === s.k ? UI.primary : UI.border, borderWidth: 1 }}
              onPress={() => { setSortKey(s.k); Haptics.selectionAsync(); }}
            >
              <Text className="text-xs font-medium" style={{ color: sortKey === s.k ? '#fff' : UI.subText }}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 列表 */}
      {sorted.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-16 h-16 rounded-2xl items-center justify-center" style={{ backgroundColor: UI.primarySoft }}>
            <FontAwesome6 name="briefcase" size={34} color={UI.primary} />
          </View>
          <Text className="text-sm mt-4" style={{ color: UI.subText }}>暂无持仓记录</Text>
          <TouchableOpacity
            className="mt-6 px-6 py-3 rounded-full"
            style={{ backgroundColor: UI.primary }}
            onPress={() => router.push('/add-transaction')}
          >
            <Text className="text-white text-sm font-semibold">记录第一笔交易</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={item => String(item.instrument.id)}
          contentContainerClassName="px-4 pb-6"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={UI.primary} />}
          renderItem={({ item }) => (
            <Swipeable
              renderRightActions={(dragX) => renderRightActions(item, dragX)}
              overshootRight={false}
            >
              <TouchableOpacity
                className="rounded-2xl p-4 mb-2"
                style={CARD_STYLE}
                activeOpacity={0.7}
                onPress={() => router.push('/instrument-detail', { id: item.instrument.id })}
              >
                <View className="flex-row justify-between items-start">
                  <View className="flex-1 pr-3">
                    <Text className="text-base font-semibold" style={{ color: UI.text }} numberOfLines={1}>{item.instrument.name}</Text>
                    <Text className="text-xs mt-1" style={{ color: UI.subText }}>
                      {item.instrument.code} · 持仓 {formatQuantity(item.quantity)}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-base font-semibold" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>
                      ¥{formatMoney(item.market_value)}
                    </Text>
                    <Text className="text-xs mt-0.5" style={{ color: UI.subText }}>现价 {formatMoney(item.instrument.latest_price || 0)}</Text>
                  </View>
                </View>

                <View className="flex-row justify-between mt-3 pt-3" style={{ borderTopWidth: 1, borderTopColor: UI.borderSoft }}>
                  <View>
                    <Text className="text-xs" style={{ color: UI.subText }}>成本价</Text>
                    <Text className="text-sm mt-0.5" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>{formatMoney(item.cost_price)}</Text>
                  </View>
                  <View>
                    <Text className="text-xs" style={{ color: UI.subText }}>持仓成本</Text>
                    <Text className="text-sm mt-0.5 text-right" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>¥{formatMoney(item.cost_amount)}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-xs" style={{ color: UI.subText }}>浮动盈亏</Text>
                    <Text className="text-sm font-semibold mt-0.5" style={{ color: getPnlColor(item.floating_pnl, reversed), fontVariant: ['tabular-nums'] }}>
                      {formatMoney(item.floating_pnl, 2, true)}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-xs" style={{ color: UI.subText }}>盈亏率</Text>
                    <Text className="text-sm font-semibold mt-0.5" style={{ color: getPnlColor(item.floating_pnl_pct, reversed) }}>
                      {formatPercent(item.floating_pnl_pct)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            </Swipeable>
          )}
        />
      )}
    </Screen>
  );
}
