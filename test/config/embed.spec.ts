import { embedAdmin, embedFrameAncestors, frameAncestorsDirective, resolveEmbed } from '../../src';
import { flashCookie } from '../../src/ui/flash';
import { markEmbedded } from '../../src/ui/embed';

/** The `ui.embed` options and `embedAdmin()` (ADR 2026-11-05-embeddable-admin). */
describe('embed configuration', () => {
  it('is off by default, and needs the screens on', () => {
    expect(resolveEmbed({}, {})).toBeNull();
    expect(resolveEmbed({ ui: { enabled: true } }, {})).toBeNull();
    expect(resolveEmbed({ ui: { enabled: false, embed: { enabled: true } } }, {})).toBeNull();
    expect(resolveEmbed({ ui: { enabled: true, embed: { enabled: false } } }, {})).toBeNull();
  });

  it('applies the defaults', () => {
    expect(resolveEmbed({ ui: { enabled: true, embed: { enabled: true } } }, {})).toEqual({
      mode: 'layout',
      prefix: 'admin/support',
      middleware: [],
      guards: [],
      replaceAdminGate: false,
      layout: null,
      rootView: null,
      frameAncestors: [],
    });
  });

  it('reads the environment variables', () => {
    const embed = resolveEmbed(
      { ui: { enabled: true } },
      {
        ESCALATED_EMBED: 'true',
        ESCALATED_EMBED_MODE: 'iframe',
        ESCALATED_EMBED_PREFIX: '/console/support/',
        ESCALATED_EMBED_FRAME_ANCESTORS: 'https://a.example, https://b.example:8443 ,*',
      },
    );
    expect(embed).toMatchObject({
      mode: 'iframe',
      prefix: 'console/support',
      frameAncestors: ['https://a.example', 'https://b.example:8443'],
    });
    // Options win over the environment.
    expect(
      resolveEmbed(
        { ui: { enabled: true, embed: { enabled: false } } },
        { ESCALATED_EMBED: 'true' },
      ),
    ).toBeNull();
  });

  it('embedAdmin() turns it on, trimming the prefix', () => {
    const embed = embedAdmin({ prefix: '/console/support/', layout: 'Layouts/ConsoleLayout' });
    expect(embed.enabled).toBe(true);
    expect(resolveEmbed({ ui: { enabled: true, embed } }, {})).toMatchObject({
      prefix: 'console/support',
      layout: 'Layouts/ConsoleLayout',
      mode: 'layout',
      replaceAdminGate: false,
    });
  });

  it('refuses an unknown mode', () => {
    expect(() => embedAdmin({ mode: 'popup' as any })).toThrow(/'layout' or 'iframe'/);
  });

  it('keeps only exact http(s) origins in the frame allow-list', () => {
    expect(
      embedFrameAncestors([
        'https://admin.example.com',
        'https://admin.example.com/',
        'HTTPS://Admin.Example.com',
        'https://*.example.com',
        '*',
        'https://admin.example.com/path',
        'https://user:pw@admin.example.com',
        'javascript:alert(1)',
        'admin.example.com',
        'http://localhost:3000',
      ]),
    ).toEqual(['https://admin.example.com', 'http://localhost:3000']);
  });

  it('allows only same-origin framing when no origins are listed', () => {
    expect(frameAncestorsDirective({ frameAncestors: [] })).toBe("frame-ancestors 'self'");
    expect(frameAncestorsDirective({ frameAncestors: ['https://a.example'] })).toBe(
      "frame-ancestors 'self' https://a.example",
    );
  });

  it("sends the screens' own cookies cross-site only from an embedded frame over HTTPS", () => {
    const embed = resolveEmbed(
      { ui: { enabled: true, embed: embedAdmin({ mode: 'iframe' }) } },
      {},
    )!;
    const state = { flash: { success: 'Saved' }, errors: {} };
    const framed: any = { secure: true };
    markEmbedded(framed, null, embed);
    expect(flashCookie(framed, state)).toMatch(/; SameSite=None; Secure$/);
    // Not over HTTPS, not framed, or layout mode: Lax as always.
    const plain: any = { secure: false };
    markEmbedded(plain, null, embed);
    expect(flashCookie(plain, state)).toMatch(/; SameSite=Lax$/);
    expect(flashCookie({ secure: true }, state)).toMatch(/; SameSite=Lax; Secure$/);
    const layout: any = { secure: true };
    markEmbedded(layout, null, resolveEmbed({ ui: { enabled: true, embed: embedAdmin() } }, {})!);
    expect(flashCookie(layout, state)).toMatch(/; SameSite=Lax; Secure$/);
  });
});
