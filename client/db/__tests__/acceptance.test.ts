jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

import { addAccount, deleteAccount, getAllAccounts } from '../accounts';
import { addCashFlow, computeAccountCashBalance, computeTotalCashBalance } from '../cash';
import {
  computeAllPositions,
  computeDcaStats,
  computePortfolioSummary,
  computePositionForInstrument,
  getFullHoldings,
  recordDailySnapshot,
} from '../calculations';
import { createDcaPlan, deleteDcaPlan, executeNextDca, getDcaExecutions } from '../dca';
import { exportBackupJson, importBackupJson } from '../export';
import {
  addInstrument,
  getAllInstruments,
  getInstrumentById,
  getInstrumentsInPortfolio,
  updateInstrumentGroup,
  updateInstrumentPrice,
} from '../instruments';
import { getDB, resetDB } from '../index';
import { getPriceOnDate, savePriceHistory } from '../prices';
import { getSetting, setSetting } from '../settings';
import { addTransaction, deleteTransaction, getAllTransactions, updateTransaction } from '../transactions';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

const storage = new MemoryStorage();

Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
});

async function seedInstrument(code = '510300', name = '沪深300ETF') {
  const instrumentId = await addInstrument(code, name, 'fund_etf');
  await updateInstrumentPrice(instrumentId, {
    latest_price: 15,
    prev_close: 14,
    change_pct: 7.14,
  });
  const instrument = await getInstrumentById(instrumentId);
  if (!instrument) throw new Error('instrument seed failed');
  return instrument;
}

