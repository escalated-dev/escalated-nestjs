import { INestApplication } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import session from 'express-session';
import * as jwt from 'jsonwebtoken';
import { Secret, TOTP } from 'otpauth';
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { TwoFactor } from '../../src/entities';
import { SettingsService } from '../../src/services/settings.service';
import { TwoFactorService } from '../../src/services/two-factor.service';
import { bootUi } from './ui-harness';

jest.setTimeout(120000);

/**
 * SSO and two-factor work out of the box on a plain NestJS + TypeORM host,
 * as they do in Laravel: SSO finds the user through the module's `userEntity`
 * and signs them in with passport's `req.login` or, without passport, in the
 * session; with no session middleware on the host, Escalated mounts
 * express-session on its own routes. Host hooks still win.
 */

@Entity('host_users')
class HostUser {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  email!: string;

  @Column()
  name!: string;
}

const SECRET = 'shared-jwt-secret-of-enough-length';
const AUD = 'https://help.example.test';

const token = (email: string) =>
  jwt.sign({ email, name: 'Someone', jti: randomUUID() }, SECRET, {
    algorithm: 'HS256',
    expiresIn: 60,
    audience: AUD,
  });

/** A browser with a cookie jar and no test identity headers of its own. */
class Browser {
  private cookies = new Map<string, string>();
  constructor(private readonly base: string) {}

