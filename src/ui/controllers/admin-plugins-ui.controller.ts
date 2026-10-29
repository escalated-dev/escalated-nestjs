import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { matchRoute, pageRoute } from '../../plugins/plugin-definition';
import {
  PLUGIN_TIMEOUTS,
  PluginRegistry,
  withTimeout,
} from '../../plugins/plugin-registry.service';
import { inertia, redirect } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard } from '../inertia.interceptor';
import { routeUrl } from '../routes';

/**
 * Admin > Plugins (`Escalated/Admin/Plugins/Index`) and the pages plugins
 * declare (`Escalated/Plugin/Page`), as domain-model/plugin-contract.md and
 * escalated-laravel's PluginController and RouteRegistrar have them. Plugins
 * are registered in code here (`EscalatedModule.forRoot({ plugins })`), so
 * there is no upload: the screen gets `can_upload: false`.
 */
@UseGuards(EscalatedAdminGuard, ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated/admin/plugins')
export class AdminPluginsUiController {
  constructor(private readonly registry: PluginRegistry) {}

  private toIndex(message: string) {
    return redirect(routeUrl('escalated.admin.plugins.index'), { success: message });
  }

  @Get()
  async index() {
    return inertia('Escalated/Admin/Plugins/Index', {
      plugins: await this.registry.list(),
      can_upload: false,
    });
  }

  @Post(':slug/activate')
  async activate(@Param('slug') slug: string) {
    if (!(await this.registry.activate(slug))) throw new NotFoundException('Plugin not found.');
    return this.toIndex('Plugin activated.');
  }

  @Post(':slug/deactivate')
  async deactivate(@Param('slug') slug: string) {
    if (!(await this.registry.deactivate(slug))) throw new NotFoundException('Plugin not found.');
    return this.toIndex('Plugin deactivated.');
  }

  @Delete(':slug')
  async destroy(@Param('slug') slug: string) {
    if (!(await this.registry.uninstall(slug))) throw new NotFoundException('Plugin not found.');
    return this.toIndex('Plugin uninstalled.');
  }

  /**
   * A page an active plugin declares, at `/escalated/admin/plugins/{slug}/{route}`,
   * rendered as `Escalated/Plugin/Page` with the props its own
   * `GET /{component}` endpoint returns, or `{}`.
   */
  @Get(':slug/*path')
  async page(@Param('slug') slug: string, @Req() request: any) {
    const plugin = await this.registry.active(slug);
    const url = String(request?.originalUrl ?? request?.url ?? '').split('?')[0];
    const marker = `/admin/plugins/${slug}/`;
    let route = '';
    try {
      route = decodeURIComponent(url.slice(url.indexOf(marker) + marker.length)).replace(
        /\/+$/,
        '',
      );
    } catch {
      throw new NotFoundException();
    }
    const declared = plugin?.pages.find(
      (page) => page?.component && pageRoute(page) !== '' && pageRoute(page) === route,
    );
    if (!plugin || !declared) throw new NotFoundException();
    if (!(await this.registry.allows(request, declared.capability))) {
      throw new ForbiddenException();
    }

    let props: unknown = {};
    const endpoint = matchRoute(plugin.endpoints, 'GET', `/${declared.component}`);
    if (endpoint) {
      try {
        props = await withTimeout(
          () =>
            endpoint.route.handler(this.registry.context(plugin, request), {
              httpContract: 1,
              body: null,
              params: endpoint.params,
              query: {},
              headers: {},
            }),
          PLUGIN_TIMEOUTS.endpoint,
        );
      } catch {
        props = {};
      }
    }

    return inertia('Escalated/Plugin/Page', {
      plugin: plugin.name,
      component: declared.component,
      layout: declared.layout ?? 'admin',
      props: props && typeof props === 'object' && !Array.isArray(props) ? props : {},
    });
  }
}
