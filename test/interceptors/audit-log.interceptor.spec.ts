import { AuditLogInterceptor } from '../../src/interceptors/audit-log.interceptor';

describe('AuditLogInterceptor', () => {
  const interceptor = new AuditLogInterceptor({} as any, {} as any);

  it('redacts sensitive values deeply in audit payloads', () => {
    const sanitized = (interceptor as any).sanitize({
      name: 'Postmark',
      token: '',
      settings: {
        webhookSecret: 'top-secret',
        apiKey: 'key-123',
        nested: [{ password: 'passw0rd', safe: 'value' }],
      },
      safeTokenizedLabel: 'visible',
    });

    expect(sanitized).toEqual({
      name: 'Postmark',
      token: '***',
      settings: {
        webhookSecret: '***',
        apiKey: '***',
        nested: [{ password: '***', safe: 'value' }],
      },
      safeTokenizedLabel: 'visible',
    });
  });

  it('does not mutate the original payload while redacting', () => {
    const payload = {
      settings: {
        password: 'passw0rd',
      },
    };

    const sanitized = (interceptor as any).sanitize(payload);

    expect(sanitized.settings.password).toBe('***');
    expect(payload.settings.password).toBe('passw0rd');
  });
});
