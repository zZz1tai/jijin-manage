// 行情数据获取模块 - 对接公开免费接口
// 使用新浪财经和腾讯财经公开接口，支持A股、场内基金、场外基金
import { Platform } from 'react-native';
import { isGeneratedInstrumentName, normalizeInstrumentCode, searchInstruments as searchLocalInstruments, updateInstrumentMeta, updateInstrumentPrice } from './instruments';
import { savePriceHistory } from './prices';
import type { InstrumentType } from './types';

type QuoteSnapshot = {
  name: string;
  price: number;
  open: number;
  prev_close: number;
  high: number;
  low: number;
  volume: number;
  change_pct: number;
};

type SearchResult = {
  code: string;
  name: string;
  type: InstrumentType;
  price?: number;
};

type HistoryKlineItem = {
  trade_date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  change_pct: number;
};

type FuzzySearchItem = SearchResult & {
  aliases?: string[];
};

export type MarketBoardCategory = 'industry' | 'concept';
export type MarketBoardSort = 'gain' | 'loss';
export type HotListPeriod = 'hour' | 'day';

export type MarketBoardItem = {
  code: string;
  name: string;
  price: number;
  change_pct: number;
  change_amount: number;
  volume: number;
  amount: number;
  leading_stock_name?: string;
  leading_stock_code?: string;
  leading_stock_change_pct?: number;
};

export type HotListItem = {
  code: string;
  name: string;
  rank: number;
  heat: number;
  price?: number;
  change_pct?: number;
  market?: number;
  rank_change?: number;
  popularity_tag?: string;
  concept_tags?: string[];
  analyse_title?: string;
  analyse?: string;
};

export type MarketIndexItem = {
  code: string;
  name: string;
  price: number;
  change_pct: number;
  change_amount: number;
  prev_close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
};

const LOCAL_API_BASE = '/api/v1';
const EASTMONEY_FUND_NAV_URL = 'https://api.fund.eastmoney.com/f10/lsjz';
const EASTMONEY_BOARD_LIST_URL = 'https://push2.eastmoney.com/api/qt/clist/get';
const EASTMONEY_BOARD_HISTORY_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const TONGHUASHUN_HOT_LIST_URL = 'https://eq.10jqka.com.cn/open/api/hot_list/v1/hot_stock/a';
const EASTMONEY_FUND_NAV_PAGE_SIZE = 20;
const QUOTE_REQUEST_TIMEOUT_MS = 12000;
const BOARD_FALLBACK_PAGE_SIZE = 100;
const BOARD_FALLBACK_MAX_PAGES = 20;
const BOARD_FALLBACK_CONCURRENCY = 8;

const COMMON_FUZZY_ITEMS: FuzzySearchItem[] = [
  { code: '600519', name: '贵州茅台', type: 'stock', aliases: ['茅台', 'gzmt', 'maotai', 'guizhoumaotai'] },
  { code: '000858', name: '五粮液', type: 'stock', aliases: ['wly', 'wuliangye'] },
  { code: '300750', name: '宁德时代', type: 'stock', aliases: ['宁德', 'ndsd', 'catl', 'ningdeshidai'] },
  { code: '002594', name: '比亚迪', type: 'stock', aliases: ['byd', 'biyadi'] },
  { code: '600036', name: '招商银行', type: 'stock', aliases: ['招行', 'zsyh', 'cmb', 'zhaoshangyinhang'] },
  { code: '601318', name: '中国平安', type: 'stock', aliases: ['平安', 'zgpa', 'pingan'] },
  { code: '300059', name: '东方财富', type: 'stock', aliases: ['东财', 'dfcf', 'eastmoney'] },
  { code: '688981', name: '中芯国际', type: 'stock', aliases: ['中芯', 'zxgj', 'smic'] },
  { code: '600276', name: '恒瑞医药', type: 'stock', aliases: ['恒瑞', 'hryy', 'hengrui'] },
  { code: '600030', name: '中信证券', type: 'stock', aliases: ['中信', 'zxzq', 'citic'] },
  { code: '510300', name: '沪深300ETF', type: 'fund_etf', aliases: ['沪深300', 'hs300', '300etf'] },
  { code: '510500', name: '中证500ETF', type: 'fund_etf', aliases: ['中证500', 'zz500', '500etf'] },
  { code: '510050', name: '上证50ETF', type: 'fund_etf', aliases: ['上证50', 'sz50', '50etf'] },
  { code: '159915', name: '创业板ETF', type: 'fund_etf', aliases: ['创业板', 'cyb', 'gemetf'] },
  { code: '588000', name: '科创50ETF', type: 'fund_etf', aliases: ['科创50', 'kc50', 'star50'] },
  { code: '512100', name: '中证1000ETF', type: 'fund_etf', aliases: ['中证1000', 'zz1000', '1000etf'] },
  { code: '513100', name: '纳指ETF', type: 'fund_etf', aliases: ['纳斯达克', '纳指100', 'nasdaq', 'ndx'] },
  { code: '518880', name: '黄金ETF', type: 'fund_etf', aliases: ['黄金', 'gold'] },
  { code: '161725', name: '招商中证白酒指数', type: 'fund_open', aliases: ['白酒', '中证白酒', 'baijiu', 'zzbj'] },
  { code: '005827', name: '易方达蓝筹精选混合', type: 'fund_open', aliases: ['蓝筹', '易方达蓝筹', 'yfdlc'] },
  { code: '260108', name: '景顺长城新兴成长混合', type: 'fund_open', aliases: ['景顺新兴', '新兴成长', 'jsxingcheng'] },
  { code: '003095', name: '中欧医疗健康混合A', type: 'fund_open', aliases: ['中欧医疗', '医疗健康', 'zoyl'] },
  { code: '519674', name: '银河创新成长混合', type: 'fund_open', aliases: ['银河创新', '创新成长', 'yhcx'] },
  { code: '161005', name: '富国天惠成长混合', type: 'fund_open', aliases: ['富国天惠', '天惠成长', 'fgth'] },
];

function shouldUseLocalApi(): boolean {
  return Platform.OS === 'web';
}

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  timeoutMs = QUOTE_REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSearchCode(value: unknown): string {
  const raw = normalizeInstrumentCode(String(value ?? ''));
  if (/^\d+\.[\w.-]+$/i.test(raw)) return raw;
  const dotted = raw.match(/(?:^|\.)(\d{6})$/)?.[1];
  if (dotted) return dotted;
  const prefixed = raw.match(/^(?:SH|SZ|BJ)(\d{6})$/)?.[1];
  return prefixed ?? raw;
}

