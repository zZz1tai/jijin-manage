// 设置管理
import { getDB } from './index';

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const db = await getDB();
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const db = await getDB();
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  return result;
}

export const SETTING_KEYS = {
  COST_METHOD: 'cost_method',
  RED_GREEN_REVERSED: 'red_green_reversed',
  THOUSAND_SEPARATOR: 'thousand_separator',
  THEME_MODE: 'theme_mode',
  SHOW_THOUSAND: 'show_thousand',
  APP_LOCK_ENABLED: 'app_lock_enabled',
  QUOTE_AUTO_REFRESH: 'quote_auto_refresh',
} as const;
