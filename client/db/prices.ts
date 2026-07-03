// 行情历史价格 & 行情API DAO
import { getDB } from './index';
import type { PriceHistory } from './types';

export async function savePriceHistory(
  instrumentId: number,
  items: Omit<PriceHistory, 'id' | 'instrument_id'>[]
) {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO price_history (instrument_id, trade_date, open, close, high, low, volume, change_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [instrumentId, item.trade_date, item.open ?? null, item.close, item.high ?? null, item.low ?? null, item.volume ?? null, item.change_pct ?? null]
      );
    }
  });
}

export async function getPriceHistory(
  instrumentId: number,
  startDate?: string,
  endDate?: string
): Promise<PriceHistory[]> {
  const db = await getDB();
  const where = ['instrument_id = ?'];
  const values: any[] = [instrumentId];
  if (startDate) { where.push('trade_date >= ?'); values.push(startDate); }
  if (endDate) { where.push('trade_date <= ?'); values.push(endDate); }
  return await db.getAllAsync<PriceHistory>(
    `SELECT * FROM price_history WHERE ${where.join(' AND ')} ORDER BY trade_date ASC`,
    values
  );
}

export async function getLatestPriceFromHistory(instrumentId: number): Promise<PriceHistory | null> {
  const db = await getDB();
  return await db.getFirstAsync<PriceHistory>(
    'SELECT * FROM price_history WHERE instrument_id = ? ORDER BY trade_date DESC LIMIT 1',
    [instrumentId]
  );
}

export async function getPriceOnDate(instrumentId: number, date: string): Promise<number | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ close: number }>(
    'SELECT close FROM price_history WHERE instrument_id = ? AND trade_date <= ? ORDER BY trade_date DESC LIMIT 1',
    [instrumentId, date]
  );
  return row?.close ?? null;
}