function normalizeQuoteCodeForType(code: string, type: InstrumentType, raw?: Record<string, unknown>): string {
  if (type === 'stock_hk' || type === 'stock_us' || type === 'stock_global' || type === 'index') {
    const quoteId = firstString(raw?.QuoteID, raw?.quoteId);
    if (/^\d+\.[\w.-]+$/i.test(quoteId)) return quoteId.toUpperCase();
    const mktNum = firstString(raw?.MktNum, raw?.MarketType, raw?.Market, raw?.mktNum);
    if (mktNum && code) return `${mktNum}.${code}`.toUpperCase();
  }
  return normalizeSearchCode(code);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text && text !== 'undefined' && text !== 'null') return text;
  }
  return '';
}

function normalizeFuzzyText(value: unknown): string {
  return firstString(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function parseFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const text = firstString(value).replace(/,/g, '');
    if (!text || text === '-') continue;
    const number = Number(text);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function normalizeBoardCategory(category: MarketBoardCategory): MarketBoardCategory {
  return category === 'concept' ? 'concept' : 'industry';
}

function normalizeBoardSort(sort: MarketBoardSort): MarketBoardSort {
  return sort === 'loss' ? 'loss' : 'gain';
}

function normalizeHotListPeriod(period: HotListPeriod): HotListPeriod {
  return period === 'day' ? 'day' : 'hour';
}

function parseJsonOrJsonp(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('(');
    const end = trimmed.lastIndexOf(')');
    if (start < 0 || end <= start) throw new Error('Response is not JSON');
    return JSON.parse(trimmed.slice(start + 1, end));
  }
}

function readEastmoneyRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const diff = data?.diff;
  if (!Array.isArray(diff)) return [];
  return diff.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
}

function normalizeMarketBoardPayload(payload: unknown): MarketBoardItem[] {
  return readEastmoneyRows(payload)
    .map(row => {
      const code = firstString(row.f12);
      const name = firstString(row.f14);
      const changePct = parseFiniteNumber(row.f3);
      if (!code || !name || changePct === undefined) return null;
      const leadingStockName = firstString(row.f128, row.f140);
      const leadingStockCode = firstString(row.f141, row.f140);
      const leadingStockChangePct = parseFiniteNumber(row.f136);
      return {
        code,
        name,
        price: parseFiniteNumber(row.f2) ?? 0,
        change_pct: changePct,
        change_amount: parseFiniteNumber(row.f4) ?? 0,
        volume: parseFiniteNumber(row.f5) ?? 0,
        amount: parseFiniteNumber(row.f6) ?? 0,
        ...(leadingStockName ? { leading_stock_name: leadingStockName } : {}),
        ...(leadingStockCode ? { leading_stock_code: leadingStockCode } : {}),
        ...(leadingStockChangePct !== undefined ? { leading_stock_change_pct: leadingStockChangePct } : {}),
      };
    })
    .filter((item): item is MarketBoardItem => Boolean(item));
}

function normalizeHotListPayload(payload: unknown): HotListItem[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const list = data?.stock_list;
  if (!Array.isArray(list)) return [];

  return list
    .map(item => {
      const row = asRecord(item);
      if (!row) return null;
      const code = firstString(row.code);
      const name = firstString(row.name);
      const rank = parseFiniteNumber(row.order);
      if (!code || !name || rank === undefined) return null;
      const tag = asRecord(row.tag);
      const conceptTags = Array.isArray(tag?.concept_tag)
        ? tag.concept_tag.map(firstString).filter(Boolean)
        : [];
      return {
        code,
        name,
        rank,
        heat: parseFiniteNumber(row.rate) ?? 0,
        ...(parseFiniteNumber(row.market) !== undefined ? { market: parseFiniteNumber(row.market) } : {}),
        ...(parseFiniteNumber(row.hot_rank_chg) !== undefined ? { rank_change: parseFiniteNumber(row.hot_rank_chg) } : {}),
        ...(firstString(tag?.popularity_tag) ? { popularity_tag: firstString(tag?.popularity_tag) } : {}),
        ...(conceptTags.length > 0 ? { concept_tags: conceptTags } : {}),
        ...(firstString(row.analyse_title) ? { analyse_title: firstString(row.analyse_title) } : {}),
        ...(firstString(row.analyse) ? { analyse: firstString(row.analyse) } : {}),
      };
    })
    .filter((item): item is HotListItem => Boolean(item));
}

function normalizeBoardListPayload(payload: unknown): Pick<MarketBoardItem, 'code' | 'name'>[] {
  return readEastmoneyRows(payload)
    .map(row => {
      const code = firstString(row.f12);
      const name = firstString(row.f14);
      return code && name ? { code, name } : null;
    })
    .filter((item): item is Pick<MarketBoardItem, 'code' | 'name'> => Boolean(item));
}

function buildMarketBoardFromKline(
  board: Pick<MarketBoardItem, 'code' | 'name'>,
  line: string,
  fallbackName?: string
): MarketBoardItem | null {
  const parts = line.split(',');
  if (parts.length < 10) return null;
  const close = parseFiniteNumber(parts[2]);
  const changePct = parseFiniteNumber(parts[8]);
  if (close === undefined || changePct === undefined) return null;
  const name = board.name || fallbackName || board.code;
  return {
    code: board.code,
    name,
    price: close,
    change_pct: changePct,
    change_amount: parseFiniteNumber(parts[9]) ?? 0,
    volume: parseFiniteNumber(parts[5]) ?? 0,
    amount: parseFiniteNumber(parts[6]) ?? 0,
  };
}

function buildMarketBoardScanCandidates(): Pick<MarketBoardItem, 'code' | 'name'>[] {
  return Array.from({ length: 901 }, (_, index) => ({
    code: `BK${String(index + 400).padStart(4, '0')}`,
    name: '',
  }));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R | null>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      const result = await worker(item);
      if (result) results.push(result);
    }
  });
  await Promise.all(workers);
  return results;
}

function isListedFundCode(code: string): boolean {
  return /^(?:5\d{5}|1[568]\d{4})$/.test(code);
}

