import { Controller, INestApplication, Post, Req } from '@nestjs/common';
import session from 'express-session';
import { Secret, TOTP } from 'otpauth';
import { DataSource } from 'typeorm';
import { AgentProfile, EscalatedSettings, TwoFactor } from '../../src/entities';
import { ApiTokenGuard } from '../../src/guards/api-token.guard';
import { ApiTokenService } from '../../src/services/api-token.service';
import { TwoFactorService } from '../../src/services/two-factor.service';
import { bootUi } from './ui-harness';

jest.setTimeout(120000);

/**
 * ADR 2026-10-29-configurable-access-features: two-factor is an install-level
 * switch (`access.twoFactor` / ESCALATED_TWO_FACTOR). Off, the enrolment and
 * challenge routes answer 404 and nobody is challenged. On, a staff user with
 * a confirmed enrolment must pass `Auth/TwoFactorChallenge` in their session
 * before any admin or agent route, and admins can require everyone to enrol.
 */

/** The host's login: a new session, as passport and most login handlers do. */
@Controller('host')
class HostLoginController {
  @Post('login')
  async login(@Req() req: any) {
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error: unknown) => (error ? reject(error) : resolve())),
    );
    req.session.signedIn = true;
    return { ok: true };
  }
}

const KEY = 'test-two-factor-key';

/** A browser: keeps cookies, signs in as a user through the host guard headers. */
class Browser {
  private cookies = new Map<string, string>();

  constructor(
    private readonly base: string,
    public user: number,
    public roles = 'agent',
  ) {}

