// 交易流水 DAO
import { getDB } from './index';
import type { Transaction, TransactionType } from './types';

export interface AddTxParams {
  instrument_id: number;
  account_id: number;
  type: TransactionType;
  price?: number;
  quantity?: number;
  fee?: number;
  amount?: number;
  dividend_amount?: number;
  split_ratio?: number;
  trade_date: string;
  note?: string;
}

const DCA_EXECUTION_NOTE_PREFIX = '[DCA_EXECUTION:';

export function isDcaGeneratedTransaction(tx: Pick<Transaction, 'type' | 'note'>): boolean {
  return tx.type === 'dca_buy' && String(tx.note ?? '').startsWith(DCA_EXECUTION_NOTE_PREFIX);
}

export async function addTransaction(tx: AddTxParams): Promise<number> {
  const db = await getDB();
  const res = await db.runAsync(
    `INSERT INTO transactions
     (instrument_id, account_id, type, price, quantity, fee, amount, dividend_amount, split_ratio, trade_date, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tx.instrument_id,
      tx.account_id,
      tx.type,
      tx.price ?? null,
      tx.quantity ?? null,
      tx.fee ?? 0,
      tx.amount ?? null,
      tx.dividend_amount ?? null,
      tx.split_ratio ?? null,
      tx.trade_date,
      tx.note ?? null,
    ]
  );
  return res.lastInsertRowId as number;
}

export async function updateTransaction(id: number, tx: Partial<AddTxParams>) {
  const db = await getDB();
  const linkedExecution = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM dca_executions WHERE transaction_id = ?',
    [id]
  );
  if (linkedExecution) {
    throw new Error('定投自动生成的交易请在定投详情中管理');
  }
  const fields: string[] = [];
  const values: any[] = [];
  const fieldMap: Record<string, keyof AddTxParams> = {
    instrument_id: 'instrument_id', account_id: 'account_id', type: 'type',
    price: 'price', quantity: 'quantity', fee: 'fee', amount: 'amount',
    dividend_amount: 'dividend_amount', split_ratio: 'split_ratio',
    trade_date: 'trade_date', note: 'note',
  };
  for (const [col, key] of Object.entries(fieldMap)) {
    if (key in tx) {
      fields.push(`${col} = ?`);
      values.push((tx as any)[key] ?? null);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteTransaction(id: number) {
  const db = await getDB();
  await db.runAsync('DELETE FROM dca_executions WHERE transaction_id = ?', [id]);
  await db.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
}

export async function getTransactionById(id: number): Promise<Transaction | null> {
  const db = await getDB();
  return await db.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
}

export async function getTransactionsByInstrument(instrumentId: number): Promise<Transaction[]> {
  const db = await getDB();
  return await db.getAllAsync<Transaction>(
    `SELECT * FROM transactions WHERE instrument_id = ? ORDER BY trade_date ASC, id ASC`,
    [instrumentId]
  );
}

export async function getAllTransactions(filter?: {
  instrument_id?: number;
  account_id?: number;
  type?: TransactionType;
  start_date?: string;
  end_date?: string;
  limit?: number;
}): Promise<Transaction[]> {
  const db = await getDB();
  const where: string[] = [];
  const values: any[] = [];
  if (filter?.instrument_id) { where.push('instrument_id = ?'); values.push(filter.instrument_id); }
  if (filter?.account_id) { where.push('account_id = ?'); values.push(filter.account_id); }
  if (filter?.type) { where.push('type = ?'); values.push(filter.type); }
  if (filter?.start_date) { where.push('trade_date >= ?'); values.push(filter.start_date); }
  if (filter?.end_date) { where.push('trade_date <= ?'); values.push(filter.end_date); }
  const sql = `SELECT * FROM transactions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY trade_date DESC, id DESC ${filter?.limit ? 'LIMIT ' + filter.limit : ''}`;
  return await db.getAllAsync<Transaction>(sql, values);
}

export async function getBuyTransactionsForFIFO(instrumentId: number): Promise<Transaction[]> {
  const db = await getDB();
  return await db.getAllAsync<Transaction>(
    `SELECT * FROM transactions
     WHERE instrument_id = ? AND type IN ('buy','dca_buy','dividend_reinvest')
     ORDER BY trade_date ASC, id ASC`,
    [instrumentId]
  );
}
