// 定投计划 DAO
import { getDB } from './index';
import type { DcaPlan, DcaExecution, DcaCycle, DcaStatus } from './types';
import { addTransaction } from './transactions';

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10000) / 10000;

function dateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dcaTransactionNote(executionId: number, planName: string): string {
  return `[DCA_EXECUTION:${executionId}] ${planName}`;
}

export interface CreateDcaParams {
  instrument_id: number;
  account_id: number;
  name: string;
  amount: number;
  fee_rate?: number;
  cycle: DcaCycle;
  weekday?: number;
  monthday?: number;
  interval_days?: number;
  confirm_days?: number;
  first_date: string;
}

export async function createDcaPlan(p: CreateDcaParams): Promise<number> {
  const db = await getDB();
  const res = await db.runAsync(
    `INSERT INTO dca_plans
     (instrument_id, account_id, name, amount, fee_rate, cycle, weekday, monthday, interval_days, confirm_days, first_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [
      p.instrument_id, p.account_id, p.name, p.amount, p.fee_rate ?? 0,
      p.cycle, p.weekday ?? null, p.monthday ?? null, p.interval_days ?? null,
      p.confirm_days ?? 1, p.first_date,
    ]
  );
  return res.lastInsertRowId as number;
}

export async function updateDcaPlan(id: number, p: Partial<CreateDcaParams>) {
  const db = await getDB();
  const fields: string[] = [];
  const values: any[] = [];
  const cols = ['instrument_id','account_id','name','amount','fee_rate','cycle','weekday','monthday','interval_days','confirm_days','first_date'];
  for (const c of cols) {
    if (c in p) {
      fields.push(`${c} = ?`);
      values.push((p as any)[c] ?? null);
    }
  }
  if (!fields.length) return;
  values.push(id);
  await db.runAsync(`UPDATE dca_plans SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function setDcaStatus(id: number, status: DcaStatus) {
  const db = await getDB();
  await db.runAsync('UPDATE dca_plans SET status = ? WHERE id = ?', [status, id]);
}

export async function deleteDcaPlan(id: number) {
  const db = await getDB();
  const executions = await getDcaExecutions(id);
  for (const execution of executions) {
    if (execution.transaction_id) {
      await db.runAsync('DELETE FROM transactions WHERE id = ?', [execution.transaction_id]);
    }
  }
  await db.runAsync('DELETE FROM dca_plans WHERE id = ?', [id]);
}

export async function getAllDcaPlans(): Promise<DcaPlan[]> {
  const db = await getDB();
  return await db.getAllAsync<DcaPlan>('SELECT * FROM dca_plans ORDER BY created_at DESC');
}

export async function getDcaPlanById(id: number): Promise<DcaPlan | null> {
  const db = await getDB();
  return await db.getFirstAsync<DcaPlan>('SELECT * FROM dca_plans WHERE id = ?', [id]);
}

export async function getDcaExecutions(planId: number): Promise<DcaExecution[]> {
  const db = await getDB();
  return await db.getAllAsync<DcaExecution>(
    'SELECT * FROM dca_executions WHERE plan_id = ? ORDER BY execute_date DESC',
    [planId]
  );
}

export async function addDcaExecution(e: Omit<DcaExecution, 'id' | 'created_at'>): Promise<number> {
  const db = await getDB();
  const res = await db.runAsync(
    `INSERT INTO dca_executions (plan_id, transaction_id, execute_date, confirm_date, nav, amount, fee, shares, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.plan_id, e.transaction_id ?? null, e.execute_date, e.confirm_date, e.nav, e.amount, e.fee, e.shares, e.status]
  );
  const id = res.lastInsertRowId as number;
  if (e.status === 'confirmed') {
    await syncDcaExecutionToTransaction(id);
  }
  return id;
}

export async function confirmDcaExecution(id: number) {
  const db = await getDB();
  await db.runAsync(`UPDATE dca_executions SET status = 'confirmed' WHERE id = ?`, [id]);
  await syncDcaExecutionToTransaction(id);
}

export async function syncDcaExecutionToTransaction(executionId: number): Promise<number | null> {
  const db = await getDB();
  const execution = await db.getFirstAsync<DcaExecution>(
    'SELECT * FROM dca_executions WHERE id = ?',
    [executionId]
  );
  if (!execution || execution.status !== 'confirmed') return null;
  if (execution.transaction_id) return execution.transaction_id;

  const plan = await getDcaPlanById(execution.plan_id);
  if (!plan) return null;

  const note = dcaTransactionNote(execution.id, plan.name);
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM transactions WHERE note = ?',
    [note]
  );
  if (existing?.id) {
    await db.runAsync('UPDATE dca_executions SET transaction_id = ? WHERE id = ?', [existing.id, execution.id]);
    return existing.id;
  }

  const txId = await addTransaction({
    instrument_id: plan.instrument_id,
    account_id: plan.account_id,
    type: 'dca_buy',
    price: execution.nav,
    quantity: execution.shares,
    fee: execution.fee,
    amount: execution.amount - execution.fee,
    trade_date: execution.execute_date,
    note,
  });
  await db.runAsync('UPDATE dca_executions SET transaction_id = ? WHERE id = ?', [txId, execution.id]);
  return txId;
}

export async function syncDcaPlanTransactions(planId: number): Promise<number> {
  const executions = await getDcaExecutions(planId);
  let synced = 0;
  for (const execution of executions) {
    if (execution.status === 'confirmed' && !execution.transaction_id) {
      const txId = await syncDcaExecutionToTransaction(execution.id);
      if (txId) synced += 1;
    }
  }
  return synced;
}

export async function syncConfirmedDcaExecutions(): Promise<number> {
  const plans = await getAllDcaPlans();
  let synced = 0;
  for (const plan of plans) {
    synced += await syncDcaPlanTransactions(plan.id);
  }
  return synced;
}

// 执行下一期定投：按计划生成扣款记录，并在确认后同步为交易流水。
export async function executeNextDca(
  planId: number,
  options: { confirmImmediately?: boolean } = {}
): Promise<boolean> {
  const plan = await getDcaPlanById(planId);
  if (!plan || plan.status !== 'active') return false;
  // 找下一个未执行的日期：找计划中已存在 executions 的最大日期，否则从 first_date 开始
  const db = await getDB();
  const last = await db.getFirstAsync<{ dt: string }>(
    'SELECT MAX(execute_date) as dt FROM dca_executions WHERE plan_id = ?', [planId]
  );
  let nextDate: Date;
  if (last?.dt) {
    nextDate = parseLocalDate(last.dt);
    if (plan.cycle === 'daily') nextDate.setDate(nextDate.getDate() + 1);
    else if (plan.cycle === 'weekly' && plan.weekday != null) {
      nextDate.setDate(nextDate.getDate() + 1);
      // 找到下一个对应 weekday: weekday 1=周一 ... 7=周日
      while (nextDate.getDay() !== (plan.weekday % 7)) nextDate.setDate(nextDate.getDate() + 1);
    } else if (plan.cycle === 'monthly' && plan.monthday != null) {
      nextDate.setMonth(nextDate.getMonth() + 1);
      const y = nextDate.getFullYear(), m = nextDate.getMonth();
      const lastDay = new Date(y, m + 1, 0).getDate();
      nextDate.setDate(Math.min(plan.monthday, lastDay));
    } else if (plan.cycle === 'custom_days' && plan.interval_days) {
      nextDate.setDate(nextDate.getDate() + plan.interval_days);
    } else {
      nextDate.setDate(nextDate.getDate() + 1);
    }
  } else {
    nextDate = parseLocalDate(plan.first_date);
  }
  // 不允许未来日期
  const today = new Date(); today.setHours(0,0,0,0);
  if (nextDate > today) return false;

  // 获取标的最新价
  const inst = await db.getFirstAsync<{ latest_price: number }>(
    'SELECT latest_price FROM instruments WHERE id = ?', [plan.instrument_id]
  );
  const latestPrice = inst?.latest_price ?? 0;
  const nav = latestPrice > 0 ? latestPrice : 1;
  const fee = round2(plan.amount * (plan.fee_rate ?? 0));
  const investAmount = plan.amount - fee;
  const shares = round4(investAmount / nav);
  const confirmDate = new Date(nextDate);
  confirmDate.setDate(confirmDate.getDate() + (plan.confirm_days ?? 1));
  const execute_date = dateString(nextDate);
  const confirm_date = dateString(confirmDate);
  const status = options.confirmImmediately || confirm_date <= dateString(today) ? 'confirmed' : 'pending';
  await addDcaExecution({
    plan_id: planId,
    execute_date,
    confirm_date,
    nav,
    amount: plan.amount,
    fee,
    shares,
    status,
  });
  return true;
}
