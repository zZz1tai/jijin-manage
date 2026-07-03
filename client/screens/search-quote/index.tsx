import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useApp } from '@/contexts/AppContext';
import { addInstrument, getInstrumentByCode, updateInstrumentPrice } from '@/db/instruments';
import { searchInstrumentsRemote } from '@/db/quotes';
import type { InstrumentType } from '@/db/types';
import { getInstrumentTypeColor, getInstrumentTypeLabel } from '@/utils/instrument';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

const UI = {
  primary: '#1677FF',
  primarySoft: '#EAF3FF',
  card: '#FFFFFF',
  input: '#F7FAFF',
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

export default function SearchQuoteScreen() {
  const router = useSafeRouter();
  const { triggerRefresh } = useApp();
  const [kw, setKw] = useState('');
  const [results, setResults] = useState<{ code: string; name: string; type: InstrumentType; price?: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);

  const doSearch = async (keyword: string) => {
    setKw(keyword);
    if (keyword.length < 1) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await searchInstrumentsRemote(keyword);
      setResults(res);
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (code: string, name: string, type: InstrumentType, idx: number) => {
    setAddingId(idx);
    try {
      const wasExisting = Boolean(await getInstrumentByCode(code));
      const id = await addInstrument(code, name, type);
      if (itemPriceIsValid(results[idx]?.price)) {
        await updateInstrumentPrice(id, { latest_price: results[idx].price });
      }
      triggerRefresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: wasExisting ? 'info' : 'success', text1: wasExisting ? '已同步到自选' : '添加成功' });
      setTimeout(() => router.replace('/instrument-detail', { id }), 300);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: e?.message || '添加失败' });
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Screen safeAreaEdges={['top']}>
      <View className="flex-row items-center gap-3 px-4 py-3" style={{ backgroundColor: UI.card, borderBottomWidth: 1, borderBottomColor: UI.border }}>
        <TouchableOpacity onPress={() => router.back()}>
          <FontAwesome6 name="chevron-left" size={16} color={UI.subText} />
        </TouchableOpacity>
        <View className="flex-1 flex-row items-center rounded-2xl px-3 py-2" style={{ backgroundColor: UI.input, borderColor: UI.border, borderWidth: 1 }}>
          <FontAwesome6 name="magnifying-glass" size={14} color={UI.primary} />
          <TextInput
            className="flex-1 ml-2 text-sm"
            style={{ color: UI.text }}
            placeholder="输入代码/名称/拼音模糊搜索"
            placeholderTextColor={UI.muted}
            value={kw}
            onChangeText={doSearch}
            autoFocus
            autoCapitalize="none"
          />
          {kw ? (
            <TouchableOpacity onPress={() => { setKw(''); setResults([]); }}>
              <FontAwesome6 name="circle-xmark" size={14} color={UI.subText} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {searching ? (
        <View className="py-10 items-center">
          <ActivityIndicator color={UI.primary} />
        </View>
      ) : results.length === 0 && kw.length > 0 ? (
        <View className="py-10 items-center">
          <Text className="text-sm" style={{ color: UI.subText }}>未找到相关标的</Text>
        </View>
      ) : results.length === 0 ? (
        <View className="py-10 items-center px-8">
          <View className="w-16 h-16 rounded-2xl items-center justify-center" style={{ backgroundColor: UI.primarySoft }}>
            <FontAwesome6 name="magnifying-glass" size={30} color={UI.primary} />
          </View>
          <Text className="text-sm mt-3 font-medium" style={{ color: UI.text }}>输入股票/基金代码或名称搜索</Text>
          <Text className="text-xs mt-1" style={{ color: UI.subText }}>支持 A股、港股、美股、场内ETF、场外基金</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(_, i) => String(i)}
          contentContainerClassName="px-4 py-3"
          renderItem={({ item, index }) => {
            const typeLabel = getInstrumentTypeLabel(item.type);
            const typeColor = getInstrumentTypeColor(item.type);
            const isAdding = addingId === index;
            return (
              <TouchableOpacity
                className="flex-row items-center justify-between p-4 rounded-2xl mb-2"
                style={CARD_STYLE}
                activeOpacity={0.7}
                onPress={() => handleAdd(item.code, item.name, item.type, index)}
                disabled={isAdding}
              >
                <View className="flex-1">
                  <Text className="text-base font-medium" style={{ color: UI.text }}>{item.name}</Text>
                  <View className="flex-row items-center gap-2 mt-1">
                    <Text className="text-xs" style={{ color: UI.subText }}>{item.code}</Text>
                    <Text className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: `${typeColor}20`, color: typeColor }}>
                      {typeLabel}
                    </Text>
                  </View>
                </View>
                {isAdding ? (
                  <ActivityIndicator size="small" color={UI.primary} />
                ) : (
                  <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: UI.primarySoft }}>
                    <FontAwesome6 name="plus" size={14} color={UI.primary} />
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

function itemPriceIsValid(price: number | undefined): price is number {
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}
