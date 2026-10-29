import {
  All,
  BadGatewayException,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { EscalatedAdminGuard } from '../guards/escalated-route.guard';
import { matchRoute, type PluginRoute, type RegisteredPlugin } from '../plugins/plugin-definition';
import {
  InvalidPluginResponse,
  type PluginReply,
  pluginReply,
  pluginRequest,
} from '../plugins/plugin-http';
import { PLUGIN_TIMEOUTS, PluginRegistry, withTimeout } from '../plugins/plugin-registry.service';
import { isScriptedRequest } from '../ui/request';

/**
 * Plugin data endpoints are called with the admin's session, so a
 * state-changing call must come from a page script (`X-Requested-With` or
 * `X-Inertia`), which another site cannot send without a CORS preflight.
 */
@Injectable()
export class PluginEndpointCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(String(request.method).toUpperCase())) return true;
    if (!isScriptedRequest(request)) {
      throw new ForbiddenException('Plugin endpoint calls must be sent by a page script');
    }
    return true;
  }
}

/** The request path below `/{kind}/plugins/{slug}`, still percent-encoded. */
function pathBelow(request: any, kind: 'api' | 'webhooks', slug: string): string {
  const url = String(request?.originalUrl ?? request?.url ?? '').split('?')[0];
  const marker = `/${kind}/plugins/${slug}`;
  const at = url.indexOf(marker);
  const rest = at < 0 ? '' : url.slice(at + marker.length);
  return rest === '' ? '/' : rest;
}

/**
 * Plugin endpoints (`/escalated/api/plugins/{slug}/...`, admin only, plus any
 * capability the endpoint declares) and webhooks
 * (`/escalated/webhooks/plugins/{slug}/...`, public: the plugin
 * authenticates the sender), as escalated-laravel's RouteRegistrar mounts
 * them. Only active plugins answer; the handler is dispatched on the manifest
 * path it declared.
 */
@Controller('escalated')
export class PluginHttpController {
  private readonly logger = new Logger('EscalatedPlugins');

  constructor(
    private readonly registry: PluginRegistry,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  @UseGuards(EscalatedAdminGuard, PluginEndpointCsrfGuard)
  @All(['api/plugins/:slug', 'api/plugins/:slug/*path'])
  async endpoint(@Param('slug') slug: string, @Req() request: any, @Res() response: any) {
    const plugin = await this.registry.active(slug);
    const found =
      plugin && matchRoute(plugin.endpoints, request.method, pathBelow(request, 'api', slug));
    if (!plugin || !found) throw new NotFoundException();
    if (!(await this.registry.allows(request, found.route.capability))) {
      throw new ForbiddenException();
    }
    await this.run(plugin, found.route, found.params, request, response, PLUGIN_TIMEOUTS.endpoint);
  }

  @All(['webhooks/plugins/:slug', 'webhooks/plugins/:slug/*path'])
  async webhook(@Param('slug') slug: string, @Req() request: any, @Res() response: any) {
    const plugin = await this.registry.active(slug);
    const found =
      plugin && matchRoute(plugin.webhooks, request.method, pathBelow(request, 'webhooks', slug));
    if (!plugin || !found) throw new NotFoundException();
    await this.run(plugin, found.route, found.params, request, response, PLUGIN_TIMEOUTS.webhook);
  }

  private async run(
    plugin: RegisteredPlugin,
    route: PluginRoute,
    params: Record<string, string>,
    request: any,
    response: any,
    timeout: number,
  ): Promise<void> {
    let reply: PluginReply;
    try {
      const result = await withTimeout(
        () => route.handler(this.registry.context(plugin, request), pluginRequest(request, params)),
        timeout,
      );
      reply = pluginReply(result);
    } catch (error) {
      if (error instanceof InvalidPluginResponse) {
        this.logger.error(`Plugin ${plugin.name} ${route.method} ${route.path}: ${error.message}`);
        throw new BadGatewayException(error.message);
      }
      // The client gets a generic answer; the cause goes to the log.
      this.logger.error(
        `Plugin ${plugin.name} ${route.method} ${route.path} failed: ${(error as Error)?.message}`,
      );
      throw new InternalServerErrorException('The plugin could not handle this request.');
    }

    const adapter = this.adapterHost.httpAdapter;
    for (const [name, value] of Object.entries(reply.headers)) {
      adapter.setHeader(response, name, value);
    }
    adapter.reply(response, reply.body, reply.status);
  }
}