  async fetch(path: string, init: { headers?: Record<string, string>; body?: unknown } = {}) {
    const headers: Record<string, string> = { accept: 'text/html', ...(init.headers ?? {}) };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookies.size) {
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const res = await fetch(`${this.base}${path}`, {
      method: init.body !== undefined ? 'POST' : 'GET',
      redirect: 'manual',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return res;
  }

  has(cookie: string): boolean {
    return this.cookies.has(cookie);
  }
}

interface World {
  app: INestApplication;
  source: DataSource;
  base: string;
}

async function world(
  escalated: Record<string, unknown>,
  prepare?: (app: INestApplication) => void,
): Promise<World> {
  const { app, source, base } = await bootUi(
    {
      ...escalated,
      access: { sso: true, ...((escalated.access as object) ?? {}) },
      sso: { jwtAudience: AUD, ...((escalated.sso as object) ?? {}) },
    } as any,
    { imports: [TypeOrmModule.forFeature([HostUser])] },
    prepare,
  );
  const settings = app.get(SettingsService);
  for (const [key, value] of Object.entries({
    sso_provider: 'jwt',
    sso_url: 'https://idp.test',
    sso_jwt_secret: SECRET,
  })) {
    await settings.set(key, value, 'string');
  }
  return { app, source, base };
}

async function alice(w: World): Promise<HostUser> {
  return w.source.getRepository(HostUser).save({ email: 'Alice@Example.test', name: 'Alice' });
}

/** The user Escalated's pages see on a later request, with no host identity headers. */
async function pageUser(b: Browser) {
  const res = await b.fetch('/escalated/agent', {
    headers: { 'x-role': 'agent', 'x-inertia': 'true', 'x-requested-with': 'XMLHttpRequest' },
  });
  expect(res.status).toBe(200);
  return (await res.json()).props.auth.user;
}

/** The signed-in user, or null when Escalated sees nobody (the page is refused or has no user). */
async function userOrNull(b: Browser) {
  const res = await b.fetch('/escalated/agent', {
    headers: { 'x-role': 'agent', 'x-inertia': 'true', 'x-requested-with': 'XMLHttpRequest' },
  });
  if (res.status !== 200) return null;
  return (await res.json()).props.auth.user;
}

describe('SSO defaults on a host with no hooks', () => {
  let w: World | undefined;
  afterEach(async () => {
    await w?.app.close();
    w = undefined;
  });

  it('finds the user through userEntity (any case) and signs them in to its own session', async () => {
    w = await world({ userEntity: HostUser, session: { secret: 'escalated-session-key' } });
    const user = await alice(w);
    const b = new Browser(w.base);

    const res = await b.fetch(`/escalated/sso/jwt/callback?jwt=${token('alice@example.test')}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/escalated/agent');
    expect(b.has('escalated.sid')).toBe(true);

    expect(await pageUser(b)).toEqual({ id: user.id, name: 'Alice', email: 'Alice@Example.test' });
    // Another browser is nobody.
    expect(await userOrNull(new Browser(w.base))).toBeNull();
  });

  it('accepts userEntity as a table name', async () => {
    w = await world({ userEntity: 'host_users', session: { secret: 'escalated-session-key' } });
    const user = await alice(w);
    const b = new Browser(w.base);
    expect(
      (await b.fetch(`/escalated/sso/jwt/callback?jwt=${token('ALICE@example.test')}`)).status,
    ).toBe(302);
    expect((await pageUser(b)).id).toBe(user.id);
  });

  it("signs in through passport's req.login when the host has passport", async () => {
    const logins: unknown[] = [];
    w = await world({ userEntity: HostUser }, (nest) => {
      nest.use(session({ secret: 'host', resave: false, saveUninitialized: true }));
      nest.use((req: any, _res: unknown, next: () => void) => {
        req.login = (user: { id: number }, done: (error?: unknown) => void) => {
          logins.push(user);
          req.session.passport = { user: user.id };
          done();
        };
        next();
      });
    });
    const user = await alice(w);
    const b = new Browser(w.base);
    expect(
      (await b.fetch(`/escalated/sso/jwt/callback?jwt=${token('alice@example.test')}`)).status,
    ).toBe(302);
    expect(logins).toEqual([expect.objectContaining({ id: user.id, email: 'Alice@Example.test' })]);
    // passport owns the login: Escalated keeps no user of its own.
    expect(b.has('escalated.sid')).toBe(false);
  });

  it("signs in to the host's own session when it has one and no passport", async () => {
    w = await world({ userEntity: HostUser }, (nest) =>
      nest.use(session({ secret: 'host', resave: false, saveUninitialized: true })),
    );
    const user = await alice(w);
    const b = new Browser(w.base);
    expect(
      (await b.fetch(`/escalated/sso/jwt/callback?jwt=${token('alice@example.test')}`)).status,
    ).toBe(302);
    expect(b.has('connect.sid')).toBe(true);
    expect(b.has('escalated.sid')).toBe(false);
    expect((await pageUser(b)).id).toBe(user.id);
  });

  it('refuses when there is no way to find the user', async () => {
    w = await world({ session: { secret: 'escalated-session-key' } });
    await alice(w);
    expect(
      (
        await new Browser(w.base).fetch(
          `/escalated/sso/jwt/callback?jwt=${token('alice@example.test')}`,
        )
      ).status,
    ).toBe(403);
  });

  it('refuses when there is no passport, no session and no signIn hook', async () => {
    w = await world({ userEntity: HostUser, session: false });
    await alice(w);
    expect(
      (
        await new Browser(w.base).fetch(
          `/escalated/sso/jwt/callback?jwt=${token('alice@example.test')}`,
        )
      ).status,
    ).toBe(403);
  });

  it('still refuses an unknown email with createUsers on and no createUser hook', async () => {
    w = await world({
      userEntity: HostUser,
      session: { secret: 'escalated-session-key' },
      sso: { createUsers: true },
    });
    expect(
      (
        await new Browser(w.base).fetch(
          `/escalated/sso/jwt/callback?jwt=${token('new@example.test')}`,
        )
      ).status,
    ).toBe(403);
    expect(await w.source.getRepository(HostUser).count()).toBe(0);
  });

  it('lets host hooks win over the defaults', async () => {
    const signedIn: unknown[] = [];
    w = await world({
      userEntity: HostUser,
      session: { secret: 'escalated-session-key' },
      sso: {
        findUserByEmail: () => ({ id: 777, email: 'hook@example.test', name: 'Hook' }),
        signIn: (_req: unknown, user: { id: number }) => {
          signedIn.push(user.id);
        },
      },
    });
    await alice(w);
    const b = new Browser(w.base);
    expect(
      (await b.fetch(`/escalated/sso/jwt/callback?jwt=${token('alice@example.test')}`)).status,
    ).toBe(302);
    expect(signedIn).toEqual([777]);
    expect(await userOrNull(b)).toBeNull();
  });
});

describe('two-factor on a host with no session middleware', () => {
  const KEY = 'test-two-factor-key';
  let w: World | undefined;
  afterEach(async () => {
    await w?.app.close();
    w = undefined;
  });

  async function enrolled(world: World, userId: number) {
    const service = world.app.get(TwoFactorService);
    const setup = await service.setup(userId, `user${userId}@example.com`);
    const secret = new URL(setup.qr_uri).searchParams.get('secret')!;
    const code = () =>
      new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
    expect(await service.confirm(userId, code())).not.toBeNull();
    await world.source.getRepository(TwoFactor).update({ userId }, { lastUsedStep: null });
    return code;
  }

  const staff = { 'x-role': 'agent', 'x-user': '41', 'x-inertia': 'true' };

  it('challenges in a session Escalated mounts itself (keyed from twoFactor.secret)', async () => {
    w = await world({ access: { sso: false, twoFactor: true }, twoFactor: { secret: KEY } });
    const code = await enrolled(w, 41);
    const b = new Browser(w.base);

    const visit = await b.fetch('/escalated/agent', { headers: staff });
    expect(visit.status).toBe(302);
    expect(visit.headers.get('location')).toBe('/escalated/two-factor/challenge');
    expect(b.has('escalated.sid')).toBe(true);

    const verify = await b.fetch('/escalated/two-factor/challenge', {
      headers: staff,
      body: { code: code() },
    });
    expect([302, 303]).toContain(verify.status);
    expect((await b.fetch('/escalated/agent', { headers: staff })).status).toBe(200);
  });

  it('keeps the clear error with session: false', async () => {
    w = await world({
      access: { sso: false, twoFactor: true },
      twoFactor: { secret: KEY },
      session: false,
    });
    await enrolled(w, 41);
    const res = await new Browser(w.base).fetch('/escalated/agent', {
      headers: { 'x-role': 'agent', 'x-user': '41', accept: 'application/json' },
    });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain('needs a session');
  });
});
