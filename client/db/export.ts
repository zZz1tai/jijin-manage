import { getDB, resetDB } from './index';

const TABLES = [
  'accounts',
  'instruments',
  'cash_flows',
  'transactions',
  'dca_plans',
  'dca_executions',
  'price_alerts',
  'price_history',
  'settings',
  'daily_snapshots',
] as const;

type TableName = typeof TABLES[number];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function exportBackupJson(): Promise<string> {
  const db = await getDB();
  const data: Record<TableName, any[]> = {} as Record<TableName, any[]>;
  for (const table of TABLES) {
    try {
      data[table] = await db.getAllAsync<any>(`SELECT * FROM ${table}`);
    } catch {
      data[table] = [];
    }
  }
  return JSON.stringify({
    app: 'jijin-manage',
    version: 1,
    exported_at: new Date().toISOString(),
    data,
  }, null, 2);
}

export async function exportTransactionsCsv(): Promise<string> {
  const db = await getDB();
  const [transactions, instruments, accounts] = await Promise.all([
    db.getAllAsync<any>('SELECT * FROM transactions ORDER BY trade_date DESC, id DESC'),
    db.getAllAsync<any>('SELECT * FROM instruments'),
    db.getAllAsync<any>('SELECT * FROM accounts'),
  ]);
  const instrumentMap = new Map(instruments.map(item => [item.id, item]));
  const accountMap = new Map(accounts.map(item => [item.id, item]));
  const rows = transactions.map(tx => ({
    ...tx,
    code: instrumentMap.get(tx.instrument_id)?.code ?? '',
    name: instrumentMap.get(tx.instrument_id)?.name ?? '',
    account_name: accountMap.get(tx.account_id)?.name ?? '',
  }));
  const headers = ['id', 'trade_date', 'type', 'code', 'name', 'account_name', 'price', 'quantity', 'fee', 'amount', 'dividend_amount', 'split_ratio', 'note'];
  return [
    headers.join(','),
    ...rows.map(row => headers.map(key => csvEscape(row[key])).join(',')),
  ].join('\n');
}

export async function importBackupJson(content: string): Promise<void> {
  const parsed = JSON.parse(content);
  const data = parsed?.data;
  if (!data || typeof data !== 'object') {
    throw new Error('备份格式不正确');
  }
  await resetDB();
  const db = await getDB();
  for (const table of TABLES) {
    const rows = Array.isArray(data[table]) ? data[table] : [];
    for (const row of rows) {
      const columns = Object.keys(row).filter(key => row[key] !== undefined);
      if (columns.length === 0) continue;
      const placeholders = columns.map(() => '?').join(', ');
      await db.runAsync(
        `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
        columns.map(key => row[key])
      );
    }
  }
}