describe('portfolio acceptance data consistency', () => {
  beforeEach(async () => {
    storage.clear();
    await resetDB();
  });

  it('keeps account cash, transactions, holdings, and summary in one consistent ledger', async () => {
    const [account] = await getAllAccounts();
    const instrument = await seedInstrument();

    await addCashFlow({
      account_id: account.id,
      type: 'deposit',
      amount: 10000,
      flow_date: '2026-01-01',
    });
    await addTransaction({
      instrument_id: instrument.id,
      account_id: account.id,
      type: 'buy',
      price: 10,
      quantity: 100,
      fee: 5,
      amount: 1000,
      trade_date: '2026-01-02',
    });
    await addTransaction({
      instrument_id: instrument.id,
      account_id: account.id,
      type: 'sell',
      price: 12,
      quantity: 20,
      fee: 2,
      amount: 240,
      trade_date: '2026-01-03',
    });
    await addTransaction({
      instrument_id: instrument.id,
      account_id: account.id,
      type: 'dividend_cash',
      dividend_amount: 30,
      amount: 30,
      trade_date: '2026-01-04',
    });

    const position = await computePositionForInstrument(instrument, account.id);
    expect(position?.quantity).toBe(80);
    expect(position?.cost_amount).toBe(804);
    expect(position?.market_value).toBe(1200);
    expect(position?.floating_pnl).toBe(396);
    expect(position?.realized_pnl).toBe(67);
    expect(position?.total_pnl).toBe(463);

    await expect(computeAccountCashBalance(account.id)).resolves.toBe(9263);
    await expect(computeTotalCashBalance()).resolves.toBe(9263);

    const summary = await computePortfolioSummary(account.id);
    expect(summary.total_market_value).toBe(1200);
    expect(summary.cash_balance).toBe(9263);
    expect(summary.total_pnl).toBe(463);

    const holdings = await getFullHoldings();
    expect(holdings).toHaveLength(1);
    expect(holdings[0].instrument.id).toBe(instrument.id);
  });

  it('syncs confirmed DCA executions to transactions without double-counting fees', async () => {
    const [account] = await getAllAccounts();
    const instrument = await seedInstrument('161725', '白酒基金');
    await updateInstrumentPrice(instrument.id, { latest_price: 2, prev_close: 2 });
    await addCashFlow({
      account_id: account.id,
      type: 'deposit',
      amount: 2000,
      flow_date: '2026-01-01',
    });

    const planId = await createDcaPlan({
      instrument_id: instrument.id,
      account_id: account.id,
      name: '月定投',
      amount: 1000,
      fee_rate: 0.01,
      cycle: 'daily',
      confirm_days: 0,
      first_date: '2026-01-01',
    });
    await expect(executeNextDca(planId, { confirmImmediately: true })).resolves.toBe(true);

    const executions = await getDcaExecutions(planId);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('confirmed');
    expect(executions[0].fee).toBe(10);
    expect(executions[0].shares).toBe(495);

    const transactions = await getAllTransactions({ account_id: account.id, type: 'dca_buy' });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].amount).toBe(990);
    expect(transactions[0].fee).toBe(10);

    const stats = await computeDcaStats(planId, 2);
    expect(stats.total_invested).toBe(1000);
    expect(stats.total_shares).toBe(495);
    expect(stats.market_value).toBe(990);
    expect(stats.exec_count).toBe(1);

    const position = await computePositionForInstrument(instrument, account.id);
    expect(position?.quantity).toBe(495);
    expect(position?.cost_amount).toBe(1000);
    await expect(computeAccountCashBalance(account.id)).resolves.toBe(1000);

    await expect(updateTransaction(transactions[0].id, { price: 3 })).rejects.toThrow('定投自动生成');
    await deleteTransaction(transactions[0].id);
    await expect(getDcaExecutions(planId)).resolves.toHaveLength(0);
    await expect(getAllTransactions({ account_id: account.id, type: 'dca_buy' })).resolves.toHaveLength(0);
    await expect(computeAccountCashBalance(account.id)).resolves.toBe(2000);

    await deleteDcaPlan(planId);
  });

  it('keeps web database query behavior aligned for filters, portfolio instruments, history, and limits', async () => {
    const [defaultAccount] = await getAllAccounts();
    const secondAccountId = await addAccount('天天基金');
    const held = await seedInstrument('600519', '贵州茅台');
    const watchOnlyId = await addInstrument('000001', '平安银行', 'stock');

    await updateInstrumentGroup(watchOnlyId, '观察');
    await addTransaction({
      instrument_id: held.id,
      account_id: defaultAccount.id,
      type: 'buy',
      price: 10,
      quantity: 1,
      amount: 10,
      trade_date: '2026-01-01',
    });
    await addTransaction({
      instrument_id: held.id,
      account_id: secondAccountId,
      type: 'sell',
      price: 11,
      quantity: 1,
      amount: 11,
      trade_date: '2026-02-01',
    });
    await addTransaction({
      instrument_id: held.id,
      account_id: secondAccountId,
      type: 'buy',
      price: 12,
      quantity: 1,
      amount: 12,
      trade_date: '2026-03-01',
    });

    const filtered = await getAllTransactions({
      account_id: secondAccountId,
      type: 'buy',
      start_date: '2026-02-15',
      end_date: '2026-03-31',
      limit: 1,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].trade_date).toBe('2026-03-01');

    const portfolioInstruments = await getInstrumentsInPortfolio();
    expect(portfolioInstruments.map(item => item.id)).toEqual([held.id]);

    await savePriceHistory(held.id, [
      { trade_date: '2026-01-01', open: 10, close: 10, high: 10, low: 10 },
      { trade_date: '2026-01-02', open: 11, close: 11, high: 11, low: 11 },
    ]);
    await savePriceHistory(held.id, [
      { trade_date: '2026-01-02', open: 12, close: 12, high: 12, low: 12 },
    ]);
    await expect(getPriceOnDate(held.id, '2026-01-03')).resolves.toBe(12);
  });

  it('round-trips backup data without changing ids or derived totals', async () => {
    const [account] = await getAllAccounts();
    const instrument = await seedInstrument();
    await setSetting('cost_method', 'fifo');
    await addCashFlow({
      account_id: account.id,
      type: 'deposit',
      amount: 500,
      flow_date: '2026-01-01',
    });
    await addTransaction({
      instrument_id: instrument.id,
      account_id: account.id,
      type: 'buy',
      price: 5,
      quantity: 10,
      amount: 50,
      trade_date: '2026-01-02',
    });
    await recordDailySnapshot();

    const beforeSummary = await computePortfolioSummary();
    const backup = await exportBackupJson();
    await resetDB();
    await importBackupJson(backup);

    const afterSummary = await computePortfolioSummary();
    expect(afterSummary).toEqual(beforeSummary);
    await expect(getSetting('cost_method')).resolves.toBe('fifo');

    const instruments = await getAllInstruments();
    expect(instruments).toHaveLength(1);
    expect(instruments[0].id).toBe(instrument.id);

    const db = await getDB();
    const snapshots = await db.getAllAsync<{ date: string; total_value: number }>(
      'SELECT date, total_value FROM daily_snapshots ORDER BY date ASC'
    );
    expect(snapshots).toHaveLength(1);
  });

  it('moves related records when deleting an account to avoid orphaned business data', async () => {
    const [defaultAccount] = await getAllAccounts();
    const accountToDelete = await addAccount('华泰证券');
    const instrument = await seedInstrument();

    await addCashFlow({
      account_id: accountToDelete,
      type: 'deposit',
      amount: 100,
      flow_date: '2026-01-01',
    });
    await addTransaction({
      instrument_id: instrument.id,
      account_id: accountToDelete,
      type: 'buy',
      price: 10,
      quantity: 1,
      amount: 10,
      trade_date: '2026-01-02',
    });
    const planId = await createDcaPlan({
      instrument_id: instrument.id,
      account_id: accountToDelete,
      name: '迁移定投',
      amount: 100,
      cycle: 'monthly',
      monthday: 1,
      first_date: '2026-01-01',
    });

    await deleteAccount(accountToDelete);
    const accounts = await getAllAccounts();
    expect(accounts.map(item => item.id)).toEqual([defaultAccount.id]);

    const transactions = await getAllTransactions({ account_id: defaultAccount.id });
    expect(transactions).toHaveLength(1);
    await expect(computeAccountCashBalance(defaultAccount.id)).resolves.toBe(90);

    const db = await getDB();
    const migratedPlan = await db.getFirstAsync<{ account_id: number }>(
      'SELECT account_id FROM dca_plans WHERE id = ?',
      [planId]
    );
    expect(migratedPlan?.account_id).toBe(defaultAccount.id);
  });
});
