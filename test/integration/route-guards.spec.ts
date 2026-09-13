import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { bootEscalatedModule } from './boot-escalated-module';
import { ESCALATED_OPTIONS } from '../../src/config/escalated.config';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';
import { AgentService } from '../../src/services/agent.service';
import { WebhookService } from '../../src/services/webhook.service';
import { ApiTokenService } from '../../src/services/api-token.service';
import { AutomationService } from '../../src/services/automation.service';
import { TicketService } from '../../src/services/ticket.service';
import { ChatSessionService } from '../../src/services/chat-session.service';
import { AttachmentService } from '../../src/services/attachment.service';
import { KnowledgeBaseService } from '../../src/services/knowledge-base.service';

jest.setTimeout(60000);

/**
 * Boots the real EscalatedModule over HTTP and checks who can reach the
 * admin, agent and customer route groups. Services are stubbed so a request
 * that gets past the guards returns 200 without needing a database, which is
 * exactly what an anonymous caller saw before the groups were guarded.
 */

function makeStubs() {
  return {
    agents: { findAll: jest.fn(async () => []) },
    webhooks: { findAll: jest.fn(async () => []) },
    apiTokens: { findAll: jest.fn(async (_userId: unknown) => []) },
    automations: { findAll: jest.fn(async () => []), run: jest.fn(async () => 0) },
    tickets: { findAll: jest.fn(async (_filters: unknown) => ({ data: [], total: 0 })) },
    chat: {
      getWaitingSessions: jest.fn(async () => []),
      getQueueDepth: jest.fn(async () => 0),
      cleanupIdleSessions: jest.fn(async () => undefined),
    },
    attachments: {
      findById: jest.fn(async () => {
        throw new NotFoundException('Attachment not found');
      }),
    },
    kb: {
      findAllCategories: jest.fn(async () => []),
      searchArticles: jest.fn(async () => []),
    },
  };
}

type Stubs = ReturnType<typeof makeStubs>;

interface RunningApp {
  app: INestApplication;
  stubs: Stubs;
  request: (method: string, path: string) => Promise<Response>;
}

async function startApp(
  escalated: EscalatedModuleOptions = {},
  hostProviders: any[] = [],
): Promise<RunningApp> {
  const stubs = makeStubs();
  const moduleRef = await bootEscalatedModule({
    escalated,
    host: { providers: hostProviders },
    configure: (builder) =>
      builder
        .overrideProvider(AgentService)
        .useValue(stubs.agents)
        .overrideProvider(WebhookService)
        .useValue(stubs.webhooks)
        .overrideProvider(ApiTokenService)
        .useValue(stubs.apiTokens)
        .overrideProvider(AutomationService)
        .useValue(stubs.automations)
        .overrideProvider(TicketService)
        .useValue(stubs.tickets)
        .overrideProvider(ChatSessionService)
        .useValue(stubs.chat)
        .overrideProvider(AttachmentService)
        .useValue(stubs.attachments)
        .overrideProvider(KnowledgeBaseService)
        .useValue(stubs.kb),
  });

  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();

  return {
    app,
    stubs,
    request: (method, path) => fetch(`${base}${path}`, { method }),
  };
}

const allow = (user?: Record<string, unknown>): CanActivate => ({
  canActivate(context: ExecutionContext) {
    if (user) context.switchToHttp().getRequest().user = user;
    return true;
  },
});

const ADMIN_ROUTES = [
  '/escalated/admin/agents',
  '/escalated/admin/webhooks',
  '/escalated/admin/api-tokens',
  '/escalated/admin/automations',
];
const AGENT_ROUTES = ['/escalated/agent/tickets', '/escalated/agent/chat/queue'];

