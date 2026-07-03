// 数据类型定义

export type InstrumentType =
  | 'stock'
  | 'stock_hk'
  | 'stock_us'
  | 'stock_global'
  | 'index'
  | 'fund_etf'
  | 'fund_open'; // A股/港股/美股/海外股票/指数/场内基金/场外基金

export interface Instrument {
  id: number;
  code: string;           // 代码
  name: string;           // 名称
  type: InstrumentType;   // 类型
  group_name?: string;    // 分组
  latest_price?: number;  // 最新价格
  prev_close?: number;    // 昨收
  change_pct?: number;    // 涨跌幅%
  high?: number;          // 最高
  low?: number;           // 最低
  open?: number;          // 开盘
  volume?: number;        // 成交量
  updated_at?: string;    // 更新时间
  created_at: string;
}

export interface Account {
  id: number;
  name: string;           // 账户名（如华泰证券、天天基金）
  type: 'broker' | 'fund_platform' | 'bank' | 'other';
  note?: string;
  created_at: string;
}

export type CashFlowType = 'deposit' | 'withdraw' | 'adjust';

export interface CashFlow {
  id: number;
  account_id: number;
  type: CashFlowType;
  amount: number;
  flow_date: string;
  note?: string;
  created_at: string;
}

export type TransactionType =
  | 'buy'          // 买入
  | 'sell'         // 卖出
  | 'dividend_cash'// 现金分红
  | 'dividend_reinvest' // 红利再投资
  | 'split'        // 份额拆分
  | 'merge'        // 份额合并
  | 'dca_buy';     // 定投买入

export interface Transaction {
  id: number;
  instrument_id: number;
  account_id: number;
  type: TransactionType;
  price?: number;         // 成交价
  quantity?: number;      // 数量/份额
  fee?: number;           // 手续费
  amount?: number;        // 成交金额
  dividend_amount?: number; // 分红金额
  split_ratio?: number;   // 拆分比例(如2=1拆2)
  trade_date: string;     // 交易日期
  note?: string;
  created_at: string;
}

export type CostMethod = 'avg' | 'fifo'; // 加权平均/先进先出

export type DcaCycle = 'daily' | 'weekly' | 'monthly' | 'custom_days';
export type DcaStatus = 'active' | 'paused' | 'terminated';

export interface DcaPlan {
  id: number;
  instrument_id: number;
  account_id: number;
  name: string;           // 计划名称
  amount: number;         // 每次定投金额
  fee_rate: number;       // 申购费率%
  cycle: DcaCycle;
  weekday?: number;       // 周定投：0-6(周日-周六)
  monthday?: number;      // 月定投：1-28
  interval_days?: number; // 自定义间隔天数
  confirm_days: number;   // T+N确认天数
  first_date: string;     // 首次扣款日
  status: DcaStatus;
  created_at: string;
}

export interface DcaExecution {
  id: number;
  plan_id: number;
  transaction_id?: number;
  execute_date: string;   // 扣款日
  confirm_date: string;   // 确认日(到账日)
  nav: number;            // 扣款日净值
  amount: number;         // 扣款金额
  fee: number;            // 手续费
  shares: number;         // 确认份额
  status: 'pending' | 'confirmed';
  created_at: string;
}

export interface PriceHistory {
  id: number;
  instrument_id: number;
  trade_date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume?: number;
  change_pct?: number;
}

export interface PriceAlert {
  id: number;
  instrument_id: number;
  alert_type: 'price_above' | 'price_below' | 'rise_pct' | 'fall_pct';
  threshold: number;
  enabled: number;
  triggered: number;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
}

// 持仓计算结果
export interface PositionView {
  instrument: Instrument;
  account?: Account;
  quantity: number;           // 持仓份额
  cost_price: number;         // 成本价
  cost_amount: number;        // 持仓成本
  market_value: number;       // 当前市值
  floating_pnl: number;       // 浮动盈亏
  floating_pnl_pct: number;   // 浮动盈亏%
  today_pnl: number;          // 今日盈亏
  realized_pnl: number;       // 已实现盈亏
  total_pnl: number;          // 累计盈亏
  buy_records?: BuyLot[];     // FIFO用的买入批次
}

export interface BuyLot {
  id: number;
  trade_date: string;
  price: number;
  quantity: number;
  remaining: number;  // 剩余份额
}

export interface PortfolioSummary {
  total_market_value: number;   // 总资产(持仓市值+现金)
  total_cost: number;           // 总成本
  total_floating_pnl: number;   // 总浮动盈亏
  total_floating_pct: number;
  total_float_pnl?: number;     // 兼容字段别名
  float_pnl_pct?: number;       // 兼容字段别名
  total_pnl_pct?: number;       // 兼容字段别名
  today_pnl: number;            // 今日盈亏
  today_pnl_pct: number;
  total_realized_pnl: number;   // 已实现盈亏
  total_pnl: number;            // 累计收益
  cash_balance?: number;
  history?: { date: string; total_value: number; stock_value?: number; fund_value?: number }[];
}
