import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImportJob } from '../../entities/import-job.entity';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import type { ImportAdapter } from '../../services/import-adapter';
import { ImportJobService } from '../../services/import-job.service';
import { back, inertia, redirect } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard } from '../inertia.interceptor';
import { routeUrl } from '../routes';

/** Tested credentials, sealed, from Connect until the import starts. */
export const IMPORT_COOKIE = 'escalated_import';
const COOKIE_PATH = '/escalated/admin/import';
const COOKIE_TTL = 3600;

function cookieValue(request: any, name: string): string | null {
  for (const part of String(request?.headers?.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at >= 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

function cookie(request: any, value: string, maxAge: number): string {
  const secure = request?.secure || request?.protocol === 'https' ? '; Secure' : '';
  return `${IMPORT_COOKIE}=${value}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** An import job as the Index and Progress pages read it; never its credentials. */
export function serializeImportJob(job: ImportJob) {
  return {
    id: job.id,
    user_id: job.userId ?? null,
    platform: job.platform,
    status: job.status,
    field_mappings: job.fieldMappings ?? null,
    progress: job.progress ?? null,
    error_log: job.errorLog ?? [],
    started_at: job.startedAt ?? null,
    completed_at: job.completedAt ?? null,
    created_at: job.createdAt ?? null,
    updated_at: job.updatedAt ?? null,
  };
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== null && entry !== undefined && typeof entry !== 'object')
        out[key] = String(entry);
    }
  }
  return out;
}

/**
 * The admin Import wizard, as escalated-laravel's Admin\ImportController:
 * pick a source, test its credentials, map fields, review, start, and follow
 * (pause, resume or cancel) the import. Sources are the host's
 * `importAdapters`. Tested credentials wait in an HttpOnly cookie scoped to
 * the import paths, sealed with AES-GCM, then on the job; never in a page.
 */
@UseGuards(EscalatedAdminGuard)
@EscalatedUi()
@Controller('escalated/admin/import')
export class AdminImportUiController {
  constructor(
    private readonly imports: ImportJobService,
    @InjectRepository(ImportJob) private readonly jobs: Repository<ImportJob>,
  ) {}

  private adapterOr404(platform: string): ImportAdapter {
    const adapter = this.imports.adapter(platform);
    if (!adapter) throw new NotFoundException(`No import adapter for '${platform}'.`);
    return adapter;
  }

  private async jobOr404(id: string): Promise<ImportJob> {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Import job not found.');
    return job;
  }

  /** The credentials tested for this platform, from the import cookie. */
  private stored(request: any, platform: string): Record<string, string> | null {
    const opened = this.imports.credentials.open(cookieValue(request, IMPORT_COOKIE));
    if (!opened || opened.platform !== platform) return null;
    try {
      return stringRecord(JSON.parse(opened.credentials));
    } catch {
      return null;
    }
  }

  @Get()
  async index() {
    const jobs = await this.jobs.find({ order: { createdAt: 'DESC' }, take: 20 });
    return inertia('Escalated/Admin/Import/Index', {
      adapters: this.imports.adapters().map((adapter) => ({
        name: adapter.name(),
        display_name: adapter.displayName(),
        credential_fields: adapter.credentialFields(),
      })),
      jobs: jobs.map(serializeImportJob),
    });
  }

  @Get(':platform/connect')
  connect(@Param('platform') platform: string) {
    const adapter = this.adapterOr404(platform);
    return inertia('Escalated/Admin/Import/Connect', {
      platform: adapter.name(),
      display_name: adapter.displayName(),
      credential_fields: adapter.credentialFields(),
    });
  }

  /**
   * Connect's own `fetch`, which sends JSON but neither `X-Inertia` nor
   * `X-Requested-With`: the JSON body is what another site's plain form
   * cannot send, so it is required here instead.
   */
  @Post(':platform/test-connection')
  @HttpCode(200)
  async testConnection(
    @Param('platform') platform: string,
    @Body() body: any,
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    if (!String(request.headers['content-type'] ?? '').includes('application/json')) {
      throw new ForbiddenException('Screen forms must be sent by the Escalated client');
    }
    const adapter = this.adapterOr404(platform);
    const credentials = stringRecord(body?.credentials);
    try {
      const success = Boolean(await adapter.testConnection(credentials));
      if (success) {
        const sealed = this.imports.credentials.seal({
          platform,
          credentials: JSON.stringify(credentials),
        });
        response.append('Set-Cookie', cookie(request, sealed, COOKIE_TTL));
      }
      return { success };
    } catch (error: any) {
      response.status(422);
      return { success: false, error: error?.message ?? String(error) };
    }
  }

  @Get(':platform/mapping')
  async mapping(@Param('platform') platform: string, @Req() request: any) {
    const adapter = this.adapterOr404(platform);
    const credentials = this.stored(request, platform);
    if (!credentials) {
      return redirect(routeUrl('escalated.admin.import.connect', { platform }), {
        error: 'Please test your connection first.',
      });
    }
    const mappings: Record<string, unknown> = {};
    for (const type of adapter.entityTypes()) {
      mappings[type] = {
        defaults: adapter.defaultFieldMappings(type),
        source_fields: await adapter.availableSourceFields(type, credentials),
      };
    }
    return inertia('Escalated/Admin/Import/Mapping', {
      platform: adapter.name(),
      display_name: adapter.displayName(),
      entity_types: adapter.entityTypes(),
      mappings,
    });
  }

  /** Shows what would be imported. Writes nothing. */
  @Post(':platform/review')
  @UseGuards(ScriptedRequestGuard)
  review(@Param('platform') platform: string, @Body() body: any) {
    const adapter = this.adapterOr404(platform);
    const types = Array.isArray(body?.entity_types)
      ? body.entity_types.filter((type: unknown) => adapter.entityTypes().includes(String(type)))
      : adapter.entityTypes();
    return inertia('Escalated/Admin/Import/Review', {
      platform: adapter.name(),
      field_mappings: body?.field_mappings ?? {},
      entity_types: types,
    });
  }

  @Post(':platform/start')
  @UseGuards(ScriptedRequestGuard)
  async start(
    @Param('platform') platform: string,
    @Body() body: any,
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    const adapter = this.adapterOr404(platform);
    const credentials = this.stored(request, platform);
    if (!credentials) {
      return redirect(routeUrl('escalated.admin.import.connect', { platform }), {
        error: 'Please test your connection first.',
      });
    }
    const mappings =
      body?.field_mappings && typeof body.field_mappings === 'object' ? body.field_mappings : {};
    const job = this.jobs.create({
      userId: request.user?.id ?? null,
      platform: adapter.name(),
      status: 'pending',
      credentials: this.imports.credentials.seal(credentials),
      fieldMappings: mappings,
      progress: {},
      errorLog: [],
    });
    job.transitionTo('authenticating');
    job.transitionTo('mapping');
    await this.jobs.save(job);
    response.append('Set-Cookie', cookie(request, '', 0));
    this.imports.dispatch(job.id);
    return redirect(routeUrl('escalated.admin.import.progress', { jobId: job.id }));
  }

  @Get('progress/:jobId')
  async progress(@Param('jobId') jobId: string) {
    const job = await this.jobOr404(jobId);
    return inertia('Escalated/Admin/Import/Progress', { job: serializeImportJob(job) });
  }

  /** Progress's poll. */
  @Get('status/:jobId')
  async status(@Param('jobId') jobId: string) {
    const job = await this.jobOr404(jobId);
    return {
      status: job.status,
      progress: job.progress ?? {},
      error_log: (job.errorLog ?? []).slice(-50),
      started_at: job.startedAt ?? null,
      completed_at: job.completedAt ?? null,
    };
  }

  @Post('pause/:jobId')
  @UseGuards(ScriptedRequestGuard)
  async pause(@Param('jobId') jobId: string) {
    const job = await this.jobOr404(jobId);
    this.transition(job, 'paused');
    await this.jobs.update({ id: job.id }, { status: job.status });
    return back(routeUrl('escalated.admin.import.progress', { jobId }), {
      success: 'Import paused.',
    });
  }

  @Post('resume/:jobId')
  @UseGuards(ScriptedRequestGuard)
  async resume(@Param('jobId') jobId: string) {
    const job = await this.jobOr404(jobId);
    if (!job.resumable || !job.credentials) {
      throw new ConflictException('This import cannot be resumed.');
    }
    // A failed import goes back through mapping; the run moves it on to importing.
    if (job.status === 'failed') this.transition(job, 'mapping');
    await this.jobs.update({ id: job.id }, { status: job.status });
    this.imports.dispatch(job.id);
    return back(routeUrl('escalated.admin.import.progress', { jobId }), {
      success: 'Import resumed.',
    });
  }

  @Post('cancel/:jobId')
  @UseGuards(ScriptedRequestGuard)
  async cancel(@Param('jobId') jobId: string) {
    const job = await this.jobOr404(jobId);
    if (job.status === 'completed') throw new ConflictException('This import has completed.');
    await this.jobs.update(
      { id: job.id },
      { status: 'failed', completedAt: new Date(), credentials: null },
    );
    return back(routeUrl('escalated.admin.import.progress', { jobId }), {
      success: 'Import cancelled.',
    });
  }

  private transition(job: ImportJob, next: string) {
    try {
      job.transitionTo(next);
    } catch (error: any) {
      throw new ConflictException(error?.message ?? String(error));
    }
  }
}
