import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { useApp } from '@/contexts/AppContext';
import { useFocusEffect } from 'expo-router';
import { getDcaPlanById, getDcaExecutions, setDcaStatus, executeNextDca } from '@/db/dca';
import { getInstrumentById } from '@/db/instruments';
import { getAccountById } from '@/db/accounts';
import { computeDcaStats } from '@/db/calculations';
import { getSetting } from '@/db/settings';
import { formatMoney, formatPercent, getPnlColor, formatDate } from '@/utils/format';
import { FontAwesome6 } from '@expo/vector-icons';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

export default function DcaDetailScreen() {
  const router = useSafeRouter();
  const { triggerRefresh } = useApp();
  const { id } = useSafeSearchParams<{ id: number }>();
  const [plan, setPlan] = useState<any>(null);
  const [instrument, setInstrument] = useState<any>(null);
  const [account, setAccount] = useState<any>(null);
  const [execs, setExecs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [reversed, setReversed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const p = await getDcaPlanById(id);
    if (!p) { setLoading(false); return; }
    setPlan(p);
    const inst = await getInstrumentById(p.instrument_id);
    const acc = p.account_id ? await getAccountById(p.account_id) : null;
    const exs = await getDcaExecutions(id);
    setInstrument(inst);
    setAccount(acc);
    setExecs(exs);
    const st = await computeDcaStats(id, inst?.latest_price || 0);
    setStats(st);
    const rg = await getSetting('red_green_reversed');
    setReversed(rg === '1');
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const cycleLabel = (p: any) => {
    if (p.cycle === 'daily') return '每日';
    if (p.cycle === 'weekly') return `每周${'日一二三四五六'[p.weekday ?? 1]}`;
    if (p.cycle === 'monthly') return `每月${p.monthday}日`;
    if (p.cycle === 'custom_days') return `每${p.interval_days}天`;
  };

  const handleManualExec = async () => {
    if (!plan) return;
    Alert.alert('手动定投', '按最新净值执行下一期定投扣款并计入持仓', [
      { text: '取消', style: 'cancel' },
      { text: '确认扣款', onPress: async () => {
          try {
            const executed = await executeNextDca(plan.id, { confirmImmediately: true });
            if (!executed) {
              Toast.show({ type: 'info', text1: '当前没有可执行的扣款日' });
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Toast.show({ type: 'success', text1: '扣款成功，已计入持仓' });
            triggerRefresh();
            load();
          } catch (e: any) {
            Toast.show({ type: 'error', text1: e?.message || '执行失败' });
          }
        }
      },
    ]);
  };

  if (loading || !plan || !instrument) {
    return (
      <Screen><View className="flex-1 items-center justify-center"><ActivityIndicator color="#3B82F6" /></View></Screen>
    );
  }

  const pnlColor = getPnlColor(stats.profit, reversed);
  const statusColor = plan.status === 'active' ? '#22C55E' : plan.status === 'paused' ? '#F59E0B' : '#64748B';
  const statusLabel = plan.status === 'active' ? '进行中' : plan.status === 'paused' ? '已暂停' : '已终止';

  return (
    <Screen safeAreaEdges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-[#1E293B]">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <FontAwesome6 name="chevron-left" size={16} color="#94A3B8" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-white flex-1" numberOfLines={1}>{plan.name}</Text>
        <TouchableOpacity onPress={() => router.push('/add-dca', { id: plan.id })}>
          <Text className="text-sm font-semibold text-[#3B82F6]">编辑</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1">
        {/* 顶部卡 */}
        <View className="m-4 rounded-2xl p-5" style={{ backgroundColor: '#161B28' }}>
          <View className="flex-row items-center justify-between mb-4">
            <View>
              <Text className="text-white text-lg font-bold">{instrument.name}</Text>
              <Text className="text-xs text-[#64748B] mt-1">{instrument.code}</Text>
            </View>
            <View className="px-3 py-1 rounded-full" style={{ backgroundColor: `${statusColor}20` }}>
              <Text className="text-xs" style={{ color: statusColor }}>{statusLabel}</Text>
            </View>
          </View>

          <View className="grid grid-cols-3 gap-4">
            <View>
              <Text className="text-xs text-[#94A3B8]">累计投入</Text>
              <Text className="text-base font-bold text-white mt-1" style={{ fontVariant: ['tabular-nums'] }}>¥{formatMoney(stats.total_invested)}</Text>
            </View>
            <View>
              <Text className="text-xs text-[#94A3B8]">持有份额</Text>
              <Text className="text-base font-bold text-white mt-1" style={{ fontVariant: ['tabular-nums'] }}>{formatMoney(stats.total_shares, 2)}</Text>
            </View>
            <View>
              <Text className="text-xs text-[#94A3B8]">当前市值</Text>
              <Text className="text-base font-bold text-white mt-1" style={{ fontVariant: ['tabular-nums'] }}>¥{formatMoney(stats.market_value)}</Text>
            </View>
            <View>
              <Text className="text-xs text-[#94A3B8]">累计收益</Text>
              <Text className="text-base font-bold mt-1" style={{ color: pnlColor }}>
                {formatMoney(stats.profit, 2, true)}
              </Text>
            </View>
            <View>
              <Text className="text-xs text-[#94A3B8]">收益率</Text>
              <Text className="text-base font-bold mt-1" style={{ color: pnlColor }}>{formatPercent(stats.profit_pct)}</Text>
            </View>
            <View>
              <Text className="text-xs text-[#94A3B8]">年化</Text>
              <Text className="text-base font-bold mt-1" style={{ color: pnlColor }}>{formatPercent(stats.annualized_pct)}</Text>
            </View>
          </View>
        </View>

        {/* 计划规则 */}
        <View className="mx-4 mb-3 rounded-2xl p-4" style={{ backgroundColor: '#161B28' }}>
          <Text className="text-sm font-semibold text-white mb-3">计划规则</Text>
          {[
            ['定投金额', `¥${formatMoney(plan.amount)} / 次`],
            ['申购费率', `${(plan.fee_rate * 100).toFixed(2)}%`],
            ['定投周期', cycleLabel(plan)],
            ['确认规则', `T+${plan.confirm_days}`],
            ['首次扣款', plan.first_date],
            ['账户', account?.name || '未设置'],
          ].map(([k, v]) => (
            <View key={k} className="flex-row justify-between py-2 border-b border-[#1E293B]">
              <Text className="text-xs text-[#94A3B8]">{k}</Text>
              <Text className="text-xs text-white">{v}</Text>
            </View>
          ))}
          {plan.end_date && (
            <View className="flex-row justify-between py-2">
              <Text className="text-xs text-[#94A3B8]">终止日期</Text>
              <Text className="text-xs text-white">{plan.end_date}</Text>
            </View>
          )}
        </View>

        {/* 操作按钮 */}
        {plan.status !== 'terminated' && (
          <View className="mx-4 mb-3 flex-row gap-3">
            <TouchableOpacity
              className="flex-1 py-3 rounded-2xl items-center"
              style={{ backgroundColor: '#1E293B' }}
              onPress={() => {
                setDcaStatus(plan.id, plan.status === 'paused' ? 'active' : 'paused').then(() => {
                  triggerRefresh();
                  load();
                });
              }}
            >
              <Text className="text-sm text-[#94A3B8]">{plan.status === 'paused' ? '恢复定投' : '暂停定投'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 py-3 rounded-2xl items-center"
              style={{ backgroundColor: '#F59E0B' }}
              onPress={handleManualExec}
            >
              <Text className="text-sm text-white font-semibold">手动投一笔</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 扣款记录 */}
        <View className="mx-4 mb-6 rounded-2xl p-4" style={{ backgroundColor: '#161B28' }}>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-sm font-semibold text-white">扣款明细</Text>
            <Text className="text-xs text-[#64748B]">共 {execs.length} 笔</Text>
          </View>
          {execs.length === 0 ? (
            <Text className="text-xs text-[#64748B] text-center py-6">暂无扣款记录</Text>
          ) : (
            execs.map((e, i) => (
              <View key={i} className="flex-row justify-between py-2.5 border-b border-[#1E293B]">
                <View>
                  <Text className="text-xs text-white">{formatDate(e.execute_date)}</Text>
                  {e.confirm_date && <Text className="text-[10px] text-[#64748B] mt-0.5">到账: {formatDate(e.confirm_date)}</Text>}
                </View>
                <View className="items-end">
                  <Text className="text-xs text-white">¥{formatMoney(e.amount)} → {formatMoney(e.shares, 2)}份</Text>
                  <Text className="text-[10px] text-[#64748B] mt-0.5">净值 {e.nav?.toFixed(4)}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
