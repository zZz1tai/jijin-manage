import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useApp } from '@/contexts/AppContext';
import { addInstrument, getInstrumentById, updateInstrumentPrice } from '@/db/instruments';
import { getAllAccounts } from '@/db/accounts';
import { addTransaction } from '@/db/transactions';
import { searchInstrumentsRemote } from '@/db/quotes';
import { formatMoney, todayStr } from '@/utils/format';
import { getInstrumentTypeLabel } from '@/utils/instrument';
import type { Account, Instrument, InstrumentType } from '@/db/types';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

type CostMode = 'cost_price' | 'cost_amount';

const UI = {
  primary: '#1677FF',
  primarySoft: '#EAF3FF',
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

const TYPE_OPTIONS: { key: InstrumentType; label: string }[] = [
  { key: 'stock', label: 'A股' },
  { key: 'stock_hk', label: '港股' },
  { key: 'stock_us', label: '美股' },
  { key: 'stock_global', label: '海外股票' },
  { key: 'index', label: '指数' },
  { key: 'fund_etf', label: '场内基金' },
  { key: 'fund_open', label: '场外基金' },
];

export default function AddHoldingScreen() {
  const router = useSafeRouter();
  const { triggerRefresh } = useApp();
  const [searchCode, setSearchCode] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualType, setManualType] = useState<InstrumentType>('stock');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{ code: string; name: string; type: InstrumentType; price?: number }[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [costMode, setCostMode] = useState<CostMode>('cost_price');
  const [costPrice, setCostPrice] = useState('');
  const [costAmount, setCostAmount] = useState('');
  const [latestPrice, setLatestPrice] = useState('');
  const [tradeDate, setTradeDate] = useState(todayStr());
  const [note, setNote] = useState('初始持仓');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const accs = await getAllAccounts();
      setAccounts(accs);
      setAccountId(accs[0]?.id ?? null);
    })();
  }, []);

  const doSearch = async (keyword: string) => {
    setSearchCode(keyword);
    setSelectedInstrument(null);
    if (keyword.trim().length < 1) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await searchInstrumentsRemote(keyword.trim());
      setSearchResults(res.slice(0, 8));
    } finally {
      setSearching(false);
    }
  };

  const selectInstrument = async (item: { code: string; name: string; type: InstrumentType; price?: number }) => {
    const id = await addInstrument(item.code, item.name, item.type);
    if (item.price && item.price > 0) {
      await updateInstrumentPrice(id, { latest_price: item.price, prev_close: item.price });
      setLatestPrice(String(item.price));
    }
    const inst = await getInstrumentById(id);
    setSelectedInstrument(inst);
    setSearchCode(inst?.code ?? item.code);
    setManualName(inst?.name ?? item.name);
    setManualType(inst?.type ?? item.type);
    setSearchResults([]);
    Haptics.selectionAsync();
  };

  const q = parseFloat(quantity) || 0;
  const enteredCostPrice = parseFloat(costPrice) || 0;
  const enteredCostAmount = parseFloat(costAmount) || 0;
  const avgCost = costMode === 'cost_amount' && q > 0 ? enteredCostAmount / q : enteredCostPrice;
  const totalCost = q > 0 && avgCost > 0 ? Math.round(q * avgCost * 100) / 100 : 0;

  const preview = useMemo(() => {
    const latest = parseFloat(latestPrice) || avgCost || 0;
    const marketValue = q > 0 && latest > 0 ? q * latest : 0;
    const pnl = marketValue - totalCost;
    const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
    return { marketValue, pnl, pnlPct };
  }, [avgCost, latestPrice, q, totalCost]);

  const handleSubmit = async () => {
    if (!accountId) {
      Alert.alert('提示', '请先创建账户');
      return;
    }
    if (q <= 0) {
      Alert.alert('提示', '请输入持仓份额');
      return;
    }
    if (avgCost <= 0) {
      Alert.alert('提示', costMode === 'cost_amount' ? '请输入持仓成本' : '请输入成本价');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
      Alert.alert('提示', '请输入正确的建仓日期');
      return;
    }

    setSubmitting(true);
    try {
      let instrument = selectedInstrument;
      if (!instrument) {
        if (!searchCode.trim() || !manualName.trim()) {
          Alert.alert('提示', '请选择标的，或填写代码和名称');
          return;
        }
        const id = await addInstrument(searchCode.trim(), manualName.trim(), manualType);
        instrument = await getInstrumentById(id);
      }
      if (!instrument) throw new Error('标的保存失败');

      const latest = parseFloat(latestPrice) || avgCost;
      if (latest > 0) {
        await updateInstrumentPrice(instrument.id, { latest_price: latest, prev_close: latest });
      }

      await addTransaction({
        instrument_id: instrument.id,
        account_id: accountId,
        type: 'buy',
        price: avgCost,
        quantity: q,
        fee: 0,
        amount: totalCost,
        trade_date: tradeDate,
        note: note.trim() || '初始持仓',
      });

      triggerRefresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: '持仓已记录' });
      setTimeout(() => router.back(), 250);
    } catch (e: any) {
      Alert.alert('失败', e?.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const canShowManualFields = !selectedInstrument;

  return (
    <Screen safeAreaEdges={['top']}>
      <View className="flex-row items-center justify-between px-4 py-3" style={{ backgroundColor: UI.card, borderBottomWidth: 1, borderBottomColor: UI.border }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-sm font-medium" style={{ color: UI.subText }}>取消</Text>
        </TouchableOpacity>
        <Text className="text-base font-semibold" style={{ color: UI.text }}>记持仓</Text>
        <TouchableOpacity onPress={handleSubmit} disabled={submitting}>
          <Text className="text-sm font-semibold" style={{ color: submitting ? UI.muted : UI.primary }}>保存</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-4 py-4 pb-10" keyboardShouldPersistTaps="handled">
        <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>标的代码/名称</Text>
        <View className="rounded-2xl px-4 py-3 mb-2" style={INPUT_STYLE}>
          {selectedInstrument ? (
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="font-semibold" style={{ color: UI.text }}>{selectedInstrument.name}</Text>
                <Text className="text-xs mt-0.5" style={{ color: UI.subText }}>{selectedInstrument.code}</Text>
              </View>
              <TouchableOpacity onPress={() => { setSelectedInstrument(null); setSearchCode(''); }}>
                <FontAwesome6 name="xmark" size={16} color={UI.subText} />
              </TouchableOpacity>
            </View>
          ) : (
            <TextInput
              className="text-sm"
              style={{ color: UI.text }}
              placeholder="输入代码/名称/拼音模糊搜索"
              placeholderTextColor={UI.muted}
              value={searchCode}
              onChangeText={doSearch}
              autoCapitalize="none"
            />
          )}
        </View>

        {searching && <ActivityIndicator size="small" color={UI.primary} className="mb-2" />}

        {searchResults.length > 0 && !selectedInstrument && (
          <View className="rounded-2xl mb-3 p-2" style={CARD_STYLE}>
            {searchResults.map((item, index) => (
              <TouchableOpacity
                key={`${item.code}-${index}`}
                className="flex-row items-center justify-between px-3 py-2.5"
                onPress={() => selectInstrument(item)}
              >
                <View>
                  <Text className="text-sm" style={{ color: UI.text }}>{item.name}</Text>
                  <Text className="text-xs mt-0.5" style={{ color: UI.subText }}>
                    {item.code} · {getInstrumentTypeLabel(item.type)}
                  </Text>
                </View>
                <FontAwesome6 name="plus" size={14} color={UI.primary} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {canShowManualFields && (
          <View className="rounded-2xl p-4 mb-3" style={CARD_STYLE}>
            <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>标的名称</Text>
            <TextInput
              className="rounded-2xl px-4 py-3 mb-3 text-sm"
              style={INPUT_STYLE}
              placeholder="如：贵州茅台"
              placeholderTextColor={UI.muted}
              value={manualName}
              onChangeText={setManualName}
            />
            <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>标的类型</Text>
            <View className="flex-row flex-wrap gap-2">
              {TYPE_OPTIONS.map(item => (
                <TouchableOpacity
                  key={item.key}
                  className="px-3 py-2 rounded-full"
                  style={{ backgroundColor: manualType === item.key ? UI.primary : UI.card, borderColor: manualType === item.key ? UI.primary : UI.border, borderWidth: 1 }}
                  onPress={() => setManualType(item.key)}
                >
                  <Text className="text-xs font-medium" style={{ color: manualType === item.key ? '#fff' : UI.subText }}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>所属账户</Text>
        <View className="flex-row flex-wrap gap-2 mb-3">
          {accounts.map(account => (
            <TouchableOpacity
              key={account.id}
              className="px-4 py-2 rounded-full"
              style={{ backgroundColor: accountId === account.id ? UI.primary : UI.card, borderColor: accountId === account.id ? UI.primary : UI.border, borderWidth: 1 }}
              onPress={() => setAccountId(account.id)}
            >
              <Text className="text-sm font-medium" style={{ color: accountId === account.id ? '#fff' : UI.subText }}>{account.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View className="rounded-2xl p-4 mb-3" style={CARD_STYLE}>
          <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>持仓份额</Text>
          <TextInput
            className="rounded-2xl px-4 py-3 mb-3 text-sm"
            style={INPUT_STYLE}
            placeholder="0"
            placeholderTextColor={UI.muted}
            keyboardType="decimal-pad"
            value={quantity}
            onChangeText={setQuantity}
          />

          <View className="flex-row gap-2 mb-3">
            {[
              { key: 'cost_price', label: '成本价' },
              { key: 'cost_amount', label: '持仓成本' },
            ].map(item => (
              <TouchableOpacity
                key={item.key}
                className="flex-1 py-2 rounded-full items-center"
                style={{ backgroundColor: costMode === item.key ? UI.primary : UI.primarySoft }}
                onPress={() => setCostMode(item.key as CostMode)}
              >
                <Text className="text-xs font-medium" style={{ color: costMode === item.key ? '#fff' : UI.primary }}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {costMode === 'cost_price' ? (
            <>
              <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>平均成本价</Text>
              <TextInput
                className="rounded-2xl px-4 py-3 mb-3 text-sm"
                style={INPUT_STYLE}
                placeholder="0.00"
                placeholderTextColor={UI.muted}
                keyboardType="decimal-pad"
                value={costPrice}
                onChangeText={setCostPrice}
              />
            </>
          ) : (
            <>
              <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>总持仓成本</Text>
              <TextInput
                className="rounded-2xl px-4 py-3 mb-3 text-sm"
                style={INPUT_STYLE}
                placeholder="0.00"
                placeholderTextColor={UI.muted}
                keyboardType="decimal-pad"
                value={costAmount}
                onChangeText={setCostAmount}
              />
            </>
          )}

          <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>当前价</Text>
          <TextInput
            className="rounded-2xl px-4 py-3 text-sm"
            style={INPUT_STYLE}
            placeholder={avgCost > 0 ? String(Math.round(avgCost * 10000) / 10000) : '0.00'}
            placeholderTextColor={UI.muted}
            keyboardType="decimal-pad"
            value={latestPrice}
            onChangeText={setLatestPrice}
          />
        </View>

        <View className="rounded-2xl p-4 mb-3" style={CARD_STYLE}>
          <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>建仓日期</Text>
          <TextInput
            className="rounded-2xl px-4 py-3 mb-3 text-sm"
            style={INPUT_STYLE}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={UI.muted}
            value={tradeDate}
            onChangeText={setTradeDate}
            autoCapitalize="none"
          />
          <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>备注</Text>
          <TextInput
            className="rounded-2xl px-4 py-3 text-sm"
            style={INPUT_STYLE}
            placeholder="选填"
            placeholderTextColor={UI.muted}
            value={note}
            onChangeText={setNote}
          />
        </View>

        <View className="rounded-2xl p-4 mb-4" style={CARD_STYLE}>
          <View className="flex-row justify-between mb-2">
            <Text className="text-xs" style={{ color: UI.subText }}>持仓成本</Text>
            <Text className="text-sm font-semibold" style={{ color: UI.text }}>¥{formatMoney(totalCost)}</Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-xs" style={{ color: UI.subText }}>当前市值</Text>
            <Text className="text-sm font-semibold" style={{ color: UI.text }}>¥{formatMoney(preview.marketValue)}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-xs" style={{ color: UI.subText }}>浮动盈亏</Text>
            <Text className="text-sm font-semibold" style={{ color: preview.pnl >= 0 ? '#EF4444' : '#22C55E' }}>
              {formatMoney(preview.pnl, 2, true)} ({preview.pnlPct.toFixed(2)}%)
            </Text>
          </View>
        </View>

        <TouchableOpacity
          className="rounded-2xl py-4 items-center"
          style={{ backgroundColor: UI.primary, opacity: submitting ? 0.7 : 1 }}
          disabled={submitting}
          onPress={handleSubmit}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text className="text-white font-semibold text-base">保存持仓</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}
