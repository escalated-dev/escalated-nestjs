import {
  Controller,
  Get,
  Param,
  Res,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { AttachmentService } from '../../services/attachment.service';

@Controller('escalated/attachments')
export class AttachmentController {
  constructor(private readonly attachmentService: AttachmentService) {}

  @Get(':id/download')
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const attachment = await this.attachmentService.findById(id);

    const filePath = join(process.cwd(), attachment.filePath);
    if (!existsSync(filePath)) {
      throw new NotFoundException('File not found on disk');
    }

    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `inline; filename="${attachment.fileName}"`,
    });

    return res.sendFile(filePath);
  }
}
