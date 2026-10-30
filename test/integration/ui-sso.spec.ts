import { INestApplication } from '@nestjs/common';
import { createHash, createHmac, generateKeyPairSync, randomUUID } from 'crypto';
import { createServer, type Server } from 'http';
import { AddressInfo } from 'net';
import { inflateRawSync } from 'zlib';
import session from 'express-session';
import * as jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import { AgentProfile, EscalatedSettings, Role } from '../../src/entities';
import { seedRolesAndPermissions } from '../../src/access/permission-seed';
import { SettingsService } from '../../src/services/settings.service';
import { assertionXml, b64, IDP_CERT, IDP_ENTITY_ID, responseXml, sign } from './saml-idp';
import { bootUi } from './ui-harness';

jest.setTimeout(120000);

/**
 * ADR 2026-10-29-configurable-access-features: single sign-on is an
 * install-level switch (`access.sso` / ESCALATED_SSO). Off, every SSO route
 * and the SSO settings page answer 404. On, the provider chosen in Admin >
 * Settings > SSO (SAML, OAuth 2 / OIDC with state and PKCE, or JWT) signs a
 * matched host user in through the host's `sso.signIn`.
 */

interface HostUser {
  id: number;
  email: string;
  name: string;
}

class Host {
  users: HostUser[] = [{ id: 501, email: 'Alice@Example.test', name: 'Alice' }];
  signedIn: number[] = [];
  created: string[] = [];
  createUsers = false;
  syncRoles = false;

  hooks() {
    return {
      findUserByEmail: (email: string) =>
        this.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null,
      createUser: ({ email, name }: { email: string; name: string }) => {
        const user = { id: 600 + this.users.length, email, name };
        this.users.push(user);
        this.created.push(email);
        return user;
      },
      signIn: (req: any, user: { id: number }) => {
        req.session.hostUserId = user.id;
        this.signedIn.push(user.id);
      },
    };
  }
}

interface World {
  app: INestApplication;
  source: DataSource;
  base: string;
  host: Host;
  settings: SettingsService;
}

async function world(sso: boolean, extra: Record<string, unknown> = {}): Promise<World> {
  const host = new Host();
  const hooks = host.hooks();
  const { app, source, base } = await bootUi(
    {
      access: { sso, ...((extra.access as object) ?? {}) },
      sso: {
        ...hooks,
        get createUsers() {
          return host.createUsers;
        },
        get syncRoles() {
          return host.syncRoles;
        },
        jwtAudience: 'https://help.example.test',
      },
    } as any,
    undefined,
    (nest) => nest.use(session({ secret: 'host', resave: false, saveUninitialized: true })),
  );
  return { app, source, base, host, settings: app.get(SettingsService) };
}

async function configure(w: World, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) await w.settings.set(key, value, 'string');
}

/** A browser with a cookie jar. */
class Browser {
  private cookies = new Map<string, string>();
  constructor(private readonly base: string) {}

