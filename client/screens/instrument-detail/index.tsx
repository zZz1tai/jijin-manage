import { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, useWindowDimensions, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { useApp } from '@/contexts/AppContext';
import { useFocusEffect } from 'expo-router';
import { deleteInstrument, getInstrumentById, isGeneratedInstrumentName, normalizeInstrumentCode, updateInstrumentMeta, updateInstrumentPrice } from '@/db/instruments';
import { deleteTransaction, getTransactionsByInstrument, isDcaGeneratedTransaction } from '@/db/transactions';
import { getAllAccounts } from '@/db/accounts';
import { computePositionForInstrument } from '@/db/calculations';
import { fetchAndSaveHistory, fetchRealtimeQuotes } from '@/db/quotes';
import { getPriceHistory } from '@/db/prices';
import { addAlert, deleteAlert, getAlertsByInstrument, markAlertTriggered, toggleAlert, type AlertType } from '@/db/alerts';
import { getSetting } from '@/db/settings';
import { formatMoney, formatPercent, formatQuantity, getPnlColor, daysAgo, todayStr } from '@/utils/format';
import { getInstrumentTypeLabel } from '@/utils/instrument';
import type { Instrument, PositionView, Transaction, Account, PriceAlert } from '@/db/types';
import { LineChart } from 'react-native-gifted-charts';
import Svg, { Line as SvgLine } from 'react-native-svg';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

type Period = '5D' | '1M' | '3M' | '6M' | '1Y' | 'ALL';
type HistoryPoint = { date: string; close: number };

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: '5D', label: '5日' },
  { key: '1M', label: '1M' },
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: '1Y', label: '1Y' },
  { key: 'ALL', label: 'ALL' },
];

const ALERT_META: Record<AlertType, { label: string; unit: string }> = {
  price_above: { label: '价格上穿', unit: '元' },
  price_below: { label: '价格下穿', unit: '元' },
  rise_pct: { label: '涨幅达到', unit: '%' },
  fall_pct: { label: '跌幅达到', unit: '%' },
};

