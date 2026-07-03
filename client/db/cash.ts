import { getDB } from './index';
import { getAllTransactions } from './transactions';
import type { CashFlow, CashFlowType, Transaction } from './types';

export interface AddCashFlowParams {
  account_id: number;
  type: CashFlowType;
  amount: number;
  flow_date: string;
  note?: string;
}

export async function addCashFlow(flow: AddCashFlowParams): Promise<number> {
  const db = await getDB();
  const res = await db.runAsync(
    'INSERT INTO cash_flows (account_id, type, amount, flow_date, note) VALUES (?, ?, ?, ?, ?)',
    [flow.account_id, flow.type, flow.amount, flow.flow_date, flow.note ?? null]
  );
  return res.lastInsertRowId as number;
}

export async function deleteCashFlow(id: number) {
  const db = await getDB();
  await db.runAsync('DELETE FROM cash_flows WHERE id = ?', [id]);
}

export async function getCashFlows(accountId?: number): Promise<CashFlow[]> {
  const db = await getDB();
  if (accountId) {
    return await db.getAllAsync<CashFlow>(
      'SELECT * FROM cash_flows WHERE account_id = ? ORDER BY flow_date DESC, id DESC',
      [accountId]
    );
  }
  return await db.getAllAsync<CashFlow>('SELECT * FROM cash_flows ORDER BY flow_date DESC, id DESC');
}

function transactionCashImpact(tx: Transaction): number {
  const gross = tx.amount ?? ((tx.price ?? 0) * (tx.quantity ?? 0));
  const fee = tx.fee ?? 0;
  if (tx.type === 'buy' || tx.type === 'dca_buy') return -(gross + fee);
  if (tx.type === 'sell') return gross - fee;
  if (tx.type === 'dividend_cash') return tx.dividend_amount ?? gross;
  return 0;
}

export async function computeAccountCashBalance(accountId: number): Promise<number> {
  const [flows, transactions] = await Promise.all([
    getCashFlows(accountId),
    getAllTransactions({ account_id: accountId }),
  ]);
  const manualCash = flows.reduce((sum, flow) => {
    if (flow.type === 'deposit') return sum + flow.amount;
    if (flow.type === 'withdraw') return sum - flow.amount;
    return sum + flow.amount;
  }, 0);
  const tradeCash = transactions.reduce((sum, tx) => sum + transactionCashImpact(tx), 0);
  return Math.round((manualCash + tradeCash) * 100) / 100;
}

export async function computeTotalCashBalance(): Promise<number> {
  const db = await getDB();
  const accounts = await db.getAllAsync<{ id: number }>('SELECT id FROM accounts ORDER BY id');
  let total = 0;
  for (const account of accounts) {
    total += await computeAccountCashBalance(account.id);
  }
  return Math.round(total * 100) / 100;
}
