import { createServer, Server, Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Test, TestingModule } from '@nestjs/testing';
import { MailerModule, MailerService } from '@nestjs-modules/mailer';
import { EmailService } from '../../../src/services/email/email.service';
import { ESCALATED_OPTIONS } from '../../../src/config/escalated.config';

/** Real SMTP on loopback, with synthetic credentials and no external provider. */
async function smtpFixture(rejectRecipient = false) {
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  const recipients: string[] = [];
  let authentications = 0;
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let pending = '';
    let data: string[] | null = null;
    socket.write('220 localhost test SMTP\r\n');
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      while (pending.includes('\r\n')) {
        const end = pending.indexOf('\r\n');
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (data !== null) {
          if (line === '.') {
            messages.push(data.join('\r\n'));
            data = null;
            socket.write('250 2.0.0 queued locally\r\n');
          } else {
            data.push(line.replace(/^\.\./, '.'));
          }
        } else if (/^(EHLO|HELO) /i.test(line)) {
          socket.write('250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 1048576\r\n');
        } else if (/^AUTH PLAIN /i.test(line)) {
          authentications += 1;
          socket.write('235 2.7.0 authenticated\r\n');
        } else if (/^RCPT TO:/i.test(line)) {
          recipients.push(line);
          socket.write(rejectRecipient ? '550 5.1.1 rejected\r\n' : '250 2.1.5 recipient OK\r\n');
        } else if (line === 'DATA') {
          data = [];
          socket.write('354 End with a single dot\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 goodbye\r\n');
        } else {
          socket.write('250 2.0.0 OK\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const transport = {
    host: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
    secure: false,
    auth: { user: 'fixture', pass: 'fixture' },
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 3000,
  };
  let moduleRef: TestingModule | undefined;
  try {
    moduleRef = await Test.createTestingModule({
      imports: [MailerModule.forRoot({ transport })],
      providers: [
        EmailService,
        {
          provide: ESCALATED_OPTIONS,
          useValue: {
            mail: { from: 'support@example.test', transport },
            inbound: {
              replyDomain: 'reply.example.test',
              replySecret: 'fixture-signing-secret',
              webhookSecret: 'fixture-webhook-secret',
            },
            appName: 'Support',
            appUrl: 'https://help.example.test',
          },
        },
      ],
    }).compile();
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  return {
    email: moduleRef.get(EmailService),
    mailer: moduleRef.get(MailerService),
    messages,
    recipients,
    authentications: () => authentications,
    async close() {
      try {
        await moduleRef.close();
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}

describe('real Nest mail transport', () => {
  it('delivers ticket notifications with threading and a signed reply address', async () => {
    const fixture = await smtpFixture();
    try {
      await fixture.email.sendTicketCreated({
        to: 'requester@example.test',
        ticket: { id: 55, referenceNumber: 'TK-55', subject: 'Help', description: 'Ticket body' },
        contact: { email: 'requester@example.test', name: 'Requester' },
        guestAccessToken: 'fixture-grant',
      });
      await fixture.email.sendReplyPosted({
        to: 'requester@example.test',
        ticket: { id: 55, referenceNumber: 'TK-55', subject: 'Help' },
        reply: { id: 3, body: 'Agent reply body' },
        contact: { email: 'requester@example.test', name: 'Requester' },
        guestAccessToken: 'fixture-grant',
      });
      expect(fixture.messages).toHaveLength(2);
      expect(fixture.authentications()).toBeGreaterThan(0);
      expect(fixture.messages[0]).toMatch(/Message-ID: <ticket-55@reply\.example\.test>/i);
      expect(fixture.messages[0]).toMatch(/Reply-To: reply\+55\.[a-f0-9]{8}@reply\.example\.test/i);
      expect(fixture.messages[0]).toContain('Ticket body');
      expect(fixture.messages[1]).toContain('Agent reply body');
      expect(fixture.messages[1]).toMatch(/Message-ID: <ticket-55-reply-3@reply\.example\.test>/i);
      expect(fixture.messages[1]).toMatch(/In-Reply-To: <ticket-55@reply\.example\.test>/i);
      expect(fixture.messages[1]).toMatch(/References: <ticket-55@reply\.example\.test>/i);
    } finally {
      await fixture.close();
    }
  });

  it('preserves attachments and BCC envelopes without exposing BCC headers', async () => {
    const fixture = await smtpFixture();
    try {
      const response = await fixture.mailer.sendMail({
        from: 'support@example.test',
        to: 'requester@example.test',
        cc: 'agent@example.test',
        bcc: 'archive@example.test',
        subject: 'Case notes',
        text: 'Case notes attached',
        attachments: [{ filename: 'notes.txt', content: Buffer.from('Case notes') }],
      });
      expect([...response.envelope.to].sort()).toEqual(
        ['requester@example.test', 'agent@example.test', 'archive@example.test'].sort(),
      );
      expect(fixture.recipients).toHaveLength(3);
      expect(fixture.messages[0]).toMatch(/filename=notes\.txt/);
      expect(fixture.messages[0]).toContain(Buffer.from('Case notes').toString('base64'));
      expect(fixture.messages[0]).not.toMatch(/^Bcc:/im);
    } finally {
      await fixture.close();
    }
  });

  it('propagates recipient rejection to the caller', async () => {
    const fixture = await smtpFixture(true);
    try {
      await expect(
        fixture.email.sendTicketCreated({
          to: 'rejected@example.test',
          ticket: { id: 1, referenceNumber: 'TK-1', subject: 'Help', description: 'Body' },
          contact: { email: 'rejected@example.test', name: null },
          guestAccessToken: 'fixture-grant',
        }),
      ).rejects.toThrow(/550/);
      expect(fixture.messages).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  });
});
