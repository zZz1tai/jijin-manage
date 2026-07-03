import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

type RunResult = { lastInsertRowId: number; changes: number };
type WebTableName =
  | 'accounts'
  | 'alerts'
  | 'cash_flows'
  | 'daily_snapshots'
  | 'dca_executions'
  | 'dca_plans'
  | 'instruments'
  | 'price_alerts'
  | 'price_history'
  | 'settings'
  | 'transactions';
type WebRow = Record<string, any>;
type WebSnapshot = {
  ids?: Partial<Record<WebTableName, number>>;
  tables?: Partial<Record<WebTableName, WebRow[]>>;
};
type WebDatabase = {
  execAsync: (source: string) => Promise<void>;
  runAsync: (source: string, ...params: any[]) => Promise<RunResult>;
  getFirstAsync: <T>(source: string, ...params: any[]) => Promise<T | null>;
  getAllAsync: <T>(source: string, ...params: any[]) => Promise<T[]>;
  withTransactionAsync: (task: () => Promise<void>) => Promise<void>;
};

let dbInstance: SQLiteDatabase | WebDatabase | null = null;
const WEB_DB_STORAGE_KEY = 'jijin_manage_web_db_v1';

export async function getDB(): Promise<SQLiteDatabase> {
  if (dbInstance) return dbInstance as SQLiteDatabase;
  if (Platform.OS === 'web') {
    dbInstance = createWebDatabase();
    await initSchema(dbInstance as SQLiteDatabase);
    return dbInstance as SQLiteDatabase;
  }

  const SQLite = await import('expo-sqlite');
  const databaseName = 'portfolio.db';
  dbInstance = await SQLite.openDatabaseAsync(databaseName);
  await initSchema(dbInstance as SQLiteDatabase);
  return dbInstance as SQLiteDatabase;
}

