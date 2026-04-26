import type { EscalatedModuleOptions } from '../../src/config/escalated.config';

describe('EscalatedModuleOptions', () => {
  it('accepts mail config with SMTP transport', () => {
    const opts: EscalatedModuleOptions = {
      mail: {
        from: 'support@example.com',
        transport: {
          host: 'smtp.example.com',
          port: 587,
          auth: { user: 'x', pass: 'y' },
        },
      },
    };
    expect(opts.mail?.from).toBe('support@example.com');
    if (opts.mail && 'host' in opts.mail.transport) {
      expect(opts.mail.transport.host).toBe('smtp.example.com');
      expect(opts.mail.transport.port).toBe(587);
    }
  });

  it('accepts mail config with named service transport', () => {
    const opts: EscalatedModuleOptions = {
      mail: {
        from: 'support@example.com',
        transport: {
          service: 'postmark',
          auth: { user: 'key', pass: 'key' },
        },
      },
    };
    if (opts.mail && 'service' in opts.mail.transport) {
      expect(opts.mail.transport.service).toBe('postmark');
    }
  });

  it('accepts inbound config with secrets and default provider', () => {
    const opts: EscalatedModuleOptions = {
      inbound: {
        replyDomain: 'reply.example.com',
        replySecret: 'deadbeef',
        webhookSecret: 'hunter2',
        provider: 'postmark',
      },
    };
    expect(opts.inbound?.replyDomain).toBe('reply.example.com');
    expect(opts.inbound?.replySecret).toBe('deadbeef');
    expect(opts.inbound?.webhookSecret).toBe('hunter2');
    expect(opts.inbound?.provider).toBe('postmark');
  });

  it('accepts guestPolicy mode=unassigned without extra fields', () => {
    const opts: EscalatedModuleOptions = {
      guestPolicy: { mode: 'unassigned' },
    };
    expect(opts.guestPolicy?.mode).toBe('unassigned');
  });

  it('accepts guestPolicy mode=guest_user with required guestUserId', () => {
    const opts: EscalatedModuleOptions = {
      guestPolicy: { mode: 'guest_user', guestUserId: 42 },
    };
    expect(opts.guestPolicy?.mode).toBe('guest_user');
    if (opts.guestPolicy?.mode === 'guest_user') {
      expect(opts.guestPolicy.guestUserId).toBe(42);
    }
  });

  it('accepts guestPolicy mode=prompt_signup with optional signupUrlTemplate', () => {
    const opts: EscalatedModuleOptions = {
      guestPolicy: {
        mode: 'prompt_signup',
        signupUrlTemplate: 'https://app.example.com/signup?token={token}',
      },
    };
    expect(opts.guestPolicy?.mode).toBe('prompt_signup');
    if (opts.guestPolicy?.mode === 'prompt_signup') {
      expect(opts.guestPolicy.signupUrlTemplate).toContain('{token}');
    }
  });

  it('keeps the existing emailFrom string field for backwards compat', () => {
    const opts: EscalatedModuleOptions = { emailFrom: 'legacy@example.com' };
    expect(opts.emailFrom).toBe('legacy@example.com');
  });
});
