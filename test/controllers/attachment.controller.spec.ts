import { writeFileSync, mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NotFoundException } from '@nestjs/common';
import { AttachmentController } from '../../src/controllers/agent/attachment.controller';

describe('AttachmentController', () => {
  const makeResponse = () =>
    ({
      set: jest.fn(),
      sendFile: jest.fn((path: string) => path),
    }) as any;

  function makeController(attachment: Record<string, unknown>) {
    return new AttachmentController({
      findById: jest.fn(async () => ({
        id: 1,
        fileName: 'report.pdf',
        filePath: '/unused',
        mimeType: 'application/pdf',
        ...attachment,
      })),
    } as any);
  }

  it('serves absolute storage paths without prefixing the process cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'esc-attachment-controller-'));
    const filePath = join(root, 'report.pdf');
    writeFileSync(filePath, 'payload');

    const controller = makeController({ filePath });
    const res = makeResponse();

    await controller.download(1, res);

    expect(res.sendFile).toHaveBeenCalledWith(filePath);
  });

  it('serves relative storage paths from the process cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'esc-attachment-controller-'));
    const previousCwd = process.cwd();
    mkdirSync(join(root, 'attachments'));
    writeFileSync(join(root, 'attachments', 'report.pdf'), 'payload');

    try {
      process.chdir(root);
      const controller = makeController({ filePath: join('attachments', 'report.pdf') });
      const res = makeResponse();

      await controller.download(1, res);

      expect(res.sendFile).toHaveBeenCalledWith(join(root, 'attachments', 'report.pdf'));
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('rejects relative storage paths that escape the process cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'esc-attachment-controller-'));
    const previousCwd = process.cwd();
    writeFileSync(join(root, 'secret.txt'), 'secret');
    mkdirSync(join(root, 'app'));

    try {
      process.chdir(join(root, 'app'));
      const controller = makeController({ filePath: join('..', 'secret.txt') });
      const res = makeResponse();

      await expect(controller.download(1, res)).rejects.toBeInstanceOf(NotFoundException);
      expect(res.sendFile).not.toHaveBeenCalled();
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('sanitizes the filename used in Content-Disposition', async () => {
    const root = mkdtempSync(join(tmpdir(), 'esc-attachment-controller-'));
    const filePath = join(root, 'report.pdf');
    writeFileSync(filePath, 'payload');

    const controller = makeController({
      fileName: '../bad"\r\nname.pdf',
      filePath,
    });
    const res = makeResponse();

    await controller.download(1, res);

    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="badname.pdf"',
    });
  });
});
