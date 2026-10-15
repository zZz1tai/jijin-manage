import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput, Alert, Platform, KeyboardAvoidingView, Share } from 'react-native';
import { Screen } from '@/components/Screen';
import { useApp } from '@/contexts/AppContext';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { getSetting, setSetting, SETTING_KEYS } from '@/db/settings';
import { getAllAccounts, createAccount, deleteAccount } from '@/db/accounts';
import { getAllTransactions, isDcaGeneratedTransaction } from '@/db/transactions';
import { addCashFlow, computeAccountCashBalance, deleteCashFlow, getCashFlows } from '@/db/cash';
import { exportBackupJson, exportTransactionsCsv, importBackupJson } from '@/db/export';
import { formatMoney, formatDate, todayStr } from '@/utils/format';
import { getAllInstruments } from '@/db/instruments';
import type { CashFlowType } from '@/db/types';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

const {
  COST_METHOD, RED_GREEN_REVERSED, THEME_MODE,
  THOUSAND_SEPARATOR,
} = SETTING_KEYS;

const UI = {
  primary: '#1D4ED8',
  primarySoft: '#EAF0FF',
  card: '#FFFFFF',
  input: '#F5F8FF',
  border: '#E6EEF8',
  borderSoft: '#EEF2F7',
  text: '#0F172A',
  subText: '#667085',
  muted: '#98A2B3',
  gold: '#F59E0B',
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

function SettingItem({ label, value, onPress, desc }: { label: string; value: string; onPress?: () => void; desc?: string }) {
  return (
    <TouchableOpacity
      className="flex-row items-center justify-between py-4 px-4"
      style={{ borderBottomWidth: 1, borderBottomColor: UI.borderSoft }}
      onPress={onPress}
      activeOpacity={0.6}
      disabled={!onPress}
    >
      <View className="flex-1">
        <Text className="text-sm" style={{ color: UI.text }}>{label}</Text>
        {desc && <Text className="text-[10px] mt-0.5" style={{ color: UI.subText }}>{desc}</Text>}
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="text-sm" style={{ color: UI.subText }}>{value}</Text>
        {onPress && <FontAwesome6 name="chevron-right" size={12} color={UI.muted} />}
      </View>
    </TouchableOpacity>
  );
}

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      className="w-12 h-7 rounded-full justify-center px-0.5"
      style={{ backgroundColor: on ? UI.primary : '#D8E7FF' }}
    >
      <View className="w-6 h-6 bg-white rounded-full self-end" style={!on ? { alignSelf: 'flex-start' } : {}} />
    </TouchableOpacity>
  );
}

async function exportTextFile(filename: string, content: string, mimeType: string) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return;
  }
  await Share.share({ title: filename, message: content });
}

