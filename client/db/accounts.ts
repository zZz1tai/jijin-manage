// 账户 DAO
import { getDB } from './index';
import type { Account } from './types';

export async function addAccount(name: string, type: Account['type'] = 'broker', note?: string): Promise<number> {
  const db = await getDB();
  const res = await db.runAsync(
    'INSERT INTO accounts (name, type, note) VALUES (?, ?, ?)',
    [name, type, note ?? null]
  );
  return res.lastInsertRowId as number;
}

export async function getAllAccounts(): Promise<Account[]> {
  const db = await getDB();
  return await db.getAllAsync<Account>('SELECT * FROM accounts ORDER BY id');
}

export async function getAccountById(id: number): Promise<Account | null> {
  const db = await getDB();
  return await db.getFirstAsync<Account>('SELECT * FROM accounts WHERE id = ?', [id]);
}

// createAccount 是 addAccount 的别名
export const createAccount = addAccount;

export async function getAccounts(): Promise<Account[]> {
  return getAllAccounts();
}

export async function getDefaultAccount(): Promise<Account> {
  const db = await getDB();
  const acc = await db.getFirstAsync<Account>('SELECT * FROM accounts ORDER BY id LIMIT 1');
  if (!acc) throw new Error('无默认账户');
  return acc;
}

export async function updateAccount(id: number, name: string, type: Account['type'], note?: string) {
  const db = await getDB();
  await db.runAsync('UPDATE accounts SET name = ?, type = ?, note = ? WHERE id = ?', [name, type, note ?? null, id]);
}

export async function deleteAccount(id: number) {
  const db = await getDB();
  // 不允许删除唯一账户
  const cnt = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) c FROM accounts');
  if (cnt && cnt.c <= 1) throw new Error('至少保留一个账户');
  // 将该账户交易迁移到默认账户
  const defaultAcc = await db.getFirstAsync<{ id: number }>('SELECT id FROM accounts WHERE id != ? ORDER BY id LIMIT 1', [id]);
  if (defaultAcc) {
    await db.runAsync('UPDATE transactions SET account_id = ? WHERE account_id = ?', [defaultAcc.id, id]);
    await db.runAsync('UPDATE dca_plans SET account_id = ? WHERE account_id = ?', [defaultAcc.id, id]);
    await db.runAsync('UPDATE cash_flows SET account_id = ? WHERE account_id = ?', [defaultAcc.id, id]);
  }
  await db.runAsync('DELETE FROM accounts WHERE id = ?', [id]);
}
