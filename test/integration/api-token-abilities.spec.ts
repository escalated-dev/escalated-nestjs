import { Controller, Get, INestApplication, Req, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { bootEscalatedModule } from './boot-escalated-module';
import { ApiTokenAbility, ApiTokenGuard } from '../../src/guards/api-token.guard';
import { EscalatedAdminGuard } from '../../src/guards/escalated-route.guard';
import { ApiTokenService } from '../../src/services/api-token.service';
import { ApiToken } from '../../src/entities';

jest.setTimeout(60000);

/*
 * API token abilities are enforced as escalated-laravel's AuthenticateApiToken
 * enforces them: agent routes need the `agent` ability, admin routes need
 * `admin`, `*` grants both, and a token without the needed ability gets 403.
 */

@Controller('host-api')
class HostApi {
  /** Host route with no ability requirement. */
  @Get('open')
  @UseGuards(ApiTokenGuard)
  open(@Req() req: any) {
    return { userId: req.apiUserId };
  }

  /** Host route that names its ability explicitly. */
  @Get('reports')
  @UseGuards(ApiTokenGuard)
  @ApiTokenAbility('admin')
  reports() {
    return { ok: true };
  }
}

/** Host route that stacks the token guard in front of Escalated's admin group. */
@Controller('host-admin')
@UseGuards(ApiTokenGuard, EscalatedAdminGuard)
class HostAdmin {
  @Get()
  index() {
    return { ok: true };
  }
}

describe('API token abilities', () => {
  let app: INestApplication;
  let base: string;
  let tokens: ApiTokenService;
  let source: DataSource;

  beforeAll(async () => {
    const moduleRef = await bootEscalatedModule({
      host: { controllers: [HostApi, HostAdmin] },
      escalated: {
        adminGuard: ApiTokenGuard,
        agentGuard: ApiTokenGuard,
        customerGuard: ApiTokenGuard,
      },
    });
    source = moduleRef.get(DataSource);
    await source.initialize();
    await source.synchronize();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    tokens = app.get(ApiTokenService);
  });

  afterAll(async () => {
    await app?.close();
  });

  let counter = 0;
  let lastId = 0;
  const tokenWith = async (abilities: string[] | null): Promise<string> => {
    const { token, plainTextToken } = await tokens.create({
      name: `t-${++counter}`,
      userId: 1,
      abilities: abilities ?? undefined,
    });
    if (abilities === null || abilities.length === 0) {
      await source.getRepository(ApiToken).update(token.id, { abilities: abilities as any });
    }
    lastId = token.id;
    return plainTextToken;
  };

  const get = (path: string, token: string) =>
    fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });

  const AGENT_ROUTE = '/escalated/agent/tickets';
  const ADMIN_ROUTE = '/escalated/admin/skills';

  it('lets an agent token reach agent routes and refuses admin routes with 403', async () => {
    const token = await tokenWith(['agent']);

    expect((await get(AGENT_ROUTE, token)).status).toBe(200);
    const admin = await get(ADMIN_ROUTE, token);
    expect(admin.status).toBe(403);
    expect(await admin.json()).toMatchObject({ message: 'Insufficient permissions.' });
  });

  it('lets an admin token reach admin routes and refuses agent routes, as Laravel does', async () => {
    const token = await tokenWith(['admin']);

    expect((await get(ADMIN_ROUTE, token)).status).toBe(200);
    expect((await get(AGENT_ROUTE, token)).status).toBe(403);
  });

  it('lets a wildcard token reach both', async () => {
    const token = await tokenWith(['*']);

    expect((await get(AGENT_ROUTE, token)).status).toBe(200);
    expect((await get(ADMIN_ROUTE, token)).status).toBe(200);
  });

  it('refuses a token with no abilities on agent and admin routes', async () => {
    for (const abilities of [[], null]) {
      const token = await tokenWith(abilities);
      expect((await get(AGENT_ROUTE, token)).status).toBe(403);
      expect((await get(ADMIN_ROUTE, token)).status).toBe(403);
    }
  });

  it('does not record use of a token that was refused', async () => {
    const token = await tokenWith(['agent']);
    await get(ADMIN_ROUTE, token);

    const row = await source.getRepository(ApiToken).findOneByOrFail({ id: lastId });
    expect(row.lastUsedAt).toBeNull();
  });

  it('honours an explicit @ApiTokenAbility on a host route', async () => {
    expect((await get('/host-api/reports', await tokenWith(['agent']))).status).toBe(403);
    expect((await get('/host-api/reports', await tokenWith(['admin']))).status).toBe(200);
  });

  it('infers the admin ability when the token guard runs before the admin group guard', async () => {
    expect((await get('/host-admin', await tokenWith(['agent']))).status).toBe(403);
    expect((await get('/host-admin', await tokenWith(['admin']))).status).toBe(200);
  });

  it('requires no ability on a host route that names none', async () => {
    const res = await get('/host-api/open', await tokenWith(['agent']));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 1 });
  });

  it('still answers 401 for a missing or unknown token', async () => {
    expect((await fetch(`${base}${AGENT_ROUTE}`)).status).toBe(401);
    expect((await get(AGENT_ROUTE, 'nope')).status).toBe(401);
  });
});
