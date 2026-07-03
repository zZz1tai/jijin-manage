// 价格预警 DAO
import { getDB } from './index';
import type { PriceAlert } from './types';

export type AlertType = 'price_above' | 'price_below' | 'rise_pct' | 'fall_pct';

export async function addAlert(instrumentId: number, alertType: AlertType, threshold: number): Promise<number> {
  const db = await getDB();
  const res = await db.runAsync(
    'INSERT INTO price_alerts (instrument_id, alert_type, threshold) VALUES (?, ?, ?)',
    [instrumentId, alertType, threshold]
  );
  return res.lastInsertRowId as number;
}

export async function getAlertsByInstrument(instrumentId: number): Promise<PriceAlert[]> {
  const db = await getDB();
  return await db.getAllAsync<PriceAlert>(
    'SELECT * FROM price_alerts WHERE instrument_id = ? ORDER BY created_at DESC',
    [instrumentId]
  );
}

export async function getAllEnabledAlerts(): Promise<PriceAlert[]> {
  const db = await getDB();
  return await db.getAllAsync<PriceAlert>('SELECT * FROM price_alerts WHERE enabled = 1');
}

export async function toggleAlert(id: number, enabled: boolean) {
  const db = await getDB();
  await db.runAsync('UPDATE price_alerts SET enabled = ?, triggered = 0 WHERE id = ?', [enabled ? 1 : 0, id]);
}

export async function markAlertTriggered(id: number) {
  const db = await getDB();
  await db.runAsync('UPDATE price_alerts SET triggered = 1 WHERE id = ?', [id]);
}

export async function deleteAlert(id: number) {
  const db = await getDB();
  await db.runAsync('DELETE FROM price_alerts WHERE id = ?', [id]);
}