describe('Escalated route guards', () => {
  let running: RunningApp | undefined;

  afterEach(async () => {
    await running?.app.close();
    running = undefined;
  });

  describe('with no guards configured', () => {
    it.each([...ADMIN_ROUTES, ...AGENT_ROUTES, '/escalated/customer/tickets'])(
      'refuses an anonymous GET %s',
      async (path) => {
        running = await startApp();

        const res = await running.request('GET', path);

        expect(res.status).toBe(403);
        expect(running.stubs.agents.findAll).not.toHaveBeenCalled();
        expect(running.stubs.webhooks.findAll).not.toHaveBeenCalled();
        expect(running.stubs.apiTokens.findAll).not.toHaveBeenCalled();
        expect(running.stubs.tickets.findAll).not.toHaveBeenCalled();
      },
    );

    it('refuses an anonymous attachment download before looking the file up', async () => {
      running = await startApp();

      const res = await running.request('GET', '/escalated/attachments/1/download');

      expect(res.status).toBe(403);
      expect(running.stubs.attachments.findById).not.toHaveBeenCalled();
    });
  });

  describe('with a configured guard', () => {
    it('propagates a 401 thrown by the admin guard', async () => {
      running = await startApp({
        adminGuard: {
          canActivate() {
            throw new UnauthorizedException();
          },
        },
      });

      for (const path of ADMIN_ROUTES) {
        expect((await running.request('GET', path)).status).toBe(401);
      }
      expect(running.stubs.agents.findAll).not.toHaveBeenCalled();
    });

    it('refuses with 403 when the admin guard returns false', async () => {
      running = await startApp({ adminGuard: { canActivate: () => false } });

      expect((await running.request('GET', '/escalated/admin/agents')).status).toBe(403);
      expect(running.stubs.agents.findAll).not.toHaveBeenCalled();
    });

    it('lets the request through when the admin guard allows it', async () => {
      running = await startApp({ adminGuard: allow({ id: 7 }) });

      for (const path of ADMIN_ROUTES) {
        expect((await running.request('GET', path)).status).toBe(200);
      }
      expect(running.stubs.apiTokens.findAll).toHaveBeenCalledWith(7);
    });

    it('does not let the admin guard open the agent or customer groups', async () => {
      running = await startApp({ adminGuard: allow({ id: 7 }) });

      for (const path of [...AGENT_ROUTES, '/escalated/customer/tickets']) {
        expect((await running.request('GET', path)).status).toBe(403);
      }
    });

    it('guards the agent group with agentGuard', async () => {
      running = await startApp({ agentGuard: allow({ id: 3 }) });

      for (const path of AGENT_ROUTES) {
        expect((await running.request('GET', path)).status).toBe(200);
      }
      expect((await running.request('GET', '/escalated/admin/agents')).status).toBe(403);
    });

    it('guards the customer group with customerGuard', async () => {
      running = await startApp({ customerGuard: allow({ id: 5 }) });

      const res = await running.request('GET', '/escalated/customer/tickets');

      expect(res.status).toBe(200);
      expect(running.stubs.tickets.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ requesterId: 5 }),
      );
      expect((await running.request('GET', '/escalated/agent/tickets')).status).toBe(403);
    });

    it.each([
      ['agentGuard', { agentGuard: allow({ id: 3 }) }],
      ['customerGuard', { customerGuard: allow({ id: 5 }) }],
    ])('lets %s reach attachment downloads', async (_name, options) => {
      running = await startApp(options);

      const res = await running.request('GET', '/escalated/attachments/1/download');

      expect(res.status).toBe(404);
      expect(running.stubs.attachments.findById).toHaveBeenCalledWith(1);
    });

    it('instantiates a guard class with dependency injection', async () => {
      @Injectable()
      class OptionsAwareAdminGuard implements CanActivate {
        constructor(@Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions) {}

        canActivate(): boolean {
          return this.options.appName === 'Guarded Desk';
        }
      }

      running = await startApp({ appName: 'Guarded Desk', adminGuard: OptionsAwareAdminGuard });

      expect((await running.request('GET', '/escalated/admin/agents')).status).toBe(200);
    });

    it('uses the host-registered instance of a guard class', async () => {
      const HOST_ALLOWED_USER = 'HOST_ALLOWED_USER';

      @Injectable()
      class HostAgentGuard implements CanActivate {
        constructor(@Inject(HOST_ALLOWED_USER) private readonly userId: number) {}

        canActivate(context: ExecutionContext): boolean {
          context.switchToHttp().getRequest().user = { id: this.userId };
          return true;
        }
      }

      running = await startApp({ agentGuard: HostAgentGuard }, [
        { provide: HOST_ALLOWED_USER, useValue: 11 },
        HostAgentGuard,
      ]);

      expect((await running.request('GET', '/escalated/agent/tickets')).status).toBe(200);
    });
  });

  describe('public endpoints keep their own auth model', () => {
    beforeEach(async () => {
      running = await startApp();
    });

    it.each([
      ['GET', '/escalated/widget/kb/search', 200],
      ['GET', '/escalated/widget/chat/availability', 200],
      ['GET', '/escalated/customer/kb/categories', 200],
      // Guest-token guard, not a route-group guard.
      ['GET', '/escalated/widget/tickets/1', 403],
      // Host auth callbacks are not configured.
      ['POST', '/escalated/api/v1/auth/login', 501],
      // Inbound signature guard: no webhook secret configured.
      ['POST', '/escalated/webhook/email/inbound', 401],
    ])('%s %s responds %i without any route-group guard', async (method, path, status) => {
      const res = await running!.request(method as string, path as string);

      expect(res.status).toBe(status);
    });
  });
});
