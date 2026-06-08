import { join } from 'path';
import { NewsletterRendererService } from '../../../src/services/newsletter/newsletter-renderer.service';
import type { EscalatedModuleOptions } from '../../../src/config/escalated.config';
import type { NewsletterDelivery } from '../../../src/entities/newsletter';
import { Contact } from '../../../src/entities/contact.entity';

function buildOptions(
  overrides: Partial<EscalatedModuleOptions['newsletters']> = {},
): EscalatedModuleOptions {
  return {
    appUrl: 'http://localhost',
    appName: 'Acme Support',
    enableNewsletters: true,
    newsletters: {
      defaultTheme: 'default',
      trackingEnabled: true,
      themesDir: join(__dirname, '../../../templates/newsletter/themes'),
      ...overrides,
    },
  };
}

function buildDelivery(
  opts: {
    bodyMarkdown?: string;
    contactName?: string | null;
    contactEmail?: string;
  } = {},
): NewsletterDelivery {
  const contact = new Contact();
  contact.id = 1;
  contact.email = opts.contactEmail ?? 'maria@example.com';
  contact.name = opts.contactName ?? 'Maria Lopez';
  contact.metadata = {};
  contact.marketing_opt_out_at = null;

  const delivery: NewsletterDelivery = {
    id: '1',
    newsletter_id: 1,
    contact_id: contact.id,
    email_at_send: contact.email,
    status: 'sent',
    tracking_token: 'tok-abc123',
    sent_at: new Date(),
    opened_at: null,
    last_clicked_at: null,
    clicks_count: 0,
    bounce_reason: null,
    failure_reason: null,
    attempt_count: 0,
    claimed_at: null,
    next_attempt_at: null,
    is_test: false,
    created_at: new Date(),
    newsletter: {
      id: 1,
      subject: 'Hello',
      from_email: 'hi@example.com',
      from_name: null,
      reply_to: null,
      target_list_id: 1,
      template_id: null,
      theme: 'default',
      body_markdown: opts.bodyMarkdown ?? 'Hi {{ contact.first_name }}!',
      status: 'sending',
      scheduled_at: null,
      sent_at: null,
      created_by: null,
      sent_by: null,
      summary_total: 1,
      summary_sent: 0,
      summary_opened: 0,
      summary_clicked: 0,
      summary_bounced: 0,
      summary_complained: 0,
      created_at: new Date(),
      updated_at: new Date(),
      targetList: null as never,
      template: null,
      deliveries: [],
    },
    contact,
  };
  return delivery;
}

describe('NewsletterRendererService', () => {
  it('renders Markdown and resolves contact merge fields', () => {
    const renderer = new NewsletterRendererService(buildOptions());
    const html = renderer.render(
      buildDelivery({
        bodyMarkdown: '# Hi {{ contact.first_name }}\n\nYour email is {{ contact.email }}.',
        contactName: 'Maria Lopez',
      }),
    );
    expect(html).toContain('<h1>Hi Maria</h1>');
    expect(html).toContain('Your email is maria@example.com.');
  });

  it('resolves unknown merge fields to empty strings', () => {
    const renderer = new NewsletterRendererService(buildOptions());
    const html = renderer.render(buildDelivery({ bodyMarkdown: 'foo {{ contact.unknown }} bar' }));
    expect(html).toContain('foo  bar');
    expect(html).not.toContain('{{');
  });

  it('rewrites href attributes to the click endpoint', () => {
    const renderer = new NewsletterRendererService(buildOptions());
    const html = renderer.render(
      buildDelivery({ bodyMarkdown: '[Click](https://landing.example/page)' }),
    );
    expect(html).toMatch(/href="http:\/\/localhost\/escalated\/n\/c\/[^"]+"/);
    expect(html).not.toContain('https://landing.example/page"');
  });

  it('appends the tracking pixel before </body>', () => {
    const renderer = new NewsletterRendererService(buildOptions());
    const html = renderer.render(buildDelivery());
    expect(html).toMatch(/<img src="http:\/\/localhost\/escalated\/n\/o\/[^"]+\.gif"/);
  });

  it('skips click rewriting and pixel when tracking is disabled', () => {
    const renderer = new NewsletterRendererService(buildOptions({ trackingEnabled: false }));
    const html = renderer.render(
      buildDelivery({ bodyMarkdown: '[Click](https://landing.example/page)' }),
    );
    expect(html).toContain('https://landing.example/page');
    expect(html).not.toContain('/escalated/n/o/');
  });

  it('does not leave any javascript: href in the rendered output', () => {
    const renderer = new NewsletterRendererService(buildOptions());
    const html = renderer.render(buildDelivery({ bodyMarkdown: '[Bad](javascript:alert(1))' }));
    expect(html).not.toMatch(/href="javascript:/i);
  });
});