function isLikelyStockCode(code: string): boolean {
  return /^(?:60|68|00[0-3]|30|301|4|8|920)\d+/.test(code);
}

function inferExactCodeFallbackType(code: string): InstrumentType {
  const common = COMMON_FUZZY_ITEMS.find(item => item.code === code);
  if (common) return common.type;
  if (/^93\d{4}$/.test(code)) return 'index';
  if (isListedFundCode(code)) return 'fund_etf';
  return isLikelyStockCode(code) ? 'stock' : 'fund_open';
}

function inferInstrumentType(code: string, raw?: Record<string, unknown>): InstrumentType {
  const explicit = firstString(raw?.type, raw?.instrument_type);
  if (
    explicit === 'stock' ||
    explicit === 'stock_hk' ||
    explicit === 'stock_us' ||
    explicit === 'stock_global' ||
    explicit === 'index' ||
    explicit === 'fund_etf' ||
    explicit === 'fund_open'
  ) return explicit;

  const mktNum = firstString(raw?.MktNum, raw?.MarketType, raw?.Market, raw?.mktNum);
  const marketType = firstString(raw?.MarketType, raw?.Market);
  const securityType = firstString(raw?.SecurityType, raw?.securityType);
  const quoteId = firstString(raw?.QuoteID, raw?.quoteId);
  const classify = firstString(raw?.Classify, raw?.classify).toUpperCase();
  const exchange = firstString(raw?.JYS, raw?.Exchange, raw?.exchange).toUpperCase();
  const typeName = firstString(raw?.SecurityTypeName, raw?.TypeName, raw?.SecurityType, raw?.typeName);
  const name = firstString(raw?.Name, raw?.name, raw?.SecurityName, raw?.SECURITY_NAME, raw?.ShortName, raw?.shortName, raw?.JC);
  const typeNameUpper = typeName.toUpperCase();
  const isFundName = typeName.includes('基金') || typeNameUpper.includes('FUND');
  const nameUpper = name.toUpperCase();
  const isOtcFund = exchange.includes('OTCFUND') || classify.includes('OTCFUND') || mktNum === '150' || marketType === '6' || securityType === '17' || quoteId.startsWith('150.');
  const quoteMarket = quoteId.match(/^(\d+)\./)?.[1];

  if (isOtcFund || mktNum === '113') return 'fund_open';
  if (typeName.includes('指数') || securityType === '11' || classify.includes('INDEX')) return 'index';
  if (classify.includes('USSTOCK') || typeName.includes('美股') || marketType === '7' || ['105', '106', '107'].includes(mktNum)) return 'stock_us';
  if (classify === 'HK' || exchange === 'HK' || typeName.includes('港股') || marketType === '5' || mktNum === '116') return 'stock_hk';
  if (quoteMarket && !['0', '1', '113', '150'].includes(quoteMarket)) return 'stock_global';
  if (typeName.includes('股票') || typeName.includes('粉单') || classify.includes('STOCK')) return 'stock_global';
  if (typeNameUpper.includes('ETF') || typeNameUpper.includes('LOF') || typeNameUpper.includes('REIT') || nameUpper.includes('ETF') || nameUpper.includes('LOF') || nameUpper.includes('REIT')) return 'fund_etf';
  if (isListedFundCode(code)) return 'fund_etf';
  if (isFundName) return 'fund_open';
  return 'stock';
}

