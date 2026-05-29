import { userKeyType, userIdColumn } from '../../src/config/user-id-column';

describe('user-id-column', () => {
  const envKey = 'ESCALATED_USER_KEY_TYPE';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[envKey];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = saved;
    }
  });

  describe('userKeyType', () => {
    it('defaults to int when env is unset', () => {
      delete process.env[envKey];
      expect(userKeyType()).toBe('int');
    });

    it('returns uuid when ESCALATED_USER_KEY_TYPE=uuid', () => {
      process.env[envKey] = 'uuid';
      expect(userKeyType()).toBe('uuid');
    });
  });

  describe('userIdColumn', () => {
    it('returns int column options by default', () => {
      delete process.env[envKey];
      expect(userIdColumn()).toEqual({ type: 'int' });
    });

    it('returns varchar(255) when ESCALATED_USER_KEY_TYPE=uuid', () => {
      process.env[envKey] = 'uuid';
      expect(userIdColumn()).toEqual({ type: 'varchar', length: 255 });
    });

    it('spreads caller options such as nullable', () => {
      delete process.env[envKey];
      expect(userIdColumn({ nullable: true })).toEqual({ type: 'int', nullable: true });
    });
  });
});