  async fetch(
    path: string,
    init: { method?: string; form?: Record<string, string>; headers?: Record<string, string> } = {},
  ) {
    const headers: Record<string, string> = { accept: 'text/html', ...(init.headers ?? {}) };
    if (init.form) headers['content-type'] = 'application/x-www-form-urlencoded';
    if (this.cookies.size)
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(path.startsWith('http') ? path : `${this.base}${path}`, {
      method: init.method ?? (init.form ? 'POST' : 'GET'),
      redirect: 'manual',
      headers,
      body: init.form ? new URLSearchParams(init.form).toString() : undefined,
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return res;
  }
}

describe('SSO switched off (the default)', () => {
  let w: World;
  beforeAll(async () => {
    w = await world(false);
    await configure(w, {
      sso_provider: 'jwt',
      sso_jwt_secret: 'secret',
      sso_url: 'https://idp.test',
    });
  });
  afterAll(async () => {
    await w?.app.close();
  });

  it('answers 404 on every SSO route and the settings page', async () => {
    const b = new Browser(w.base);
    for (const path of [
      '/escalated/sso/login',
      '/escalated/sso/saml/metadata',
      '/escalated/sso/oauth/callback?code=x&state=y',
      '/escalated/sso/jwt/callback?jwt=x',
    ]) {
      expect((await b.fetch(path)).status).toBe(404);
    }
    expect((await b.fetch('/escalated/sso/saml/acs', { form: { SAMLResponse: 'x' } })).status).toBe(
      404,
    );
    expect((await b.fetch('/escalated/sso/jwt/callback', { form: { jwt: 'x' } })).status).toBe(404);

    const admin = { 'x-role': 'agent,admin', 'x-user': '1', 'x-inertia': 'true' };
    expect((await b.fetch('/escalated/admin/settings/sso', { headers: admin })).status).toBe(404);
    expect(w.host.signedIn).toEqual([]);
  });

  it('shares the switch off', async () => {
    const res = await new Browser(w.base).fetch('/escalated/agent', {
      headers: {
        'x-role': 'agent',
        'x-user': '21',
        'x-inertia': 'true',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    expect((await res.json()).props.escalated.features.sso).toBe(false);
  });

  it('cannot be turned on from the settings store', async () => {
    await configure(w, { sso: 'true', 'access.sso': 'true', ESCALATED_SSO: 'true' });
    expect((await new Browser(w.base).fetch('/escalated/sso/login')).status).toBe(404);
  });
});

describe('SSO switched on', () => {
  let w: World;
  let sp: { entityId: string; acs: string };

  beforeAll(async () => {
    w = await world(true, { access: { rolesPermissions: true } });
    sp = {
      entityId: `${w.base}/escalated/sso/saml/metadata`,
      acs: `${w.base}/escalated/sso/saml/acs`,
    };
    await seedRolesAndPermissions(w.source.manager);
  });
  afterAll(async () => {
    await w?.app.close();
  });

  beforeEach(async () => {
    w.host.signedIn = [];
    w.host.createUsers = false;
    w.host.syncRoles = false;
    await w.source.getRepository(EscalatedSettings).clear();
  });

  it('shares the switch on', async () => {
    // Roles & permissions is on in this block: the agent needs a role.
    const agentRole = await w.source.getRepository(Role).findOneByOrFail({ slug: 'agent' });
    await w.source.getRepository(AgentProfile).save({ userId: 21, roleId: agentRole.id } as any);
    const res = await new Browser(w.base).fetch('/escalated/agent', {
      headers: {
        'x-role': 'agent',
        'x-user': '21',
        'x-inertia': 'true',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    expect((await res.json()).props.escalated.features.sso).toBe(true);
  });

  it('answers 404 on sign-in while the provider is none', async () => {
    expect((await new Browser(w.base).fetch('/escalated/sso/login')).status).toBe(404);
    await configure(w, { sso_provider: 'oauth' });
    expect((await new Browser(w.base).fetch('/escalated/sso/saml/metadata')).status).toBe(404);
  });

  describe('the settings page', () => {
    const admin = {
      'x-role': 'agent,admin',
      'x-user': '1',
      'x-inertia': 'true',
      'x-requested-with': 'XMLHttpRequest',
    };

    it('renders the settings with secrets masked, and the endpoints for the IdP', async () => {
      await w.source.getRepository(AgentProfile).delete({ userId: 1 } as any);
      await configure(w, {
        sso_provider: 'jwt',
        sso_jwt_secret: 'top-secret',
        sso_url: 'https://idp.test/login',
      });
      const res = await new Browser(w.base).fetch('/escalated/admin/settings/sso', {
        headers: admin,
      });
      // Roles & permissions is on here: the admin needs a role first.
      expect(res.status).toBe(403);
      const adminRole = await w.source.getRepository(Role).findOneByOrFail({ slug: 'admin' });
      await w.source.getRepository(AgentProfile).save({ userId: 1, roleId: adminRole.id } as any);

      const page = await (
        await new Browser(w.base).fetch('/escalated/admin/settings/sso', { headers: admin })
      ).json();
      expect(page.component).toBe('Escalated/Admin/Settings/SsoSettings');
      expect(page.props.settings).toMatchObject({
        sso_provider: 'jwt',
        sso_jwt_secret: '********',
      });
      expect(JSON.stringify(page)).not.toContain('top-secret');
      expect(page.props.endpoints).toEqual({
        login: `${w.base}/escalated/sso/login`,
        sp_entity_id: `${w.base}/escalated/sso/saml/metadata`,
        metadata: `${w.base}/escalated/sso/saml/metadata`,
        acs: `${w.base}/escalated/sso/saml/acs`,
        oauth_redirect: `${w.base}/escalated/sso/oauth/callback`,
        jwt_callback: `${w.base}/escalated/sso/jwt/callback`,
      });
    });

    it('saves, keeps a secret posted back as the mask, and validates the provider', async () => {
      await configure(w, { sso_jwt_secret: 'kept' });
      const post = (body: unknown) =>
        fetch(`${w.base}/escalated/admin/settings/sso`, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            ...admin,
            'content-type': 'application/json',
            referer: `${w.base}/escalated/admin/settings/sso`,
          },
          body: JSON.stringify(body),
        });
      const saved = await post({
        sso_provider: 'jwt',
        sso_url: 'https://idp.test/login',
        sso_jwt_secret: '********',
        sso_jwt_algorithm: 'HS512',
      });
      expect(saved.status).toBe(303);
      expect(await w.settings.get('sso_jwt_secret')).toBe('kept');
      expect(await w.settings.get('sso_jwt_algorithm')).toBe('HS512');

      const bad = await post({ sso_provider: 'kerberos' });
      expect(bad.status).toBe(303);
      expect(await w.settings.get('sso_provider')).toBe('jwt');
    });
  });

  describe('SAML', () => {
    const configureSaml = (overrides: Record<string, string> = {}) =>
      configure(w, {
        sso_provider: 'saml',
        sso_entity_id: IDP_ENTITY_ID,
        sso_login_url: 'https://idp.example.test/sso',
        sso_certificate: IDP_CERT,
        ...overrides,
      });

    /** Starts a sign-in and returns the AuthnRequest ID the IdP must answer. */
    const start = async (b: Browser) => {
      const res = await b.fetch('/escalated/sso/login');
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location')!);
      expect(location.origin + location.pathname).toBe('https://idp.example.test/sso');
      const xml = inflateRawSync(
        Buffer.from(location.searchParams.get('SAMLRequest')!, 'base64'),
      ).toString();
      expect(xml).toContain(`AssertionConsumerServiceURL="${sp.acs}"`);
      return /ID="([^"]+)"/.exec(xml)![1];
    };

    const post = (b: Browser, xml: string) =>
      b.fetch('/escalated/sso/saml/acs', { form: { SAMLResponse: b64(xml) } });

    const signedResponse = (
      requestId: string,
      options: Parameters<typeof assertionXml>[1] = {},
      response: { destination?: string | null } = {},
    ) =>
      responseXml(sign(assertionXml(sp, { inResponseTo: requestId, ...options }), 'Assertion'), {
        destination: response.destination === undefined ? sp.acs : response.destination,
        inResponseTo: requestId,
      });

    it('signs in the matched user with a correctly signed response for the pending request', async () => {
      await configureSaml();
      const b = new Browser(w.base);
      const id = await start(b);
      const res = await post(b, signedResponse(id, { email: 'alice@example.test' }));
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/escalated/agent');
      expect(w.host.signedIn).toEqual([501]);
    });

    it('serves SP metadata naming the entity ID and ACS URL', async () => {
      await configureSaml();
      const res = await new Browser(w.base).fetch('/escalated/sso/saml/metadata');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/samlmetadata+xml');
      const xml = await res.text();
      expect(xml).toContain(`entityID="${sp.entityId}"`);
      expect(xml).toContain(`Location="${sp.acs}"`);
    });

    const refusals: Array<[string, (id: string) => string, Record<string, string>?]> = [
      ['with no certificate configured', (id) => signedResponse(id), { sso_certificate: '' }],
      [
        'with an unsigned assertion',
        (id) =>
          responseXml(assertionXml(sp, { inResponseTo: id }), {
            destination: sp.acs,
            inResponseTo: id,
          }),
      ],
      [
        'with only the Response signed',
        (id) =>
          sign(
            responseXml(assertionXml(sp, { inResponseTo: id }), {
              destination: sp.acs,
              inResponseTo: id,
            }),
            'Response',
          ),
      ],
      [
        'signed by another key',
        (id) => {
          const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
            type: 'pkcs8',
            format: 'pem',
          }) as string;
          return responseXml(sign(assertionXml(sp, { inResponseTo: id }), 'Assertion', other), {
            destination: sp.acs,
            inResponseTo: id,
          });
        },
      ],
      [
        'tampered after signing',
        (id) =>
          signedResponse(id, { email: 'alice@example.test' }).replace(
            /alice@example.test/g,
            'mallory@example.test',
          ),
      ],
      ['from another Issuer', (id) => signedResponse(id, { issuer: 'https://evil.test' })],
      [
        'for another Audience',
        (id) => signedResponse(id, { audiences: ['https://other-sp.test'] }),
      ],
      [
        'to another Destination',
        (id) => signedResponse(id, {}, { destination: 'https://other-sp.test/acs' }),
      ],
      [
        'for another Recipient',
        (id) => signedResponse(id, { recipient: 'https://other-sp.test/acs' }),
      ],
      [
        'once expired',
        (id) =>
          signedResponse(id, {
            notOnOrAfter: new Date(Date.now() - 10 * 60_000).toISOString(),
            confirmationNotOnOrAfter: new Date(Date.now() - 10 * 60_000).toISOString(),
          }),
      ],
      ['answering a request it never issued', () => signedResponse('_unknown-request')],
      [
        'with no InResponseTo while IdP-initiated sign-in is off',
        () =>
          responseXml(sign(assertionXml(sp, { inResponseTo: null }), 'Assertion'), {
            destination: sp.acs,
          }),
      ],
    ];

    // A loop, not it.each: each's rows of unequal length (the optional settings) stall Jest here.
    for (const [why, build, overrides] of refusals)
      it(`refuses a response ${why}`, async () => {
        await configureSaml();
        const b = new Browser(w.base);
        const id = await start(b);
        if (overrides) await configure(w, overrides);
        const res = await post(b, build(id));
        expect(res.status).toBe(403);
        expect(await res.text()).toBe('Single sign-on failed. Contact your administrator.');
        expect(w.host.signedIn).toEqual([]);
      });

    it('refuses the same assertion a second time', async () => {
      await configureSaml();
      const b = new Browser(w.base);
      const id = await start(b);
      const xml = signedResponse(id, { id: `_once${randomUUID()}` });
      expect((await post(b, xml)).status).toBe(302);
      expect((await post(b, xml)).status).toBe(403);
      expect(w.host.signedIn).toEqual([501]);
    });
  });

  describe('OAuth 2 / OIDC', () => {
    let idp: Server;
    let idpUrl: string;
    const seen: { token?: URLSearchParams; userinfoAuth?: string } = {};
    let profile: Record<string, unknown> = { email: 'alice@example.test', name: 'Alice' };

    beforeAll(async () => {
      idp = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          if (req.url?.startsWith('/token')) {
            seen.token = new URLSearchParams(body);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({ access_token: 'at-123', token_type: 'Bearer', expires_in: 60 }),
            );
          } else if (req.url?.startsWith('/userinfo')) {
            seen.userinfoAuth = String(req.headers.authorization ?? '');
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(profile));
          } else {
            res.writeHead(404);
            res.end();
          }
        });
      });
      await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve));
      idpUrl = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      await new Promise((resolve) => idp?.close(resolve));
    });

    beforeEach(async () => {
      profile = { email: 'alice@example.test', name: 'Alice' };
      await configure(w, {
        sso_provider: 'oauth',
        sso_oauth_authorize_url: `${idpUrl}/authorize`,
        sso_oauth_token_url: `${idpUrl}/token`,
        sso_oauth_userinfo_url: `${idpUrl}/userinfo`,
        sso_oauth_client_id: 'client-1',
        sso_oauth_client_secret: 'client-secret',
      });
    });

    const start = async (b: Browser) => {
      const res = await b.fetch('/escalated/sso/login');
      expect(res.status).toBe(302);
      return new URL(res.headers.get('location')!);
    };

    it('signs in with a matching state, sending the PKCE verifier to the token endpoint', async () => {
      const b = new Browser(w.base);
      const authorize = await start(b);
      expect(authorize.origin + authorize.pathname).toBe(`${idpUrl}/authorize`);
      expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authorize.searchParams.get('redirect_uri')).toBe(
        `${w.base}/escalated/sso/oauth/callback`,
      );
      const state = authorize.searchParams.get('state')!;

      const res = await b.fetch(`/escalated/sso/oauth/callback?code=the-code&state=${state}`);
      expect(res.status).toBe(302);
      expect(w.host.signedIn).toEqual([501]);
      expect(seen.token?.get('code')).toBe('the-code');
      const verifier = seen.token?.get('code_verifier') ?? '';
      expect(verifier).not.toBe('');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      expect(challenge).toBe(authorize.searchParams.get('code_challenge'));
      expect(seen.userinfoAuth).toBe('Bearer at-123');
    });

    it('refuses a missing or mismatched state, and an IdP error', async () => {
      const b = new Browser(w.base);
      await start(b);
      expect((await b.fetch('/escalated/sso/oauth/callback?code=c')).status).toBe(403);
      await start(b);
      expect((await b.fetch('/escalated/sso/oauth/callback?code=c&state=forged')).status).toBe(403);
      const authorize = await start(b);
      const state = authorize.searchParams.get('state');
      expect(
        (await b.fetch(`/escalated/sso/oauth/callback?error=access_denied&state=${state}`)).status,
      ).toBe(403);
      // Another browser cannot use this browser's state.
      const other = await start(new Browser(w.base));
      expect(
        (
          await new Browser(w.base).fetch(
            `/escalated/sso/oauth/callback?code=c&state=${other.searchParams.get('state')}`,
          )
        ).status,
      ).toBe(403);
      expect(w.host.signedIn).toEqual([]);
    });

    it('refuses an email the provider says is not verified', async () => {
      profile = { email: 'alice@example.test', email_verified: false };
      const b = new Browser(w.base);
      const state = (await start(b)).searchParams.get('state');
      expect((await b.fetch(`/escalated/sso/oauth/callback?code=c&state=${state}`)).status).toBe(
        403,
      );
    });
  });

  describe('JWT', () => {
    const SECRET = 'shared-jwt-secret-of-enough-length';
    const AUD = 'https://help.example.test';
    const token = (
      claims: Record<string, unknown>,
      options: jwt.SignOptions = {},
      key: string = SECRET,
    ) =>
      jwt.sign({ email: 'alice@example.test', name: 'Alice', jti: randomUUID(), ...claims }, key, {
        algorithm: 'HS256',
        expiresIn: 300,
        audience: AUD,
        ...options,
      });

    beforeEach(async () => {
      await configure(w, {
        sso_provider: 'jwt',
        sso_url: 'https://idp.example.test/login',
        sso_jwt_secret: SECRET,
        sso_jwt_algorithm: 'HS256',
      });
    });

    const callback = (t: string) =>
      new Browser(w.base).fetch(`/escalated/sso/jwt/callback?jwt=${encodeURIComponent(t)}`);

    it('starts at the configured login URL with where to come back', async () => {
      const res = await new Browser(w.base).fetch('/escalated/sso/login');
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('return_to')).toBe(`${w.base}/escalated/sso/jwt/callback`);
    });

    it('signs in with a valid token, by GET or POST', async () => {
      expect((await callback(token({}))).status).toBe(302);
      const posted = await new Browser(w.base).fetch('/escalated/sso/jwt/callback', {
        form: { jwt: token({}) },
      });
      expect(posted.status).toBe(302);
      expect(w.host.signedIn).toEqual([501, 501]);
    });

    it('refuses a bad signature, alg none, another algorithm, and algorithm confusion', async () => {
      expect((await callback(token({}, {}, 'another-secret-of-enough-length'))).status).toBe(403);
      const unsigned = jwt.sign(
        {
          email: 'alice@example.test',
          jti: 'n1',
          aud: AUD,
          exp: Math.floor(Date.now() / 1000) + 60,
        },
        '',
        {
          algorithm: 'none',
        },
      );
      expect((await callback(unsigned)).status).toBe(403);
      expect((await callback(token({}, { algorithm: 'HS512' }))).status).toBe(403);

      // RS256 configured: an HS256 token signed with the public key is refused.
      const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
      await configure(w, { sso_jwt_algorithm: 'RS256', sso_jwt_secret: pem });
      const forged = Buffer.from(pem);
      const confused = [
        Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
        Buffer.from(
          JSON.stringify({
            email: 'alice@example.test',
            jti: 'c1',
            aud: AUD,
            exp: Math.floor(Date.now() / 1000) + 60,
          }),
        ).toString('base64url'),
      ].join('.');
      const sig = createHmac('sha256', forged).update(confused).digest('base64url');
      expect((await callback(`${confused}.${sig}`)).status).toBe(403);
      // ...and a real RS256 token passes.
      const rs = jwt.sign(
        { email: 'alice@example.test', jti: randomUUID() },
        privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
        {
          algorithm: 'RS256',
          expiresIn: 60,
          audience: AUD,
        },
      );
      expect((await callback(rs)).status).toBe(302);
      expect(w.host.signedIn).toEqual([501]);
    });

    it('refuses a missing or past exp, a wrong aud, and a missing or reused jti', async () => {
      const now = Math.floor(Date.now() / 1000);
      const noExp = jwt.sign({ email: 'alice@example.test', jti: randomUUID(), aud: AUD }, SECRET, {
        algorithm: 'HS256',
      });
      expect((await callback(noExp)).status).toBe(403);
      const expired = jwt.sign(
        { email: 'alice@example.test', jti: randomUUID(), aud: AUD, exp: now - 600 },
        SECRET,
        { algorithm: 'HS256' },
      );
      expect((await callback(expired)).status).toBe(403);
      expect((await callback(token({}, { audience: 'https://other.test' }))).status).toBe(403);
      const noJti = jwt.sign({ email: 'alice@example.test', aud: AUD }, SECRET, {
        algorithm: 'HS256',
        expiresIn: 60,
      });
      expect((await callback(noJti)).status).toBe(403);

      const once = token({ jti: 'only-once' });
      expect((await callback(once)).status).toBe(302);
      expect((await callback(once)).status).toBe(403);
      expect(w.host.signedIn).toEqual([501]);
    });
  });

  describe('users and roles', () => {
    const SECRET = 'shared-jwt-secret-of-enough-length';
    const sign = (claims: Record<string, unknown>) =>
      jwt.sign({ jti: randomUUID(), ...claims }, SECRET, {
        algorithm: 'HS256',
        expiresIn: 60,
        audience: 'https://help.example.test',
      });
    const callback = (t: string) =>
      new Browser(w.base).fetch(`/escalated/sso/jwt/callback?jwt=${t}`);

    beforeEach(async () => {
      await configure(w, {
        sso_provider: 'jwt',
        sso_url: 'https://idp.test',
        sso_jwt_secret: SECRET,
      });
    });

    it('refuses an unknown email unless creating users is on', async () => {
      expect((await callback(sign({ email: 'new@example.test', name: 'New' }))).status).toBe(403);
      expect(w.host.created).toEqual([]);

      w.host.createUsers = true;
      expect((await callback(sign({ email: 'new@example.test', name: 'New' }))).status).toBe(302);
      expect(w.host.created).toEqual(['new@example.test']);
      expect(w.host.signedIn).toHaveLength(1);
    });

    it('maps the asserted role only with roles on and syncRoles on', async () => {
      const light = await w.source.getRepository(Role).findOneByOrFail({ slug: 'light_agent' });
      await w.source.getRepository(AgentProfile).delete({ userId: 501 } as any);

      expect(
        (await callback(sign({ email: 'alice@example.test', role: 'light_agent' }))).status,
      ).toBe(302);
      expect(
        await w.source.getRepository(AgentProfile).findOneBy({ userId: 501 } as any),
      ).toBeNull();

      w.host.syncRoles = true;
      expect(
        (await callback(sign({ email: 'alice@example.test', role: 'no-such-role' }))).status,
      ).toBe(302);
      expect(
        await w.source.getRepository(AgentProfile).findOneBy({ userId: 501 } as any),
      ).toBeNull();
      expect(
        (await callback(sign({ email: 'alice@example.test', role: 'light_agent' }))).status,
      ).toBe(302);
      expect(
        (await w.source.getRepository(AgentProfile).findOneByOrFail({ userId: 501 } as any)).roleId,
      ).toBe(light.id);
    });
  });
});

describe('SSO role mapping with roles & permissions off', () => {
  it('does not map roles', async () => {
    const w = await world(true);
    try {
      await seedRolesAndPermissions(w.source.manager);
      w.host.syncRoles = true;
      await configure(w, {
        sso_provider: 'jwt',
        sso_url: 'https://idp.test',
        sso_jwt_secret: 'k'.repeat(32),
      });
      const t = jwt.sign(
        { email: 'alice@example.test', role: 'admin', jti: randomUUID() },
        'k'.repeat(32),
        {
          algorithm: 'HS256',
          expiresIn: 60,
          audience: 'https://help.example.test',
        },
      );
      expect((await new Browser(w.base).fetch(`/escalated/sso/jwt/callback?jwt=${t}`)).status).toBe(
        302,
      );
      expect(
        await w.source.getRepository(AgentProfile).findOneBy({ userId: 501 } as any),
      ).toBeNull();
    } finally {
      await w.app.close();
    }
  });
});
