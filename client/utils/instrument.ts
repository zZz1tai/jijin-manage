import type { InstrumentType } from '@/db/types';

export function getInstrumentTypeLabel(type: InstrumentType | string): string {
  switch (type) {
    case 'stock':
      return 'A股';
    case 'stock_hk':
      return '港股';
    case 'stock_us':
      return '美股';
    case 'stock_global':
      return '海外股票';
    case 'index':
      return '指数';
    case 'fund_etf':
      return '场内基金';
    case 'fund_open':
      return '场外基金';
    default:
      return '标的';
  }
}

export function getInstrumentTypeShortLabel(type: InstrumentType | string): string {
  switch (type) {
    case 'stock':
      return 'A股';
    case 'stock_hk':
      return '港股';
    case 'stock_us':
      return '美股';
    case 'stock_global':
      return '海外';
    case 'index':
      return '指数';
    case 'fund_etf':
      return 'ETF';
    case 'fund_open':
      return '场外';
    default:
      return '标的';
  }
}

export function getInstrumentTypeColor(type: InstrumentType | string): string {
  switch (type) {
    case 'stock':
      return '#EF4444';
    case 'stock_hk':
      return '#06B6D4';
    case 'stock_us':
      return '#2563EB';
    case 'stock_global':
      return '#8B5CF6';
    case 'index':
      return '#10B981';
    case 'fund_etf':
      return '#1D4ED8';
    case 'fund_open':
      return '#F59E0B';
    default:
      return '#667085';
  }
}
