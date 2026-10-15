import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform, Alert } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { useApp } from '@/contexts/AppContext';
import { getAllInstruments } from '@/db/instruments';
import { getAllAccounts } from '@/db/accounts';
import { createDcaPlan, getDcaPlanById, updateDcaPlan } from '@/db/dca';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

type Cycle = 'daily' | 'weekly' | 'monthly' | 'custom_days';

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

export default function AddDcaScreen() {
  const router = useSafeRouter();
  const { id } = useSafeSearchParams<{ id?: number }>();
  const planId = id ? Number(id) : undefined;
  const { triggerRefresh } = useApp();
  const [name, setName] = useState('');
  const [instrumentId, setInstrumentId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [feeRate, setFeeRate] = useState('0.15');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [confirmDays, setConfirmDays] = useState('1');
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [weekday, setWeekday] = useState('1');
  const [monthday, setMonthday] = useState('1');
  const [intervalDays, setIntervalDays] = useState('30');
  const [showInstrumentPicker, setShowInstrumentPicker] = useState(false);
  const [instruments, setInstruments] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const insts = await getAllInstruments();
      const accts = await getAllAccounts();
      setInstruments(insts);
      setAccounts(accts);
      if (accts.length > 0) setAccountId(accts[0].id);
      if (planId) {
        const plan = await getDcaPlanById(planId);
        if (plan) {
          setName(plan.name);
          setInstrumentId(plan.instrument_id);
          setAccountId(plan.account_id);
          setAmount(String(plan.amount));
          setFeeRate(String((plan.fee_rate || 0) * 100));
          setStartDate(plan.first_date);
          setConfirmDays(String(plan.confirm_days));
          setCycle(plan.cycle);
          setWeekday(String(plan.weekday ?? 1));
          setMonthday(String(plan.monthday ?? 1));
          setIntervalDays(String(plan.interval_days ?? 30));
        }
      }
    })();
  }, [planId]);

  const openPicker = async () => {
    const insts = await getAllInstruments();
    setInstruments(insts);
    if (insts.length === 0) {
      Alert.alert('请先添加标的', '需要先在行情页添加标的才能创建定投', [
        { text: '取消', style: 'cancel' },
        { text: '去添加', onPress: () => router.push('/search-quote') },
      ]);
      return;
    }
    setShowInstrumentPicker(true);
  };

  const pickInstrument = (id: number) => {
    setInstrumentId(id);
    setShowInstrumentPicker(false);
  };

  const handleSave = async () => {
    if (!instrumentId) { Toast.show({ type: 'error', text1: '请选择标的' }); return; }
    if (!accountId) { Toast.show({ type: 'error', text1: '请选择账户' }); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Toast.show({ type: 'error', text1: '请输入定投金额' }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) { Toast.show({ type: 'error', text1: '请输入正确的首次扣款日' }); return; }
    const fr = parseFloat(feeRate) || 0;
    const cd = parseInt(confirmDays) || 1;

    try {
      const payload = {
        instrument_id: instrumentId,
        account_id: accountId,
        name: name || `定投${new Date().toLocaleDateString()}`,
        amount: amt,
        fee_rate: fr / 100,
        cycle,
        first_date: startDate,
        weekday: cycle === 'weekly' ? parseInt(weekday) || 0 : undefined,
        monthday: cycle === 'monthly' ? parseInt(monthday) || 1 : undefined,
        interval_days: cycle === 'custom_days' ? parseInt(intervalDays) || 1 : undefined,
        confirm_days: cd,
      };
      if (planId) {
        await updateDcaPlan(planId, payload);
      } else {
        await createDcaPlan(payload);
      }
      triggerRefresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: planId ? '更新成功' : '创建成功' });
      setTimeout(() => router.back(), 300);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: e?.message || (planId ? '更新失败' : '创建失败') });
    }
  };

  const selectedInst = instruments.find(i => i.id === instrumentId);

  return (
    <Screen safeAreaEdges={['top']}>
      <View className="flex-row items-center px-4 py-3" style={{ backgroundColor: UI.card, borderBottomWidth: 1, borderBottomColor: UI.border }}>
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <FontAwesome6 name="chevron-left" size={16} color={UI.subText} />
        </TouchableOpacity>
        <Text className="text-lg font-bold flex-1" style={{ color: UI.text }}>{planId ? '编辑定投计划' : '新建定投计划'}</Text>
        <TouchableOpacity onPress={handleSave}>
          <Text className="font-semibold text-sm" style={{ color: UI.primary }}>保存</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-4 py-4 gap-3" keyboardShouldPersistTaps="handled">
        {/* 标的选择 */}
        <TouchableOpacity className="rounded-2xl p-4" style={CARD_STYLE} onPress={openPicker}>
          <Text className="text-xs mb-1 font-medium" style={{ color: UI.subText }}>选择标的</Text>
          {selectedInst ? (
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-medium" style={{ color: UI.text }}>{selectedInst.name}</Text>
              <Text className="text-sm" style={{ color: UI.subText }}>{selectedInst.code}</Text>
            </View>
          ) : (
            <Text className="text-sm" style={{ color: UI.subText }}>点击选择 →</Text>
          )}
        </TouchableOpacity>

        {showInstrumentPicker && (
          <View className="rounded-2xl p-4" style={CARD_STYLE}>
            {instruments.map(i => (
              <TouchableOpacity key={i.id} className="py-3" style={{ borderBottomWidth: 1, borderBottomColor: UI.borderSoft }} onPress={() => pickInstrument(i.id)}>
                <Text style={{ color: UI.text }}>{i.name} <Text className="text-sm" style={{ color: UI.subText }}>{i.code}</Text></Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 计划名称 */}
        <View className="rounded-2xl p-4" style={CARD_STYLE}>
          <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>计划名称</Text>
          <TextInput
            className="text-sm"
            style={{ color: UI.text }}
            placeholder="如：沪深300ETF月定投"
            placeholderTextColor={UI.muted}
            value={name}
            onChangeText={setName}
          />
        </View>

        {/* 金额 */}
        <View className="rounded-2xl p-4" style={CARD_STYLE}>
          <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>定投金额（元）</Text>
          <TextInput
            className="text-base font-semibold"
            style={{ color: UI.text }}
            placeholder="500"
            placeholderTextColor={UI.muted}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />
        </View>

        {/* 首次扣款日 */}
        <View className="rounded-2xl p-4" style={CARD_STYLE}>
          <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>首次扣款日</Text>
          <TextInput
            className="text-sm"
            style={{ color: UI.text }}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={UI.muted}
            value={startDate}
            onChangeText={setStartDate}
            autoCapitalize="none"
          />
        </View>

        {/* 定投周期 */}
        <View className="rounded-2xl p-4" style={CARD_STYLE}>
          <Text className="text-xs mb-3 font-medium" style={{ color: UI.subText }}>定投周期</Text>
          <View className="flex-row flex-wrap gap-2 mb-3">
            {[
              { k: 'daily', label: '每日' },
              { k: 'weekly', label: '每周' },
              { k: 'monthly', label: '每月' },
              { k: 'custom_days', label: '自定义' },
            ].map(c => (
              <TouchableOpacity
                key={c.k}
                className="px-4 py-2 rounded-full"
                style={{ backgroundColor: cycle === c.k ? UI.primary : UI.card, borderColor: cycle === c.k ? UI.primary : UI.border, borderWidth: 1 }}
                onPress={() => setCycle(c.k as Cycle)}
              >
                <Text className="text-sm font-medium" style={{ color: cycle === c.k ? '#fff' : UI.subText }}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {cycle === 'weekly' && (
            <View className="flex-row gap-2">
              {['日', '一', '二', '三', '四', '五', '六'].map((d, i) => (
                <TouchableOpacity
                  key={i}
                  className="w-9 h-9 rounded-full items-center justify-center"
                  style={{ backgroundColor: parseInt(weekday) === i ? UI.primary : UI.primarySoft }}
                  onPress={() => setWeekday(String(i))}
                >
                  <Text className="text-xs font-medium" style={{ color: parseInt(weekday) === i ? '#fff' : UI.primary }}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {cycle === 'monthly' && (
            <View>
              <Text className="text-xs mb-2" style={{ color: UI.subText }}>每月日期 (1-28)</Text>
              <TextInput
                className="text-sm px-3 py-2 rounded-lg"
                style={INPUT_STYLE}
                keyboardType="number-pad"
                value={monthday}
                onChangeText={t => setMonthday(t.replace(/\D/g, '').slice(0, 2))}
              />
            </View>
          )}
          {cycle === 'custom_days' && (
            <View>
              <Text className="text-xs mb-2" style={{ color: UI.subText }}>间隔天数</Text>
              <TextInput
                className="text-sm px-3 py-2 rounded-lg"
                style={INPUT_STYLE}
                keyboardType="number-pad"
                value={intervalDays}
                onChangeText={t => setIntervalDays(t.replace(/\D/g, '').slice(0, 3))}
              />
            </View>
          )}
        </View>

        {/* 申购费率 */}
        <View className="rounded-2xl p-4" style={CARD_STYLE}>
          <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>申购费率 (%)</Text>
          <TextInput
            className="text-sm"
            style={{ color: UI.text }}
            placeholder="0.15"
            placeholderTextColor={UI.muted}
            keyboardType="decimal-pad"
            value={feeRate}
            onChangeText={setFeeRate}
          />
        </View>

        {/* 确认天数 */}
        <View className="rounded-2xl p-4" style={CARD_STYLE}>
          <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>份额确认 T+N</Text>
          <View className="flex-row gap-2">
            {[0, 1, 2, 3].map(n => (
              <TouchableOpacity
                key={n}
                className="px-4 py-2 rounded-full"
                style={{ backgroundColor: parseInt(confirmDays) === n ? UI.primary : UI.primarySoft }}
                onPress={() => setConfirmDays(String(n))}
              >
                <Text className="text-sm font-medium" style={{ color: parseInt(confirmDays) === n ? '#fff' : UI.primary }}>T+{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 账户选择 */}
        {accounts.length > 0 && (
          <View className="rounded-2xl p-4" style={CARD_STYLE}>
            <Text className="text-xs mb-2 font-medium" style={{ color: UI.subText }}>所属账户</Text>
            <View className="flex-row flex-wrap gap-2">
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
          </View>
        )}

        {Platform.OS !== 'ios' && <View className="h-10" />}
      </ScrollView>
    </Screen>
  );
}
