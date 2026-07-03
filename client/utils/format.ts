// 工具函数
export const round2 = (v: number) => Math.round(v * 100) / 100;
export const round4 = (v: number) => Math.round(v * 10000) / 10000;

export function formatMoney(v: number, decimal = 2, withSign = false): string {
  if (v === null || v === undefined || isNaN(v)) return '--';
  const sign = v > 0 ? '+' : '';
  const abs = Math.abs(v);
  const s = abs.toFixed(decimal);
  const parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formatted = parts.join('.');
  if (withSign && v !== 0) return `${sign}${formatted}`;
  return v < 0 ? `-${formatted}` : formatted;
}

export function formatPercent(v: number, withSign = true): string {
  if (v === null || v === undefined || isNaN(v)) return '--';
  const sign = v > 0 ? '+' : '';
  const s = v.toFixed(2);
  if (withSign && v > 0) return `${sign}${s}%`;
  return `${s}%`;
}

export function formatQuantity(v: number): string {
  if (v === null || v === undefined || isNaN(v)) return '--';
  // 整数份额不带小数，否则保留4位
  if (Math.abs(v - Math.round(v)) < 0.0001) return Math.round(v).toLocaleString();
  return v.toFixed(4).replace(/\.?0+$/, '');
}

export function getPnlColor(v: number, reversed = false): string {
  if (v > 0.001) return reversed ? '#22C55E' : '#EF4444';
  if (v < -0.001) return reversed ? '#EF4444' : '#22C55E';
  return '#9CA3AF';
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(s: string): string {
  if (!s) return '--';
  // 支持 YYYY-MM-DD 或 ISO 字符串
  if (s.length >= 10) return s.slice(0, 10);
  return s;
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dateStr(d);
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(a: string, b: string): number {
  const da = parseDate(a).getTime();
  const db = parseDate(b).getTime();
  return Math.round((db - da) / 86400000);
}

export function addDays(s: string, days: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + days);
  return dateStr(d);
}

export function addWorkDays(s: string, days: number): string {
  // T+N 交易日简单近似：跳过周末
  const d = parseDate(s);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return dateStr(d);
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
