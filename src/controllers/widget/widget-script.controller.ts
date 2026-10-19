import { Controller, Get, Headers, NotFoundException, Res } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The standalone widget bundle, built by `@escalated-dev/escalated` and
 * vendored at `assets/widget/escalated-widget.js`. Resolved from this file so
 * it works from `src/` (tests) and `dist/` (the published package) alike.
 */
export const WIDGET_BUNDLE_PATH = join(__dirname, '../../../assets/widget/escalated-widget.js');

let cached: { body: Buffer; etag: string } | undefined;

function bundle(): { body: Buffer; etag: string } {
  if (!cached) {
    const body = readFileSync(WIDGET_BUNDLE_PATH);
    cached = { body, etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"` };
  }
  return cached;
}

/**
 * Serves the widget script so any site can load it with a `<script>` tag
 * pointing at this install. It is public and carries no data, so it is
 * readable from every origin.
 */
@Controller('escalated/widget')
export class WidgetScriptController {
  @Get('embed.js')
  script(@Headers('if-none-match') ifNoneMatch: string | undefined, @Res() res: any) {
    let script: { body: Buffer; etag: string };
    try {
      script = bundle();
    } catch {
      throw new NotFoundException();
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      ETag: script.etag,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Access-Control-Allow-Origin': '*',
    };
    const notModified = (ifNoneMatch ?? '')
      .split(',')
      .map((tag) => tag.trim().replace(/^W\//, ''))
      .some((tag) => tag === script.etag || tag === '*');

    // Raw Node response API, so this works under Express and Fastify.
    const raw = res.raw ?? res;
    raw.writeHead(notModified ? 304 : 200, headers);
    raw.end(notModified ? undefined : script.body);
  }
}
