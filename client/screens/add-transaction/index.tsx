import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { useApp } from '@/contexts/AppContext';
import { addInstrument, getInstrumentById } from '@/db/instruments';
import { getAllAccounts } from '@/db/accounts';
import { addTransaction, getTransactionById, isDcaGeneratedTransaction, updateTransaction } from '@/db/transactions';
import { searchInstrumentsRemote } from '@/db/quotes';
import { todayStr } from '@/utils/format';
import { getInstrumentTypeLabel } from '@/utils/instrument';
import type { Account, Instrument, InstrumentType, TransactionType } from '@/db/types';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

const UI = {
  primary: '#1D4ED8',
  primarySoft: '#EAF0FF',
  page: '#F5F7FB',
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

const TX_TYPES: { key: TransactionType; label: string; needPrice: boolean; needQty: boolean; needAmount?: boolean; needDividend?: boolean; needRatio?: boolean }[] = [
  { key: 'buy', label: '买入', needPrice: true, needQty: true },
  { key: 'sell', label: '卖出', needPrice: true, needQty: true },
  { key: 'dca_buy', label: '定投买入', needPrice: true, needQty: true },
  { key: 'dividend_cash', label: '现金分红', needPrice: false, needQty: false, needAmount: true, needDividend: true },
  { key: 'dividend_reinvest', label: '红利再投', needPrice: true, needQty: true },
  { key: 'split', label: '份额拆分', needPrice: false, needQty: false, needRatio: true },
  { key: 'merge', label: '份额合并', needPrice: false, needQty: false, needRatio: true },
];

export default function AddTransactionScreen() {
  const router = useSafeRouter();
  const { triggerRefresh } = useApp();
  const params = useSafeSearchParams<{ instrument_id?: number; instrument_name?: string; transaction_id?: number; edit?: string }>();
  const presetInstId = params.instrument_id ? Number(params.instrument_id) : undefined;
  const transactionId = params.transaction_id ? Number(params.transaction_id) : undefined;

  const [txType, setTxType] = useState<TransactionType>('buy');
  const [searchCode, setSearchCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{ code: string; name: string; type: InstrumentType }[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null);

  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [fee, setFee] = useState('');
  const [amount, setAmount] = useState('');
  const [dividendAmount, setDividendAmount] = useState('');
  const [splitRatio, setSplitRatio] = useState('');
  const [tradeDate, setTradeDate] = useState(todayStr());
  const [note, setNote] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [isLockedDcaTransaction, setIsLockedDcaTransaction] = useState(false);

  useEffect(() => {
    (async () => {
      const accs = await getAllAccounts();
      setAccounts(accs);
      if (accs.length > 0) setAccountId(accs[0].id);
      if (transactionId) {
        const tx = await getTransactionById(transactionId);
        if (tx) {
          const inst = await getInstrumentById(tx.instrument_id);
          if (inst) {
            setSelectedInstrument(inst);
            setSearchCode(inst.code);
          }
          setTxType(tx.type);
          setAccountId(tx.account_id);
          setPrice(tx.price ? String(tx.price) : '');
          setQuantity(tx.quantity ? String(tx.quantity) : '');
          setFee(tx.fee ? String(tx.fee) : '');
          setAmount(tx.amount ? String(tx.amount) : '');
          setDividendAmount(tx.dividend_amount ? String(tx.dividend_amount) : '');
          setSplitRatio(tx.split_ratio ? String(tx.split_ratio) : '');
          setTradeDate(tx.trade_date);
          setNote(tx.note ?? '');
          setIsLockedDcaTransaction(isDcaGeneratedTransaction(tx));
        }
      } else if (presetInstId) {
        const inst = await getInstrumentById(presetInstId);
        if (inst) {
          setSelectedInstrument(inst);
          setSearchCode(inst.code);
        }
      }
    })();
  }, [presetInstId, transactionId]);

  const doSearch = async (kw: string) => {
    setSearchCode(kw);
    if (kw.trim().length < 1) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await searchInstrumentsRemote(kw);
      setSearchResults(res.slice(0, 10));
    } finally {
      setSearching(false);
    }
  };

  const selectInstrument = async (code: string, name: string, type: InstrumentType) => {
    const id = await addInstrument(code, name, type);
    const inst = await getInstrumentById(id);
    setSelectedInstrument(inst);
    setSearchResults([]);
    setSearchCode(code);
    Haptics.selectionAsync();
  };

  const typeConfig = TX_TYPES.find(t => t.key === txType)!;
  const availableTxTypes = transactionId
    ? TX_TYPES
    : TX_TYPES.filter(t => t.key !== 'dca_buy');

  const calcAmount = () => {
    const p = parseFloat(price) || 0;
    const q = parseFloat(quantity) || 0;
    if (p > 0 && q > 0) return (p * q).toFixed(2);
    return amount;
  };

  const handleSubmit = async () => {
    if (!selectedInstrument) {
      Alert.alert('提示', '请先选择标的');
      return;
    }
    if (isLockedDcaTransaction) {
      Alert.alert('提示', '定投自动生成的交易请在定投详情中管理');
      return;
    }
    if (!accountId) {
      Alert.alert('提示', '请先选择账户');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
      Alert.alert('提示', '请输入正确的交易日期');
      return;
    }
    const p = parseFloat(price) || 0;
    const q = parseFloat(quantity) || 0;
    const f = parseFloat(fee) || 0;
    const a = parseFloat(amount) || 0;
    const da = parseFloat(dividendAmount) || 0;
    const sr = parseFloat(splitRatio) || 0;

    if ((typeConfig.needPrice && p <= 0) || (typeConfig.needQty && q <= 0)) {
      Alert.alert('提示', '请填写完整的价格和数量');
      return;
    }
    if (f < 0) {
      Alert.alert('提示', '手续费不能为负数');
      return;
    }
    if (typeConfig.needDividend && da <= 0) {
      Alert.alert('提示', '请输入分红金额');
      return;
    }
    if (typeConfig.needRatio && sr <= 0) {
      Alert.alert('提示', '请填写拆分/合并比例（拆分2表示1份变2份，合并2表示2份合并为1份）');
      return;
    }

    setSubmitting(true);
    try {
      const finalAmount = ['buy', 'sell', 'dca_buy', 'dividend_reinvest'].includes(txType)
        ? (a > 0 ? a : Math.round(p * q * 100) / 100)
        : (da || a || 0);

      const payload = {
        instrument_id: selectedInstrument.id,
        account_id: accountId,
        type: txType,
        price: p || undefined,
        quantity: q || undefined,
        fee: f,
        amount: finalAmount || undefined,
        dividend_amount: typeConfig.needDividend ? (da || undefined) : undefined,
        split_ratio: typeConfig.needRatio ? sr : undefined,
        trade_date: tradeDate,
        note: note || undefined,
      };
      if (transactionId) {
        await updateTransaction(transactionId, payload);
      } else {
        await addTransaction(payload);
      }
      Toast.show({ type: 'success', text1: transactionId ? '更新成功' : '记录成功' });
      triggerRefresh();
      setTimeout(() => router.back(), 300);
    } catch (e: any) {
      Alert.alert('失败', e?.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen safeAreaEdges={['top']}>
      <View className="flex-row items-center justify-between px-4 py-3" style={{ backgroundColor: UI.card, borderBottomWidth: 1, borderBottomColor: UI.border }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-sm font-medium" style={{ color: UI.subText }}>取消</Text>
        </TouchableOpacity>
        <Text className="text-base font-semibold" style={{ color: UI.text }}>{transactionId ? '编辑交易' : '记交易'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-4 py-4 pb-10">
        {/* 交易类型 */}
        <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>交易类型</Text>
        <View className="mb-4">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {availableTxTypes.map(t => (
                <TouchableOpacity
                  key={t.key}
                  className="px-4 py-2 rounded-full"
                  style={{ backgroundColor: txType === t.key ? UI.primary : UI.card, borderColor: txType === t.key ? UI.primary : UI.border, borderWidth: 1 }}
                  onPress={() => { setTxType(t.key); Haptics.selectionAsync(); }}
                >
                  <Text className="text-sm font-medium" style={{ color: txType === t.key ? '#fff' : UI.subText }}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* 标的选择 */}
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
            {searchResults.map((r, idx) => (
              <TouchableOpacity
                key={idx}
                className="flex-row items-center justify-between px-3 py-2.5"
                onPress={() => selectInstrument(r.code, r.name, r.type)}
              >
                <View>
                  <Text className="text-sm" style={{ color: UI.text }}>{r.name}</Text>
                  <Text className="text-xs mt-0.5" style={{ color: UI.subText }}>{r.code} · {getInstrumentTypeLabel(r.type)}</Text>
                </View>
                <FontAwesome6 name="plus" size={14} color={UI.primary} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 账户选择 */}
        <Text className="text-xs mb-2 mt-2 font-medium" style={{ color: UI.subText }}>所属账户</Text>
        <View className="mb-3">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {accounts.map(a => (
                <TouchableOpacity
                  key={a.id}
                  className="px-4 py-2 rounded-full"
                  style={{ backgroundColor: accountId === a.id ? UI.primary : UI.card, borderColor: accountId === a.id ? UI.primary : UI.border, borderWidth: 1 }}
                  onPress={() => setAccountId(a.id)}
                >
                  <Text className="text-sm font-medium" style={{ color: accountId === a.id ? '#fff' : UI.subText }}>{a.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* 日期 */}
        <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>交易日期</Text>
        <TextInput
          className="rounded-2xl px-4 py-3 mb-3 text-sm"
          style={INPUT_STYLE}
          value={tradeDate}
          onChangeText={setTradeDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={UI.muted}
        />

        {/* 价格、数量（按类型显示） */}
        {typeConfig.needPrice && (
          <>
            <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>{txType === 'dividend_reinvest' ? '单位净值' : '成交价(元)'}</Text>
            <TextInput
              className="rounded-2xl px-4 py-3 mb-3 text-sm"
              style={INPUT_STYLE}
              placeholder="0.00"
              placeholderTextColor={UI.muted}
              keyboardType="decimal-pad"
              value={price}
              onChangeText={setPrice}
            />
          </>
        )}

        {typeConfig.needQty && (
          <>
            <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>{txType === 'dividend_reinvest' ? '确认份额' : '数量/份额'}</Text>
            <TextInput
              className="rounded-2xl px-4 py-3 mb-3 text-sm"
              style={INPUT_STYLE}
              placeholder="0"
              placeholderTextColor={UI.muted}
              keyboardType="decimal-pad"
              value={quantity}
              onChangeText={setQuantity}
            />
          </>
        )}

        {typeConfig.needRatio && (
          <>
            <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>
              {txType === 'split' ? '拆分比例（如 1拆2 填 2）' : '合并比例（如 2合1 填 2）'}
            </Text>
            <TextInput
              className="rounded-2xl px-4 py-3 mb-3 text-sm"
              style={INPUT_STYLE}
              placeholder="例如: 2"
              placeholderTextColor={UI.muted}
              keyboardType="decimal-pad"
              value={splitRatio}
              onChangeText={setSplitRatio}
            />
          </>
        )}

        {(typeConfig.key === 'buy' || typeConfig.key === 'sell' || typeConfig.key === 'dca_buy' || typeConfig.key === 'dividend_reinvest') && (
          <>
            <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>手续费(元，可留空)</Text>
            <TextInput
              className="rounded-2xl px-4 py-3 mb-3 text-sm"
              style={INPUT_STYLE}
              placeholder="0"
              placeholderTextColor={UI.muted}
              keyboardType="decimal-pad"
              value={fee}
              onChangeText={setFee}
            />
            {typeConfig.key !== 'dividend_reinvest' && price && quantity && (
              <View className="px-2 mb-2">
                <Text className="text-xs" style={{ color: UI.subText }}>预估成交金额：¥{calcAmount()}（含手续费前）</Text>
              </View>
            )}
          </>
        )}

        {typeConfig.needDividend && (
          <>
            <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>分红金额(元)</Text>
            <TextInput
              className="rounded-2xl px-4 py-3 mb-3 text-sm"
              style={INPUT_STYLE}
              placeholder="0.00"
              placeholderTextColor={UI.muted}
              keyboardType="decimal-pad"
              value={dividendAmount}
              onChangeText={setDividendAmount}
            />
          </>
        )}

        <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>备注</Text>
        <TextInput
          className="rounded-2xl px-4 py-3 mb-6 text-sm"
          style={INPUT_STYLE}
          placeholder="选填"
          placeholderTextColor={UI.muted}
          value={note}
          onChangeText={setNote}
        />

        <TouchableOpacity
          className="rounded-2xl py-4 items-center"
          style={{ backgroundColor: UI.primary, opacity: submitting ? 0.7 : 1 }}
          disabled={submitting}
          onPress={handleSubmit}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text className="text-white font-semibold text-base">保存记录</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}
