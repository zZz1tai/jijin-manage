// 持仓与收益计算核心逻辑
import { getDB } from './index';
import { getSetting } from './settings';
import { getAllAccounts } from './accounts';
import { getAllInstruments, getInstrumentById } from './instruments';
import { computeAccountCashBalance, computeTotalCashBalance } from './cash';
import type { PositionView, PortfolioSummary, BuyLot, Instrument, Transaction, CostMethod } from './types';
import { getBuyTransactionsForFIFO, getAllTransactions } from './transactions';

const round4 = (v: number) => Math.round(v * 10000) / 10000;
const round2 = (v: number) => Math.round(v * 100) / 100;

// 处理分红、拆分等事件带来的份额与成本调整，返回调整后的 (quantity, cost_amount)
// 基于交易流水重算（从0开始）
function applyTransactionsToHoldings(
  txs: Transaction[],
  method: CostMethod
): { quantity: number; cost_amount: number; realized_pnl: number; lots: BuyLot[] } {
  // 按时间顺序处理
  const sorted = [...txs].sort((a, b) =>
    a.trade_date === b.trade_date ? a.id - b.id : a.trade_date.localeCompare(b.trade_date)
  );

  let quantity = 0;
  let cost_amount = 0;
  let realized_pnl = 0;
  const lots: BuyLot[] = []; // 仅 FIFO 使用

  for (const tx of sorted) {
    switch (tx.type) {
      case 'buy':
      case 'dca_buy': {
        const qty = tx.quantity ?? 0;
        const fee = tx.fee ?? 0;
        const gross = (tx.price ?? 0) * qty;
        const totalCost = gross + fee;
        quantity = round4(quantity + qty);
        cost_amount = round4(cost_amount + totalCost);
        if (method === 'fifo') {
          lots.push({
            id: tx.id,
            trade_date: tx.trade_date,
            price: tx.price ?? 0,
            quantity: qty,
            remaining: qty,
          });
        }
        break;
      }
      case 'sell': {
        const qty = tx.quantity ?? 0;
        const fee = tx.fee ?? 0;
        const gross = (tx.price ?? 0) * qty;
        const netProceeds = gross - fee;
        let sold_cost = 0;
        if (method === 'avg') {
          if (quantity > 0) {
            const avgCost = cost_amount / quantity;
            sold_cost = avgCost * qty;
          }
        } else {
          // FIFO
          let remaining = qty;
          for (const lot of lots) {
            if (remaining <= 0) break;
            if (lot.remaining <= 0) continue;
            const take = Math.min(lot.remaining, remaining);
            sold_cost += take * lot.price;
            lot.remaining = round4(lot.remaining - take);
            remaining = round4(remaining - take);
          }
          // 修正 sold_cost 包含买入手续费（按比例分摊简化）
          if (quantity > 0) sold_cost = (cost_amount / quantity) * qty;
        }
        realized_pnl = round4(realized_pnl + (netProceeds - sold_cost));
        quantity = round4(quantity - qty);
        cost_amount = round4(Math.max(0, cost_amount - sold_cost));
        break;
      }
      case 'dividend_cash': {
        // 现金分红：直接算已实现收益
        const amt = tx.dividend_amount ?? 0;
        realized_pnl = round4(realized_pnl + amt);
        break;
      }
      case 'dividend_reinvest': {
        // 红利再投资：增加份额，成本0（已用分红买入）
        const qty = tx.quantity ?? 0;
        quantity = round4(quantity + qty);
        if (method === 'fifo') {
          lots.push({
            id: tx.id,
            trade_date: tx.trade_date,
            price: 0,
            quantity: qty,
            remaining: qty,
          });
        }
        break;
      }
      case 'split': {
        // 拆分：份额 * ratio，成本总额不变
        const ratio = tx.split_ratio ?? 1;
        quantity = round4(quantity * ratio);
        if (method === 'fifo') {
          for (const lot of lots) {
            lot.quantity = round4(lot.quantity * ratio);
            lot.remaining = round4(lot.remaining * ratio);
            lot.price = round4(lot.price / ratio);
          }
        }
        break;
      }
      case 'merge': {
        // 合并：份额 / ratio
        const ratio = tx.split_ratio ?? 1;
        quantity = round4(quantity / ratio);
        if (method === 'fifo') {
          for (const lot of lots) {
            lot.quantity = round4(lot.quantity / ratio);
            lot.remaining = round4(lot.remaining / ratio);
            lot.price = round4(lot.price * ratio);
          }
        }
        break;
      }
    }
  }

  return { quantity, cost_amount, realized_pnl, lots };
}