function collectRows(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || value == null) return [];
  if (Array.isArray(value)) {
    const looksLikeRows = value.some(item => {
      if (!item || typeof item !== 'object') return false;
      const row = item as Record<string, unknown>;
      return 'Code' in row || 'code' in row || 'SecurityCode' in row || 'FundCode' in row;
    });
    if (looksLikeRows) return value.filter(item => item && typeof item === 'object') as Record<string, unknown>[];
    return value.flatMap(item => collectRows(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(item => collectRows(item, depth + 1));
  }
  return [];
}

function normalizeSearchPayload(payload: unknown): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const row of collectRows(payload)) {
    const rawCode = firstString(row.Code, row.code, row.SecurityCode, row.SECURITY_CODE, row.FundCode);
    const name = firstString(row.Name, row.name, row.SecurityName, row.SECURITY_NAME, row.ShortName, row.shortName, row.JC);
    if (!rawCode || !name) continue;

    const type = inferInstrumentType(rawCode, row);
    const code = normalizeQuoteCodeForType(rawCode, type, row);
    const key = `${code}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const price = parseFiniteNumber(row.ClaimPrice, row.Price, row.NewPrice, row.LatestPrice, row.price);
    results.push({ code, name, type, ...(price !== undefined && price > 0 ? { price } : {}) });
  }
  return results;
}

function mergeSearchResults(...groups: SearchResult[][]): SearchResult[] {
  const indexes = new Map<string, number>();
  const merged: SearchResult[] = [];
  for (const group of groups) {
    for (const item of group) {
      const key = `${item.code}:${item.type}`;
      const existingIndex = indexes.get(key);
      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];
        if (existing.price === undefined && item.price !== undefined) existing.price = item.price;
        continue;
      }
      indexes.set(key, merged.length);
      merged.push(item);
    }
  }
  return merged;
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let offset = 0;
  for (const char of needle) {
    const next = haystack.indexOf(char, offset);
    if (next < 0) return false;
    offset = next + 1;
  }
  return true;
}

function fuzzyScore(item: FuzzySearchItem, keyword: string): number {
  const query = normalizeFuzzyText(keyword);
  if (!query) return 0;
  const commonItem = COMMON_FUZZY_ITEMS.find(common => common.code === item.code && common.type === item.type);
  const code = normalizeFuzzyText(item.code);
  const name = normalizeFuzzyText(item.name);
  const aliases = [...(item.aliases ?? []), ...(commonItem?.aliases ?? [])].map(normalizeFuzzyText).filter(Boolean);

  if (code === query) return 1000;
  if (code.startsWith(query)) return 900;
  if (code.includes(query)) return 760;
  if (name === query) return 850;
  if (name.startsWith(query)) return 780;
  if (name.includes(query)) return 700;
  if (aliases.some(alias => alias === query)) return 840;
  if (aliases.some(alias => alias.startsWith(query))) return 740;
  if (aliases.some(alias => alias.includes(query))) return 680;
  if (query.length >= 2 && isSubsequence(query, name)) return 420;
  if (query.length >= 2 && aliases.some(alias => isSubsequence(query, alias))) return 400;
  return 0;
}

function rankSearchResults(keyword: string, items: SearchResult[]): SearchResult[] {
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(item, keyword) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.item);
}

function buildFuzzyFallback(keyword: string): SearchResult[] {
  return COMMON_FUZZY_ITEMS
    .map((item, index) => ({ item, index, score: fuzzyScore(item, keyword) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 12)
    .map(entry => {
      const { aliases, ...result } = entry.item;
      return result;
    });
}

function buildExactCodeFallback(keyword: string): SearchResult[] {
  const code = normalizeSearchCode(keyword);
  if (!/^\d{6}$/.test(code)) return [];
  const type = inferExactCodeFallbackType(code);
  const label = type === 'stock' ? 'A股' : type === 'index' ? '指数' : type === 'fund_etf' ? '场内基金' : '场外基金';
  return [{ code, name: `${label} ${code}`, type }];
}

async function searchExactOpenFundFromSina(keyword: string): Promise<SearchResult[]> {
  if (shouldUseLocalApi()) return [];

  const code = normalizeSearchCode(keyword);
  if (!/^\d{6}$/.test(code)) return [];

  const quotes = await fetchRealtimeQuotesDirect([{ code, type: 'fund_open' }]);
  const quote = quotes.get(code);
  const name = quote?.name?.trim();
  if (!quote || quote.price <= 0 || !name || name === code) return [];
  return [{ code, name, type: 'fund_open', price: quote.price }];
}

// 将代码转换为新浪接口的市场前缀
function sinaSymbol(code: string, type: InstrumentType): string {
  const normalizedCode = normalizeInstrumentCode(code);
  if (type === 'fund_open') {
    // 场外基金使用 jsFund...
    return `fu_${normalizedCode}`;
  }
  if (normalizedCode.startsWith('6') || normalizedCode.startsWith('5') || normalizedCode.startsWith('9')) {
    return `sh${normalizedCode}`; // 沪市
  }
  return `sz${normalizedCode}`; // 深市
}

function isEastmoneySecid(code: string): boolean {
  return /^\d+\.[\w.-]+$/i.test(normalizeInstrumentCode(code));
}

function usesEastmoneyListedQuote(item: { code: string; type: InstrumentType }): boolean {
  return item.type === 'stock_hk' || item.type === 'stock_us' || item.type === 'stock_global' || item.type === 'index' || /^93\d{4}$/.test(normalizeInstrumentCode(item.code)) || isEastmoneySecid(item.code);
}

function eastmoneySecid(code: string): string {
  const normalizedCode = normalizeInstrumentCode(code);
  if (isEastmoneySecid(normalizedCode)) return normalizedCode;
  if (/^93\d{4}$/.test(normalizedCode)) return `2.${normalizedCode}`;
  const market = normalizedCode.startsWith('6') || normalizedCode.startsWith('5') || normalizedCode.startsWith('9') ? '1' : '0';
  return `${market}.${normalizedCode}`;
}

// 判断是否交易时段（简化：周一-周五 9:30-11:30, 13:00-15:00，忽略节假日）
export function isTradingHours(): boolean {
  const now = new Date();
  // 使用北京时间
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  const day = bj.getDay();
  if (day === 0 || day === 6) return false;
  const h = bj.getHours();
  const m = bj.getMinutes();
  const t = h * 60 + m;
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

// 获取行业/概念板块涨幅排行
export async function fetchMarketBoards(
  category: MarketBoardCategory = 'industry',
  page = 1,
  pageSize = 50,
  sort: MarketBoardSort = 'gain'
): Promise<MarketBoardItem[]> {
  const normalizedCategory = normalizeBoardCategory(category);
  const normalizedSort = normalizeBoardSort(sort);
  const normalizedPage = Math.max(1, Math.round(page));
  const normalizedPageSize = Math.max(1, Math.min(Math.round(pageSize), 100));
  if (shouldUseLocalApi()) {
    try {
      const params = new URLSearchParams({
        category: normalizedCategory,
        page: String(normalizedPage),
        pageSize: String(normalizedPageSize),
        sort: normalizedSort,
      });
      const resp = await fetchWithTimeout(`${LOCAL_API_BASE}/market-boards?${params.toString()}`);
      if (!resp.ok) throw new Error(`local market boards proxy failed: ${resp.status}`);
      const data = await resp.json();
      return Array.isArray(data?.items) ? data.items : [];
    } catch (e) {
      console.warn('本地板块排行代理请求失败:', e);
      return [];
    }
  }

  return fetchMarketBoardsDirect(normalizedCategory, normalizedPage, normalizedPageSize, normalizedSort);
}

async function fetchMarketBoardsDirect(
  category: MarketBoardCategory,
  page: number,
  pageSize: number,
  sort: MarketBoardSort
): Promise<MarketBoardItem[]> {
  const realtimeItems = await fetchMarketBoardsRealtime(category, page, pageSize, sort);
  if (realtimeItems.length > 0) return realtimeItems;
  return fetchMarketBoardsFromDailyKline(category, page, pageSize, sort);
}

async function fetchMarketBoardsRealtime(
  category: MarketBoardCategory,
  page: number,
  pageSize: number,
  sort: MarketBoardSort
): Promise<MarketBoardItem[]> {
  try {
    const params = new URLSearchParams({
      pn: String(page),
      pz: String(pageSize),
      po: sort === 'loss' ? '0' : '1',
      np: '1',
      fltt: '2',
      invt: '2',
      fid: 'f3',
      fs: category === 'concept' ? 'm:90+t:3' : 'm:90+t:2',
      fields: 'f12,f14,f2,f3,f4,f5,f6,f128,f136,f140,f141',
    });
    const resp = await fetchWithTimeout(`${EASTMONEY_BOARD_LIST_URL}?${params.toString()}`, {
      headers: { 'Referer': 'https://quote.eastmoney.com/' },
    });
    if (!resp.ok) throw new Error(`eastmoney market boards failed: ${resp.status}`);
    return normalizeMarketBoardPayload(parseJsonOrJsonp(await resp.text()));
  } catch (e) {
    console.warn('板块排行请求失败:', e);
    return [];
  }
}

async function fetchMarketBoardList(category: MarketBoardCategory): Promise<Pick<MarketBoardItem, 'code' | 'name'>[]> {
  const results: Pick<MarketBoardItem, 'code' | 'name'>[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= BOARD_FALLBACK_MAX_PAGES; page += 1) {
    try {
      const params = new URLSearchParams({
        pn: String(page),
        pz: String(BOARD_FALLBACK_PAGE_SIZE),
        po: '1',
        np: '1',
        fltt: '2',
        invt: '2',
        fid: 'f12',
        fs: category === 'concept' ? 'm:90+t:3' : 'm:90+t:2',
        fields: 'f12,f14',
      });
      const resp = await fetchWithTimeout(`${EASTMONEY_BOARD_LIST_URL}?${params.toString()}`, {
        headers: { 'Referer': 'https://quote.eastmoney.com/' },
      });
      if (!resp.ok) throw new Error(`eastmoney market board list failed: ${resp.status}`);
      const items = normalizeBoardListPayload(parseJsonOrJsonp(await resp.text()));
      for (const item of items) {
        if (seen.has(item.code)) continue;
        seen.add(item.code);
        results.push(item);
      }
      if (items.length < BOARD_FALLBACK_PAGE_SIZE) break;
    } catch (e) {
      console.warn('板块列表请求失败:', e);
      break;
    }
  }
  return results;
}

async function fetchMarketBoardFromDailyKline(
  board: Pick<MarketBoardItem, 'code' | 'name'>,
  options: { quiet?: boolean } = {}
): Promise<MarketBoardItem | null> {
  try {
    const params = new URLSearchParams({
      secid: `90.${board.code}`,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      klt: '101',
      fqt: '1',
      end: '20500101',
      lmt: '2',
    });
    const resp = await fetchWithTimeout(`${EASTMONEY_BOARD_HISTORY_URL}?${params.toString()}`);
    if (!resp.ok) throw new Error(`eastmoney market board history failed: ${resp.status}`);
    const root = asRecord(parseJsonOrJsonp(await resp.text()));
    const data = asRecord(root?.data);
    const klines = data?.klines;
    if (!Array.isArray(klines) || klines.length === 0) return null;
    return buildMarketBoardFromKline(board, firstString(klines.at(-1)), firstString(data?.name));
  } catch (e) {
    if (!options.quiet) console.warn('板块日K兜底请求失败:', e);
    return null;
  }
}

async function fetchMarketBoardsFromDailyKline(
  category: MarketBoardCategory,
  page: number,
  pageSize: number,
  sort: MarketBoardSort
): Promise<MarketBoardItem[]> {
  const boardList = await fetchMarketBoardList(category);
  const boards = boardList.length > 0 ? boardList : buildMarketBoardScanCandidates();
  const items = await mapWithConcurrency(
    boards,
    BOARD_FALLBACK_CONCURRENCY,
    board => fetchMarketBoardFromDailyKline(board, { quiet: boardList.length === 0 }),
  );
  return items
    .sort((a, b) => sort === 'loss' ? a.change_pct - b.change_pct : b.change_pct - a.change_pct)
    .slice((page - 1) * pageSize, page * pageSize);
}

export async function fetchHotList(
  period: HotListPeriod = 'hour',
  page = 1,
  pageSize = 50
): Promise<HotListItem[]> {
  const normalizedPeriod = normalizeHotListPeriod(period);
  const normalizedPage = Math.max(1, Math.round(page));
  const normalizedPageSize = Math.max(1, Math.min(Math.round(pageSize), 100));

  if (shouldUseLocalApi()) {
    try {
      const params = new URLSearchParams({
        period: normalizedPeriod,
        page: String(normalizedPage),
        pageSize: String(normalizedPageSize),
      });
      const resp = await fetchWithTimeout(`${LOCAL_API_BASE}/hot-list?${params.toString()}`);
      if (!resp.ok) throw new Error(`local hot list proxy failed: ${resp.status}`);
      const data = await resp.json();
      return Array.isArray(data?.items) ? data.items : [];
    } catch (e) {
      console.warn('本地热门榜代理请求失败:', e);
      return [];
    }
  }

  try {
    const resp = await fetchWithTimeout(`${TONGHUASHUN_HOT_LIST_URL}/${normalizedPeriod}/data.txt`, {
      headers: { 'Referer': 'https://eq.10jqka.com.cn/' },
    });
    if (!resp.ok) throw new Error(`tonghuashun hot list failed: ${resp.status}`);
    return normalizeHotListPayload(parseJsonOrJsonp(await resp.text()))
      .slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize);
  } catch (e) {
    console.warn('热门榜请求失败:', e);
    return [];
  }
}

export async function fetchMarketIndices(
  page = 1,
  pageSize = 50,
  sort: MarketBoardSort = 'gain'
): Promise<MarketIndexItem[]> {
  const normalizedSort = normalizeBoardSort(sort);
  const normalizedPage = Math.max(1, Math.round(page));
  const normalizedPageSize = Math.max(1, Math.min(Math.round(pageSize), 100));

  try {
    const params = new URLSearchParams({
      page: String(normalizedPage),
      pageSize: String(normalizedPageSize),
      sort: normalizedSort,
    });
    const resp = await fetchWithTimeout(`${LOCAL_API_BASE}/market-indices?${params.toString()}`);
    if (!resp.ok) throw new Error(`local market indices proxy failed: ${resp.status}`);
    const data = await resp.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch (e) {
    console.warn('指数榜请求失败:', e);
    return [];
  }
}

// 获取标的实时行情（使用新浪财经 hq.sinajs.cn 接口）
// 注意：该接口为 JSONP 格式，我们直接用 fetch 解析文本
export async function fetchRealtimeQuotes(
  items: { code: string; type: InstrumentType }[]
): Promise<Map<string, QuoteSnapshot>> {
  if (items.length === 0) return new Map();

  if (shouldUseLocalApi()) {
    const proxied = await fetchRealtimeQuotesFromLocalApi(items);
    return proxied;
  }

  return fetchRealtimeQuotesDirect(items);
}

async function fetchRealtimeQuotesFromLocalApi(
  items: { code: string; type: InstrumentType }[]
): Promise<Map<string, QuoteSnapshot>> {
  const results = new Map();
  if (items.length === 0) return results;

  try {
    const resp = await fetchWithTimeout(`${LOCAL_API_BASE}/realtime-quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!resp.ok) throw new Error(`local quote proxy failed: ${resp.status}`);
    const data = await resp.json();
    const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    for (const row of rows) {
      const code = normalizeSearchCode(row?.code);
      const price = parseFiniteNumber(row?.price);
      if (!code || price === undefined || price <= 0) continue;
      const prevClose = parseFiniteNumber(row?.prev_close, row?.prevClose) ?? price;
      const quote = {
        name: firstString(row?.name, code),
        price,
        open: parseFiniteNumber(row?.open) ?? price,
        prev_close: prevClose,
        high: parseFiniteNumber(row?.high) ?? price,
        low: parseFiniteNumber(row?.low) ?? price,
        volume: parseFiniteNumber(row?.volume) ?? 0,
        change_pct: parseFiniteNumber(row?.change_pct, row?.changePct) ?? (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0),
      };
      results.set(code, quote);
      const shortCode = code.includes('.') ? code.split('.').at(-1) : '';
      if (shortCode) results.set(shortCode, quote);
    }
  } catch (e) {
    console.warn('本地行情代理请求失败:', e);
  }
  return results;
}

