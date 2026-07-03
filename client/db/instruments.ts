// 标的(Instrument) DAO
import { getDB } from './index';
import type { Instrument, InstrumentType } from './types';

export function normalizeInstrumentCode(code: string): string {
  const raw = code.trim().replace(/\s+/g, '').toUpperCase();
  if (/^\d+\.[A-Z0-9._-]+$/.test(raw)) return raw;
  const dotted = raw.match(/(?:^|\.)(\d{6})$/)?.[1];
  if (dotted) return dotted;
  const prefixed = raw.match(/^(?:SH|SZ|BJ)(\d{6})$/)?.[1];
  return prefixed ?? raw;
}

export function isGeneratedInstrumentName(name: string | undefined | null, code: string): boolean {
  const normalizedCode = normalizeInstrumentCode(code);
  const normalizedName = String(name ?? '').trim();
  if (!normalizedName || normalizedName === normalizedCode) return true;
  return ['股票', 'A股', '港股', '美股', '海外股票', '指数', '场内基金', '场外基金'].some(label => normalizedName === `${label} ${normalizedCode}`);
}

export async function updateInstrumentMeta(
  id: number,
  data: Partial<Pick<Instrument, 'code' | 'name' | 'type' | 'group_name'>>
) {
  const db = await getDB();
  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    values.push(key === 'code' && typeof value === 'string' ? normalizeInstrumentCode(value) : value);
  }
  if (fields.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE instruments SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function addInstrument(
  code: string,
  name: string,
  type: InstrumentType = 'stock',
  groupName?: string
): Promise<number> {
  const db = await getDB();
  const normalizedCode = normalizeInstrumentCode(code);
  const normalizedName = name.trim() || normalizedCode;
  const existing = await db.getFirstAsync<Instrument>(
    'SELECT * FROM instruments WHERE code = ?',
    [normalizedCode]
  );
  if (existing) {
    const patch: Partial<Pick<Instrument, 'name' | 'type' | 'group_name'>> = {};
    if (normalizedName && normalizedName !== existing.name && isGeneratedInstrumentName(existing.name, normalizedCode)) {
      patch.name = normalizedName;
    }
    if (type && type !== existing.type) patch.type = type;
    if (groupName !== undefined && groupName !== existing.group_name) patch.group_name = groupName;
    await updateInstrumentMeta(existing.id, patch);
    return existing.id;
  }
  const res = await db.runAsync(
    'INSERT INTO instruments (code, name, type, group_name) VALUES (?, ?, ?, ?)',
    [normalizedCode, normalizedName, type, groupName ?? null]
  );
  return res.lastInsertRowId as number;
}

export async function updateInstrumentPrice(
  id: number,
  data: Partial<Pick<Instrument, 'latest_price' | 'prev_close' | 'change_pct' | 'high' | 'low' | 'open' | 'volume'>>
) {
  const db = await getDB();
  const fields: string[] = [];
  const values: any[] = [];
  for (const [k, v] of Object.entries(data)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  fields.push(`updated_at = datetime('now','localtime')`);
  values.push(id);
  await db.runAsync(
    `UPDATE instruments SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function getAllInstruments(): Promise<Instrument[]> {
  const db = await getDB();
  return await db.getAllAsync<Instrument>('SELECT * FROM instruments ORDER BY created_at DESC');
}

export async function getInstrumentsInPortfolio(): Promise<Instrument[]> {
  const db = await getDB();
  return await db.getAllAsync<Instrument>(`
    SELECT DISTINCT i.* FROM instruments i
    WHERE EXISTS (
      SELECT 1 FROM transactions t WHERE t.instrument_id = i.id
      AND t.type IN ('buy','sell','dividend_reinvest','split','merge','dca_buy')
    )
    ORDER BY i.created_at DESC
  `);
}

export async function getInstrumentById(id: number): Promise<Instrument | null> {
  const db = await getDB();
  return await db.getFirstAsync<Instrument>('SELECT * FROM instruments WHERE id = ?', [id]);
}

export async function getInstrumentByCode(code: string): Promise<Instrument | null> {
  const db = await getDB();
  return await db.getFirstAsync<Instrument>('SELECT * FROM instruments WHERE code = ?', [normalizeInstrumentCode(code)]);
}

export async function deleteInstrument(id: number) {
  const db = await getDB();
  await db.runAsync('DELETE FROM instruments WHERE id = ?', [id]);
}

export async function searchInstruments(keyword: string): Promise<Instrument[]> {
  const db = await getDB();
  return await db.getAllAsync<Instrument>(
    `SELECT * FROM instruments WHERE code LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 50`,
    [`%${keyword}%`, `%${keyword}%`]
  );
}

export async function updateInstrumentGroup(id: number, groupName: string | null) {
  const db = await getDB();
  await db.runAsync('UPDATE instruments SET group_name = ? WHERE id = ?', [groupName, id]);
}