// 计算单个持仓视图
export async function computePositionForInstrument(
  instrument: Instrument,
  accountId?: number
): Promise<PositionView | null> {
  const method = (await getSetting('cost_method') ?? 'avg') as CostMethod;
  const db = await getDB();

  let txs: Transaction[];
  if (accountId) {
    txs = await db.getAllAsync<Transaction>(
      `SELECT * FROM transactions WHERE instrument_id = ? AND account_id = ? ORDER BY trade_date ASC, id ASC`,
      [instrument.id, accountId]
    );
  } else {
    txs = await db.getAllAsync<Transaction>(
      `SELECT * FROM transactions WHERE instrument_id = ? ORDER BY trade_date ASC, id ASC`,
      [instrument.id]
    );
  }

  const { quantity, cost_amount, realized_pnl, lots } = applyTransactionsToHoldings(txs, method);

  if (quantity <= 0.0001 && realized_pnl === 0) return null; // 无持仓且无已实现收益（如果有已实现但清仓仍返回）

  const latestPrice = instrument.latest_price ?? 0;
  const prevClose = instrument.prev_close ?? latestPrice;
  const cost_price = quantity > 0 ? round4(cost_amount / quantity) : 0;
  const market_value = round2(quantity * latestPrice);
  const floating_pnl = round2(market_value - cost_amount);
  const floating_pnl_pct = cost_amount > 0 ? round2((floating_pnl / cost_amount) * 100) : 0;
  const today_pnl = quantity > 0 && prevClose > 0 ? round2((latestPrice - prevClose) * quantity) : 0;

  return {
    instrument,
    quantity: round4(quantity),
    cost_price,
    cost_amount: round2(cost_amount),
    market_value,
    floating_pnl,
    floating_pnl_pct,
    today_pnl,
    realized_pnl: round2(realized_pnl),
    total_pnl: round2(floating_pnl + realized_pnl),
    buy_records: method === 'fifo' ? lots : undefined,
  };
}

export async function computeAllPositions(accountId?: number): Promise<PositionView[]> {
  const instruments = await getAllInstruments();
  const results: PositionView[] = [];
  for (const inst of instruments) {
    const pos = await computePositionForInstrument(inst, accountId);
    if (pos && pos.quantity > 0.0001) results.push(pos);
  }
  return results;
}

export async function computePortfolioSummary(accountId?: number): Promise<PortfolioSummary> {
  const positions = await computeAllPositions(accountId);
  const cash = accountId ? await computeAccountCashBalance(accountId) : await computeTotalCashBalance();
  let total_mv = 0, total_cost = 0, total_float = 0, today = 0, total_realized = 0;
  for (const p of positions) {
    total_mv += p.market_value;
    total_cost += p.cost_amount;
    total_float += p.floating_pnl;
    today += p.today_pnl;
    total_realized += p.realized_pnl;
  }
  const total_pnl = total_float + total_realized;
  const float_pct = total_cost > 0 ? round2((total_float / total_cost) * 100) : 0;
  const today_pct = (total_mv - today) > 0 ? round2((today / (total_mv - today)) * 100) : 0;
  return {
    total_market_value: round2(total_mv),
    total_cost: round2(total_cost),
    total_floating_pnl: round2(total_float),
    total_floating_pct: float_pct,
    today_pnl: round2(today),
    today_pnl_pct: today_pct,
    total_realized_pnl: round2(total_realized),
    total_pnl: round2(total_pnl),
    cash_balance: cash,
  };
}

// 按账户分组汇总
export async function computePortfolioByAccount(): Promise<{ account: { id: number; name: string }; summary: PortfolioSummary }[]> {
  const accounts = await getAllAccounts();
  const results = [];
  for (const acc of accounts) {
    const summary = await computePortfolioSummary(acc.id);
    results.push({ account: { id: acc.id, name: acc.name }, summary });
  }
  return results;
}