function parseSinaOpenFundQuote(code: string, data: string[]): QuoteSnapshot | null {
  const name = firstString(data[0], code);
  const hasTimeField = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(firstString(data[1]));
  const price = hasTimeField ? parseFiniteNumber(data[2]) : parseFiniteNumber(data[1]);
  if (price === undefined || price <= 0) return null;

  const prevClose = (hasTimeField ? parseFiniteNumber(data[3]) : parseFiniteNumber(data[3], data[1])) ?? price;
  const changePct = parseFiniteNumber(data[6]) ?? (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0);
  return {
    name,
    price,
    prev_close: prevClose,
    open: price,
    high: price,
    low: price,
    volume: 0,
    change_pct: changePct,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readFundNavRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  const data = asRecord(root?.Data);
  const list = data?.LSJZList;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
}

function buildOpenFundQuoteFromNav(code: string, rows: Record<string, unknown>[]): QuoteSnapshot | null {
  const latest = rows[0];
  if (!latest) return null;

  const price = parseFiniteNumber(latest.DWJZ);
  if (price === undefined || price <= 0) return null;

  const previousPrice = parseFiniteNumber(rows[1]?.DWJZ);
  const changePct = parseFiniteNumber(latest.JZZZL);
  const impliedPrev = changePct !== undefined && changePct > -100 ? price / (1 + changePct / 100) : undefined;
  const prevClose = previousPrice ?? impliedPrev ?? price;
  return {
    name: code,
    price,
    prev_close: prevClose,
    open: price,
    high: price,
    low: price,
    volume: 0,
    change_pct: changePct ?? (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0),
  };
}

async function fetchEastmoneyOpenFundQuotes(codes: string[]): Promise<Map<string, QuoteSnapshot>> {
  const results = new Map<string, QuoteSnapshot>();
  const uniqueCodes = [...new Set(codes.map(normalizeInstrumentCode).filter(code => /^\d{6}$/.test(code)))];
  if (uniqueCodes.length === 0) return results;

  const entries: Array<readonly [string, QuoteSnapshot] | null> = await Promise.all(uniqueCodes.map(async code => {
    try {
      const params = new URLSearchParams({
        fundCode: code,
        pageIndex: '1',
        pageSize: '2',
        startDate: '',
        endDate: '',
      });
      const resp = await fetchWithTimeout(`${EASTMONEY_FUND_NAV_URL}?${params.toString()}`, {
        headers: { 'Referer': 'https://fundf10.eastmoney.com/' },
      });
      if (!resp.ok) throw new Error(`eastmoney fund nav failed: ${resp.status}`);
      const quote = buildOpenFundQuoteFromNav(code, readFundNavRows(parseJsonOrJsonp(await resp.text())));
      return quote ? [code, quote] as const : null;
    } catch (e) {
      console.warn('场外基金净值兜底请求失败:', e);
      return null;
    }
  }));

  for (const entry of entries) {
    if (entry) results.set(entry[0], entry[1]);
  }
  return results;
}

async function fetchRealtimeQuotesDirect(
  items: { code: string; type: InstrumentType }[]
): Promise<Map<string, QuoteSnapshot>> {
  const results = new Map<string, QuoteSnapshot>();
  if (items.length === 0) return results;

  const sinaItems = items.filter(item => !usesEastmoneyListedQuote(item));
  const eastmoneyItems = items.filter(usesEastmoneyListedQuote);

  if (sinaItems.length > 0) {
    const symbols = sinaItems.map(it => sinaSymbol(it.code, it.type)).join(',');
    const url = `https://hq.sinajs.cn/list=${symbols}`;

    try {
      const resp = await fetchWithTimeout(url, {
        headers: {
          'Referer': 'https://finance.sina.com.cn',
        },
      });
      const text = await resp.text();
      // 解析每一行 var hq_str_sh600000="xxx,xxx,...";
      const lines = text.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const m = line.match(/hq_str_(\w+)="([^"]*)"/);
        if (!m) continue;
        const sym = m[1];
        const data = m[2].split(',');
        let code: string;
        if (sym.startsWith('fu_')) {
          code = normalizeInstrumentCode(sym.slice(3));
          const quote = parseSinaOpenFundQuote(code, data);
          if (quote) results.set(code, quote);
        } else {
          // 股票/场内基金格式：
          // 0:name 1:open 2:prev_close 3:price 4:high 5:low 6:buy 7:sell 8:volume 9:amount ...
          code = normalizeInstrumentCode(sym.slice(2));
          if (data.length >= 32) {
            const name = data[0];
            const open = parseFloat(data[1]) || 0;
            const prev_close = parseFloat(data[2]) || 0;
            const price = parseFloat(data[3]) || 0;
            const high = parseFloat(data[4]) || 0;
            const low = parseFloat(data[5]) || 0;
            const volume = parseFloat(data[8]) || 0;
            const change_pct = prev_close > 0 ? ((price - prev_close) / prev_close) * 100 : 0;
            results.set(code, { name, price, open, prev_close, high, low, volume, change_pct });
          }
        }
      }
    } catch (e) {
      console.warn('行情接口请求失败:', e);
    }
  }

  const missingListedItems = [
    ...eastmoneyItems,
    ...sinaItems
      .filter(item => item.type !== 'fund_open')
      .filter(item => !results.has(normalizeInstrumentCode(item.code))),
  ];
  const listedFallbackQuotes = await fetchEastmoneyListedQuotes(missingListedItems);
  for (const [code, quote] of listedFallbackQuotes) {
    results.set(code, quote);
  }

  const missingOpenFundCodes = items
    .filter(item => item.type === 'fund_open')
    .map(item => normalizeInstrumentCode(item.code))
    .filter(code => !results.has(code));
  const fallbackQuotes = await fetchEastmoneyOpenFundQuotes(missingOpenFundCodes);
  for (const [code, quote] of fallbackQuotes) {
    results.set(code, quote);
  }
  return results;
}

function readEastmoneyQuoteRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const diff = data?.diff;
  if (!Array.isArray(diff)) return [];
  return diff.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
}

function buildListedQuoteFromEastmoneyRow(row: Record<string, unknown>): readonly [string, QuoteSnapshot] | null {
  const shortCode = normalizeInstrumentCode(firstString(row.f12));
  const market = firstString(row.f13);
  const price = parseFiniteNumber(row.f2);
  if (!shortCode || price === undefined || price <= 0) return null;

  const code = market && !['0', '1'].includes(market) ? `${market}.${shortCode}` : shortCode;
  const prevClose = parseFiniteNumber(row.f18) ?? price;
  return [code, {
    name: firstString(row.f14, shortCode),
    price,
    open: parseFiniteNumber(row.f17) ?? price,
    prev_close: prevClose,
    high: parseFiniteNumber(row.f15) ?? price,
    low: parseFiniteNumber(row.f16) ?? price,
    volume: parseFiniteNumber(row.f5) ?? 0,
    change_pct: parseFiniteNumber(row.f3) ?? (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0),
  }] as const;
}

async function fetchEastmoneyListedQuotes(
  items: { code: string; type: InstrumentType }[]
): Promise<Map<string, QuoteSnapshot>> {
  const results = new Map<string, QuoteSnapshot>();
  const secids = [...new Set(items
    .filter(item => item.type !== 'fund_open')
    .map(item => eastmoneySecid(item.code)))];
  if (secids.length === 0) return results;

  try {
    const params = new URLSearchParams({
      fltt: '2',
      invt: '2',
      fields: 'f12,f13,f14,f2,f3,f5,f15,f16,f17,f18',
      secids: secids.join(','),
    });
    const resp = await fetchWithTimeout(`https://push2.eastmoney.com/api/qt/ulist.np/get?${params.toString()}`);
    if (!resp.ok) throw new Error(`eastmoney listed quote failed: ${resp.status}`);
    for (const entry of readEastmoneyQuoteRows(parseJsonOrJsonp(await resp.text())).map(buildListedQuoteFromEastmoneyRow)) {
      if (entry) {
        results.set(entry[0], entry[1]);
        const shortCode = entry[0].includes('.') ? entry[0].split('.').at(-1) : '';
        if (shortCode) results.set(shortCode, entry[1]);
      }
    }
  } catch (e) {
    console.warn('东方财富上市标的行情兜底请求失败:', e);
  }
  return results;
}

