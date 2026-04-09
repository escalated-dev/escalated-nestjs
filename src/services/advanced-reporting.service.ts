import { Injectable } from '@nestjs/common';

export interface Percentiles {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}
export interface DistributionResult {
  buckets: Array<{ range: string; count: number }>;
  stats: Record<string, any>;
  percentiles: Percentiles;
}

@Injectable()
export class AdvancedReportingService {
  calculatePercentiles(values: number[]): Percentiles | Record<string, never> {
    if (!values.length) return {};
    const sorted = [...values].sort((a, b) => a - b);
    return {
      p50: this.pct(sorted, 50),
      p75: this.pct(sorted, 75),
      p90: this.pct(sorted, 90),
      p95: this.pct(sorted, 95),
      p99: this.pct(sorted, 99),
    };
  }

  pct(sorted: number[], p: number): number {
    if (sorted.length === 1) return Math.round(sorted[0] * 100) / 100;
    const k = (p / 100) * (sorted.length - 1);
    const f = Math.floor(k);
    const c = Math.ceil(k);
    if (f === c) return Math.round(sorted[f] * 100) / 100;
    return Math.round((sorted[f] + (k - f) * (sorted[c] - sorted[f])) * 100) / 100;
  }

  buildDistribution(
    values: number[],
    unit: string,
  ): DistributionResult | { buckets: []; stats: Record<string, never> } {
    if (!values.length) return { buckets: [], stats: {} };
    const sorted = [...values].sort((a, b) => a - b);
    const max = sorted[sorted.length - 1];
    const bucketSize = Math.max(Math.ceil(max / 10), 1);
    const buckets: Array<{ range: string; count: number }> = [];
    for (let start = 0; start <= Math.ceil(max); start += bucketSize) {
      const end = start + bucketSize;
      const count = sorted.filter((v) => v >= start && v < end).length;
      if (count > 0) buckets.push({ range: `${start}-${end}`, count });
    }
    const avg = Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 100) / 100;
    return {
      buckets,
      stats: {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg,
        median: this.pct(sorted, 50),
        count: sorted.length,
        unit,
      },
      percentiles: this.calculatePercentiles(sorted) as Percentiles,
    };
  }

  compositeScore(
    resRate: number,
    avgFrt: number | null,
    avgRes: number | null,
    avgCsat: number | null,
  ): number {
    let score = (resRate / 100) * 30,
      weights = 30;
    if (avgFrt && avgFrt > 0) {
      score += Math.max(1 - avgFrt / 24, 0) * 25;
      weights += 25;
    }
    if (avgRes && avgRes > 0) {
      score += Math.max(1 - avgRes / 72, 0) * 25;
      weights += 25;
    }
    if (avgCsat !== null) {
      score += (avgCsat / 5) * 20;
      weights += 20;
    }
    return weights > 0 ? Math.round((score / weights) * 1000) / 10 : 0;
  }

  dateSeries(from: Date, to: Date): Date[] {
    const days = Math.min(
      Math.max(Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1, 1),
      90,
    );
    return Array.from({ length: days }, (_, i) => new Date(from.getTime() + i * 86400000));
  }

  calculateChanges(
    current: Record<string, number>,
    previous: Record<string, number>,
  ): Record<string, number> {
    const changes: Record<string, number> = {};
    for (const key of ['total_created', 'total_resolved', 'resolution_rate']) {
      const cur = current[key] ?? 0,
        prev = previous[key] ?? 0;
      changes[key] =
        prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10;
    }
    return changes;
  }
}