// 计算定投计划的统计数据
export async function computeDcaStats(planId: number, latestPrice: number) {
  const db = await getDB();
  const execs = await db.getAllAsync<any>(
    'SELECT * FROM dca_executions WHERE plan_id = ? ORDER BY execute_date ASC',
    [planId]
  );
  const confirmedExecs = execs.filter(execution => execution.status === 'confirmed');
  let total_amount = 0, total_shares = 0, total_fee = 0;
  for (const e of confirmedExecs) {
    total_amount += e.amount;
    total_shares += e.shares;
    total_fee += e.fee;
  }
  const market_value = round2(total_shares * latestPrice);
  const total_invested = round2(total_amount);
  const profit = round2(market_value - total_invested);
  const profit_pct = total_invested > 0 ? round2((profit / total_invested) * 100) : 0;

  // 年化收益率（XIRR简化：按加权平均天数）
  let annualized_pct = 0;
  if (confirmedExecs.length > 0 && total_invested > 0) {
    const now = new Date();
    let weighted_days = 0;
    for (const e of confirmedExecs) {
      const d = new Date(e.execute_date);
      const days = Math.max(1, Math.floor((now.getTime() - d.getTime()) / 86400000));
      weighted_days += (e.amount / total_invested) * days;
    }
    const years = weighted_days / 365;
    if (years > 0) {
      annualized_pct = round2((Math.pow(1 + profit / total_invested, 1 / years) - 1) * 100);
    }
  }

  return {
    total_invested,
    total_shares: round4(total_shares),
    total_fee: round2(total_fee),
    market_value,
    profit,
    profit_pct,
    annualized_pct,
    exec_count: confirmedExecs.length,
  };
}

// 兼容接口：getFullHoldings 等同于 computeAllPositions 但传入 instruments
export async function getFullHoldings(insts?: Instrument[]) {
  if (!insts) insts = await getAllInstruments();
  const results: PositionView[] = [];
  for (const inst of insts) {
    const pos = await computePositionForInstrument(inst);
    if (pos && pos.quantity > 0.0001) results.push(pos);
  }
  return results;
}

// computeSummary: 返回含历史快照数据
export async function computeSummary(positions?: PositionView[]): Promise<PortfolioSummary & { history: { date: string; total_value: number }[] }> {
  if (!positions) positions = await computeAllPositions();
  const cash = await computeTotalCashBalance();
  let total_mv = 0, total_cost = 0, total_float = 0, today = 0, total_realized = 0;
  for (const p of positions) {
    total_mv += p.market_value;
    total_cost += p.cost_amount;
    total_float += p.floating_pnl;
    today += p.today_pnl;
    total_realized += p.realized_pnl;
  }
  const total_pnl = total_float + total_realized;
  const float_pct = total_cost > 0 ? round2((total_float / total_cost) * 100) : 0;
  const today_pct = (total_mv - today) > 0 ? round2((today / (total_mv - today)) * 100) : 0;

  const history = await getDailySnapshots();
  return {
    total_market_value: round2(total_mv),
    total_cost: round2(total_cost),
    total_floating_pnl: round2(total_float),
    total_floating_pct: float_pct,
    total_float_pnl: round2(total_float),
    float_pnl_pct: float_pct,
    today_pnl: round2(today),
    today_pnl_pct: today_pct,
    total_realized_pnl: round2(total_realized),
    total_pnl: round2(total_pnl),
    total_pnl_pct: total_cost > 0 ? round2((total_pnl / total_cost) * 100) : 0,
    cash_balance: cash,
    history,
  };
}

// 每日快照记录（用于净值曲线）
export async function recordDailySnapshot() {
  const db = await getDB();
  // 建表
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS daily_snapshots (
      date TEXT PRIMARY KEY,
      total_value REAL NOT NULL,
      total_cost REAL NOT NULL,
      total_pnl REAL NOT NULL,
      cash REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
  const positions = await computeAllPositions();
  const cash = await computeTotalCashBalance();
  let total_mv = 0, total_cost = 0;
  for (const p of positions) { total_mv += p.market_value; total_cost += p.cost_amount; }
  const today = new Date().toISOString().slice(0, 10);
  await db.runAsync(
    `INSERT OR REPLACE INTO daily_snapshots (date, total_value, total_cost, total_pnl) VALUES (?, ?, ?, ?)`,
    [today, round2(total_mv + cash), round2(total_cost), round2(total_mv - total_cost)]
  );
}

export async function getDailySnapshots(): Promise<{ date: string; total_value: number }[]> {
  const db = await getDB();
  try {
    const rows = await db.getAllAsync<any>(
      `SELECT date, total_value FROM daily_snapshots ORDER BY date ASC`
    );
    return rows;
  } catch {
    return [];
  }
}
