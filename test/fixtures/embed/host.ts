import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NestMiddleware,
  Req,
} from '@nestjs/common';
import {
  EscalatedAdminNavigation,
  escapeHtml,
  ROUTE_HELPER,
  scriptJson,
  type EscalatedNavigationItem,
  type InertiaPageObject,
} from '../../../src';

/**
 * A host's own pieces for the embedded-admin tests (ADR
 * 2026-11-05-embeddable-admin): its admin middleware, its admin guard, and
 * its server-rendered admin template, the one docs/embedding-admin.md shows.
 */

/** Host middleware: marks what it saw, refuses `x-host-block`. */
@Injectable()
export class HostAdminMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void): void {
    if (req.headers['x-host-block']) {
      res.statusCode = 401;
      res.end('Sign in to the back office first.');
      return;
    }
    res.setHeader('X-Host-Admin', '1');
    next();
  }
}

/** Host middleware that sends its own policies, as helmet would. */
export function hostFramingMiddleware(req: any, res: any, next: () => void): void {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (req.headers['x-host-csp']) res.setHeader('Content-Security-Policy', "script-src 'self'");
  next();
}

/** A host guard that refuses `x-host-deny`. */
export const hostDenyGuard: CanActivate = {
  canActivate(context: ExecutionContext) {
    return !context.switchToHttp().getRequest().headers['x-host-deny'];
  },
};

/** The host's own admin check: back-office owners (`x-owner: yes`), whatever Escalated thinks. */
export const hostOwnerGuard: CanActivate = {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.headers['x-owner'] !== 'yes') return false;
    req.user = { id: Number(req.headers['x-user']), name: 'Owner' };
    return true;
  },
};

// --- docs/embedding-admin.md, "2. Server-rendered host" -----------------------

/**
 * The host's admin template as the root view of embedded admin pages: its
 * header and sidebar (listing Escalated's menu from the page's
 * `escalated.navigation`) around the Inertia mount point.
 */
export function hostAdminRootView(page: InertiaPageObject): string {
  const escalated = page.props.escalated as { navigation?: EscalatedNavigationItem[] };
  const menu = (escalated.navigation ?? [])
    .map(
      (item) =>
        `<li><a href="${escapeHtml(item.url)}"${
          item.active ? ' class="active" aria-current="page"' : ''
        }>${escapeHtml(item.label)}</a></li>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Back office</title>
    <link rel="stylesheet" href="/build/admin.css">
    <script type="module" src="/build/app.js"></script>
  </head>
  <body>
    <header class="backoffice-header">Back office</header>
    <aside data-host-admin-sidebar>
      <p class="menu-heading">Support</p>
      <ul>${menu}</ul>
    </aside>
    <main>
      <script data-page="app" type="application/json">${scriptJson(page)}</script>
      <div id="app" data-page="${escapeHtml(JSON.stringify(page))}"></div>
    </main>
    <script>${ROUTE_HELPER}</script>
  </body>
</html>`;
}

// --- docs/embedding-admin.md, the menu outside Inertia --------------------------

/** A host back-office page listing Escalated's menu (the docs render it with @Render). */
@Controller('admin')
export class BackOfficeController {
  constructor(private readonly navigation: EscalatedAdminNavigation) {}

  @Get()
  async dashboard(@Req() req: any) {
    req.user = { id: Number(req.headers['x-user']), isAdmin: req.headers['x-admin'] === 'yes' };
    return {
      support: await this.navigation.adminNavigation(req.user, req, { isAdmin: req.user?.isAdmin }),
    };
  }
}
