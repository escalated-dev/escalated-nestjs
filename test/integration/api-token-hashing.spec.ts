import { createHash } from 'crypto';
import { Controller, Get, INestApplication, Req, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { bootEscalatedModule } from './boot-escalated-module';
import { apiFetch, guardFor, inertiaFetch } from './ui-harness';
import { ApiTokenGuard } from '../../src/guards/api-token.guard';
import { ApiTokenService } from '../../src/services/api-token.service';
import { ApiToken } from '../../src/entities';

jest.setTimeout(60000);

/*
 * API tokens are stored as their SHA-256 digest, as escalated-laravel stores
 * them. The plain token is returned once, by the create call, and is what a
 * client sends; the digest never leaves the server.
 */

@Controller('token-api')
@UseGuards(ApiTokenGuard)
class TokenApi {
  @Get('me') me(@Req() req: any) {
    return { userId: req.apiUserId, tokenId: req.apiToken?.id };
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('API tokens are stored hashed', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  const asAdmin = { as: 'admin' as const };

  beforeAll(async () => {
    const moduleRef = await bootEscalatedModule({
      host: { controllers: [TokenApi] },
      escalated: {
        adminGuard: guardFor('admin'),
        agentGuard: guardFor('agent'),
        customerGuard: guardFor('customer'),
        ui: { enabled: true },
      },
    });
    source = moduleRef.get(DataSource);
    await source.initialize();
    await source.synchronize();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  const createToken = async (name: string) => {
    const res = await apiFetch(base, '/escalated/admin/api-tokens', {
      ...asAdmin,
      body: { name, abilities: ['agent'] },
    });
    expect(res.status).toBe(201);
    const body = await res.text();
    return { body, created: JSON.parse(body) };
  };

  const authed = (token: string) =>
    fetch(`${base}/token-api/me`, { headers: { authorization: `Bearer ${token}` } });

  it('returns the plain token once and stores only its SHA-256 digest', async () => {
    const { body, created } = await createToken('Hashed');
    const plain: string = created.plainTextToken;
    expect(plain).toMatch(/^[0-9a-f]{80}$/);
    expect(body).not.toContain(sha256(plain));

    const row = await source.getRepository(ApiToken).findOneByOrFail({ name: 'Hashed' });
    expect(row.token).toBe(sha256(plain));
    expect(row.token).not.toBe(plain);
    expect(row.abilities).toEqual(['agent']);

    const raw = await source.query(`SELECT * FROM escalated_api_tokens WHERE name = 'Hashed'`);
    expect(JSON.stringify(raw)).not.toContain(plain);
  });

  it('authenticates with the plain token and refuses the stored digest', async () => {
    const { created } = await createToken('Bearer');
    const plain: string = created.plainTextToken;

    const ok = await authed(plain);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ userId: 1, tokenId: created.token.id });

    expect((await authed(sha256(plain))).status).toBe(401);
    expect((await authed('not-a-token')).status).toBe(401);

    const service = app.get(ApiTokenService);
    expect((await service.validate(plain))?.id).toBe(created.token.id);
    expect((await service.validate(plain, 'agent'))?.id).toBe(created.token.id);
    expect(await service.validate(plain, 'admin')).toBeNull();
    expect(await service.validate(sha256(plain))).toBeNull();
  });

  it('never sends the digest or the plain token back after creation', async () => {
    const { created } = await createToken('Listed');
    const plain: string = created.plainTextToken;
    const digest = sha256(plain);

    const responses = [
      await apiFetch(base, '/escalated/admin/api-tokens', asAdmin),
      await inertiaFetch(base, '/escalated/admin/api-tokens', asAdmin),
      await apiFetch(base, `/escalated/admin/api-tokens/${created.token.id}/revoke`, {
        ...asAdmin,
        body: {},
      }),
    ];
    for (const res of responses) {
      expect(res.status).toBeLessThan(400);
      const text = await res.text();
      expect(text).not.toContain(digest);
      expect(text).not.toContain(plain);
    }
  });
});
