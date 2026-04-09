import { MentionService } from '../../src/services/mention.service';

describe('MentionService', () => {
  const service = new MentionService();

  it('extracts single mention', () => {
    expect(service.extractMentions('Hello @john review')).toEqual(['john']);
  });
  it('extracts multiple', () => {
    const r = service.extractMentions('@alice and @bob');
    expect(r).toContain('alice');
    expect(r).toContain('bob');
  });
  it('extracts dotted', () => {
    expect(service.extractMentions('cc @john.doe')).toEqual(['john.doe']);
  });
  it('deduplicates', () => {
    expect(service.extractMentions('@alice @alice')).toHaveLength(1);
  });
  it('empty for null', () => {
    expect(service.extractMentions('')).toEqual([]);
  });
  it('no mentions', () => {
    expect(service.extractMentions('no mentions')).toEqual([]);
  });
  it('username from email', () => {
    expect(service.extractUsernameFromEmail('john@example.com')).toBe('john');
  });
});
