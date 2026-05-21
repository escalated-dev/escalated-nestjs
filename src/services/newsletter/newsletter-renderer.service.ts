import { Inject, Injectable, Logger } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import Handlebars from 'handlebars';
import MarkdownIt from 'markdown-it';
import {
  ESCALATED_OPTIONS,
  type EscalatedModuleOptions,
} from '../../config/escalated.config';
import { Contact } from '../../entities/contact.entity';
import { NewsletterDelivery } from '../../entities/newsletter';

interface RenderContext {
  baseUrl: string;
  trackingEnabled: boolean;
  defaultTheme: string;
  themesDir: string;
  brand: {
    name: string;
    accent: string;
    logo_url?: string;
    physical_address?: string;
  };
}

@Injectable()
export class NewsletterRendererService {
  private readonly logger = new Logger(NewsletterRendererService.name);
  private readonly md = new MarkdownIt({ html: false, linkify: false });
  private readonly templateCache = new Map<string, HandlebarsTemplateDelegate>();

  private static readonly ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel'];

  constructor(
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
  ) {}

  render(delivery: NewsletterDelivery): string {
    const ctx = this.buildContext();
    const n = delivery.newsletter;
    const contact = delivery.contact;
    const bodyMarkdown = n.body_markdown ?? n.template?.body_markdown ?? '';
    const themeSlug = n.theme ?? n.template?.theme ?? ctx.defaultTheme;

    let body = this.md.render(bodyMarkdown);
    body = this.resolveMergeFields(body, contact, delivery, ctx);

    const themed = this.renderTheme(themeSlug, ctx, {
      subject: n.subject,
      body,
      unsubscribe_url: this.unsubscribeUrl(delivery, ctx),
      view_in_browser_url: this.viewInBrowserUrl(delivery, ctx),
      brand: ctx.brand,
    });

    if (!ctx.trackingEnabled) return themed;
    return this.injectPixel(this.rewriteLinks(themed, delivery, ctx), delivery, ctx);
  }

  unsubscribeUrl(delivery: NewsletterDelivery, ctx?: RenderContext): string {
    const base = ctx?.baseUrl ?? this.buildContext().baseUrl;
    return `${base}/escalated/n/u/${delivery.tracking_token}`;
  }

  viewInBrowserUrl(delivery: NewsletterDelivery, ctx?: RenderContext): string {
    const base = ctx?.baseUrl ?? this.buildContext().baseUrl;
    return `${base}/escalated/n/v/${delivery.tracking_token}`;
  }

  private buildContext(): RenderContext {
    const opts = this.options.newsletters ?? {};
    return {
      baseUrl: (this.options.appUrl ?? 'http://localhost').replace(/\/+$/, ''),
      trackingEnabled: opts.trackingEnabled !== false,
      defaultTheme: opts.defaultTheme ?? 'default',
      themesDir: opts.themesDir ?? join(__dirname, '../../../templates/newsletter/themes'),
      brand: {
        name: opts.brand?.name ?? this.options.appName ?? 'Support',
        accent: opts.brand?.accent ?? '#2563eb',
        logo_url: opts.brand?.logoUrl,
        physical_address: opts.brand?.physicalAddress,
      },
    };
  }

  private renderTheme(slug: string, ctx: RenderContext, data: Record<string, unknown>): string {
    const cached = this.templateCache.get(slug);
    if (cached) return cached(data);
    const candidate = join(ctx.themesDir, `${slug}.hbs`);
    const path = existsSync(candidate)
      ? candidate
      : join(ctx.themesDir, 'default.hbs');
    const source = readFileSync(path, 'utf8');
    const compiled = Handlebars.compile(source, { noEscape: false });
    this.templateCache.set(slug, compiled);
    return compiled(data);
  }

  private resolveMergeFields(
    html: string,
    contact: Contact,
    delivery: NewsletterDelivery,
    ctx: RenderContext,
  ): string {
    return html.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, raw: string) => {
      const path = raw.trim();
      const value = this.resolvePath(path, contact, delivery, ctx);
      return this.escape(value);
    });
  }

  private resolvePath(
    path: string,
    contact: Contact,
    delivery: NewsletterDelivery,
    ctx: RenderContext,
  ): string {
    if (path === 'contact.name') return String(contact.name ?? '');
    if (path === 'contact.first_name') return (String(contact.name ?? '').split(' ')[0] ?? '');
    if (path === 'contact.email') return String(contact.email);
    if (path === 'unsubscribe_url') return this.unsubscribeUrl(delivery, ctx);
    if (path === 'view_in_browser_url') return this.viewInBrowserUrl(delivery, ctx);
    if (path.startsWith('contact.metadata.')) {
      const key = path.slice('contact.metadata.'.length);
      const value = (contact.metadata ?? {})[key];
      return value == null ? '' : String(value);
    }
    return '';
  }

  private rewriteLinks(html: string, delivery: NewsletterDelivery, ctx: RenderContext): string {
    const unsubPrefix = this.unsubscribeUrl(delivery, ctx);
    const viewPrefix = this.viewInBrowserUrl(delivery, ctx);
    return html.replace(/(<a\s[^>]*\bhref=)(["'])(.*?)\2/gi, (match, prefix, quote, href: string) => {
      if (!href || href.startsWith('#')) return match;
      const scheme = (href.split(':')[0] ?? '').toLowerCase();
      if (!NewsletterRendererService.ALLOWED_SCHEMES.includes(scheme)) {
        return `${prefix}${quote}#${quote}`;
      }
      if (scheme === 'mailto' || scheme === 'tel') return match;
      if (href.startsWith(unsubPrefix) || href.startsWith(viewPrefix)) return match;
      const encoded = Buffer.from(href, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      const tracked = `${ctx.baseUrl}/escalated/n/c/${delivery.tracking_token}?u=${encoded}`;
      return `${prefix}${quote}${tracked}${quote}`;
    });
  }

  private injectPixel(html: string, delivery: NewsletterDelivery, ctx: RenderContext): string {
    const url = `${ctx.baseUrl}/escalated/n/o/${delivery.tracking_token}.gif`;
    const pixel = `<img src="${this.escape(url)}" width="1" height="1" alt="" />`;
    if (html.includes('</body>')) {
      return html.replace('</body>', `${pixel}</body>`);
    }
    return html + pixel;
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