// 刷新所有已添加标的的价格
export async function refreshAllQuotes(instruments: { id: number; code: string; name?: string; type: InstrumentType }[]) {
  const batch: { code: string; type: InstrumentType }[] = instruments.map(i => ({ code: i.code, type: i.type }));
  const quotes = await fetchRealtimeQuotes(batch);
  for (const inst of instruments) {
    const normalizedCode = normalizeInstrumentCode(inst.code);
    const code = usesEastmoneyListedQuote({ code: inst.code, type: inst.type }) ? eastmoneySecid(inst.code) : normalizedCode;
    const q = quotes.get(code) ?? quotes.get(normalizedCode);
    if (q) {
      const quoteName = q.name?.trim();
      const metaPatch: { code?: string; name?: string; type?: InstrumentType } = {};
      if (code !== inst.code) metaPatch.code = code;
      if (inst.type === 'stock' && /^93\d{4}$/.test(normalizedCode)) metaPatch.type = 'index';
      if (quoteName && quoteName !== inst.name && isGeneratedInstrumentName(inst.name, normalizedCode)) metaPatch.name = quoteName;
      if (Object.keys(metaPatch).length > 0) {
        try {
          await updateInstrumentMeta(inst.id, metaPatch);
        } catch (e) {
          console.warn('标的元数据自动修正失败:', e);
        }
      }
      await updateInstrumentPrice(inst.id, {
        latest_price: q.price,
        prev_close: q.prev_close,
        open: q.open,
        high: q.high,
        low: q.low,
        volume: q.volume,
        change_pct: q.change_pct,
      });
    }
  }
}

// 搜索标的（东方财富/新浪模糊搜索接口）
export async function searchInstrumentsRemote(keyword: string): Promise<{
  code: string; name: string; type: InstrumentType; price?: number;
}[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];

  const local = await searchInstrumentsFromLocalDb(trimmed);
  if (shouldUseLocalApi()) {
    const proxied = await searchInstrumentsFromLocalApi(trimmed);
    const fallback = mergeSearchResults(buildFuzzyFallback(trimmed), buildExactCodeFallback(trimmed));
    return rankSearchResults(trimmed, mergeSearchResults(local, proxied, fallback));
  }

  const exactOpenFund = await searchExactOpenFundFromSina(trimmed);
  const fallback = mergeSearchResults(exactOpenFund, buildFuzzyFallback(trimmed), buildExactCodeFallback(trimmed));
  const remote = await searchInstrumentsFromEastmoney(trimmed);
  return rankSearchResults(trimmed, mergeSearchResults(local, remote, fallback));
}

async function searchInstrumentsFromLocalDb(keyword: string): Promise<SearchResult[]> {
  try {
    const rows = await searchLocalInstruments(keyword);
    return rows.map(row => ({
      code: normalizeSearchCode(row.code),
      name: row.name,
      type: row.type,
      ...(row.latest_price && row.latest_price > 0 ? { price: row.latest_price } : {}),
    }));
  } catch (e) {
    console.warn('本地标的模糊搜索失败:', e);
    return [];
  }
}

async function searchInstrumentsFromLocalApi(keyword: string): Promise<SearchResult[]> {
  try {
    const resp = await fetchWithTimeout(`${LOCAL_API_BASE}/search-instruments?keyword=${encodeURIComponent(keyword)}`);
    if (!resp.ok) throw new Error(`local search proxy failed: ${resp.status}`);
    return normalizeSearchPayload(await resp.json());
  } catch (e) {
    console.warn('本地搜索代理请求失败:', e);
    return [];
  }
}

