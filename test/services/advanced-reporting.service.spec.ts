import { AdvancedReportingService } from '../../src/services/advanced-reporting.service';

describe('AdvancedReportingService', () => {
  const service = new AdvancedReportingService();

  describe('calculatePercentiles', () => {
    it('returns p50-p99', () => {
      const result = service.calculatePercentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(result).toHaveProperty('p50', 5.5);
      expect(result).toHaveProperty('p75');
      expect(result).toHaveProperty('p90');
    });
    it('returns empty for empty', () => {
      expect(service.calculatePercentiles([])).toEqual({});
    });
  });

  describe('buildDistribution', () => {
    it('creates buckets', () => {
      const result = service.buildDistribution([1, 2, 3, 4, 5], 'hours');
      expect(result.buckets.length).toBeGreaterThan(0);
      expect(result.stats).toHaveProperty('count', 5);
    });
    it('handles empty', () => {
      expect(service.buildDistribution([], 'hours').buckets).toEqual([]);
    });
  });

  describe('compositeScore', () => {
    it('returns positive score', () => {
      expect(service.compositeScore(80, 2, 24, 4.5)).toBeGreaterThan(0);
    });
  });

  describe('dateSeries', () => {
    it('generates dates', () => {
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-10');
      expect(service.dateSeries(from, to)).toHaveLength(10);
    });
  });

  describe('calculateChanges', () => {
    it('computes percentage changes', () => {
      const changes = service.calculateChanges(
        { total_created: 100, total_resolved: 80, resolution_rate: 80 },
        { total_created: 50, total_resolved: 40, resolution_rate: 80 },
      );
      expect(changes.total_created).toBe(100);
    });
  });
});