async function initSchema(db: SQLiteDatabase) {
  if (Platform.OS !== 'web') {
    await db.execAsync('PRAGMA journal_mode = WAL;');
  }

  await db.execAsync('PRAGMA foreign_keys = ON;');

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS instruments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'stock',
      group_name TEXT,
      latest_price REAL,
      prev_close REAL,
      change_pct REAL,
      high REAL,
      low REAL,
      open REAL,
      volume REAL,
      updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'broker',
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL,
      price REAL,
      quantity REAL,
      fee REAL DEFAULT 0,
      amount REAL,
      dividend_amount REAL,
      split_ratio REAL,
      trade_date TEXT NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS cash_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      flow_date TEXT NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS dca_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      fee_rate REAL DEFAULT 0,
      cycle TEXT NOT NULL,
      weekday INTEGER,
      monthday INTEGER,
      interval_days INTEGER,
      confirm_days INTEGER DEFAULT 1,
      first_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dca_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      transaction_id INTEGER,
      execute_date TEXT NOT NULL,
      confirm_date TEXT NOT NULL,
      nav REAL NOT NULL,
      amount REAL NOT NULL,
      fee REAL DEFAULT 0,
      shares REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (plan_id) REFERENCES dca_plans(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id INTEGER NOT NULL,
      trade_date TEXT NOT NULL,
      open REAL,
      close REAL NOT NULL,
      high REAL,
      low REAL,
      volume REAL,
      change_pct REAL,
      UNIQUE(instrument_id, trade_date),
      FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id INTEGER NOT NULL,
      alert_type TEXT NOT NULL,
      threshold REAL NOT NULL,
      enabled INTEGER DEFAULT 1,
      triggered INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_snapshots (
      date TEXT PRIMARY KEY,
      total_value REAL NOT NULL,
      total_cost REAL NOT NULL,
      total_pnl REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_tx_instrument ON transactions(instrument_id);
    CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(trade_date);
    CREATE INDEX IF NOT EXISTS idx_cash_account ON cash_flows(account_id);
    CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_flows(flow_date);
    CREATE INDEX IF NOT EXISTS idx_price_inst_date ON price_history(instrument_id, trade_date);
    CREATE INDEX IF NOT EXISTS idx_dca_plan ON dca_executions(plan_id);
  `);

  try {
    await db.execAsync('ALTER TABLE dca_executions ADD COLUMN transaction_id INTEGER;');
  } catch {}

  // 初始化默认账户
  const accountRow = await db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM accounts');
  if (!accountRow || accountRow.cnt === 0) {
    await db.runAsync('INSERT INTO accounts (name, type, note) VALUES (?, ?, ?)', ['默认账户', 'broker', '初始账户']);
  }

  // 初始化默认设置
  const defaults: Record<string, string> = {
    cost_method: 'avg',
    theme_mode: 'system',
    red_green_reversed: '0',
    thousand_separator: '1',
    decimal_places: '2',
    app_lock_enabled: '0',
    refresh_interval_min: '15',
  };
  for (const [k, v] of Object.entries(defaults)) {
    await db.runAsync(
      'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
      [k, v]
    );
  }
}

export async function resetDB() {
  const db = await getDB();
  await db.execAsync(`
    DROP TABLE IF EXISTS dca_executions;
    DROP TABLE IF EXISTS dca_plans;
    DROP TABLE IF EXISTS transactions;
    DROP TABLE IF EXISTS cash_flows;
    DROP TABLE IF EXISTS price_alerts;
    DROP TABLE IF EXISTS price_history;
    DROP TABLE IF EXISTS instruments;
    DROP TABLE IF EXISTS accounts;
    DROP TABLE IF EXISTS settings;
    DROP TABLE IF EXISTS daily_snapshots;
  `);
  dbInstance = null;
  await getDB();
}

function loadWebSnapshot(): WebSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(WEB_DB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WebSnapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveWebSnapshot(snapshot: WebSnapshot) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WEB_DB_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage can be unavailable or full in private browsing; keep the in-memory DB working.
  }
}

function createWebDatabase(): WebDatabase {
  const emptyTables = (): Record<WebTableName, WebRow[]> => ({
    accounts: [],
    alerts: [],
    cash_flows: [],
    daily_snapshots: [],
    dca_executions: [],
    dca_plans: [],
    instruments: [],
    price_alerts: [],
    price_history: [],
    settings: [],
    transactions: [],
  });
  const snapshot = loadWebSnapshot();
  const tables = emptyTables();
  for (const table of Object.keys(tables) as WebTableName[]) {
    const rows = snapshot?.tables?.[table];
    if (Array.isArray(rows)) tables[table] = rows.map(row => ({ ...row }));
  }
  const ids: Partial<Record<WebTableName, number>> = {};
  for (const table of Object.keys(tables) as WebTableName[]) {
    const savedId = snapshot?.ids?.[table];
    const maxRowId = tables[table].reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
    ids[table] = Math.max(Number(savedId) || 0, maxRowId);
  }

  const persist = () => saveWebSnapshot({ tables, ids });

  const normalize = (source: string) => source.replace(/\s+/g, ' ').trim();
  const readParams = (params: any[]) => {
    while (params.length === 1 && Array.isArray(params[0])) {
      params = params[0];
    }
    return params;
  };
  const cloneRows = <T>(rows: WebRow[]): T[] => rows.map(row => ({ ...row })) as T[];
  const nextId = (table: WebTableName) => {
    ids[table] = (ids[table] ?? 0) + 1;
    return ids[table];
  };
  const getTableName = (source: string): WebTableName | null => {
    const lower = source.toLowerCase();
    for (const table of Object.keys(tables) as WebTableName[]) {
      if (
        lower.includes(` from ${table}`) ||
        lower.includes(` into ${table}`) ||
        lower.includes(` update ${table}`) ||
        lower.startsWith(`update ${table}`) ||
        lower.includes(`delete from ${table}`)
      ) {
        return table;
      }
    }
    return null;
  };
  const findById = (table: WebTableName, id: number) => tables[table].find(row => row.id === id);
  const applyAssignments = (row: WebRow, setClause: string, params: any[]) => {
    let paramIndex = 0;
    for (const assignment of setClause.split(',')) {
      const [rawColumn, ...rawExprParts] = assignment.split('=');
      const column = rawColumn?.trim();
      const expr = rawExprParts.join('=').trim();
      if (!column || !expr) continue;
      if (expr === '?') {
        row[column] = params[paramIndex++];
      } else if (/^'.*'$/.test(expr)) {
        row[column] = expr.slice(1, -1);
      } else if (expr.toLowerCase().startsWith('datetime(')) {
        row[column] = new Date().toISOString();
      } else {
        const numeric = Number(expr);
        row[column] = Number.isFinite(numeric) ? numeric : expr;
      }
    }
  };

  const insertRow = (table: WebTableName, row: WebRow) => {
    if (!('created_at' in row)) row.created_at = new Date().toISOString();
    if (table !== 'settings' && table !== 'daily_snapshots' && row.id == null) {
      row.id = nextId(table);
    } else if (table !== 'settings' && table !== 'daily_snapshots' && row.id != null) {
      ids[table] = Math.max(ids[table] ?? 0, Number(row.id) || 0);
    }
    tables[table].push(row);
    return row;
  };

  return {
    async execAsync(source: string) {
      const sql = normalize(source).toLowerCase();
      if (!sql.includes('drop table')) return;
      for (const table of Object.keys(tables) as WebTableName[]) {
        tables[table] = [];
        ids[table] = 0;
      }
      persist();
    },

    async runAsync(source: string, ...rawParams: any[]) {
      const params = readParams(rawParams);
      const sql = normalize(source);
      const lower = sql.toLowerCase();
      const table = getTableName(sql);

      if (lower.startsWith('insert') && table) {
        if (table === 'settings') {
          const [key, value] = params;
          const existing = tables.settings.find(row => row.key === key);
          if (existing) {
            if (!lower.startsWith('insert or ignore')) {
              existing.value = value;
              persist();
              return { lastInsertRowId: 0, changes: 1 };
            }
            return { lastInsertRowId: 0, changes: 0 };
          }
          insertRow('settings', { key, value });
          persist();
          return { lastInsertRowId: 0, changes: 1 };
        }

        if (table === 'daily_snapshots') {
          const [date, total_value, total_cost, total_pnl] = params;
          const existing = tables.daily_snapshots.find(row => row.date === date);
          const row = { date, total_value, total_cost, total_pnl, created_at: new Date().toISOString() };
          if (existing) Object.assign(existing, row);
          else insertRow('daily_snapshots', row);
          persist();
          return { lastInsertRowId: 0, changes: 1 };
        }

        const columns = sql.match(/\(([^)]+)\)\s*values/i)?.[1]
          .split(',')
          .map(col => col.trim())
          ?? [];
        const row: WebRow = {};
        columns.forEach((column, index) => {
          row[column] = params[index] ?? null;
        });

        if (table === 'accounts') {
          row.name ??= params[0] ?? '默认账户';
          row.type ??= params[1] ?? 'broker';
          row.note ??= params[2] ?? null;
        }
        if (table === 'instruments') {
          row.latest_price ??= null;
          row.prev_close ??= null;
          row.change_pct ??= null;
        }
        if (table === 'dca_plans' && lower.includes("'active'")) {
          row.status = 'active';
        }

        if (lower.startsWith('insert or replace')) {
          const existingIndex = table === 'price_history'
            ? tables.price_history.findIndex(item =>
              item.instrument_id === row.instrument_id && item.trade_date === row.trade_date
            )
            : row.id == null
              ? -1
              : tables[table].findIndex(item => item.id === row.id);
          if (existingIndex >= 0) {
            tables[table][existingIndex] = { ...tables[table][existingIndex], ...row };
            persist();
            return { lastInsertRowId: tables[table][existingIndex].id ?? 0, changes: 1 };
          }
        }

        const inserted = insertRow(table, row);
        persist();
        return { lastInsertRowId: inserted.id ?? 0, changes: 1 };
      }

      if (lower.startsWith('update') && table) {
        const setIndex = lower.indexOf(' set ');
        const whereIndex = lower.indexOf(' where ');
        const setClause = setIndex >= 0 && whereIndex > setIndex ? sql.slice(setIndex + 5, whereIndex) : '';
        let rows: WebRow[] = [];
        if (/\bwhere\s+id\s*=\s*\?/.test(lower)) {
          const id = Number(params[params.length - 1]);
          const row = findById(table, id);
          rows = row ? [row] : [];
        } else if (lower.includes('where account_id = ?')) {
          const accountId = Number(params[params.length - 1]);
          rows = tables[table].filter(row => row.account_id === accountId);
        } else if (lower.includes('where key = ?') && table === 'settings') {
          rows = tables.settings.filter(row => row.key === params[params.length - 1]);
        }

        for (const row of rows) {
          applyAssignments(row, setClause, params);
        }
        if (rows.length > 0) persist();
        return { lastInsertRowId: 0, changes: rows.length };
      }

      if (lower.startsWith('delete') && table) {
        const id = Number(params[0]);
        if (table === 'instruments') {
          const planIds = tables.dca_plans
            .filter(row => row.instrument_id === id)
            .map(row => row.id);
          tables.transactions = tables.transactions.filter(row => row.instrument_id !== id);
          tables.price_history = tables.price_history.filter(row => row.instrument_id !== id);
          tables.price_alerts = tables.price_alerts.filter(row => row.instrument_id !== id);
          tables.dca_plans = tables.dca_plans.filter(row => row.instrument_id !== id);
          tables.dca_executions = tables.dca_executions.filter(row => !planIds.includes(row.plan_id));
        } else if (table === 'dca_plans') {
          tables.dca_executions = tables.dca_executions.filter(row => row.plan_id !== id);
        }
        const before = tables[table].length;
        tables[table] = tables[table].filter(row => row.id !== id);
        if (before !== tables[table].length || table === 'instruments') persist();
        return { lastInsertRowId: 0, changes: before - tables[table].length };
      }

      return { lastInsertRowId: 0, changes: 0 };
    },

    async getFirstAsync<T>(source: string, ...rawParams: any[]) {
      const params = readParams(rawParams);
      const sql = normalize(source);
      const lower = sql.toLowerCase();

      if (lower.includes('count(*)') && lower.includes('from accounts')) {
        const key = lower.includes(' as cnt') ? 'cnt' : 'c';
        return { [key]: tables.accounts.length } as T;
      }

      if (lower.includes('max(execute_date)')) {
        const planId = params[0];
        const dates = tables.dca_executions
          .filter(row => row.plan_id === planId)
          .map(row => row.execute_date)
          .filter(Boolean)
          .sort();
        return { dt: dates.at(-1) ?? null } as T;
      }

      if (lower.includes('select value from settings')) {
        const row = tables.settings.find(item => item.key === params[0]);
        return (row ? { value: row.value } : null) as T | null;
      }

      if (lower.includes('select id from instruments where code')) {
        const row = tables.instruments.find(item => item.code === params[0]);
        return (row ? { id: row.id } : null) as T | null;
      }

      if (lower.includes('select latest_price from instruments where id')) {
        const row = findById('instruments', Number(params[0]));
        return (row ? { latest_price: row.latest_price } : null) as T | null;
      }

      const rows = await this.getAllAsync<T>(source, params);
      return rows[0] ?? null;
    },

    async getAllAsync<T>(source: string, ...rawParams: any[]) {
      const params = readParams(rawParams);
      const sql = normalize(source);
      const lower = sql.toLowerCase();
      const table = getTableName(sql);

      if (!table) return [];

      let rows = [...tables[table]];
      if (table === 'settings') return cloneRows<T>(rows);
      if (table === 'instruments' && lower.includes('where exists') && lower.includes('from transactions')) {
        const heldInstrumentIds = new Set(
          tables.transactions
            .filter(row => ['buy', 'sell', 'dividend_reinvest', 'split', 'merge', 'dca_buy'].includes(String(row.type)))
            .map(row => row.instrument_id)
        );
        rows = rows.filter(row => heldInstrumentIds.has(row.id));
      } else if (/\bwhere\s+id\s*=\s*\?/.test(lower)) {
        rows = rows.filter(row => row.id === Number(params[0]));
      } else if (/\bwhere\s+id\s*!=\s*\?/.test(lower)) {
        rows = rows.filter(row => row.id !== Number(params[0]));
      } else if (table === 'instruments' && lower.includes('where code = ?')) {
        rows = rows.filter(row => row.code === params[0]);
      } else if (table === 'instruments' && lower.includes('like ?')) {
        const keyword = String(params[0] ?? '').replace(/%/g, '').toLowerCase();
        rows = rows.filter(row =>
          String(row.code ?? '').toLowerCase().includes(keyword) ||
          String(row.name ?? '').toLowerCase().includes(keyword)
        );
      } else if (table === 'transactions') {
        let whereClause = '';
        const whereIndex = lower.indexOf(' where ');
        if (whereIndex >= 0) {
          whereClause = lower.slice(whereIndex + 7);
          const orderIndex = whereClause.indexOf(' order by ');
          const limitIndex = whereClause.indexOf(' limit ');
          const endIndexes = [orderIndex, limitIndex].filter(index => index >= 0);
          if (endIndexes.length > 0) {
            whereClause = whereClause.slice(0, Math.min(...endIndexes));
          }
        }
        const conditions = whereClause.split(/\s+and\s+/).map(condition => condition.trim()).filter(Boolean);
        let paramIndex = 0;
        for (const condition of conditions) {
          const compactCondition = condition.replace(/\s+/g, '');
          if (compactCondition === 'instrument_id=?') {
            const instrumentId = Number(params[paramIndex++]);
            rows = rows.filter(row => Number(row.instrument_id) === instrumentId);
          } else if (compactCondition === 'account_id=?') {
            const accountId = Number(params[paramIndex++]);
            rows = rows.filter(row => Number(row.account_id) === accountId);
          } else if (compactCondition === 'type=?') {
            const type = params[paramIndex++];
            rows = rows.filter(row => row.type === type);
          } else if (compactCondition === 'note=?') {
            const note = params[paramIndex++];
            rows = rows.filter(row => row.note === note);
          } else if (compactCondition === 'trade_date>=?') {
            const startDate = String(params[paramIndex++] ?? '');
            rows = rows.filter(row => String(row.trade_date ?? '') >= startDate);
          } else if (compactCondition === 'trade_date<=?') {
            const endDate = String(params[paramIndex++] ?? '');
            rows = rows.filter(row => String(row.trade_date ?? '') <= endDate);
          }
        }
      } else if (table === 'cash_flows' && lower.includes('where account_id = ?')) {
        rows = rows.filter(row => row.account_id === params[0]);
      } else if (table === 'dca_executions' && lower.includes('where plan_id = ?')) {
        rows = rows.filter(row => row.plan_id === params[0]);
      } else if (table === 'price_alerts' && lower.includes('where enabled = 1')) {
        rows = rows.filter(row => row.enabled === 1);
      } else if (table === 'price_history' && lower.includes('where instrument_id = ?')) {
        rows = rows.filter(row => row.instrument_id === params[0]);
        let dateParamIndex = 1;
        if (lower.includes('trade_date >= ?')) {
          const startDate = String(params[dateParamIndex++] ?? '');
          rows = rows.filter(row => String(row.trade_date ?? '') >= startDate);
        }
        if (lower.includes('trade_date <= ?')) {
          const endDate = String(params[dateParamIndex++] ?? '');
          rows = rows.filter(row => String(row.trade_date ?? '') <= endDate);
        }
      }

      if (lower.includes('order by created_at desc')) {
        rows.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
      } else if (lower.includes('order by trade_date desc')) {
        rows.sort((a, b) => String(b.trade_date ?? '').localeCompare(String(a.trade_date ?? '')) || (b.id ?? 0) - (a.id ?? 0));
      } else if (lower.includes('order by execute_date desc')) {
        rows.sort((a, b) => String(b.execute_date ?? '').localeCompare(String(a.execute_date ?? '')) || (b.id ?? 0) - (a.id ?? 0));
      } else if (lower.includes('order by flow_date desc')) {
        rows.sort((a, b) => String(b.flow_date ?? '').localeCompare(String(a.flow_date ?? '')) || (b.id ?? 0) - (a.id ?? 0));
      } else if (lower.includes('order by id')) {
        rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      } else if (lower.includes('order by date asc')) {
        rows.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
      } else if (lower.includes('order by trade_date asc')) {
        rows.sort((a, b) => String(a.trade_date ?? '').localeCompare(String(b.trade_date ?? '')) || (a.id ?? 0) - (b.id ?? 0));
      }

      const limitMatch = lower.match(/\blimit\s+(\d+)/);
      if (limitMatch) {
        rows = rows.slice(0, Number(limitMatch[1]));
      }

      return cloneRows<T>(rows);
    },

    async withTransactionAsync(task: () => Promise<void>) {
      await task();
    },
  };
}
