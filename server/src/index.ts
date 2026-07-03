import express from "express";
import cors from "cors";
import type { Response as ExpressResponse } from "express";

type InstrumentType =
  | "stock"
  | "stock_hk"
  | "stock_us"
  | "stock_global"
  | "index"
  | "fund_etf"
  | "fund_open";

type SearchItem = {
  code: string;
  name: string;
  type: InstrumentType;
  price?: number;
};

type FuzzySearchItem = SearchItem & {
  aliases?: string[];
};

type QuoteRequestItem = {
  code: string;
  type: InstrumentType;
};

type QuoteItem = {
  code: string;
  name: string;
  price: number;
  open: number;
  prev_close: number;
  high: number;
  low: number;
  volume: number;
  change_pct: number;
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

type MarketBoardCategory = "industry" | "concept";
type MarketBoardSort = "gain" | "loss";

type MarketBoardItem = {
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

type HotListPeriod = "hour" | "day";

type HotListItem = {
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

type MarketIndexItem = {
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

const app = express();
const port = process.env.PORT || 9091;

const EASTMONEY_SEARCH_TOKEN = "D43BF722C8E33BDC906FB84D85E326E8";
const EASTMONEY_SEARCH_URL = "https://searchapi.eastmoney.com/api/suggest/get";
const EASTMONEY_FUND_NAV_URL = "https://api.fund.eastmoney.com/f10/lsjz";
const EASTMONEY_LISTED_QUOTE_URL = "https://push2.eastmoney.com/api/qt/ulist.np/get";
const EASTMONEY_BOARD_LIST_URL = "https://push2.eastmoney.com/api/qt/clist/get";
const EASTMONEY_BOARD_HISTORY_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const TONGHUASHUN_BOARD_BASE_URL = "https://q.10jqka.com.cn";
const TONGHUASHUN_HOT_LIST_URL = "https://eq.10jqka.com.cn/open/api/hot_list/v1/hot_stock/a";
const SINA_QUOTE_URL = "https://hq.sinajs.cn/list=";
const EASTMONEY_FUND_NAV_PAGE_SIZE = 20;
const UPSTREAM_TIMEOUT_MS = 5000;
const BOARD_FALLBACK_PAGE_SIZE = 100;
const BOARD_FALLBACK_MAX_PAGES = 20;
const BOARD_FALLBACK_CONCURRENCY = 8;
const TONGHUASHUN_BOARD_MAX_PAGES = 20;

const COMMON_FUZZY_ITEMS: FuzzySearchItem[] = [
  { code: "600519", name: "贵州茅台", type: "stock", aliases: ["茅台", "gzmt", "maotai", "guizhoumaotai"] },
  { code: "000858", name: "五粮液", type: "stock", aliases: ["wly", "wuliangye"] },
  { code: "300750", name: "宁德时代", type: "stock", aliases: ["宁德", "ndsd", "catl", "ningdeshidai"] },
  { code: "002594", name: "比亚迪", type: "stock", aliases: ["byd", "biyadi"] },
  { code: "600036", name: "招商银行", type: "stock", aliases: ["招行", "zsyh", "cmb", "zhaoshangyinhang"] },
  { code: "601318", name: "中国平安", type: "stock", aliases: ["平安", "zgpa", "pingan"] },
  { code: "300059", name: "东方财富", type: "stock", aliases: ["东财", "dfcf", "eastmoney"] },
  { code: "688981", name: "中芯国际", type: "stock", aliases: ["中芯", "zxgj", "smic"] },
  { code: "600276", name: "恒瑞医药", type: "stock", aliases: ["恒瑞", "hryy", "hengrui"] },
  { code: "600030", name: "中信证券", type: "stock", aliases: ["中信", "zxzq", "citic"] },
  { code: "510300", name: "沪深300ETF", type: "fund_etf", aliases: ["沪深300", "hs300", "300etf"] },
  { code: "510500", name: "中证500ETF", type: "fund_etf", aliases: ["中证500", "zz500", "500etf"] },
  { code: "510050", name: "上证50ETF", type: "fund_etf", aliases: ["上证50", "sz50", "50etf"] },
  { code: "159915", name: "创业板ETF", type: "fund_etf", aliases: ["创业板", "cyb", "gemetf"] },
  { code: "588000", name: "科创50ETF", type: "fund_etf", aliases: ["科创50", "kc50", "star50"] },
  { code: "512100", name: "中证1000ETF", type: "fund_etf", aliases: ["中证1000", "zz1000", "1000etf"] },
  { code: "513100", name: "纳指ETF", type: "fund_etf", aliases: ["纳斯达克", "纳指100", "nasdaq", "ndx"] },
  { code: "518880", name: "黄金ETF", type: "fund_etf", aliases: ["黄金", "gold"] },
  { code: "161725", name: "招商中证白酒指数", type: "fund_open", aliases: ["白酒", "中证白酒", "baijiu", "zzbj"] },
  { code: "005827", name: "易方达蓝筹精选混合", type: "fund_open", aliases: ["蓝筹", "易方达蓝筹", "yfdlc"] },
  { code: "260108", name: "景顺长城新兴成长混合", type: "fund_open", aliases: ["景顺新兴", "新兴成长", "jsxingcheng"] },
  { code: "003095", name: "中欧医疗健康混合A", type: "fund_open", aliases: ["中欧医疗", "医疗健康", "zoyl"] },
  { code: "519674", name: "银河创新成长混合", type: "fund_open", aliases: ["银河创新", "创新成长", "yhcx"] },
  { code: "161005", name: "富国天惠成长混合", type: "fund_open", aliases: ["富国天惠", "天惠成长", "fgth"] },
];

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/api/v1/health", (req, res) => {
  console.log("Health check success");
  res.status(200).json({ status: "ok" });
});

app.get("/api/v1/search-instruments", async (req, res) => {
  const keyword = firstString(req.query.keyword, req.query.input);
  if (!keyword) {
    res.status(200).json({ items: [] });
    return;
  }

  const exactOpenFundItems = await searchExactOpenFundFromSina(keyword);
  try {
    const params = new URLSearchParams({
      input: keyword,
      type: "14",
      token: EASTMONEY_SEARCH_TOKEN,
      count: "30",
    });
    const response = await fetchWithTimeout(`${EASTMONEY_SEARCH_URL}?${params.toString()}`, {
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://quote.eastmoney.com/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`Eastmoney search failed: ${response.status}`);
    }

    const text = await response.text();
    const payload = parseJsonOrJsonp(text);
    const remoteItems = normalizeSearchPayload(payload);
    const items = rankSearchItems(keyword, mergeSearchItems(remoteItems, exactOpenFundItems, buildFuzzyFallback(keyword), buildExactCodeFallback(keyword)));
    res.status(200).json({ items, source: "eastmoney" });
  } catch (error) {
    console.warn("Search proxy failed:", error);
    res.status(200).json({
      items: rankSearchItems(keyword, mergeSearchItems(exactOpenFundItems, buildFuzzyFallback(keyword), buildExactCodeFallback(keyword))),
      source: "fallback",
      warning: "remote_search_failed",
    });
  }
});

app.get("/api/v1/realtime-quotes", async (req, res) => {
  await sendRealtimeQuotesResponse(req.query.items, res);
});

app.post("/api/v1/realtime-quotes", async (req, res) => {
  await sendRealtimeQuotesResponse(req.body?.items, res);
});

app.get("/api/v1/market-boards", async (req, res) => {
  try {
    const category = normalizeBoardCategory(req.query.category);
    const sort = normalizeBoardSort(req.query.sort);
    const rawPage = parseFiniteNumber(req.query.page) ?? 1;
    const rawPageSize = parseFiniteNumber(req.query.pageSize, req.query.limit) ?? 50;
    const page = Math.max(1, Math.round(rawPage));
    const pageSize = Math.max(1, Math.min(Math.round(rawPageSize), 100));
    const items = await fetchMarketBoards(category, page, pageSize, sort);
    res.status(200).json({ items });
  } catch (error) {
    console.warn("Market boards endpoint failed:", error);
    res.status(200).json({ items: [], warning: "market_boards_failed" });
  }
});

app.get("/api/v1/hot-list", async (req, res) => {
  try {
    const period = normalizeHotListPeriod(req.query.period);
    const rawPage = parseFiniteNumber(req.query.page) ?? 1;
    const rawPageSize = parseFiniteNumber(req.query.pageSize, req.query.limit) ?? 50;
    const page = Math.max(1, Math.round(rawPage));
    const pageSize = Math.max(1, Math.min(Math.round(rawPageSize), 100));
    const items = await fetchHotList(period, page, pageSize);
    res.status(200).json({ items });
  } catch (error) {
    console.warn("Hot list endpoint failed:", error);
    res.status(200).json({ items: [], warning: "hot_list_failed" });
  }
});

app.get("/api/v1/market-indices", async (req, res) => {
  try {
    const sort = normalizeBoardSort(req.query.sort);
    const rawPage = parseFiniteNumber(req.query.page) ?? 1;
    const rawPageSize = parseFiniteNumber(req.query.pageSize, req.query.limit) ?? 50;
    const page = Math.max(1, Math.round(rawPage));
    const pageSize = Math.max(1, Math.min(Math.round(rawPageSize), 100));
    const items = await fetchMarketIndices(page, pageSize, sort);
    res.status(200).json({ items });
  } catch (error) {
    console.warn("Market indices endpoint failed:", error);
    res.status(200).json({ items: [], warning: "market_indices_failed" });
  }
});

app.get("/api/v1/history-kline", async (req, res) => {
  try {
    const code = normalizeInstrumentCode(req.query.code);
    const type = inferInstrumentType(code, { type: firstString(req.query.type) });
    const startDate = normalizeDateParam(req.query.startDate, req.query.start);
    const endDate = normalizeDateParam(req.query.endDate, req.query.end);
    if (!(/^\d{6}$/.test(code) || isEastmoneySecid(code)) || !startDate || !endDate) {
      res.status(200).json({ items: [], warning: "invalid_history_params" });
      return;
    }

    const items = await fetchHistoryKline(code, type, startDate, endDate);
    res.status(200).json({ items });
  } catch (error) {
    console.warn("History kline endpoint failed:", error);
    res.status(200).json({ items: [], warning: "history_kline_failed" });
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
});

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && text !== "undefined" && text !== "null") return text;
  }
  return "";
}

function normalizeFuzzyText(value: unknown): string {
  return firstString(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeInstrumentCode(value: unknown): string {
  const raw = firstString(value).replace(/\s+/g, "").toUpperCase();
  if (/^\d+\.[A-Z0-9._-]+$/.test(raw)) return raw;
  const dotted = raw.match(/(?:^|\.)(\d{6})$/)?.[1];
  if (dotted) return dotted;
  const prefixed = raw.match(/^(?:SH|SZ|BJ)(\d{6})$/)?.[1];
  return prefixed ?? raw;
}

function normalizeQuoteCodeForType(code: string, type: InstrumentType, raw?: Record<string, unknown>): string {
  if (type === "stock_hk" || type === "stock_us" || type === "stock_global" || type === "index") {
    const quoteId = firstString(raw?.QuoteID, raw?.quoteId);
    if (/^\d+\.[A-Z0-9._-]+$/i.test(quoteId)) return quoteId.toUpperCase();
    const mktNum = firstString(raw?.MktNum, raw?.MarketType, raw?.Market, raw?.mktNum);
    if (mktNum && code) return `${mktNum}.${code}`.toUpperCase();
  }
  return normalizeInstrumentCode(code);
}

function parseFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const text = firstString(value).replace(/,/g, "");
    if (!text || text === "-") continue;
    const number = Number(text);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function normalizeBoardCategory(value: unknown): MarketBoardCategory {
  return firstString(value) === "concept" ? "concept" : "industry";
}

function normalizeBoardSort(value: unknown): MarketBoardSort {
  return firstString(value) === "loss" ? "loss" : "gain";
}

function normalizeHotListPeriod(value: unknown): HotListPeriod {
  return firstString(value) === "day" ? "day" : "hour";
}

function normalizeDateParam(...values: unknown[]): string {
  const text = firstString(...values);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return "";
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
  if (/^93\d{4}$/.test(code)) return "index";
  if (isListedFundCode(code)) return "fund_etf";
  return isLikelyStockCode(code) ? "stock" : "fund_open";
}

function inferInstrumentType(code: string, raw?: Record<string, unknown>): InstrumentType {
  const explicit = firstString(raw?.type, raw?.instrument_type);
  if (
    explicit === "stock" ||
    explicit === "stock_hk" ||
    explicit === "stock_us" ||
    explicit === "stock_global" ||
    explicit === "index" ||
    explicit === "fund_etf" ||
    explicit === "fund_open"
  ) {
    return explicit;
  }

  const mktNum = firstString(raw?.MktNum, raw?.MarketType, raw?.Market, raw?.mktNum);
  const marketType = firstString(raw?.MarketType, raw?.Market);
  const securityType = firstString(raw?.SecurityType, raw?.securityType);
  const quoteId = firstString(raw?.QuoteID, raw?.quoteId);
  const classify = firstString(raw?.Classify, raw?.classify).toUpperCase();
  const exchange = firstString(raw?.JYS, raw?.Exchange, raw?.exchange).toUpperCase();
  const typeName = firstString(raw?.SecurityTypeName, raw?.TypeName, raw?.SecurityType, raw?.typeName);
  const name = firstString(raw?.Name, raw?.name, raw?.SecurityName, raw?.SECURITY_NAME, raw?.ShortName, raw?.shortName, raw?.JC);
  const typeNameUpper = typeName.toUpperCase();
  const isFundName = typeName.includes("\u57fa\u91d1") || typeNameUpper.includes("FUND");
  const nameUpper = name.toUpperCase();
  const isOtcFund = exchange.includes("OTCFUND") || classify.includes("OTCFUND") || mktNum === "150" || marketType === "6" || securityType === "17" || quoteId.startsWith("150.");
  const quoteMarket = quoteId.match(/^(\d+)\./)?.[1];

  if (isOtcFund || mktNum === "113") return "fund_open";
  if (typeName.includes("\u6307\u6570") || securityType === "11" || classify.includes("INDEX")) return "index";
  if (classify.includes("USSTOCK") || typeName.includes("\u7f8e\u80a1") || marketType === "7" || ["105", "106", "107"].includes(mktNum)) return "stock_us";
  if (classify === "HK" || exchange === "HK" || typeName.includes("\u6e2f\u80a1") || marketType === "5" || mktNum === "116") return "stock_hk";
  if (quoteMarket && !["0", "1", "113", "150"].includes(quoteMarket)) return "stock_global";
  if (typeName.includes("\u80a1\u7968") || typeName.includes("\u7c89\u5355") || classify.includes("STOCK")) return "stock_global";
  if (typeNameUpper.includes("ETF") || typeNameUpper.includes("LOF") || typeNameUpper.includes("REIT") || nameUpper.includes("ETF") || nameUpper.includes("LOF") || nameUpper.includes("REIT")) {
    return "fund_etf";
  }
  if (isListedFundCode(code)) return "fund_etf";
  if (isFundName) return "fund_open";
  return "stock";
}

function collectRows(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || value == null) return [];
  if (Array.isArray(value)) {
    const looksLikeRows = value.some(item => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return "Code" in row || "code" in row || "SecurityCode" in row || "FundCode" in row;
    });
    if (looksLikeRows) return value.filter(item => item && typeof item === "object") as Record<string, unknown>[];
    return value.flatMap(item => collectRows(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(item => collectRows(item, depth + 1));
  }
  return [];
}

function normalizeSearchPayload(payload: unknown): SearchItem[] {
  const seen = new Set<string>();
  const results: SearchItem[] = [];
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

function mergeSearchItems(...groups: SearchItem[][]): SearchItem[] {
  const indexes = new Map<string, number>();
  const merged: SearchItem[] = [];
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

function rankSearchItems(keyword: string, items: SearchItem[]): SearchItem[] {
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(item, keyword) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.item);
}

function buildFuzzyFallback(keyword: string): SearchItem[] {
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

function buildExactCodeFallback(keyword: string): SearchItem[] {
  const code = normalizeInstrumentCode(keyword);
  if (!/^\d{6}$/.test(code)) return [];
  const type = inferExactCodeFallbackType(code);
  const label = type === "stock" ? "A\u80a1" : type === "index" ? "\u6307\u6570" : type === "fund_etf" ? "\u573a\u5185\u57fa\u91d1" : "\u573a\u5916\u57fa\u91d1";
  return [{ code, name: `${label} ${code}`, type }];
}

async function searchExactOpenFundFromSina(keyword: string): Promise<SearchItem[]> {
  const code = normalizeInstrumentCode(keyword);
  if (!/^\d{6}$/.test(code)) return [];

  const quotes = await fetchSinaQuotes([{ code, type: "fund_open" }]);
  const quote = quotes.find(item => item.code === code);
  const name = quote?.name?.trim();
  if (!quote || quote.price <= 0 || !name || name === code) return [];
  return [{ code, name, type: "fund_open", price: quote.price }];
}

function parseJsonOrJsonp(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("(");
    const end = trimmed.lastIndexOf(")");
    if (start < 0 || end <= start) throw new Error("Response is not JSON");
    return JSON.parse(trimmed.slice(start + 1, end));
  }
}

function parseQuoteItems(value: unknown): QuoteRequestItem[] {
  let raw = value;
  if (typeof raw === "string") {
    const rawText = raw;
    try {
      raw = JSON.parse(rawText);
    } catch {
      raw = rawText.split(",").map((code: string) => ({ code, type: inferInstrumentType(normalizeInstrumentCode(code)) }));
    }
  }

  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const code = normalizeInstrumentCode(row.code);
      if (!code) return null;
      return { code, type: inferInstrumentType(code, row) };
    })
    .filter((item): item is QuoteRequestItem => Boolean(item));
}

async function sendRealtimeQuotesResponse(value: unknown, res: ExpressResponse): Promise<void> {
  try {
    const items = parseQuoteItems(value);
    const quotes = await fetchSinaQuotes(items);
    res.status(200).json({ items: quotes });
  } catch (error) {
    console.warn("Realtime quote endpoint failed:", error);
    res.status(200).json({ items: [], warning: "realtime_quote_failed" });
  }
}

async function fetchWithTimeout(
  url: string,
  options: Parameters<typeof fetch>[1] = {},
  timeoutMs = UPSTREAM_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readUpstreamText(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (/\b(?:gbk|gb2312|gb18030)\b/i.test(contentType)) {
    return new TextDecoder("gb18030").decode(await response.arrayBuffer());
  }
  return response.text();
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .trim();
}

function sinaSymbol(code: string, type: InstrumentType): string {
  const normalizedCode = normalizeInstrumentCode(code);
  if (type === "fund_open") return `fu_${normalizedCode}`;
  if (normalizedCode.startsWith("6") || normalizedCode.startsWith("5") || normalizedCode.startsWith("9")) {
    return `sh${normalizedCode}`;
  }
  return `sz${normalizedCode}`;
}

function isEastmoneySecid(code: string): boolean {
  return /^\d+\.[A-Z0-9._-]+$/i.test(normalizeInstrumentCode(code));
}

function usesEastmoneyListedQuote(item: QuoteRequestItem): boolean {
  return item.type === "stock_hk" || item.type === "stock_us" || item.type === "stock_global" || item.type === "index" || /^93\d{4}$/.test(normalizeInstrumentCode(item.code)) || isEastmoneySecid(item.code);
}

async function fetchSinaQuotes(items: QuoteRequestItem[]): Promise<QuoteItem[]> {
  if (items.length === 0) return [];

  const sinaItems = items.filter(item => !usesEastmoneyListedQuote(item));
  const eastmoneyItems = items.filter(usesEastmoneyListedQuote);
  let quotes: QuoteItem[] = [];
  if (sinaItems.length > 0) {
    const symbols = sinaItems.map(item => sinaSymbol(item.code, item.type)).join(",");
    try {
      const response = await fetchWithTimeout(`${SINA_QUOTE_URL}${symbols}`, {
        headers: {
          accept: "text/plain,*/*",
          referer: "https://finance.sina.com.cn",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`Sina quote failed: ${response.status}`);
      }
      quotes = parseSinaQuoteText(await readUpstreamText(response));
    } catch (error) {
      console.warn("Realtime quote proxy failed:", error);
    }
  }

  const quotedCodes = new Set(quotes.map(item => item.code));
  const missingListedItems = [
    ...eastmoneyItems,
    ...sinaItems
    .filter(item => item.type !== "fund_open")
    .filter(item => !quotedCodes.has(normalizeInstrumentCode(item.code))),
  ];
  const missingOpenFundCodes = items
    .filter(item => item.type === "fund_open")
    .map(item => normalizeInstrumentCode(item.code))
    .filter(code => !quotedCodes.has(code));
  const [listedFallbackQuotes, fallbackQuotes] = await Promise.all([
    fetchEastmoneyListedQuotes(missingListedItems),
    fetchEastmoneyOpenFundQuotes(missingOpenFundCodes),
  ]);
  return mergeQuoteItems(quotes, listedFallbackQuotes, fallbackQuotes);
}

function mergeQuoteItems(...groups: QuoteItem[][]): QuoteItem[] {
  const merged = new Map<string, QuoteItem>();
  for (const group of groups) {
    for (const item of group) {
      merged.set(item.code, item);
      const shortCode = item.code.includes(".") ? item.code.split(".").at(-1) : "";
      if (shortCode && !merged.has(shortCode)) {
        merged.set(shortCode, { ...item, code: shortCode });
      }
    }
  }
  return Array.from(merged.values());
}

function parseSinaOpenFundQuote(code: string, data: string[]): QuoteItem | null {
  const name = firstString(data[0], code);
  const hasTimeField = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(firstString(data[1]));
  const price = hasTimeField ? parseFiniteNumber(data[2]) : parseFiniteNumber(data[1]);
  if (price === undefined || price <= 0) return null;

  const prevClose = (hasTimeField ? parseFiniteNumber(data[3]) : parseFiniteNumber(data[3], data[1])) ?? price;
  const changePct = parseFiniteNumber(data[6]) ?? (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0);
  return {
    code,
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
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function eastmoneySecid(code: string): string {
  const normalizedCode = normalizeInstrumentCode(code);
  if (isEastmoneySecid(normalizedCode)) return normalizedCode;
  if (/^93\d{4}$/.test(normalizedCode)) return `2.${normalizedCode}`;
  const market = normalizedCode.startsWith("6") || normalizedCode.startsWith("5") || normalizedCode.startsWith("9") ? "1" : "0";
  return `${market}.${normalizedCode}`;
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

function readEastmoneyQuoteRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const diff = data?.diff;
  if (!Array.isArray(diff)) return [];
  return diff.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
}

function buildListedQuoteFromEastmoneyRow(row: Record<string, unknown>): QuoteItem | null {
  const shortCode = normalizeInstrumentCode(row.f12);
  const market = firstString(row.f13);
  const price = parseFiniteNumber(row.f2);
  if (!shortCode || price === undefined || price <= 0) return null;

  const code = market && !["0", "1"].includes(market) ? `${market}.${shortCode}` : shortCode;
  const prevClose = parseFiniteNumber(row.f18) ?? price;
  return {
    code,
    name: firstString(row.f14, shortCode),
    price,
    open: parseFiniteNumber(row.f17) ?? price,
    prev_close: prevClose,
    high: parseFiniteNumber(row.f15) ?? price,
    low: parseFiniteNumber(row.f16) ?? price,
    volume: parseFiniteNumber(row.f5) ?? 0,
    change_pct: parseFiniteNumber(row.f3) ?? (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0),
  };
}

function buildMarketBoardFromEastmoneyRow(row: Record<string, unknown>): MarketBoardItem | null {
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
}

function buildMarketBoardListItemFromEastmoneyRow(row: Record<string, unknown>): Pick<MarketBoardItem, "code" | "name"> | null {
  const code = firstString(row.f12);
  const name = firstString(row.f14);
  return code && name ? { code, name } : null;
}

function buildMarketBoardFromKline(
  board: Pick<MarketBoardItem, "code" | "name">,
  line: string,
  fallbackName?: string,
): MarketBoardItem | null {
  const parts = line.split(",");
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

function buildMarketBoardScanCandidates(): Pick<MarketBoardItem, "code" | "name">[] {
  return Array.from({ length: 901 }, (_, index) => ({
    code: `BK${String(index + 400).padStart(4, "0")}`,
    name: "",
  }));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R | null>,
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

async function fetchMarketBoards(
  category: MarketBoardCategory,
  page: number,
  pageSize: number,
  sort: MarketBoardSort,
): Promise<MarketBoardItem[]> {
  const realtimeItems = await fetchMarketBoardsRealtime(category, page, pageSize, sort);
  if (realtimeItems.length > 0) return realtimeItems;
  const tonghuashunItems = await fetchMarketBoardsFromTonghuashun(category, page, pageSize, sort);
  if (tonghuashunItems.length > 0) return tonghuashunItems;
  return fetchMarketBoardsFromDailyKline(category, page, pageSize, sort);
}

async function fetchMarketBoardsRealtime(
  category: MarketBoardCategory,
  page: number,
  pageSize: number,
  sort: MarketBoardSort,
): Promise<MarketBoardItem[]> {
  try {
    const params = new URLSearchParams({
      pn: String(page),
      pz: String(pageSize),
      po: sort === "loss" ? "0" : "1",
      np: "1",
      fltt: "2",
      invt: "2",
      fid: "f3",
      fs: category === "concept" ? "m:90+t:3" : "m:90+t:2",
      fields: "f12,f14,f2,f3,f4,f5,f6,f128,f136,f140,f141",
    });
    const response = await fetchWithTimeout(`${EASTMONEY_BOARD_LIST_URL}?${params.toString()}`, {
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://quote.eastmoney.com/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`Eastmoney market boards failed: ${response.status}`);
    }
    return readEastmoneyQuoteRows(parseJsonOrJsonp(await response.text()))
      .map(buildMarketBoardFromEastmoneyRow)
      .filter((item): item is MarketBoardItem => Boolean(item));
  } catch (error) {
    console.warn("Market boards fetch failed:", error);
    return [];
  }
}

async function fetchMarketBoardList(category: MarketBoardCategory): Promise<Pick<MarketBoardItem, "code" | "name">[]> {
  const results: Pick<MarketBoardItem, "code" | "name">[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= BOARD_FALLBACK_MAX_PAGES; page += 1) {
    try {
      const params = new URLSearchParams({
        pn: String(page),
        pz: String(BOARD_FALLBACK_PAGE_SIZE),
        po: "1",
        np: "1",
        fltt: "2",
        invt: "2",
        fid: "f12",
        fs: category === "concept" ? "m:90+t:3" : "m:90+t:2",
        fields: "f12,f14",
      });
      const response = await fetchWithTimeout(`${EASTMONEY_BOARD_LIST_URL}?${params.toString()}`, {
        headers: {
          accept: "application/json,text/plain,*/*",
          referer: "https://quote.eastmoney.com/",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`Eastmoney market board list failed: ${response.status}`);
      }
      const items = readEastmoneyQuoteRows(parseJsonOrJsonp(await response.text()))
        .map(buildMarketBoardListItemFromEastmoneyRow)
        .filter((item): item is Pick<MarketBoardItem, "code" | "name"> => Boolean(item));
      for (const item of items) {
        if (seen.has(item.code)) continue;
        seen.add(item.code);
        results.push(item);
      }
      if (items.length < BOARD_FALLBACK_PAGE_SIZE) break;
    } catch (error) {
      console.warn("Market board list fetch failed:", error);
      break;
    }
  }
  return results;
}

async function fetchMarketBoardFromDailyKline(
  board: Pick<MarketBoardItem, "code" | "name">,
  options: { quiet?: boolean } = {},
): Promise<MarketBoardItem | null> {
  try {
    const params = new URLSearchParams({
      secid: `90.${board.code}`,
      fields1: "f1,f2,f3,f4,f5,f6",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
      klt: "101",
      fqt: "1",
      end: "20500101",
      lmt: "2",
    });
    const response = await fetchWithTimeout(`${EASTMONEY_BOARD_HISTORY_URL}?${params.toString()}`, {
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://quote.eastmoney.com/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`Eastmoney market board history failed: ${response.status}`);
    }
    const root = asRecord(parseJsonOrJsonp(await response.text()));
    const data = asRecord(root?.data);
    const klines = data?.klines;
    if (!Array.isArray(klines) || klines.length === 0) return null;
    return buildMarketBoardFromKline(board, firstString(klines.at(-1)), firstString(data?.name));
  } catch (error) {
    if (!options.quiet) console.warn("Market board history fallback failed:", error);
    return null;
  }
}

async function fetchMarketBoardsFromDailyKline(
  category: MarketBoardCategory,
  page: number,
  pageSize: number,
  sort: MarketBoardSort,
): Promise<MarketBoardItem[]> {
  const boardList = await fetchMarketBoardList(category);
  const boards = boardList.length > 0 ? boardList : buildMarketBoardScanCandidates();
  const items = await mapWithConcurrency(
    boards,
    BOARD_FALLBACK_CONCURRENCY,
    board => fetchMarketBoardFromDailyKline(board, { quiet: boardList.length === 0 }),
  );
  return items
    .sort((a, b) => sort === "loss" ? a.change_pct - b.change_pct : b.change_pct - a.change_pct)
    .slice((page - 1) * pageSize, page * pageSize);
}

function parseTonghuashunBoardRows(html: string): MarketBoardItem[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  return rows
    .map(row => {
      const cells = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
      if (cells.length < 12) return null;

      const boardMatch = cells[1].match(/detail\/code\/(\d+)/i);
      const leadingStockMatch = cells[9].match(/stockpage\.10jqka\.com\.cn\/(\d+)/i);
      const code = firstString(boardMatch?.[1]);
      const name = stripHtml(cells[1]);
      const changePct = parseFiniteNumber(stripHtml(cells[2]));
      if (!code || !name || changePct === undefined) return null;

      const leadingStockName = stripHtml(cells[9]);
      const leadingStockCode = firstString(leadingStockMatch?.[1]);
      const leadingStockChangePct = parseFiniteNumber(stripHtml(cells[11]));

      return {
        code,
        name,
        price: parseFiniteNumber(stripHtml(cells[8])) ?? 0,
        change_pct: changePct,
        change_amount: 0,
        volume: parseFiniteNumber(stripHtml(cells[3])) ?? 0,
        amount: parseFiniteNumber(stripHtml(cells[4])) ?? 0,
        ...(leadingStockName ? { leading_stock_name: leadingStockName } : {}),
        ...(leadingStockCode ? { leading_stock_code: leadingStockCode } : {}),
        ...(leadingStockChangePct !== undefined ? { leading_stock_change_pct: leadingStockChangePct } : {}),
      };
    })
    .filter((item): item is MarketBoardItem => Boolean(item));
}

function parseTonghuashunFundBoardRows(html: string): MarketBoardItem[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  return rows
    .map(row => {
      const cells = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
      if (cells.length < 11) return null;

      const boardMatch = cells[1].match(/detail\/code\/(\d+)/i);
      const leadingStockMatch = cells[8].match(/stockpage\.10jqka\.com\.cn\/(\d+)/i);
      const name = stripHtml(cells[1]);
      const code = firstString(boardMatch?.[1], `ths_${name}`);
      const changePct = parseFiniteNumber(stripHtml(cells[3]).replace("%", ""));
      if (!code || !name || changePct === undefined) return null;

      const leadingStockName = stripHtml(cells[8]);
      const leadingStockCode = firstString(leadingStockMatch?.[1]);
      const leadingStockChangePct = parseFiniteNumber(stripHtml(cells[9]).replace("%", ""));

      return {
        code,
        name,
        price: parseFiniteNumber(stripHtml(cells[2])) ?? 0,
        change_pct: changePct,
        change_amount: 0,
        volume: 0,
        amount: parseFiniteNumber(stripHtml(cells[4])) ?? 0,
        ...(leadingStockName ? { leading_stock_name: leadingStockName } : {}),
        ...(leadingStockCode ? { leading_stock_code: leadingStockCode } : {}),
        ...(leadingStockChangePct !== undefined ? { leading_stock_change_pct: leadingStockChangePct } : {}),
      };
    })
    .filter((item): item is MarketBoardItem => Boolean(item));
}

function readTonghuashunPageCount(html: string): number {
  const match = html.match(/class=["']page_info["'][^>]*>\s*\d+\s*\/\s*(\d+)/i);
  const count = parseFiniteNumber(match?.[1]);
  return Math.max(1, Math.min(TONGHUASHUN_BOARD_MAX_PAGES, Math.round(count ?? 1)));
}

async function fetchTonghuashunBoardPage(
  category: MarketBoardCategory,
  page: number,
  sort: MarketBoardSort,
): Promise<{ items: MarketBoardItem[]; pageCount: number }> {
  const section = category === "concept" ? "gn" : "thshy";
  const order = sort === "loss" ? "asc" : "desc";
  const path = page <= 1
    ? `/${section}/`
    : `/${section}/index/field/199112/order/${order}/page/${page}/ajax/1/`;
  const response = await fetchWithTimeout(`${TONGHUASHUN_BOARD_BASE_URL}${path}`, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: `${TONGHUASHUN_BOARD_BASE_URL}/${section}/`,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Tonghuashun board page failed: ${response.status}`);
  }
  const html = await readUpstreamText(response);
  return {
    items: parseTonghuashunBoardRows(html),
    pageCount: readTonghuashunPageCount(html),
  };
}

async function fetchMarketBoardsFromTonghuashun(
  category: MarketBoardCategory,
  page: number,
  pageSize: number,
  sort: MarketBoardSort,
): Promise<MarketBoardItem[]> {
  const fundItems = await fetchBoardsFromTonghuashunFunds(category, page, pageSize, sort);
  if (fundItems.length > 0) return fundItems;
  try {
    const firstPage = await fetchTonghuashunBoardPage(category, 1, sort);
    const pageCount = firstPage.pageCount;
    const tailPages = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
        fetchTonghuashunBoardPage(category, index + 2, sort).catch(() => ({ items: [], pageCount })),
      ),
    );
    const seen = new Set<string>();
    const items = [firstPage, ...tailPages]
      .flatMap(result => result.items)
      .filter(item => {
        if (seen.has(item.code)) return false;
        seen.add(item.code);
        return true;
      })
      .sort((a, b) => sort === "loss" ? a.change_pct - b.change_pct : b.change_pct - a.change_pct);
    return items.slice((page - 1) * pageSize, page * pageSize);
  } catch (error) {
    console.warn("Tonghuashun market boards fallback failed:", error);
    return [];
  }
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

async function fetchHotList(period: HotListPeriod, page: number, pageSize: number): Promise<HotListItem[]> {
  try {
    const response = await fetchWithTimeout(`${TONGHUASHUN_HOT_LIST_URL}/${period}/data.txt`, {
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://eq.10jqka.com.cn/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`Tonghuashun hot list failed: ${response.status}`);
    }
    const items = normalizeHotListPayload(parseJsonOrJsonp(await response.text()));
    const quotes = await fetchSinaQuotes(items.map(item => ({ code: item.code, type: "stock" })));
    const quoteMap = new Map(quotes.map(quote => [quote.code, quote]));
    return items
      .map(item => {
        const quote = quoteMap.get(item.code);
        return quote ? { ...item, price: quote.price, change_pct: quote.change_pct } : item;
      })
      .slice((page - 1) * pageSize, page * pageSize);
  } catch (error) {
    console.warn("Hot list fetch failed:", error);
    return [];
  }
}

function parseTonghuashunIndexRows(html: string): MarketIndexItem[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  return rows
    .map(row => {
      const cells = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
      if (cells.length < 12) return null;
      const code = stripHtml(cells[1]);
      const name = stripHtml(cells[2]);
      const price = parseFiniteNumber(stripHtml(cells[3]));
      const changeAmount = parseFiniteNumber(stripHtml(cells[4]));
      const changePct = parseFiniteNumber(stripHtml(cells[5]));
      if (!code || !name || price === undefined || changePct === undefined) return null;
      return {
        code,
        name,
        price,
        change_pct: changePct,
        change_amount: changeAmount ?? 0,
        prev_close: parseFiniteNumber(stripHtml(cells[6])) ?? 0,
        open: parseFiniteNumber(stripHtml(cells[7])) ?? 0,
        high: parseFiniteNumber(stripHtml(cells[8])) ?? 0,
        low: parseFiniteNumber(stripHtml(cells[9])) ?? 0,
        volume: parseFiniteNumber(stripHtml(cells[10])) ?? 0,
        amount: parseFiniteNumber(stripHtml(cells[11])) ?? 0,
      };
    })
    .filter((item): item is MarketIndexItem => Boolean(item));
}

async function fetchTonghuashunIndexPage(
  page: number,
  sort: MarketBoardSort,
): Promise<{ items: MarketIndexItem[]; pageCount: number }> {
  const order = sort === "loss" ? "asc" : "desc";
  const response = await fetchWithTimeout(`${TONGHUASHUN_BOARD_BASE_URL}/zs/index/field/zdf/order/${order}/page/${page}/`, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: `${TONGHUASHUN_BOARD_BASE_URL}/zs/`,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Tonghuashun index page failed: ${response.status}`);
  }
  const html = await readUpstreamText(response);
  return {
    items: parseTonghuashunIndexRows(html),
    pageCount: readTonghuashunPageCount(html),
  };
}

async function fetchMarketIndices(page: number, pageSize: number, sort: MarketBoardSort): Promise<MarketIndexItem[]> {
  try {
    const firstPage = await fetchTonghuashunIndexPage(1, sort);
    const pageCount = firstPage.pageCount;
    const tailPages = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
        fetchTonghuashunIndexPage(index + 2, sort).catch(() => ({ items: [], pageCount })),
      ),
    );
    const seen = new Set<string>();
    const items = [firstPage, ...tailPages]
      .flatMap(result => result.items)
      .filter(item => {
        if (seen.has(item.code)) return false;
        seen.add(item.code);
        return true;
      })
      .sort((a, b) => sort === "loss" ? a.change_pct - b.change_pct : b.change_pct - a.change_pct);
    return items.slice((page - 1) * pageSize, page * pageSize);
  } catch (error) {
    console.warn("Market indices fetch failed:", error);
    return [];
  }
}

async function fetchTonghuashunFundBoardPage(
  category: MarketBoardCategory,
  page: number,
  sort: MarketBoardSort,
): Promise<{ items: MarketBoardItem[]; pageCount: number }> {
  const order = sort === "loss" ? "asc" : "desc";
  const section = category === "concept" ? "gnzjl" : "hyzjl";
  const response = await fetchWithTimeout(`${TONGHUASHUN_BOARD_BASE_URL.replace("q.", "data.")}/funds/${section}/field/tradezdf/order/${order}/page/${page}/`, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: `https://data.10jqka.com.cn/funds/${section}/`,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Tonghuashun concept fund board page failed: ${response.status}`);
  }
  const html = await readUpstreamText(response);
  return {
    items: parseTonghuashunFundBoardRows(html),
    pageCount: readTonghuashunPageCount(html),
  };
}

async function fetchBoardsFromTonghuashunFunds(
  category: MarketBoardCategory,
  page: number,
  pageSize: number,
  sort: MarketBoardSort,
): Promise<MarketBoardItem[]> {
  try {
    const firstPage = await fetchTonghuashunFundBoardPage(category, 1, sort);
    const pageCount = firstPage.pageCount;
    const tailPages = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
        fetchTonghuashunFundBoardPage(category, index + 2, sort).catch(() => ({ items: [], pageCount })),
      ),
    );
    const seen = new Set<string>();
    const items = [firstPage, ...tailPages]
      .flatMap(result => result.items)
      .filter(item => {
        if (seen.has(item.code)) return false;
        seen.add(item.code);
        return true;
      })
      .sort((a, b) => sort === "loss" ? a.change_pct - b.change_pct : b.change_pct - a.change_pct);
    return items.slice((page - 1) * pageSize, page * pageSize);
  } catch (error) {
    console.warn("Tonghuashun concept funds fallback failed:", error);
    return [];
  }
}

async function fetchHistoryKline(
  code: string,
  type: InstrumentType,
  startDate: string,
  endDate: string,
): Promise<HistoryKlineItem[]> {
  if (type === "fund_open") {
    return fetchEastmoneyOpenFundHistory(code, startDate, endDate);
  }
  return fetchEastmoneyListedHistory(code, startDate, endDate);
}

async function fetchEastmoneyListedHistory(
  code: string,
  startDate: string,
  endDate: string,
): Promise<HistoryKlineItem[]> {
  try {
    const params = new URLSearchParams({
      secid: eastmoneySecid(code),
      fields1: "f1,f2,f3,f4,f5,f6",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
      klt: "101",
      fqt: "1",
      beg: startDate.replace(/-/g, ""),
      end: endDate.replace(/-/g, ""),
      limit: String(historyRequestSize(startDate, endDate)),
    });
    const response = await fetchWithTimeout(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params.toString()}`, {
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://quote.eastmoney.com/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`Eastmoney kline failed: ${response.status}`);
    }

    const payload = asRecord(await response.json());
    const data = asRecord(payload?.data);
    const klines = data?.klines;
    if (!Array.isArray(klines)) return [];

    return klines
      .map(line => {
        const parts = firstString(line).split(",");
        if (parts.length < 9) return null;
        const close = parseFiniteNumber(parts[2]);
        if (!parts[0] || close === undefined || close <= 0) return null;
        return {
          trade_date: parts[0],
          open: parseFiniteNumber(parts[1]) ?? close,
          close,
          high: parseFiniteNumber(parts[3]) ?? close,
          low: parseFiniteNumber(parts[4]) ?? close,
          volume: parseFiniteNumber(parts[5]) ?? 0,
          change_pct: parseFiniteNumber(parts[8]) ?? 0,
        };
      })
      .filter((item): item is HistoryKlineItem => Boolean(item));
  } catch (error) {
    console.warn("Listed history fallback failed:", error);
    return [];
  }
}

async function fetchEastmoneyOpenFundHistory(
  code: string,
  startDate: string,
  endDate: string,
): Promise<HistoryKlineItem[]> {
  try {
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
      const response = await fetchWithTimeout(`${EASTMONEY_FUND_NAV_URL}?${params.toString()}`, {
        headers: {
          accept: "application/json,text/plain,*/*",
          referer: "https://fundf10.eastmoney.com/",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`Eastmoney fund history failed: ${response.status}`);
      }

      const payload = parseJsonOrJsonp(await response.text());
      const rows = readFundNavRows(payload);
      if (rows.length === 0) break;
      allRows.push(...rows);

      const totalCount = parseFiniteNumber(asRecord(payload)?.TotalCount) ?? 0;
      if (rows.length < EASTMONEY_FUND_NAV_PAGE_SIZE || (totalCount > 0 && allRows.length >= totalCount)) break;
    }

    const rows = Array.from(new Map(
      allRows
        .filter(row => firstString(row.FSRQ))
        .map(row => [firstString(row.FSRQ).replace(/\//g, "-"), row] as const),
    ).entries())
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([, row]) => row);
    const results: HistoryKlineItem[] = [];
    let prevClose = 0;
    for (const row of rows) {
      const close = parseFiniteNumber(row.DWJZ);
      const tradeDate = firstString(row.FSRQ).replace(/\//g, "-");
      if (!tradeDate || close === undefined || close <= 0) continue;
      const changePct = prevClose > 0
        ? ((close - prevClose) / prevClose) * 100
        : (parseFiniteNumber(row.JZZZL) ?? 0);
      results.push({
        trade_date: tradeDate,
        open: close,
        close,
        high: close,
        low: close,
        volume: 0,
        change_pct: Math.round(changePct * 100) / 100,
      });
      prevClose = close;
    }
    return results;
  } catch (error) {
    console.warn("Open fund history fallback failed:", error);
    return [];
  }
}

async function fetchEastmoneyListedQuotes(items: QuoteRequestItem[]): Promise<QuoteItem[]> {
  const secids = [...new Set(items
    .filter(item => item.type !== "fund_open")
    .map(item => eastmoneySecid(item.code)))];
  if (secids.length === 0) return [];

  try {
    const params = new URLSearchParams({
      fltt: "2",
      invt: "2",
      fields: "f12,f13,f14,f2,f3,f5,f15,f16,f17,f18",
      secids: secids.join(","),
    });
    const response = await fetchWithTimeout(`${EASTMONEY_LISTED_QUOTE_URL}?${params.toString()}`, {
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://quote.eastmoney.com/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`Eastmoney listed quote failed: ${response.status}`);
    }
    return readEastmoneyQuoteRows(parseJsonOrJsonp(await response.text()))
      .map(buildListedQuoteFromEastmoneyRow)
      .filter((item): item is QuoteItem => Boolean(item));
  } catch (error) {
    console.warn("Listed quote fallback failed:", error);
    return [];
  }
}

function readFundNavRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  const data = asRecord(root?.Data);
  const list = data?.LSJZList;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
}

function buildOpenFundQuoteFromNav(code: string, rows: Record<string, unknown>[]): QuoteItem | null {
  const latest = rows[0];
  if (!latest) return null;

  const price = parseFiniteNumber(latest.DWJZ);
  if (price === undefined || price <= 0) return null;

  const previousPrice = parseFiniteNumber(rows[1]?.DWJZ);
  const changePct = parseFiniteNumber(latest.JZZZL);
  const impliedPrev = changePct !== undefined && changePct > -100 ? price / (1 + changePct / 100) : undefined;
  const prevClose = previousPrice ?? impliedPrev ?? price;
  return {
    code,
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

async function fetchEastmoneyOpenFundQuotes(codes: string[]): Promise<QuoteItem[]> {
  const uniqueCodes = [...new Set(codes.map(normalizeInstrumentCode).filter(code => /^\d{6}$/.test(code)))];
  if (uniqueCodes.length === 0) return [];

  const entries: Array<QuoteItem | null> = await Promise.all(uniqueCodes.map(async code => {
    try {
      const params = new URLSearchParams({
        fundCode: code,
        pageIndex: "1",
        pageSize: "2",
        startDate: "",
        endDate: "",
      });
      const response = await fetchWithTimeout(`${EASTMONEY_FUND_NAV_URL}?${params.toString()}`, {
        headers: {
          accept: "application/json,text/plain,*/*",
          referer: "https://fundf10.eastmoney.com/",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`Eastmoney fund nav failed: ${response.status}`);
      }
      return buildOpenFundQuoteFromNav(code, readFundNavRows(parseJsonOrJsonp(await response.text())));
    } catch (error) {
      console.warn("Open fund nav fallback failed:", error);
      return null;
    }
  }));

  return entries.filter((item): item is QuoteItem => Boolean(item));
}

function parseSinaQuoteText(text: string): QuoteItem[] {
  const results: QuoteItem[] = [];
  const lines = text.split("\n").filter(line => line.trim());
  for (const line of lines) {
    const match = line.match(/hq_str_(\w+)="([^"]*)"/);
    if (!match) continue;

    const symbol = match[1];
    const data = match[2].split(",");
    if (symbol.startsWith("fu_")) {
      const code = normalizeInstrumentCode(symbol.slice(3));
      const quote = parseSinaOpenFundQuote(code, data);
      if (quote) results.push(quote);
      continue;
    }

    if (data.length < 6) continue;
    const code = normalizeInstrumentCode(symbol.slice(2));
    const open = parseFiniteNumber(data[1]) ?? 0;
    const prevClose = parseFiniteNumber(data[2]) ?? 0;
    const price = parseFiniteNumber(data[3]) ?? 0;
    const high = parseFiniteNumber(data[4]) ?? 0;
    const low = parseFiniteNumber(data[5]) ?? 0;
    const volume = parseFiniteNumber(data[8]) ?? 0;
    results.push({
      code,
      name: data[0] || code,
      price,
      open,
      prev_close: prevClose,
      high,
      low,
      volume,
      change_pct: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
    });
  }
  return results;
}