async function searchInstrumentsFromEastmoney(keyword: string): Promise<SearchResult[]> {
  try {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=30`;
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) throw new Error(`eastmoney search failed: ${resp.status}`);
    return normalizeSearchPayload(await resp.json());
  } catch (e) {
    console.warn('搜索接口请求失败:', e);
    return [];
  }
}

function dateSpanDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 300;
  return Math.ceil((end - start) / 86400000);
}

function historyRequestSize(startDate: string, endDate: string): number {
  const days = dateSpanDays(startDate, endDate);
  return Math.min(5000, Math.max(300, Math.ceil(days * 1.2)));
}

async function fetchHistoryKlineFromLocalApi(
  code: string,
  type: InstrumentType,
  startDate: string,
  endDate: string
): Promise<HistoryKlineItem[]> {
  try {
    const params = new URLSearchParams({
      code: normalizeSearchCode(code),
      type,
      startDate,
      endDate,
    });
    const resp = await fetchWithTimeout(`${LOCAL_API_BASE}/history-kline?${params.toString()}`);
    if (!resp.ok) throw new Error(`local history proxy failed: ${resp.status}`);
    const data = await resp.json();
    const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    return rows
      .map((row: any) => {
        const close = parseFiniteNumber(row?.close);
        const tradeDate = firstString(row?.trade_date, row?.tradeDate, row?.date).replace(/\//g, '-');
        if (!tradeDate || close === undefined || close <= 0) return null;
        return {
          trade_date: tradeDate,
          open: parseFiniteNumber(row?.open) ?? close,
          close,
          high: parseFiniteNumber(row?.high) ?? close,
          low: parseFiniteNumber(row?.low) ?? close,
          volume: parseFiniteNumber(row?.volume) ?? 0,
          change_pct: parseFiniteNumber(row?.change_pct, row?.changePct) ?? 0,
        };
      })
      .filter((item: HistoryKlineItem | null): item is HistoryKlineItem => Boolean(item))
      .sort((a: HistoryKlineItem, b: HistoryKlineItem) => a.trade_date.localeCompare(b.trade_date));
  } catch (e) {
    console.warn('本地历史行情代理请求失败:', e);
    return [];
  }
}

// 获取历史K线数据（使用腾讯财经接口）
export async function fetchHistoryKline(
  code: string,
  type: InstrumentType,
  startDate: string, // YYYY-MM-DD
  endDate: string
): Promise<HistoryKlineItem[]> {
  if (shouldUseLocalApi()) {
    return fetchHistoryKlineFromLocalApi(code, type, startDate, endDate);
  }

  const results: HistoryKlineItem[] = [];
  try {
    let secid = '';
    if (type === 'fund_open') {
      // 场外基金历史净值（东方财富）
      const pageSize = historyRequestSize(startDate, endDate);
      const allRows: Record<string, unknown>[] = [];
      const maxPages = Math.min(150, Math.max(1, Math.ceil(historyRequestSize(startDate, endDate) / EASTMONEY_FUND_NAV_PAGE_SIZE) + 5));
      for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
        const params = new URLSearchParams({
          fundCode: normalizeInstrumentCode(code),
          pageIndex: String(pageIndex),
          pageSize: String(EASTMONEY_FUND_NAV_PAGE_SIZE),
          startDate,
          endDate,
        });
        const resp = await fetchWithTimeout(`${EASTMONEY_FUND_NAV_URL}?${params.toString()}`, {
          headers: { 'Referer': 'https://fundf10.eastmoney.com/' },
        });
        if (!resp.ok) throw new Error(`eastmoney fund history failed: ${resp.status}`);
        const payload = parseJsonOrJsonp(await resp.text());
        const rows = readFundNavRows(payload);
        if (rows.length === 0) break;
        allRows.push(...rows);

        const totalCount = parseFiniteNumber(asRecord(payload)?.TotalCount) ?? 0;
        if (rows.length < EASTMONEY_FUND_NAV_PAGE_SIZE || (totalCount > 0 && allRows.length >= totalCount)) break;
      }

      const navRows = Array.from(new Map(
        allRows
          .filter(row => firstString(row.FSRQ))
          .map(row => [firstString(row.FSRQ).replace(/\//g, '-'), row] as const),
      ).entries())
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .map(([, row]) => row);
      let prevClose = 0;
      for (const it of navRows) {
        const close = parseFiniteNumber(it.DWJZ) ?? 0;
        const date = firstString(it.FSRQ).replace(/\//g, '-');
        if (!date || close <= 0) continue;
        const change = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : (parseFiniteNumber(it.JZZZL) ?? 0);
        results.push({
          trade_date: date,
          open: close,
          close,
          high: close,
          low: close,
          volume: 0,
          change_pct: Math.round(change * 100) / 100,
        });
        prevClose = close;
      }
    } else {
      // A股/场内基金 - 使用腾讯日K线
      secid = eastmoneySecid(code);
      const limit = historyRequestSize(startDate, endDate);
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&beg=${startDate.replace(/-/g,'')}&end=${endDate.replace(/-/g,'')}&limit=${limit}`;
      const resp = await fetchWithTimeout(url);
      const data = await resp.json();
      if (data?.data?.klines) {
        let prevClose = 0;
        for (const line of data.data.klines) {
          const parts = line.split(',');
          // 日期,开,收,高,低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
          if (parts.length >= 9) {
            const open = parseFloat(parts[1]);
            const close = parseFloat(parts[2]);
            const high = parseFloat(parts[3]);
            const low = parseFloat(parts[4]);
            const vol = parseFloat(parts[5]);
            const change_pct = parseFloat(parts[8]);
            results.push({
              trade_date: parts[0],
              open, close, high, low,
              volume: vol,
              change_pct,
            });
            prevClose = close;
          }
        }
      }
    }
  } catch (e) {
    console.warn('历史K线获取失败:', e);
  }
  return results;
}

// 封装：拉取并保存历史数据
export async function fetchAndSaveHistory(
  instrumentId: number,
  code: string,
  type: InstrumentType,
  startDate: string,
  endDate: string
) {
  const data = await fetchHistoryKline(code, type, startDate, endDate);
  if (data.length > 0) {
    await savePriceHistory(instrumentId, data);
  }
  return data;
}