  async request(path: string, init: { method?: string; body?: unknown; json?: boolean } = {}) {
    const headers: Record<string, string> = {
      'x-role': this.roles,
      'x-user': String(this.user),
      ...(init.json
        ? { accept: 'application/json' }
        : {
            'x-inertia': 'true',
            'x-requested-with': 'XMLHttpRequest',
            accept: 'text/html, application/xhtml+xml',
          }),
    };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookies.size) {
      headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    const res = await fetch(`${this.base}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      redirect: 'manual',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (/max-age=0/i.test(line) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  /** A page visit that must render: the page object. */
  async page(path: string) {
    const res = await this.request(path);
    if (res.status !== 200) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async login() {
    const res = await this.request('/host/login', { body: {}, json: true });
    expect(res.status).toBe(201);
  }
}

interface World {
  app: INestApplication;
  source: DataSource;
  base: string;
  service: TwoFactorService;
}

let nextUser = 900;

async function world(twoFactor: boolean, extra: Record<string, unknown> = {}): Promise<World> {
  const { app, source, base } = await bootUi(
    { access: { twoFactor }, twoFactor: { secret: KEY }, ...extra } as any,
    { controllers: [HostLoginController] },
    (nest) => nest.use(session({ secret: 'host-session', resave: false, saveUninitialized: true })),
  );
  return { app, source, base, service: app.get(TwoFactorService) };
}

function code(secret: string, offsetSteps = 0): string {
  return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({
    timestamp: Date.now() + offsetSteps * 30_000,
  });
}

/** A confirmed enrolment, made through the service; returns the secret and recovery codes. */
async function enrol(w: World, userId: number) {
  const setup = await w.service.setup(userId, `user${userId}@example.com`);
  const secret = new URL(setup.qr_uri).searchParams.get('secret')!;
  expect(await w.service.confirm(userId, code(secret))).not.toBeNull();
  // Let the tests use the current step again.
  await w.source.getRepository(TwoFactor).update({ userId }, { lastUsedStep: null });
  return { secret, recovery: setup.recovery_codes };
}

function staff(w: World, roles = 'agent') {
  return new Browser(w.base, (nextUser += 1), roles);
}

describe('two-factor switched off (the default)', () => {
  let w: World;
  beforeAll(async () => {
    w = await world(false);
  });
  afterAll(async () => {
    await w?.app.close();
  });

  it('is off without configuration', async () => {
    const { accessFeatureEnabled } = await import('../../src/access/access-features');
    expect(accessFeatureEnabled({}, 'two_factor')).toBe(false);
  });

  it('does not challenge an enrolled user and hides the two-factor routes (404)', async () => {
    const user = staff(w, 'agent,admin');
    await enrol(w, user.user);

    expect((await user.request('/escalated/agent')).status).toBe(200);
    expect((await user.request('/escalated/admin/departments')).status).toBe(200);
    expect((await user.request('/escalated/admin/settings/two-factor')).status).toBe(404);
    expect(
      (await user.request('/escalated/admin/settings/two-factor/setup', { body: {} })).status,
    ).toBe(404);
    expect((await user.request('/escalated/two-factor/challenge')).status).toBe(404);
    expect(
      (await user.request('/escalated/two-factor/challenge', { body: { code: '000000' } })).status,
    ).toBe(404);
  });

  it('shares the switch off, and ignores the requirement', async () => {
    const user = staff(w);
    await w.source
      .getRepository(EscalatedSettings)
      .save({ key: 'two_factor_required', value: 'true', type: 'boolean' } as any);
    const props = (await user.page('/escalated/agent')).props;
    expect(props.escalated.features.two_factor).toBe(false);
    expect(props.escalated.two_factor_required).toBe(false);
    await w.source.getRepository(EscalatedSettings).delete({ key: 'two_factor_required' } as any);
  });

  it('does not offer the two-factor requirement setting', async () => {
    const admin = staff(w, 'agent,admin');
    const page = await admin.page('/escalated/admin/settings');
    expect(page.props.supported_settings).not.toContain('two_factor_required');
  });

  it('cannot be turned on from the settings store', async () => {
    const admin = staff(w, 'agent,admin');
    const saved = await fetch(`${w.base}/escalated/admin/settings`, {
      method: 'PUT',
      headers: {
        'x-role': 'agent,admin',
        'x-user': String(admin.user),
        'content-type': 'application/json',
      },
      body: JSON.stringify([
        { key: 'two_factor', value: 'true' },
        { key: 'access.two_factor', value: 'true' },
        { key: 'ESCALATED_TWO_FACTOR', value: 'true' },
      ]),
    });
    expect(saved.status).toBe(200);
    expect((await admin.request('/escalated/admin/settings/two-factor')).status).toBe(404);
  });
});

describe('two-factor switched on', () => {
  let w: World;
  beforeAll(async () => {
    w = await world(true);
  });
  afterAll(async () => {
    await w?.app.close();
  });

  it('shares the switch on', async () => {
    const props = (await staff(w).page('/escalated/agent')).props;
    expect(props.escalated.features.two_factor).toBe(true);
    expect(props.escalated.two_factor_required).toBe(false);
  });

  it('sends an enrolled user to the challenge from agent and admin pages', async () => {
    const user = staff(w, 'agent,admin');
    await enrol(w, user.user);

    for (const path of ['/escalated/agent', '/escalated/admin/departments']) {
      const res = await user.request(path);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/escalated/two-factor/challenge');
    }
    const json = await user.request('/escalated/agent/tickets', { json: true });
    expect(json.status).toBe(403);
    expect(await json.json()).toMatchObject({ two_factor_required: true });
  });

  it('renders the shared challenge page with the action to post to', async () => {
    const user = staff(w);
    await enrol(w, user.user);
    const page = await user.page('/escalated/two-factor/challenge');
    expect(page.component).toBe('Escalated/Auth/TwoFactorChallenge');
    expect(page.props.action).toBe(`${w.base}/escalated/two-factor/challenge`);
    expect(page.props.error).toBe('');
  });

  it('accepts a valid code and returns to the page asked for', async () => {
    const user = staff(w);
    const { secret } = await enrol(w, user.user);

    const asked = await user.request('/escalated/agent/tickets?status=open');
    expect(asked.headers.get('location')).toBe('/escalated/two-factor/challenge');

    const res = await user.request('/escalated/two-factor/challenge', {
      body: { code: code(secret) },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/escalated/agent/tickets?status=open');
    expect((await user.request('/escalated/agent/tickets?status=open')).status).toBe(200);
  });

  it('refuses a wrong code with a code error', async () => {
    const user = staff(w);
    const { secret } = await enrol(w, user.user);
    const wrong = String((Number(code(secret)) + 1) % 1_000_000).padStart(6, '0');

    const res = await user.request('/escalated/two-factor/challenge', {
      body: { code: wrong },
      json: true,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual({ code: 'That code is not valid.' });
    expect((await user.request('/escalated/agent')).status).toBe(302);
  });

  it('refuses a code that was already used, after a new login', async () => {
    const user = staff(w);
    const { secret } = await enrol(w, user.user);
    const once = code(secret);

    expect(
      (await user.request('/escalated/two-factor/challenge', { body: { code: once } })).status,
    ).toBe(303);
    await user.login();
    const again = await user.request('/escalated/two-factor/challenge', {
      body: { code: once },
      json: true,
    });
    expect(again.status).toBe(422);
    expect((await again.json()).errors).toHaveProperty('code');
  });

  it('accepts a recovery code once', async () => {
    const user = staff(w);
    const { recovery } = await enrol(w, user.user);

    const res = await user.request('/escalated/two-factor/challenge', {
      body: { recovery_code: recovery[0].toLowerCase() },
    });
    expect(res.status).toBe(303);
    expect((await user.request('/escalated/agent')).status).toBe(200);

    await user.login();
    const again = await user.request('/escalated/two-factor/challenge', {
      body: { recovery_code: recovery[0] },
      json: true,
    });
    expect(again.status).toBe(422);
    expect((await again.json()).errors).toHaveProperty('recovery_code');

    const enrolment = await w.source
      .getRepository(TwoFactor)
      .findOneByOrFail({ userId: user.user });
    expect(w.service.recoveryCodes(enrolment)).toEqual(recovery.slice(1));
  });

  it('throttles the verify route', async () => {
    const user = staff(w);
    await enrol(w, user.user);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await user.request('/escalated/two-factor/challenge', {
        body: { code: '000000' },
        json: true,
      });
    }
    const res = await user.request('/escalated/two-factor/challenge', {
      body: { code: '000000' },
      json: true,
    });
    expect(res.status).toBe(429);
  });

  it('challenges again after a new login', async () => {
    const user = staff(w);
    const { secret } = await enrol(w, user.user);
    await user.request('/escalated/two-factor/challenge', { body: { code: code(secret) } });
    expect((await user.request('/escalated/agent')).status).toBe(200);

    await user.login();
    const res = await user.request('/escalated/agent');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/escalated/two-factor/challenge');
  });

  it('does not pass a session for one user on to another', async () => {
    const first = staff(w);
    const { secret } = await enrol(w, first.user);
    await first.request('/escalated/two-factor/challenge', { body: { code: code(secret) } });
    expect((await first.request('/escalated/agent')).status).toBe(200);

    const second = (nextUser += 1);
    await enrol(w, second);
    first.user = second; // the same browser session, now another user
    expect((await first.request('/escalated/agent')).status).toBe(302);
  });

  it('does not let an unchallenged session switch two-factor off', async () => {
    const user = staff(w);
    await enrol(w, user.user);
    const res = await user.request('/escalated/admin/settings/two-factor/disable', { body: {} });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/escalated/two-factor/challenge');
    expect(await w.source.getRepository(TwoFactor).countBy({ userId: user.user })).toBe(1);
  });

  it('lets an agent who is not an admin enrol, with the secret sealed and never in props', async () => {
    const agent = staff(w, 'agent');
    const index = await agent.page('/escalated/admin/settings/two-factor');
    expect(index.component).toBe('Escalated/Admin/Settings/TwoFactor');
    expect(index.props).toMatchObject({ enabled: false, pending: false, required: false });

    const setup = await agent.request('/escalated/admin/settings/two-factor/setup', { body: {} });
    expect(setup.status).toBe(303);
    const shown = await agent.page('/escalated/admin/settings/two-factor');
    const data = shown.props.flash.two_factor_setup;
    expect(data.qr_uri).toMatch(/^otpauth:\/\/totp\//);
    expect(data.recovery_codes).toHaveLength(8);
    expect(shown.props.pending).toBe(true);
    const secret = new URL(data.qr_uri).searchParams.get('secret')!;
    expect(secret.length).toBeGreaterThanOrEqual(32);

    const row = await w.source.getRepository(TwoFactor).findOneByOrFail({ userId: agent.user });
    expect(row.secret).not.toContain(secret);
    expect(row.recoveryCodes).not.toContain(data.recovery_codes[0]);

    const confirmed = await agent.request('/escalated/admin/settings/two-factor/confirm', {
      body: { code: code(secret) },
    });
    expect(confirmed.status).toBe(303);
    const after = await agent.page('/escalated/admin/settings/two-factor');
    expect(after.props.flash.two_factor_confirmed.recovery_codes).toEqual(data.recovery_codes);
    expect(after.props.enabled).toBe(true);
    expect(JSON.stringify(after)).not.toContain(secret);

    // Confirming proves the second factor for this session.
    expect((await agent.request('/escalated/agent')).status).toBe(200);
  });

  it('resets an enrolment (lost device) through TwoFactorService.reset', async () => {
    const user = staff(w);
    await enrol(w, user.user);
    await w.service.reset(user.user);
    expect(await w.source.getRepository(TwoFactor).countBy({ userId: user.user })).toBe(0);
    expect((await user.request('/escalated/agent')).status).toBe(200);
  });

  it('challenges an enrolment made on the agent profile by an earlier version', async () => {
    const user = staff(w);
    const secret = new Secret({ size: 20 }).base32;
    await w.source.getRepository(AgentProfile).save({
      userId: user.user,
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      twoFactorRecoveryCodes: ['OLD1-OLD2'],
    } as any);

    expect((await user.request('/escalated/agent')).status).toBe(302);
    const profile = await w.source
      .getRepository(AgentProfile)
      .findOneByOrFail({ userId: user.user });
    expect(profile.twoFactorSecret).toBeNull();
    expect(
      (await user.request('/escalated/two-factor/challenge', { body: { code: code(secret) } }))
        .status,
    ).toBe(303);
    expect((await user.request('/escalated/agent')).status).toBe(200);
  });

  it('lets an admin require two-factor at runtime', async () => {
    const admin = staff(w, 'agent,admin');
    expect((await admin.request('/escalated/agent')).status).toBe(200);
    const settings = await admin.page('/escalated/admin/settings');
    expect(settings.props.supported_settings).toContain('two_factor_required');
    expect(settings.props.settings.two_factor_required).toBe(false);

    const saved = await admin.request('/escalated/admin/settings', {
      body: { two_factor_required: true },
    });
    expect(saved.status).toBe(303);

    const res = await admin.request('/escalated/agent');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/escalated/admin/settings/two-factor');
    const page = await admin.page('/escalated/admin/settings/two-factor');
    expect(page.props.required).toBe(true);
    expect(page.props.escalated.two_factor_required).toBe(true);

    await w.source.getRepository(EscalatedSettings).delete({ key: 'two_factor_required' } as any);
  });
});

describe('two-factor required by configuration', () => {
  let w: World;
  beforeAll(async () => {
    w = await world(true, { twoFactor: { secret: KEY, required: true } });
  });
  afterAll(async () => {
    await w?.app.close();
  });

  it('sends staff without an enrolment to enrol, and nowhere else', async () => {
    const agent = staff(w);
    const res = await agent.request('/escalated/agent');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/escalated/admin/settings/two-factor');
    const json = await agent.request('/escalated/agent/tickets', { json: true });
    expect(json.status).toBe(403);

    const page = await agent.page('/escalated/admin/settings/two-factor');
    expect(page.props.required).toBe(true);
    expect(
      (await agent.request('/escalated/admin/settings/two-factor/setup', { body: {} })).status,
    ).toBe(303);
  });
});

describe('two-factor and API tokens', () => {
  it('does not challenge the token API', async () => {
    const { app, source, base } = await bootUi({
      access: { twoFactor: true },
      twoFactor: { secret: KEY },
      agentGuard: ApiTokenGuard,
    } as any);
    try {
      const service = app.get(TwoFactorService);
      await enrol({ app, source, base, service }, 1234);
      const { plainTextToken } = await app.get(ApiTokenService).create({
        name: 't',
        userId: 1234,
        abilities: ['agent'],
      });
      const res = await fetch(`${base}/escalated/agent/tickets`, {
        headers: { authorization: `Bearer ${plainTextToken}`, accept: 'application/json' },
      });
      expect(res.status).toBe(200);
    } finally {
      await app.close();
    }
  });
});
