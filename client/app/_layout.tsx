import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import Toast from 'react-native-toast-message';
import { Provider } from '@/components/Provider';

import '../global.css';

LogBox.ignoreLogs([
  "TurboModuleRegistry.getEnforcing(...): 'RNMapsAirModule' could not be found",
  "expo-sqlite requires a migration to a new API",
]);

export default function RootLayout() {
  return (
    <Provider>
      <Stack
        screenOptions={{
          animation: 'slide_from_right',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          headerShown: false
        }}
      >
        <Stack.Screen name="(tabs)" options={{ title: "" }} />
        <Stack.Screen name="add-holding" options={{ title: "新增持仓", presentation: 'modal' }} />
        <Stack.Screen name="add-transaction" options={{ title: "记交易", presentation: 'modal' }} />
        <Stack.Screen name="add-dca" options={{ title: "新建定投", presentation: 'modal' }} />
        <Stack.Screen name="instrument-detail" options={{ title: "标的详情" }} />
        <Stack.Screen name="dca-detail" options={{ title: "定投详情" }} />
        <Stack.Screen name="search-quote" options={{ title: "搜索标的" }} />
      </Stack>
      <Toast />
    </Provider>
  );
}
