import {
  Controller,
  Get,
  Param,
  Res,
  ParseIntPipe,
  NotFoundException,
  ForbiddenException,
  Optional,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { basename, isAbsolute, relative, resolve } from 'path';
import { existsSync } from 'fs';
import { AttachmentService } from '../../services/attachment.service';
import {
  ESCALATED_ROUTE_GROUP,
  EscalatedAgentOrCustomerGuard,
} from '../../guards/escalated-route.guard';
import { TicketAccess } from '../../config/ticket-access';
import { requireUserId } from '../../config/request-user';

@UseGuards(EscalatedAgentOrCustomerGuard)
@Controller('escalated/attachments')
export class AttachmentController {
  constructor(
    private readonly attachmentService: AttachmentService,
    @Optional() private readonly access?: TicketAccess,
  ) {}

  @Get(':id/download')
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: Response, @Req() req: any) {
    const attachment = await this.attachmentService.findById(id);
    await this.authorize(req, attachment);

    const filePath = this.resolveStoredPath(attachment.filePath);
    if (!existsSync(filePath)) {
      throw new NotFoundException('File not found on disk');
    }

    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `inline; filename="${this.safeHeaderFilename(attachment.fileName)}"`,
    });

    return res.sendFile(filePath);
  }

  /**
   * Mirrors Laravel's AttachmentAccess: agents need access to the ticket;
   * customers only get public attachments of tickets they requested.
   */
  private async authorize(req: any, attachment: any): Promise<void> {
    const { ticket, isPublic } = await this.attachmentService.ownerOf(attachment);
    if (!ticket) throw new NotFoundException('Attachment not found');

    if (req?.[ESCALATED_ROUTE_GROUP] === 'agent') {
      if (this.access && !(await this.access.allows(this.access.currentActor(), ticket))) {
        throw new NotFoundException('Attachment not found');
      }
      return;
    }

    const userId = requireUserId(req);
    if (!isPublic || String(ticket.requesterId) !== String(userId)) {
      throw new ForbiddenException('You can only download attachments on your own tickets');
    }
  }

  private resolveStoredPath(storedPath: string): string {
    if (isAbsolute(storedPath)) {
      return resolve(storedPath);
    }

    const root = process.cwd();
    const resolved = resolve(root, storedPath);
    const pathFromRoot = relative(root, resolved);
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
      throw new NotFoundException('File not found on disk');
    }

    return resolved;
  }

  private safeHeaderFilename(fileName: string): string {
    const clean = basename(fileName.replace(/[\r\n"]/g, '').replace(/\\/g, '/')).trim();
    return clean || 'attachment';
  }
}
