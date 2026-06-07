import { Controller, Get, Param, Res, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { basename, isAbsolute, relative, resolve } from 'path';
import { existsSync } from 'fs';
import { AttachmentService } from '../../services/attachment.service';

@Controller('escalated/attachments')
export class AttachmentController {
  constructor(private readonly attachmentService: AttachmentService) {}

  @Get(':id/download')
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const attachment = await this.attachmentService.findById(id);

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
