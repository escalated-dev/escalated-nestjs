import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { requireUserId } from '../../config/request-user';
import { EscalatedAgentGuard } from '../../guards/escalated-route.guard';
import {
  AgentNotificationsService,
  NOTIFICATIONS_MAX_PER_PAGE,
  NOTIFICATIONS_PER_PAGE,
} from '../../services/agent-notifications.service';
import {
  AGENT_STATUSES,
  AgentStatusService,
  isAgentStatus,
} from '../../services/agent-status.service';
import { KnowledgeBaseService } from '../../services/knowledge-base.service';
import { TicketReadsService } from '../../services/ticket-reads.service';
import { TicketService } from '../../services/ticket.service';
import { back } from '../../ui/inertia';
import { BrowserFormGuard, EscalatedUi, UiValidationException } from '../../ui/inertia.interceptor';
import { sameOriginReferer, wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';
import { uiEnabled } from '../../ui/ui-options';

export const KB_SEARCH_DEFAULT_LIMIT = 10;
export const KB_SEARCH_MAX_LIMIT = 20;

function origin(request: any): string {
  const protocol = request?.protocol ?? (request?.secure ? 'https' : 'http');
  return `${protocol}://${request?.headers?.host ?? 'localhost'}`;
}

/** Plain text from article HTML, about 160 characters. */
export function excerpt(html: string | null | undefined, length = 160): string {
  const text = String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > length ? `${text.slice(0, length).trimEnd()}...` : text;
}

function wholeNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  return /^\d+$/.test(String(value)) ? Number(value) : NaN;
}

/**
 * The agent panel's own data routes (ADR 2026-11-05-agent-panel-data): the
 * agent's status, knowledge-base search, the notifications feed and per-agent
 * read markers. Every one acts for the signed-in agent only. JSON clients get
 * JSON; an Inertia visit to a mutating route goes back.
 */
@UseGuards(EscalatedAgentGuard, BrowserFormGuard)
@EscalatedUi()
@Controller('escalated/agent')
export class AgentPanelController {
  constructor(
    private readonly status: AgentStatusService,
    private readonly kb: KnowledgeBaseService,
    private readonly notifications: AgentNotificationsService,
    private readonly reads: TicketReadsService,
    private readonly tickets: TicketService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  /** Any agent, light agents included, sets their own status. */
  @Put('status')
  @HttpCode(200)
  putStatus(@Body() body: any, @Req() req: any) {
    return this.setStatus(body, req);
  }

  @Post('status')
  @HttpCode(200)
  postStatus(@Body() body: any, @Req() req: any) {
    return this.setStatus(body, req);
  }

  @Get('kb/search')
  async kbSearch(@Query() query: Record<string, unknown>, @Req() req: any) {
    if (this.options?.enableKnowledgeBase === false) throw new NotFoundException();
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    if (q.length < 2 || q.length > 200) {
      throw new UiValidationException({ q: 'The q field must be between 2 and 200 characters.' });
    }
    const limit = wholeNumber(query.limit);
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > KB_SEARCH_MAX_LIMIT)) {
      throw new UiValidationException({
        limit: `The limit field must be between 1 and ${KB_SEARCH_MAX_LIMIT}.`,
      });
    }
    const articles = await this.kb.searchForAgents(q, limit ?? KB_SEARCH_DEFAULT_LIMIT);
    const linkable = uiEnabled(this.options);
    return {
      data: articles.map((article) => ({
        id: article.id,
        title: article.title,
        excerpt: excerpt(article.content),
        url: linkable
          ? origin(req) + routeUrl('escalated.customer.kb.show', { slug: article.slug })
          : null,
        category: article.category
          ? { id: article.category.id, name: article.category.name }
          : null,
        updated_at: article.updatedAt ? new Date(article.updatedAt).toISOString() : null,
      })),
    };
  }

  @Get('notifications')
  async notificationIndex(@Query() query: Record<string, unknown>, @Req() req: any) {
    const agent = this.feedUser(req);
    const page = wholeNumber(query.page);
    const perPage = wholeNumber(query.per_page);
    if (page !== null && (!Number.isInteger(page) || page < 1)) {
      throw new UiValidationException({ page: 'The page field must be at least 1.' });
    }
    if (
      perPage !== null &&
      (!Number.isInteger(perPage) || perPage < 1 || perPage > NOTIFICATIONS_MAX_PER_PAGE)
    ) {
      throw new UiValidationException({
        per_page: `The per page field must be between 1 and ${NOTIFICATIONS_MAX_PER_PAGE}.`,
      });
    }
    const unread = ['1', 'true'].includes(String(query.unread ?? '').toLowerCase());
    const size = perPage ?? NOTIFICATIONS_PER_PAGE;
    const current = page ?? 1;
    const { items, total } = await this.notifications.page(agent, current, size, unread);
    return {
      data: items,
      meta: {
        current_page: current,
        last_page: Math.max(1, Math.ceil(total / size)),
        per_page: size,
        total,
      },
      unread_count: await this.notifications.unreadCount(agent),
    };
  }

  /** Declared before `notifications/:id/read`. */
  @Post('notifications/read-all')
  @HttpCode(200)
  async notificationsReadAll(@Req() req: any) {
    const agent = this.feedUser(req);
    await this.notifications.markAllRead(agent);
    return { unread_count: 0 };
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async notificationRead(@Param('id') id: string, @Req() req: any) {
    const agent = this.feedUser(req);
    if (!(await this.notifications.markRead(agent, String(id)))) throw new NotFoundException();
    return { unread_count: await this.notifications.unreadCount(agent) };
  }

  @Post('tickets/:ticket/read')
  @HttpCode(200)
  async markRead(@Param('ticket') param: string, @Req() req: any) {
    const ticket = await this.ticket(param);
    await this.reads.markRead(requireUserId(req), ticket.id);
    return this.readAnswer(req, false);
  }

  @Post('tickets/:ticket/unread')
  @HttpCode(200)
  async markUnread(@Param('ticket') param: string, @Req() req: any) {
    const ticket = await this.ticket(param);
    await this.reads.markUnread(requireUserId(req), ticket.id);
    return this.readAnswer(req, true);
  }

  private async setStatus(body: any, req: any) {
    const value = body?.status;
    if (!isAgentStatus(value)) {
      throw new UiValidationException({
        status: `The selected status is invalid (${AGENT_STATUSES.join(', ')}).`,
      });
    }
    await this.status.set(requireUserId(req), value);
    if (wantsPage(this.options, req)) return this.back(req);
    return { agent_status: value };
  }

  /** The ticket by id or reference, in the agent's ticket-access scope (404 otherwise). */
  private async ticket(param: string) {
    if (/^\d+$/.test(param)) return this.tickets.findById(Number(param));
    if (/^[A-Za-z0-9-]{1,64}$/.test(param)) return this.tickets.findByReference(param);
    throw new NotFoundException('Ticket not found');
  }

  private readAnswer(req: any, unread: boolean) {
    if (wantsPage(this.options, req)) return this.back(req);
    return { is_unread: unread };
  }

  private back(req: any) {
    return back(
      sameOriginReferer(req) ??
        (uiEnabled(this.options) ? routeUrl('escalated.agent.tickets.index') : '/'),
    );
  }

  private feedUser(req: any) {
    if (!this.notifications.available()) throw new NotFoundException();
    return requireUserId(req);
  }
}
