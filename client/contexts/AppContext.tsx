// 全局 Context：数据库加载状态、持仓刷新触发器、设置
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { getDB } from '@/db';
import { syncConfirmedDcaExecutions } from '@/db/dca';
import { getAllSettings, setSetting as dbSetSetting } from '@/db/settings';

interface AppContextType {
  isReady: boolean;
  settings: Record<string, string>;
  refreshTrigger: number;
  triggerRefresh: () => void;
  updateSetting: (key: string, value: string) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};
// eslint-disable-next-line @typescript-eslint/no-empty-function
const noopAsync = async () => {};

const AppContext = createContext<AppContextType>({
  isReady: false,
  settings: {},
  refreshTrigger: 0,
  triggerRefresh: noop,
  updateSetting: noopAsync,
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    (async () => {
      await getDB();
      await syncConfirmedDcaExecutions();
      const s = await getAllSettings();
      setSettings(s);
      setIsReady(true);
    })();
  }, []);

  const triggerRefresh = useCallback(() => {
    setRefreshTrigger(t => t + 1);
  }, []);

  const updateSetting = useCallback(async (key: string, value: string) => {
    await dbSetSetting(key, value);
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  return (
    <AppContext.Provider value={{ isReady, settings, refreshTrigger, triggerRefresh, updateSetting }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
