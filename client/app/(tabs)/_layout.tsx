import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { useCSSVariable } from 'uniwind';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const [background, muted, accent, border, surface] = useCSSVariable([
    '--color-background',
    '--color-muted',
    '--color-accent',
    '--color-border',
    '--color-surface',
  ]) as string[];

  let tabBarStyle = {
    backgroundColor: surface || background,
    borderTopWidth: 1,
    borderTopColor: border,
    paddingBottom: Math.max(insets.bottom, 10),
    paddingTop: 9,
    height: Platform.OS === 'web' ? 'auto' as const : 56 + Math.max(insets.bottom, 8),
    shadowColor: '#1677FF',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  };

  if (Platform.OS === 'web') {
    tabBarStyle = { ...tabBarStyle, height: 'auto' as const };
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle,
        tabBarActiveTintColor: accent || '#1677FF',
        tabBarInactiveTintColor: muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const },
        tabBarItemStyle: { minWidth: 0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '首页',
          tabBarIcon: ({ color }) => <FontAwesome6 name="house" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="holdings"
        options={{
          title: '持仓',
          tabBarIcon: ({ color }) => <FontAwesome6 name="briefcase" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="market"
        options={{
          title: '行情',
          tabBarIcon: ({ color }) => <FontAwesome6 name="chart-line" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="dca"
        options={{
          title: '定投',
          tabBarIcon: ({ color }) => <FontAwesome6 name="coins" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ color }) => <FontAwesome6 name="user" size={18} color={color} />,
        }}
      />
    </Tabs>
  );
}