export default function ProfileScreen() {
  const router = useSafeRouter();
  const { triggerRefresh } = useApp();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showCashModal, setShowCashModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [tab, setTab] = useState<'settings' | 'accounts' | 'cash' | 'records'>('settings');
  const [recordFilter, setRecordFilter] = useState<string>('all');
  const [cashFlows, setCashFlows] = useState<any[]>([]);
  const [cashBalances, setCashBalances] = useState<Record<number, number>>({});
  const [cashAccountId, setCashAccountId] = useState<number | null>(null);
  const [cashType, setCashType] = useState<CashFlowType>('deposit');
  const [cashAmount, setCashAmount] = useState('');
  const [cashDate, setCashDate] = useState(todayStr());
  const [cashNote, setCashNote] = useState('');
  const [restoreText, setRestoreText] = useState('');

  const load = useCallback(async () => {
    const obj: Record<string, string> = {};
    for (const k of Object.values(SETTING_KEYS)) {
      obj[k] = (await getSetting(k)) || '';
    }
    setSettings(obj);
    const accountRows = await getAllAccounts();
    setAccounts(accountRows);
    if (!cashAccountId && accountRows[0]) setCashAccountId(accountRows[0].id);
    const balances: Record<number, number> = {};
    for (const account of accountRows) {
      balances[account.id] = await computeAccountCashBalance(account.id);
    }
    setCashBalances(balances);
    const flows = await getCashFlows();
    const accountMap = new Map(accountRows.map(account => [account.id, account]));
    setCashFlows(flows.map(flow => ({ ...flow, account: accountMap.get(flow.account_id) })));
    const allT = await getAllTransactions();
    const insts = await getAllInstruments();
    const instMap = new Map(insts.map(i => [i.id, i]));
    setTransactions(allT.map(t => ({ ...t, inst: instMap.get(t.instrument_id) })));
  }, [cashAccountId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleSetting = async (key: string, v1: string, v2: string) => {
    const newV = settings[key] === v1 ? v2 : v1;
    await setSetting(key, newV);
    Haptics.selectionAsync();
    load();
    triggerRefresh();
  };

  const handleAddAccount = async () => {
    if (!newAccountName.trim()) { Toast.show({ type: 'error', text1: '请输入账户名' }); return; }
    await createAccount(newAccountName.trim());
    setNewAccountName('');
    setShowAccountModal(false);
    load();
    triggerRefresh();
    Toast.show({ type: 'success', text1: '添加成功' });
  };

  const handleDeleteAccount = (id: number, name: string) => {
    Alert.alert('删除账户', `确定删除账户「${name}」？该账户下持仓与流水不会被删除但不再归类。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => { await deleteAccount(id); load(); triggerRefresh(); } },
    ]);
  };

  const handleAddCashFlow = async () => {
    if (!cashAccountId) { Toast.show({ type: 'error', text1: '请选择账户' }); return; }
    const value = parseFloat(cashAmount);
    if (!value || value <= 0) { Toast.show({ type: 'error', text1: '请输入金额' }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cashDate)) { Toast.show({ type: 'error', text1: '请输入正确日期' }); return; }
    await addCashFlow({
      account_id: cashAccountId,
      type: cashType,
      amount: cashType === 'adjust' ? value : Math.abs(value),
      flow_date: cashDate,
      note: cashNote.trim() || undefined,
    });
    setShowCashModal(false);
    setCashAmount('');
    setCashNote('');
    load();
    triggerRefresh();
    Toast.show({ type: 'success', text1: '现金流水已记录' });
  };

  const handleDeleteCashFlow = (id: number) => {
    Alert.alert('删除现金流水', '确定删除这条现金流水？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => { await deleteCashFlow(id); load(); triggerRefresh(); } },
    ]);
  };

  const handleExportBackup = async () => {
    const content = await exportBackupJson();
    await exportTextFile(`jijin-backup-${todayStr()}.json`, content, 'application/json;charset=utf-8');
    Toast.show({ type: 'success', text1: '备份已导出' });
  };

  const handleExportTransactions = async () => {
    const content = await exportTransactionsCsv();
    await exportTextFile(`jijin-transactions-${todayStr()}.csv`, content, 'text/csv;charset=utf-8');
    Toast.show({ type: 'success', text1: '流水 CSV 已导出' });
  };

  const handleRestoreBackup = () => {
    if (!restoreText.trim()) {
      Toast.show({ type: 'error', text1: '请粘贴备份 JSON' });
      return;
    }
    Alert.alert('恢复备份', '恢复会覆盖当前本地数据，确定继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '恢复',
        style: 'destructive',
        onPress: async () => {
          try {
            await importBackupJson(restoreText);
            setShowRestoreModal(false);
            setRestoreText('');
            await load();
            triggerRefresh();
            Toast.show({ type: 'success', text1: '恢复完成' });
          } catch (e: any) {
            Toast.show({ type: 'error', text1: e?.message || '恢复失败' });
          }
        },
      },
    ]);
  };

  const txTypeLabel: Record<string, { label: string; color: string; sign: string }> = {
    buy: { label: '买入', color: '#EF4444', sign: '-' },
    sell: { label: '卖出', color: '#22C55E', sign: '+' },
    dividend_cash: { label: '现金分红', color: '#22C55E', sign: '+' },
    dividend_reinvest: { label: '红利再投', color: UI.primary, sign: '' },
    split: { label: '份额拆分', color: '#F59E0B', sign: '' },
    merge: { label: '份额合并', color: '#F59E0B', sign: '' },
    dca_buy: { label: '定投买入', color: '#F59E0B', sign: '-' },
  };

  const filteredTxs = recordFilter === 'all' ? transactions : transactions.filter(t => t.type === recordFilter);

  return (
    <Screen safeAreaEdges={['top']}>
      <View className="px-4 pt-2 pb-3">
        <Text className="text-xl font-bold" style={{ color: UI.text }}>我的</Text>
      </View>

      {/* Tab切换 */}
      <View className="flex-row px-4 mb-2 gap-2">
        {[
          { k: 'settings', label: '设置', icon: 'gear' },
          { k: 'accounts', label: '账户', icon: 'wallet' },
          { k: 'cash', label: '现金', icon: 'money-bill' },
          { k: 'records', label: '流水', icon: 'clock-rotate-left' },
        ].map(t => (
          <TouchableOpacity
            key={t.k}
            className="flex-1 py-2.5 rounded-2xl flex-row items-center justify-center gap-1.5"
            style={{ backgroundColor: tab === t.k ? UI.primary : UI.card, borderColor: tab === t.k ? UI.primary : UI.border, borderWidth: 1, minWidth: 0 }}
            onPress={() => { setTab(t.k as any); Haptics.selectionAsync(); }}
          >
            <FontAwesome6 name={t.icon} size={12} color={tab === t.k ? '#fff' : UI.primary} />
            <Text className="text-xs font-medium" style={{ color: tab === t.k ? '#fff' : UI.subText }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView className="flex-1 px-4 pb-8">
        {tab === 'settings' && (
          <View className="rounded-2xl overflow-hidden" style={CARD_STYLE}>
            <View className="px-4 py-2" style={{ backgroundColor: UI.primarySoft }}>
              <Text className="text-xs font-medium" style={{ color: UI.primary }}>核算方式</Text>
            </View>
            <SettingItem label="成本核算方法" value={settings[COST_METHOD] === 'fifo' ? '先进先出' : '加权平均'}
              onPress={() => toggleSetting(COST_METHOD, 'avg', 'fifo')}
              desc="切换后将自动重算成本与收益"
            />

            <View className="px-4 py-2" style={{ backgroundColor: UI.primarySoft }}><Text className="text-xs font-medium" style={{ color: UI.primary }}>外观显示</Text></View>
            <SettingItem label="深色模式"
              value={settings[THEME_MODE] === 'dark' ? '已开启' : settings[THEME_MODE] === 'light' ? '已关闭' : '跟随系统'}
              onPress={() => {
                const m = settings[THEME_MODE];
                const n = m === 'system' ? 'dark' : m === 'dark' ? 'light' : 'system';
                setSetting(THEME_MODE, n); load(); triggerRefresh();
              }}
            />
            <View className="flex-row items-center justify-between py-4 px-4" style={{ borderBottomWidth: 1, borderBottomColor: UI.borderSoft }}>
              <View className="flex-1">
                <Text className="text-sm" style={{ color: UI.text }}>红绿反转</Text>
                <Text className="text-[10px] mt-0.5" style={{ color: UI.subText }}>涨为绿、跌为红（国际惯例）</Text>
              </View>
              <Switch on={settings[RED_GREEN_REVERSED] === '1'} onToggle={() => toggleSetting(RED_GREEN_REVERSED, '0', '1')} />
            </View>
            <View className="flex-row items-center justify-between py-4 px-4" style={{ borderBottomWidth: 1, borderBottomColor: UI.borderSoft }}>
              <View className="flex-1">
                <Text className="text-sm" style={{ color: UI.text }}>金额千分位</Text>
                <Text className="text-[10px] mt-0.5" style={{ color: UI.subText }}>大额数字显示千位分隔</Text>
              </View>
              <Switch on={settings[THOUSAND_SEPARATOR] === '1'} onToggle={() => toggleSetting(THOUSAND_SEPARATOR, '0', '1')} />
            </View>

            <View className="px-4 py-2" style={{ backgroundColor: UI.primarySoft }}><Text className="text-xs font-medium" style={{ color: UI.primary }}>安全与工具</Text></View>
            <SettingItem label="手续费计算器" value="内置" onPress={() => Toast.show({ type: 'info', text1: '买卖页会自动纳入手续费' })} />
            <SettingItem label="数据备份" value="JSON" onPress={handleExportBackup} />
            <SettingItem label="恢复备份" value="粘贴 JSON" onPress={() => setShowRestoreModal(true)} />
            <SettingItem label="导出流水" value="CSV" onPress={handleExportTransactions} />

            <View className="px-4 py-2" style={{ backgroundColor: UI.primarySoft }}><Text className="text-xs font-medium" style={{ color: UI.primary }}>关于</Text></View>
            <View className="py-4 px-4">
              <Text className="text-sm" style={{ color: UI.text }}>投资记账 v1.0.0</Text>
              <Text className="text-[10px] mt-1" style={{ color: UI.subText }}>本地存储 · 不上传任何私有数据 · 仅供个人记录</Text>
            </View>
          </View>
        )}

        {tab === 'accounts' && (
          <View>
            <View className="rounded-2xl overflow-hidden mb-3" style={CARD_STYLE}>
              {accounts.map((a, i) => (
                <View
                  key={a.id}
                  className="flex-row items-center justify-between py-4 px-4"
                  style={i < accounts.length - 1 ? { borderBottomWidth: 1, borderBottomColor: UI.borderSoft } : undefined}
                >
                  <View className="flex-row items-center gap-3">
                    <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: UI.primarySoft }}>
                      <FontAwesome6 name="wallet" size={14} color={UI.primary} />
                    </View>
                    <View>
                      <Text className="text-sm" style={{ color: UI.text }}>{a.name}</Text>
                      <Text className="text-[10px] mt-0.5" style={{ color: UI.subText }}>创建于 {formatDate(a.created_at)}</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => handleDeleteAccount(a.id, a.name)}>
                    <FontAwesome6 name="trash-can" size={14} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ))}
              {accounts.length === 0 && (
                <Text className="text-xs text-center py-8" style={{ color: UI.subText }}>暂无账户，持仓将归属到默认账户</Text>
              )}
            </View>
            <TouchableOpacity
              className="py-3 rounded-2xl items-center flex-row justify-center gap-2"
              style={{ backgroundColor: UI.primary }}
              onPress={() => setShowAccountModal(true)}
            >
              <FontAwesome6 name="plus" size={12} color="#fff" />
              <Text className="text-sm text-white font-semibold">新增账户</Text>
            </TouchableOpacity>
          </View>
        )}

        {tab === 'cash' && (
          <View>
            <View className="rounded-2xl overflow-hidden mb-3" style={CARD_STYLE}>
              {accounts.map((account, index) => {
                const balance = cashBalances[account.id] ?? 0;
                return (
                  <View
                    key={account.id}
                    className="flex-row items-center justify-between py-4 px-4"
                    style={index < accounts.length - 1 ? { borderBottomWidth: 1, borderBottomColor: UI.borderSoft } : undefined}
                  >
                    <View>
                      <Text className="text-sm" style={{ color: UI.text }}>{account.name}</Text>
                      <Text className="text-[10px] mt-0.5" style={{ color: UI.subText }}>含交易现金影响</Text>
                    </View>
                    <Text className="text-base font-semibold" style={{ color: balance >= 0 ? UI.text : '#EF4444', fontVariant: ['tabular-nums'] }}>
                      ¥{formatMoney(balance)}
                    </Text>
                  </View>
                );
              })}
            </View>
            <TouchableOpacity
              className="py-3 rounded-2xl items-center flex-row justify-center gap-2 mb-3"
              style={{ backgroundColor: UI.primary }}
              onPress={() => setShowCashModal(true)}
            >
              <FontAwesome6 name="plus" size={12} color="#fff" />
              <Text className="text-sm text-white font-semibold">记录现金流水</Text>
            </TouchableOpacity>
            <View className="rounded-2xl overflow-hidden" style={CARD_STYLE}>
              {cashFlows.length === 0 ? (
                <Text className="text-xs text-center py-8" style={{ color: UI.subText }}>暂无现金流水</Text>
              ) : (
                cashFlows.slice(0, 30).map((flow, index) => {
                  const isOut = flow.type === 'withdraw';
                  const isAdjust = flow.type === 'adjust';
                  const label = flow.type === 'deposit' ? '入金' : flow.type === 'withdraw' ? '出金' : '调整';
                  const color = isOut ? '#EF4444' : isAdjust ? '#F59E0B' : '#22C55E';
                  return (
                    <View
                      key={flow.id}
                      className="flex-row items-center py-3 px-4"
                      style={index < cashFlows.length - 1 ? { borderBottomWidth: 1, borderBottomColor: UI.borderSoft } : undefined}
                    >
                      <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: `${color}20` }}>
                        <Text className="text-xs font-bold" style={{ color }}>{label[0]}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm" style={{ color: UI.text }}>{flow.account?.name || '未知账户'} · {label}</Text>
                        <Text className="text-[10px] mt-0.5" style={{ color: UI.subText }}>{formatDate(flow.flow_date)} {flow.note ? `· ${flow.note}` : ''}</Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-sm font-semibold" style={{ color }}>
                          {isOut ? '-' : '+'}¥{formatMoney(flow.amount)}
                        </Text>
                        <TouchableOpacity onPress={() => handleDeleteCashFlow(flow.id)}>
                          <Text className="text-[10px] mt-1 text-[#EF4444]">删除</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        )}

        {tab === 'records' && (
          <View>
            <View className="flex-row flex-wrap gap-2 mb-3">
              {[
                { k: 'all', l: '全部' },
                { k: 'buy', l: '买入' },
                { k: 'sell', l: '卖出' },
                { k: 'dividend_cash', l: '分红' },
                { k: 'dca_buy', l: '定投' },
              ].map(f => (
                <TouchableOpacity
                  key={f.k}
                  className="px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: recordFilter === f.k ? UI.primary : UI.card, borderColor: recordFilter === f.k ? UI.primary : UI.border, borderWidth: 1 }}
                  onPress={() => setRecordFilter(f.k)}
                >
                  <Text className="text-xs font-medium" style={{ color: recordFilter === f.k ? '#fff' : UI.subText }}>{f.l}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="rounded-2xl overflow-hidden" style={CARD_STYLE}>
              {filteredTxs.length === 0 ? (
                <Text className="text-xs text-center py-8" style={{ color: UI.subText }}>暂无流水</Text>
              ) : (
                filteredTxs.map((t, i) => {
                  const meta = txTypeLabel[t.type] || { label: t.type, color: UI.subText, sign: '' };
                  const isLinkedDca = isDcaGeneratedTransaction(t);
                  const amt = t.amount ?? (
                    t.price && t.quantity ? Math.round((t.price * t.quantity + (t.fee || 0)) * 100) / 100 : 0
                  );
                  return (
                    <TouchableOpacity
                      key={t.id}
                      className="flex-row items-center py-3 px-4"
                      style={i < filteredTxs.length - 1 ? { borderBottomWidth: 1, borderBottomColor: UI.borderSoft } : undefined}
                      activeOpacity={0.7}
                      onPress={isLinkedDca ? undefined : () => router.push('/add-transaction', { transaction_id: t.id })}
                      disabled={isLinkedDca}
                    >
                      <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: `${meta.color}20` }}>
                        <Text className="text-xs font-bold" style={{ color: meta.color }}>{meta.label[0]}</Text>
                      </View>
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-sm" style={{ color: UI.text }} numberOfLines={1}>{t.inst?.name || '未知标的'}</Text>
                          <Text className="text-[10px] px-1 rounded" style={{ backgroundColor: `${meta.color}20`, color: meta.color }}>{meta.label}</Text>
                        </View>
                        <Text className="text-[10px] mt-0.5" style={{ color: UI.subText }}>{formatDate(t.trade_date)}</Text>
                      </View>
                      <View className="items-end">
                        {amt ? (
                          <Text className="text-sm font-semibold" style={{ color: meta.color }}>
                            {meta.sign}¥{formatMoney(amt)}
                          </Text>
                        ) : (
                          <Text className="text-xs" style={{ color: meta.color }}>{t.quantity?.toFixed?.(2) || ''}份</Text>
                        )}
                        {t.price && <Text className="text-[10px] mt-0.5" style={{ color: UI.subText }}>@{t.price.toFixed(3)}</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* 新增账户 Modal */}
      <Modal visible={showAccountModal} transparent animationType="fade" onRequestClose={() => setShowAccountModal(false)}>
        <TouchableOpacity className="flex-1 bg-black/60 items-center justify-center p-6" activeOpacity={1} onPress={() => setShowAccountModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="w-full max-w-sm">
            <TouchableOpacity activeOpacity={1} className="rounded-2xl p-5 w-full" style={CARD_STYLE}>
              <Text className="text-base font-bold mb-3" style={{ color: UI.text }}>新增投资账户</Text>
              <TextInput
                className="rounded-xl px-4 py-3 text-sm mb-4"
                style={{ backgroundColor: UI.input, color: UI.text, borderColor: UI.border, borderWidth: 1 }}
                placeholder="如：华泰证券、天天基金、招行理财"
                placeholderTextColor={UI.muted}
                value={newAccountName}
                onChangeText={setNewAccountName}
                autoFocus
              />
              <View className="flex-row gap-3">
                <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: UI.primarySoft }} onPress={() => setShowAccountModal(false)}>
                  <Text className="text-sm font-medium" style={{ color: UI.primary }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: UI.primary }} onPress={handleAddAccount}>
                  <Text className="text-sm text-white font-semibold">确定</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showCashModal} transparent animationType="fade" onRequestClose={() => setShowCashModal(false)}>
        <TouchableOpacity className="flex-1 bg-black/60 items-center justify-center p-6" activeOpacity={1} onPress={() => setShowCashModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="w-full max-w-sm">
            <TouchableOpacity activeOpacity={1} className="rounded-2xl p-5 w-full" style={CARD_STYLE}>
              <Text className="text-base font-bold mb-3" style={{ color: UI.text }}>记录现金流水</Text>
              <Text className="text-xs mb-2" style={{ color: UI.subText }}>账户</Text>
              <View className="flex-row flex-wrap gap-2 mb-3">
                {accounts.map(account => (
                  <TouchableOpacity
                    key={account.id}
                    className="px-3 py-2 rounded-full"
                    style={{ backgroundColor: cashAccountId === account.id ? UI.primary : UI.primarySoft }}
                    onPress={() => setCashAccountId(account.id)}
                  >
                    <Text className="text-xs font-medium" style={{ color: cashAccountId === account.id ? '#fff' : UI.primary }}>{account.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text className="text-xs mb-2" style={{ color: UI.subText }}>类型</Text>
              <View className="flex-row gap-2 mb-3">
                {[
                  { key: 'deposit', label: '入金' },
                  { key: 'withdraw', label: '出金' },
                  { key: 'adjust', label: '调整' },
                ].map(item => (
                  <TouchableOpacity
                    key={item.key}
                    className="flex-1 py-2 rounded-full items-center"
                    style={{ backgroundColor: cashType === item.key ? UI.primary : UI.primarySoft }}
                    onPress={() => setCashType(item.key as CashFlowType)}
                  >
                    <Text className="text-xs font-medium" style={{ color: cashType === item.key ? '#fff' : UI.primary }}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                className="rounded-xl px-4 py-3 text-sm mb-3"
                style={{ backgroundColor: UI.input, color: UI.text, borderColor: UI.border, borderWidth: 1 }}
                placeholder="金额"
                placeholderTextColor={UI.muted}
                keyboardType="decimal-pad"
                value={cashAmount}
                onChangeText={setCashAmount}
              />
              <TextInput
                className="rounded-xl px-4 py-3 text-sm mb-3"
                style={{ backgroundColor: UI.input, color: UI.text, borderColor: UI.border, borderWidth: 1 }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={UI.muted}
                value={cashDate}
                onChangeText={setCashDate}
                autoCapitalize="none"
              />
              <TextInput
                className="rounded-xl px-4 py-3 text-sm mb-4"
                style={{ backgroundColor: UI.input, color: UI.text, borderColor: UI.border, borderWidth: 1 }}
                placeholder="备注"
                placeholderTextColor={UI.muted}
                value={cashNote}
                onChangeText={setCashNote}
              />
              <View className="flex-row gap-3">
                <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: UI.primarySoft }} onPress={() => setShowCashModal(false)}>
                  <Text className="text-sm font-medium" style={{ color: UI.primary }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: UI.primary }} onPress={handleAddCashFlow}>
                  <Text className="text-sm text-white font-semibold">确定</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showRestoreModal} transparent animationType="fade" onRequestClose={() => setShowRestoreModal(false)}>
        <TouchableOpacity className="flex-1 bg-black/60 items-center justify-center p-6" activeOpacity={1} onPress={() => setShowRestoreModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="w-full max-w-sm">
            <TouchableOpacity activeOpacity={1} className="rounded-2xl p-5 w-full" style={CARD_STYLE}>
              <Text className="text-base font-bold mb-2" style={{ color: UI.text }}>恢复 JSON 备份</Text>
              <Text className="text-xs mb-3" style={{ color: UI.subText }}>粘贴由“数据备份”导出的完整 JSON 内容</Text>
              <TextInput
                className="rounded-xl px-4 py-3 text-xs mb-4"
                style={{ backgroundColor: UI.input, color: UI.text, borderColor: UI.border, borderWidth: 1, minHeight: 140, textAlignVertical: 'top' }}
                placeholder="粘贴备份 JSON"
                placeholderTextColor={UI.muted}
                value={restoreText}
                onChangeText={setRestoreText}
                multiline
              />
              <View className="flex-row gap-3">
                <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: UI.primarySoft }} onPress={() => setShowRestoreModal(false)}>
                  <Text className="text-sm font-medium" style={{ color: UI.primary }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity className="flex-1 py-2.5 rounded-xl items-center" style={{ backgroundColor: '#EF4444' }} onPress={handleRestoreBackup}>
                  <Text className="text-sm text-white font-semibold">恢复</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
    </Screen>
  );
}