const UI = {
  primary: '#1D4ED8',
  primarySoft: '#EAF0FF',
  card: '#FFFFFF',
  input: '#F7FAFF',
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

const INPUT_STYLE = {
  backgroundColor: UI.input,
  borderColor: UI.border,
  borderWidth: 1,
  color: UI.text,
};

function validNumber(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteNumber(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function priceDecimals(value: number): number {
  return value > 0 && value < 10 ? 4 : 2;
}

function buildHistoryPricePatch(points: HistoryPoint[]) {
  const valid = points.filter(point => validNumber(point.close));
  const latest = valid.at(-1);
  if (!latest) return null;

  const previous = valid.at(-2);
  const prevClose = previous?.close ?? latest.close;
  const high = Math.max(...valid.map(point => point.close));
  const low = Math.min(...valid.map(point => point.close));
  return {
    latest,
    latest_price: latest.close,
    prev_close: prevClose,
    open: valid[0]?.close ?? latest.close,
    high,
    low,
    volume: 0,
    change_pct: prevClose > 0 ? ((latest.close - prevClose) / prevClose) * 100 : 0,
  };
}

function dateMs(date: string): number {
  const ms = new Date(`${date}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function dateGapDays(from: string, to: string): number {
  const start = dateMs(from);
  const end = dateMs(to);
  if (!start || !end) return 0;
  return Math.floor((end - start) / 86400000);
}

function needsHistoryBackfill(
  rows: { trade_date: string; close: number }[],
  startDate: string,
  endDate: string,
  selectedPeriod: Period
): boolean {
  const validRows = rows.filter(row => validNumber(row.close));
  if (validRows.length < 5) return true;

  const firstDate = validRows[0]?.trade_date;
  const lastDate = validRows.at(-1)?.trade_date;
  if (!firstDate || !lastDate) return true;
  if (dateGapDays(lastDate, endDate) > 10) return true;

  const missingStartDays = dateGapDays(startDate, firstDate);
  if (selectedPeriod === 'ALL') return missingStartDays > 30 && validRows.length < 900;
  return missingStartDays > 10;
}

function buildVisibleHistoryPoints(
  rows: { trade_date: string; close: number }[],
  selectedPeriod: Period
): HistoryPoint[] {
  const pointsByDate = new Map<string, HistoryPoint>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.trade_date) || !validNumber(row.close)) continue;
    pointsByDate.set(row.trade_date, { date: row.trade_date, close: row.close });
  }
  const points = Array.from(pointsByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (selectedPeriod !== '5D') return points;
  return points.slice(-5);
}

function chartDateTickIndexes(pointCount: number, selectedPeriod: Period, chartWidth: number): number[] {
  if (pointCount <= 0) return [];
  const maxTicks = selectedPeriod === '5D' ? 5 : chartWidth >= 280 ? 5 : 3;
  const tickCount = Math.min(maxTicks, pointCount);
  if (tickCount === 1) return [0];

  return Array.from(new Set(
    Array.from({ length: tickCount }, (_, index) =>
      Math.round(((pointCount - 1) * index) / (tickCount - 1))
    )
  ));
}

function formatAxisDate(date: string, selectedPeriod: Period): string {
  if (selectedPeriod === 'ALL') return date.slice(2, 7);
  return date.slice(5);
}

export default function InstrumentDetailScreen() {
  const router = useSafeRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { refreshTrigger, triggerRefresh } = useApp();
  const { id } = useSafeSearchParams<{ id: number }>();
  const instId = Number(id);

  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [position, setPosition] = useState<PositionView | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [history, setHistory] = useState<{ date: string; close: number }[]>([]);
  const [period, setPeriod] = useState<Period>('3M');
  const periodRef = useRef<Period>('3M');
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [reversed, setReversed] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [alertType, setAlertType] = useState<AlertType>('price_above');
  const [alertThreshold, setAlertThreshold] = useState('');
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  const loadData = useCallback(async (selectedPeriod: Period = periodRef.current) => {
    if (!instId) return;
    try {
      const [inst, transactions, accs, rg, alertRows] = await Promise.all([
        getInstrumentById(instId),
        getTransactionsByInstrument(instId),
        getAllAccounts(),
        getSetting('red_green_reversed'),
        getAlertsByInstrument(instId),
      ]);
      if (!inst) {
        setLoading(false);
        return;
      }
      setInstrument(inst);
      setTxs(transactions);
      setAccounts(accs);
      setReversed(rg === '1');
      setAlerts(alertRows);

      // 计算时间范围
      const end = todayStr();
      let start = daysAgo(90);
      if (selectedPeriod === '5D') start = daysAgo(14);
      else if (selectedPeriod === '1M') start = daysAgo(30);
      else if (selectedPeriod === '3M') start = daysAgo(90);
      else if (selectedPeriod === '6M') start = daysAgo(180);
      else if (selectedPeriod === '1Y') start = daysAgo(365);
      else start = '2020-01-01';

      // 拉历史数据
      let hist = await getPriceHistory(instId, start, end);
      // 优先使用行情源本次返回的日期作为交易日集合，避免周末/节假日补点进入横轴。
      const remoteHist = await fetchAndSaveHistory(instId, inst!.code, inst!.type, start, end);
      if (remoteHist.length > 0 || needsHistoryBackfill(hist, start, end, selectedPeriod)) {
        hist = await getPriceHistory(instId, start, end);
      }
      const historyPoints = buildVisibleHistoryPoints(remoteHist.length > 0 ? remoteHist : hist, selectedPeriod);
      setHistory(historyPoints);

      const quotes = await fetchRealtimeQuotes([{ code: inst.code, type: inst.type }]);
      const normalizedCode = normalizeInstrumentCode(inst.code);
      const q = quotes.get(normalizedCode);
      let effectiveInstrument: Instrument = { ...inst, code: normalizedCode };
      if (q) {
        const quoteName = q.name?.trim();
        const metaPatch: { code?: string; name?: string } = {};
        const shouldUseQuoteName = Boolean(quoteName && quoteName !== inst.name && isGeneratedInstrumentName(inst.name, normalizedCode));
        if (normalizedCode !== inst.code) metaPatch.code = normalizedCode;
        if (shouldUseQuoteName && quoteName) metaPatch.name = quoteName;
        if (Object.keys(metaPatch).length > 0) {
          await updateInstrumentMeta(inst.id, metaPatch);
        }
        await updateInstrumentPrice(inst.id, {
          latest_price: q.price,
          prev_close: q.prev_close,
          change_pct: q.change_pct,
          high: q.high,
          low: q.low,
          open: q.open,
          volume: q.volume,
        });
        for (const alert of alertRows) {
          if (!alert.enabled || alert.triggered) continue;
          const hit =
            (alert.alert_type === 'price_above' && q.price >= alert.threshold) ||
            (alert.alert_type === 'price_below' && q.price <= alert.threshold) ||
            (alert.alert_type === 'rise_pct' && q.change_pct >= alert.threshold) ||
            (alert.alert_type === 'fall_pct' && q.change_pct <= -Math.abs(alert.threshold));
          if (hit) await markAlertTriggered(alert.id);
        }
        setAlerts(await getAlertsByInstrument(instId));
        effectiveInstrument = { ...inst, code: normalizedCode, name: shouldUseQuoteName && quoteName ? quoteName : inst.name, latest_price: q.price, prev_close: q.prev_close, change_pct: q.change_pct, high: q.high, low: q.low, open: q.open, volume: q.volume };
      } else {
        const historyPatch = buildHistoryPricePatch(historyPoints);
        if (normalizedCode !== inst.code) {
          await updateInstrumentMeta(inst.id, { code: normalizedCode });
        }
        if (historyPatch) {
          await updateInstrumentPrice(inst.id, {
            latest_price: historyPatch.latest_price,
            prev_close: historyPatch.prev_close,
            change_pct: historyPatch.change_pct,
            high: historyPatch.high,
            low: historyPatch.low,
            open: historyPatch.open,
            volume: historyPatch.volume,
          });
          effectiveInstrument = {
            ...inst,
            code: normalizedCode,
            latest_price: historyPatch.latest_price,
            prev_close: historyPatch.prev_close,
            change_pct: historyPatch.change_pct,
            high: historyPatch.high,
            low: historyPatch.low,
            open: historyPatch.open,
            volume: historyPatch.volume,
          };
        }
      }
      setInstrument(effectiveInstrument);
      setPosition(await computePositionForInstrument(effectiveInstrument));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setChartLoading(false);
    }
  }, [instId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData, refreshTrigger]));

  const handlePeriodChange = useCallback((nextPeriod: Period) => {
    if (nextPeriod === periodRef.current) return;
    periodRef.current = nextPeriod;
    setPeriod(nextPeriod);
    setChartLoading(true);
    setHistory([]);
    Haptics.selectionAsync();
    loadData(nextPeriod);
  }, [loadData]);

  const openRename = useCallback(() => {
    if (!instrument) return;
    setRenameDraft(instrument.name);
    setActionMenuOpen(false);
    setRenameOpen(true);
  }, [instrument]);

  const handleSaveName = useCallback(async () => {
    if (!instrument) return;
    const nextName = renameDraft.trim();
    if (!nextName) {
      Alert.alert('提示', '请输入名称');
      return;
    }
    await updateInstrumentMeta(instrument.id, { name: nextName });
    const nextInstrument = { ...instrument, name: nextName };
    setInstrument(nextInstrument);
    setPosition(prev => prev ? { ...prev, instrument: nextInstrument } : prev);
    setRenameOpen(false);
    triggerRefresh();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [instrument, renameDraft, triggerRefresh]);

  const handleDeleteCurrentInstrument = useCallback(() => {
    if (!instrument) return;
    setActionMenuOpen(false);
    setDeleteConfirmOpen(true);
  }, [instrument]);

  const confirmDeleteCurrentInstrument = useCallback(async () => {
    if (!instrument) return;
    await deleteInstrument(instrument.id);
    setDeleteConfirmOpen(false);
    triggerRefresh();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/market');
    }
  }, [instrument, router, triggerRefresh]);

  const handleDeleteTransaction = useCallback((tx: Transaction) => {
    Alert.alert('删除流水', '确定删除这笔交易记录？持仓和收益会重新计算。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteTransaction(tx.id);
          triggerRefresh();
          loadData();
        },
      },
    ]);
  }, [loadData, triggerRefresh]);

  const handleAddAlert = useCallback(async () => {
    const threshold = parseFloat(alertThreshold);
    if (!threshold || threshold <= 0) {
      Alert.alert('提示', '请输入有效阈值');
      return;
    }
    await addAlert(instId, alertType, threshold);
    setAlertThreshold('');
    setAlerts(await getAlertsByInstrument(instId));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [alertThreshold, alertType, instId]);

  const handleDeleteAlert = useCallback((alert: PriceAlert) => {
    Alert.alert('删除提醒', '确定删除这条价格提醒？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteAlert(alert.id);
          setAlerts(await getAlertsByInstrument(instId));
        },
      },
    ]);
  }, [instId]);

  const handleToggleAlert = useCallback(async (alert: PriceAlert) => {
    await toggleAlert(alert.id, !alert.enabled);
    setAlerts(await getAlertsByInstrument(instId));
  }, [instId]);

  if (loading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={UI.primary} />
        </View>
      </Screen>
    );
  }

  if (!instrument) {
    return (
      <Screen safeAreaEdges={['top']}>
        <View
          className="flex-row items-center justify-between px-4 py-3"
          style={{ backgroundColor: UI.card, borderBottomWidth: 1, borderBottomColor: UI.border }}
        >
          <TouchableOpacity onPress={() => router.back()}>
            <FontAwesome6 name="chevron-left" size={16} color={UI.subText} />
          </TouchableOpacity>
          <Text className="flex-1 mx-3 text-base font-semibold text-center" style={{ color: UI.text }}>标的详情</Text>
          <View style={{ width: 16 }} />
        </View>
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-16 h-16 rounded-2xl items-center justify-center" style={{ backgroundColor: UI.primarySoft }}>
            <FontAwesome6 name="magnifying-glass" size={30} color={UI.primary} />
          </View>
          <Text className="text-sm mt-4 font-medium" style={{ color: UI.text }}>未找到标的</Text>
          <Text className="text-xs mt-1 text-center" style={{ color: UI.subText }}>请返回后重新选择持仓或行情搜索结果</Text>
          <TouchableOpacity className="mt-6 px-6 py-3 rounded-full" style={{ backgroundColor: UI.primary }} onPress={() => router.back()}>
            <Text className="text-sm font-semibold" style={{ color: '#fff' }}>返回</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const historyPatch = buildHistoryPricePatch(history);
  const price = validNumber(instrument.latest_price) ? instrument.latest_price : (historyPatch?.latest_price ?? 0);
  const prevClose = validNumber(instrument.prev_close) ? instrument.prev_close : (historyPatch?.prev_close ?? price);
  const changePct = finiteNumber(instrument.change_pct) && validNumber(instrument.latest_price)
    ? instrument.change_pct
    : (historyPatch?.change_pct ?? 0);
  const priceColor = getPnlColor(changePct, reversed);

  // 图表数据
  const chartHistory = history.filter(point => validNumber(point.close));
  const firstPrice = chartHistory[0]?.close ?? price;
  const lastPrice = price || chartHistory.at(-1)?.close || 0;
  const periodPct = firstPrice > 0 && lastPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const chartColor = getPnlColor(periodPct, reversed);
  const chartYAxisLabelWidth = 48;
  const chartYAxisGap = 8;
  const chartAxisLeft = chartYAxisLabelWidth + chartYAxisGap;
  const chartPlotHeight = 160;
  const chartYAxisLabelHeight = 14;
  const chartAvailableWidth = windowWidth - 32 - 32 - chartAxisLeft - 22;
  const chartWidth = Math.max(1, Math.min(chartAvailableWidth, 700));
  const chartHigh = chartHistory.length > 0 ? Math.max(...chartHistory.map(point => point.close)) : price;
  const chartLow = chartHistory.length > 0 ? Math.min(...chartHistory.map(point => point.close)) : price;
  const chartMid = chartHigh > 0 && chartLow > 0 ? (chartHigh + chartLow) / 2 : price;
  const chartValueRange = chartHigh > chartLow ? chartHigh - chartLow : Math.max(chartHigh * 0.01, 0.01);
  const chartPointSpacing = chartHistory.length > 1 ? chartWidth / (chartHistory.length - 1) : chartWidth;
  const chartData = chartHistory.map((h, i) => {
    const scaledValue = chartHigh > chartLow ? (h.close - chartLow) / chartValueRange : 0.5;
    return {
      value: scaledValue,
      price: h.close,
      labelText: '',
      labelTextStyle: { color: UI.subText, fontSize: 9 },
      dataPointText: '',
    };
  });
  const chartDateTicks = chartDateTickIndexes(chartHistory.length, period, chartWidth).map(index => ({
    index,
    date: chartHistory[index]?.date ?? '',
  })).filter(tick => tick.date);
  const chartSegments = chartHistory.slice(1).map((point, index) => {
    const prev = chartHistory[index];
    const x1 = index * chartPointSpacing;
    const x2 = (index + 1) * chartPointSpacing;
    const y1 = (1 - chartData[index].value) * chartPlotHeight;
    const y2 = (1 - chartData[index + 1].value) * chartPlotHeight;
    return {
      key: `${prev.date}-${point.date}-${index}`,
      x1,
      y1,
      x2,
      y2,
      color: point.close > prev.close ? '#EF4444' : point.close < prev.close ? '#22C55E' : '#9CA3AF',
    };
  });
  const chartYAxisTicks = [
    { value: chartHigh, ratio: 1 },
    { value: chartMid, ratio: 0.5 },
    { value: chartLow, ratio: 0 },
  ];
  const latestDate = chartHistory.at(-1)?.date;

  const typeLabel = getInstrumentTypeLabel(instrument.type);

  return (
    <Screen safeAreaEdges={['top']}>
      {/* 头部导航 */}
      <View
        className="flex-row items-center justify-between px-4 py-3"
        style={{ backgroundColor: UI.card, borderBottomWidth: 1, borderBottomColor: UI.border }}
      >
        <TouchableOpacity onPress={() => router.back()}>
          <FontAwesome6 name="chevron-left" size={16} color={UI.subText} />
        </TouchableOpacity>
        <Text className="flex-1 mx-3 text-base font-semibold text-center" style={{ color: UI.text }} numberOfLines={1}>{instrument.name}</Text>
        <TouchableOpacity
          className="w-9 h-9 rounded-full items-center justify-center"
          style={{ backgroundColor: UI.primarySoft }}
          onPress={() => setActionMenuOpen(true)}
          accessibilityLabel="打开标的操作"
        >
          <FontAwesome6 name="ellipsis-vertical" size={16} color={UI.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="pb-6" showsVerticalScrollIndicator={false}>
        {/* 价格区 */}
        <View className="px-4 pt-4 pb-2">
          <View className="flex-row items-baseline gap-3">
            <Text className="text-4xl font-bold" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>
              {price > 0 ? formatMoney(price, priceDecimals(price)) : '--'}
            </Text>
            <Text className="text-lg" style={{ color: priceColor, fontVariant: ['tabular-nums'] }}>
              {formatMoney(price - prevClose, 2, true)}
            </Text>
            <Text className="text-sm" style={{ color: priceColor }}>
              {formatPercent(changePct)}
            </Text>
          </View>
          <View className="flex-row items-center gap-4 mt-2">
            <Text className="text-xs" style={{ color: UI.subText }}>{instrument.code} · {typeLabel}</Text>
            {instrument.high ? <Text className="text-xs" style={{ color: UI.subText }}>高 {formatMoney(instrument.high)}</Text> : null}
            {instrument.low ? <Text className="text-xs" style={{ color: UI.subText }}>低 {formatMoney(instrument.low)}</Text> : null}
            {instrument.open ? <Text className="text-xs" style={{ color: UI.subText }}>开 {formatMoney(instrument.open)}</Text> : null}
          </View>
        </View>

        {/* 周期选择 */}
        <View className="px-4 py-3 flex-row gap-2">
          {PERIOD_OPTIONS.map(item => (
            <TouchableOpacity
              key={item.key}
              className="px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: period === item.key ? UI.primary : UI.card,
                borderColor: period === item.key ? UI.primary : UI.border,
                borderWidth: 1,
              }}
              onPress={() => handlePeriodChange(item.key)}
            >
              <Text className="text-xs font-medium" style={{ color: period === item.key ? '#fff' : UI.subText }}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 走势图 */}
        <View className="mx-4 rounded-2xl p-4 mb-4" style={CARD_STYLE}>
          {chartLoading ? (
            <View style={{ height: 260, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={UI.primary} />
              <Text className="text-xs mt-2" style={{ color: UI.subText }}>正在切换周期</Text>
            </View>
          ) : chartData.length > 1 ? (
            <>
              <View className="flex-row items-start justify-between mb-3">
                <View>
                  <Text className="text-sm font-semibold" style={{ color: UI.text }}>价格走势</Text>
                  <Text className="text-xs mt-0.5" style={{ color: UI.subText }}>{latestDate ? `更新至 ${latestDate}` : '等待数据更新'}</Text>
                </View>
                <View className="px-2.5 py-1 rounded-lg" style={{ backgroundColor: `${chartColor}18` }}>
                  <Text className="text-xs font-semibold" style={{ color: chartColor }}>{formatPercent(periodPct)}</Text>
                </View>
              </View>

              <View className="flex-row mb-3 rounded-xl overflow-hidden" style={{ backgroundColor: UI.input, borderColor: UI.border, borderWidth: 1 }}>
                {[
                  { label: '最新', value: lastPrice },
                  { label: '区间高', value: chartHigh },
                  { label: '区间低', value: chartLow },
                ].map((item, index) => (
                  <View
                    key={item.label}
                    className="flex-1 px-3 py-2.5"
                    style={{ borderLeftWidth: index === 0 ? 0 : 1, borderLeftColor: UI.border }}
                  >
                    <Text className="text-[10px]" style={{ color: UI.subText }}>{item.label}</Text>
                    <Text className="text-sm font-semibold mt-0.5" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>
                      {formatMoney(item.value, priceDecimals(item.value))}
                    </Text>
                  </View>
                ))}
              </View>

              <View className="flex-row items-start">
                <View style={{ width: chartYAxisLabelWidth, height: chartPlotHeight, marginRight: chartYAxisGap, position: 'relative' }}>
                  {chartYAxisTicks.map((tick, index) => {
                    const rawTop = (1 - tick.ratio) * chartPlotHeight - chartYAxisLabelHeight / 2;
                    const top = Math.max(0, Math.min(chartPlotHeight - chartYAxisLabelHeight, rawTop));
                    return (
                      <Text
                        key={`${tick.value}-${index}`}
                        className="text-[10px] text-right"
                        style={{
                          position: 'absolute',
                          top,
                          left: 0,
                          width: chartYAxisLabelWidth,
                          height: chartYAxisLabelHeight,
                          lineHeight: chartYAxisLabelHeight,
                          color: UI.subText,
                          fontVariant: ['tabular-nums'],
                        }}
                      >
                        {formatMoney(tick.value, priceDecimals(tick.value))}
                      </Text>
                    );
                  })}
                </View>
                <View style={{ width: chartWidth, height: chartPlotHeight, position: 'relative' }}>
                  <LineChart
                    data={chartData}
                    width={chartWidth}
                    height={chartPlotHeight}
                    spacing={chartPointSpacing}
                    initialSpacing={0}
                    endSpacing={0}
                    xAxisColor={UI.border}
                    yAxisColor={UI.border}
                    rulesColor={UI.borderSoft}
                    rulesType="solid"
                    yAxisLabelWidth={0}
                    hideYAxisText
                    color="#00000000"
                    thickness={3}
                    hideDataPoints
                    maxValue={1}
                    areaChart
                    startFillColor={chartColor}
                    endFillColor={chartColor}
                    startOpacity={0.18}
                    endOpacity={0}
                    noOfSections={2}
                    isAnimated
                    animateOnDataChange
                    pointerConfig={{
                      pointerStripHeight: chartPlotHeight,
                      pointerStripColor: chartColor,
                      pointerStripWidth: 1,
                      pointerColor: chartColor,
                      pointerLabelWidth: 96,
                      pointerLabelHeight: 40,
                      activatePointersOnLongPress: true,
                      autoAdjustPointerLabelPosition: true,
                      pointerLabelComponent: (items: any) => (
                        <View style={{ padding: 6, backgroundColor: UI.card, borderColor: UI.border, borderWidth: 1, borderRadius: 8, minWidth: 86 }}>
                          <Text style={{ color: UI.primary, fontSize: 11, fontWeight: '600', textAlign: 'center' }}>
                            {items[0]?.price?.toFixed?.(priceDecimals(items[0]?.price || price || 0)) ?? '--'}
                          </Text>
                        </View>
                      ),
                    }}
                  />
                  <Svg
                    width={chartWidth}
                    height={chartPlotHeight}
                    pointerEvents="none"
                    style={{ position: 'absolute', left: 0, top: 0 }}
                  >
                    {chartSegments.map(segment => (
                      <SvgLine
                        key={segment.key}
                        x1={segment.x1}
                        y1={segment.y1}
                        x2={segment.x2}
                        y2={segment.y2}
                        stroke={segment.color}
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                  </Svg>
                </View>
              </View>
            </>
          ) : (
            <View style={{ height: 180, alignItems: 'center', justifyContent: 'center' }}>
              <Text className="text-sm" style={{ color: UI.subText }}>暂无历史数据</Text>
            </View>
          )}
          {chartData.length > 1 ? (
            <>
              <View style={{ marginLeft: chartAxisLeft, width: chartWidth, height: 18, marginTop: 4, position: 'relative' }}>
                {chartDateTicks.map((tick, tickIndex) => {
                  const labelWidth = 54;
                  const rawLeft = chartHistory.length > 1 ? (tick.index / (chartHistory.length - 1)) * chartWidth : chartWidth / 2;
                  const left = Math.max(0, Math.min(chartWidth - labelWidth, rawLeft - labelWidth / 2));
                  const textAlign = tickIndex === 0 ? 'left' : tickIndex === chartDateTicks.length - 1 ? 'right' : 'center';
                  return (
                    <Text
                      key={`${tick.index}-${tick.date}`}
                      className="text-[10px]"
                      style={{ position: 'absolute', left, width: labelWidth, textAlign, color: UI.subText, fontVariant: ['tabular-nums'] }}
                    >
                      {formatAxisDate(tick.date, period)}
                    </Text>
                  );
                })}
              </View>
              <Text className="text-xs text-center mt-1" style={{ color: chartColor }}>
                区间涨跌 {formatPercent(periodPct)}
              </Text>
            </>
          ) : null}
          {chartData.length <= 1 ? <View className="flex-row justify-between mt-2">
            <Text className="text-xs" style={{ color: UI.subText }}>{chartHistory[0]?.date || '--'}</Text>
            <Text className="text-xs" style={{ color: chartColor }}>
              区间涨跌 {formatPercent(periodPct)}
            </Text>
            <Text className="text-xs" style={{ color: UI.subText }}>{chartHistory.at(-1)?.date || '--'}</Text>
          </View> : null}
        </View>

        {/* 价格提醒 */}
        <View className="mx-4 mb-4 rounded-2xl p-4" style={CARD_STYLE}>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-sm font-semibold" style={{ color: UI.text }}>价格提醒</Text>
            <Text className="text-xs" style={{ color: UI.subText }}>{alerts.filter(a => a.enabled).length} 条启用</Text>
          </View>
          <View className="flex-row flex-wrap gap-2 mb-3">
            {(Object.keys(ALERT_META) as AlertType[]).map(type => (
              <TouchableOpacity
                key={type}
                className="px-3 py-1.5 rounded-full"
                style={{
                  backgroundColor: alertType === type ? UI.primary : UI.card,
                  borderColor: alertType === type ? UI.primary : UI.border,
                  borderWidth: 1,
                }}
                onPress={() => setAlertType(type)}
              >
                <Text className="text-xs font-medium" style={{ color: alertType === type ? '#fff' : UI.subText }}>{ALERT_META[type].label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View className="flex-row gap-2 mb-3">
            <TextInput
              className="flex-1 rounded-xl px-3 py-2 text-sm"
              style={INPUT_STYLE}
              placeholder={`阈值 (${ALERT_META[alertType].unit})`}
              placeholderTextColor={UI.muted}
              keyboardType="decimal-pad"
              value={alertThreshold}
              onChangeText={setAlertThreshold}
            />
            <TouchableOpacity
              className="px-4 rounded-xl items-center justify-center"
              style={{ backgroundColor: UI.primary }}
              onPress={handleAddAlert}
            >
              <Text className="text-xs font-semibold" style={{ color: '#fff' }}>添加</Text>
            </TouchableOpacity>
          </View>
          {alerts.length === 0 ? (
            <Text className="text-xs py-2 text-center" style={{ color: UI.subText }}>暂无提醒</Text>
          ) : (
            alerts.map(alert => {
              const meta = ALERT_META[alert.alert_type];
              const statusColor = alert.triggered ? '#F59E0B' : alert.enabled ? '#22C55E' : UI.subText;
              const statusLabel = alert.triggered ? '已触发' : alert.enabled ? '启用' : '停用';
              return (
                <View key={alert.id} className="flex-row items-center justify-between py-2.5" style={{ borderTopWidth: 1, borderTopColor: UI.borderSoft }}>
                  <View>
                    <Text className="text-xs" style={{ color: UI.text }}>{meta.label} {formatMoney(alert.threshold, alert.alert_type.includes('pct') ? 2 : (alert.threshold < 10 ? 4 : 2))}{meta.unit}</Text>
                    <Text className="text-[10px] mt-0.5" style={{ color: statusColor }}>{statusLabel}</Text>
                  </View>
                  <View className="flex-row gap-3">
                    <TouchableOpacity onPress={() => handleToggleAlert(alert)}>
                      <Text className="text-xs" style={{ color: UI.primary }}>{alert.enabled ? '停用' : '启用'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteAlert(alert)}>
                      <Text className="text-xs text-[#EF4444]">删除</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* 持仓信息 */}
        {position && position.quantity > 0 && (
          <View className="mx-4 mb-4 rounded-2xl p-4" style={CARD_STYLE}>
            <Text className="text-sm font-semibold mb-3" style={{ color: UI.text }}>持仓数据</Text>
            <View className="flex-row flex-wrap">
              <View style={{ width: '50%', marginBottom: 12 }}>
                <Text className="text-xs" style={{ color: UI.subText }}>持有份额</Text>
                <Text className="text-sm mt-1" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>{formatQuantity(position.quantity)}</Text>
              </View>
              <View style={{ width: '50%', marginBottom: 12 }}>
                <Text className="text-xs" style={{ color: UI.subText }}>成本价</Text>
                <Text className="text-sm mt-1" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>{formatMoney(position.cost_price, position.cost_price < 10 ? 4 : 2)}</Text>
              </View>
              <View style={{ width: '50%', marginBottom: 12 }}>
                <Text className="text-xs" style={{ color: UI.subText }}>持仓成本</Text>
                <Text className="text-sm mt-1" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>¥{formatMoney(position.cost_amount)}</Text>
              </View>
              <View style={{ width: '50%', marginBottom: 12 }}>
                <Text className="text-xs" style={{ color: UI.subText }}>市值</Text>
                <Text className="text-sm mt-1" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>¥{formatMoney(position.market_value)}</Text>
              </View>
              <View style={{ width: '50%' }}>
                <Text className="text-xs" style={{ color: UI.subText }}>浮动盈亏</Text>
                <Text className="text-sm font-semibold mt-1" style={{ color: getPnlColor(position.floating_pnl, reversed), fontVariant: ['tabular-nums'] }}>
                  {formatMoney(position.floating_pnl, 2, true)}
                </Text>
              </View>
              <View style={{ width: '50%' }}>
                <Text className="text-xs" style={{ color: UI.subText }}>收益率</Text>
                <Text className="text-sm font-semibold mt-1" style={{ color: getPnlColor(position.floating_pnl_pct, reversed) }}>
                  {formatPercent(position.floating_pnl_pct)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* 交易流水 */}
        <View className="mx-4 mb-6 rounded-2xl p-4" style={CARD_STYLE}>
          <Text className="text-sm font-semibold mb-3" style={{ color: UI.text }}>交易流水 ({txs.length})</Text>
          {txs.length === 0 ? (
            <Text className="text-sm py-4 text-center" style={{ color: UI.subText }}>暂无交易记录</Text>
          ) : (
            [...txs].reverse().slice(0, 20).map(t => {
              const typeLabel: Record<string, string> = {
                buy: '买入', sell: '卖出', dividend_cash: '现金分红',
                dividend_reinvest: '红利再投', split: '拆分', merge: '合并', dca_buy: '定投买入',
              };
              const isBuy = ['buy', 'dca_buy', 'dividend_reinvest'].includes(t.type);
              const isSell = t.type === 'sell';
              const isLinkedDca = isDcaGeneratedTransaction(t);
              return (
                <View key={t.id} className="flex-row items-center justify-between py-2.5" style={{ borderBottomWidth: 1, borderBottomColor: UI.borderSoft }}>
                  <View className="flex-row items-center">
                    <View
                      className="w-8 h-8 rounded-lg items-center justify-center mr-3"
                      style={{ backgroundColor: isBuy ? 'rgba(239,68,68,0.15)' : isSell ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)' }}
                    >
                      <FontAwesome6
                        name={isBuy ? 'arrow-down' : isSell ? 'arrow-up' : 'gift'}
                        size={12}
                        color={isBuy ? '#EF4444' : isSell ? '#22C55E' : '#F59E0B'}
                      />
                    </View>
                    <View>
                      <Text className="text-sm" style={{ color: UI.text }}>{typeLabel[t.type] || t.type}</Text>
                      <Text className="text-xs mt-0.5" style={{ color: UI.subText }}>{t.trade_date}</Text>
                    </View>
                  </View>
                  <View className="items-end">
                    {t.price && t.quantity ? (
                      <>
                        <Text className="text-sm" style={{ color: UI.text, fontVariant: ['tabular-nums'] }}>
                          {formatQuantity(t.quantity)} × {formatMoney(t.price)}
                        </Text>
                        <Text className="text-xs" style={{ color: UI.subText }}>¥{formatMoney((t.price * t.quantity))}</Text>
                      </>
                    ) : t.dividend_amount ? (
                      <Text className="text-sm" style={{ color: '#F59E0B' }}>+¥{formatMoney(t.dividend_amount)}</Text>
                    ) : t.split_ratio ? (
                      <Text className="text-sm" style={{ color: UI.subText }}>比例 {t.split_ratio}</Text>
                    ) : (
                      <Text className="text-sm" style={{ color: UI.subText }}>--</Text>
                    )}
                    <View className="flex-row gap-2 mt-1">
                      {isLinkedDca ? (
                        <Text className="text-[10px]" style={{ color: UI.subText }}>定投生成</Text>
                      ) : (
                        <TouchableOpacity onPress={() => router.push('/add-transaction', { transaction_id: t.id })}>
                          <Text className="text-[10px]" style={{ color: UI.primary }}>编辑</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={() => handleDeleteTransaction(t)}>
                        <Text className="text-[10px] text-[#EF4444]">删除</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <Modal visible={actionMenuOpen} transparent animationType="fade" onRequestClose={() => setActionMenuOpen(false)}>
        <TouchableOpacity
          className="flex-1 bg-black/40 justify-end"
          activeOpacity={1}
          onPress={() => setActionMenuOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} className="rounded-t-2xl p-4" style={CARD_STYLE}>
            <Text className="text-xs mb-3" style={{ color: UI.subText }}>{instrument.code} · {typeLabel}</Text>
            <TouchableOpacity
              className="flex-row items-center py-3"
              onPress={() => {
                setActionMenuOpen(false);
                router.push('/add-transaction', { instrument_id: instrument.id, instrument_name: instrument.name });
              }}
            >
              <FontAwesome6 name="plus" size={15} color={UI.primary} />
              <Text className="text-sm ml-3" style={{ color: UI.text }}>记交易</Text>
            </TouchableOpacity>
            <TouchableOpacity className="flex-row items-center py-3" onPress={openRename}>
              <FontAwesome6 name="pen-to-square" size={15} color={UI.primary} />
              <Text className="text-sm ml-3" style={{ color: UI.text }}>改名字</Text>
            </TouchableOpacity>
            <TouchableOpacity className="flex-row items-center py-3" onPress={handleDeleteCurrentInstrument}>
              <FontAwesome6 name="trash" size={15} color="#EF4444" />
              <Text className="text-sm ml-3" style={{ color: '#EF4444' }}>删除标的</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <TouchableOpacity
          className="flex-1 bg-black/50 items-center justify-center p-6"
          activeOpacity={1}
          onPress={() => setRenameOpen(false)}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="w-full max-w-sm">
            <TouchableOpacity activeOpacity={1} className="rounded-2xl p-5" style={CARD_STYLE}>
              <Text className="text-base font-bold mb-2" style={{ color: UI.text }}>修改名称</Text>
              <Text className="text-xs mb-3" style={{ color: UI.subText }}>{instrument.code}</Text>
              <TextInput
                className="rounded-xl px-4 py-3 text-sm mb-4"
                style={INPUT_STYLE}
                placeholder="输入新名称"
                placeholderTextColor={UI.muted}
                value={renameDraft}
                onChangeText={setRenameDraft}
                autoFocus
                selectTextOnFocus
              />
              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 py-2.5 rounded-xl items-center"
                  style={{ backgroundColor: UI.primarySoft }}
                  onPress={() => setRenameOpen(false)}
                >
                  <Text className="text-sm font-medium" style={{ color: UI.primary }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 py-2.5 rounded-xl items-center"
                  style={{ backgroundColor: UI.primary }}
                  onPress={handleSaveName}
                >
                  <Text className="text-sm text-white font-semibold">保存</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
      <Modal visible={deleteConfirmOpen} transparent animationType="fade" onRequestClose={() => setDeleteConfirmOpen(false)}>
        <TouchableOpacity
          className="flex-1 bg-black/50 items-center justify-center p-6"
          activeOpacity={1}
          onPress={() => setDeleteConfirmOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} className="w-full max-w-sm rounded-2xl p-5" style={CARD_STYLE}>
            <Text className="text-base font-bold mb-2" style={{ color: UI.text }}>删除标的</Text>
            <Text className="text-sm leading-5 mb-4" style={{ color: UI.subText }}>
              确定删除「{instrument.name}」及其交易、历史价格、提醒和定投记录吗？此操作不可恢复。
            </Text>
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 py-2.5 rounded-xl items-center"
                style={{ backgroundColor: UI.primarySoft }}
                onPress={() => setDeleteConfirmOpen(false)}
              >
                <Text className="text-sm font-medium" style={{ color: UI.primary }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 py-2.5 rounded-xl items-center"
                style={{ backgroundColor: '#EF4444' }}
                onPress={confirmDeleteCurrentInstrument}
              >
                <Text className="text-sm text-white font-semibold">删除</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </Screen>
  );
}
