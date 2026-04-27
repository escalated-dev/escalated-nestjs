import { PostmarkInboundParser } from '../../../src/services/email/postmark-parser.service';
import { MailgunInboundParser } from '../../../src/services/email/mailgun-parser.service';
import { SESInboundParser } from '../../../src/services/email/ses-parser.service';

/**
 * Parser-equivalence tests: the same logical email, expressed in each
 * provider's native webhook payload shape, should normalize to the
 * same {@link ParsedInboundEmail} metadata. Equivalence at this layer
 * guarantees a reply delivered via any provider routes to the same
 * ticket via the same threading chain.
 *
 * Mirrors escalated-go#37 + escalated-dotnet#31 + escalated-spring#34
 * + escalated-phoenix#43 + escalated-symfony#39. Adding a fourth
 * provider in the future gets contract validation against the
 * existing three for free — just write a `build{Provider}Payload`
 * builder.
 */
describe('parser equivalence across Postmark / Mailgun / SES', () => {
  interface LogicalEmail {
    fromEmail: string;
    fromName: string;
    toEmail: string;
    subject: string;
    bodyText: string;
    messageId: string;
    inReplyTo: string;
    references: string;
  }

  const sample: LogicalEmail = {
    fromEmail: 'alice@example.com',
    fromName: 'Alice',
    toEmail: 'support@example.com',
    subject: 'Re: Help with invoice',
    bodyText: 'Thanks for the quick response.',
    messageId: '<external-reply-xyz@mail.alice.com>',
    inReplyTo: '<ticket-42@support.example.com>',
    references: '<ticket-42@support.example.com>',
  };

  function postmarkPayload(e: LogicalEmail) {
    return {
      FromFull: { Email: e.fromEmail, Name: e.fromName },
      To: e.toEmail,
      Subject: e.subject,
      TextBody: e.bodyText,
      Headers: [
        { Name: 'Message-ID', Value: e.messageId },
        { Name: 'In-Reply-To', Value: e.inReplyTo },
        { Name: 'References', Value: e.references },
      ],
    };
  }

  function mailgunPayload(e: LogicalEmail) {
    return {
      sender: e.fromEmail,
      from: `${e.fromName} <${e.fromEmail}>`,
      recipient: e.toEmail,
      subject: e.subject,
      'body-plain': e.bodyText,
      'Message-Id': e.messageId,
      'In-Reply-To': e.inReplyTo,
      References: e.references,
    };
  }

  function sesPayload(e: LogicalEmail) {
    // Include full raw MIME as base64 so body extraction is exercised
    // — keeps the test payload close to a real SES delivery.
    const mime =
      `From: ${e.fromName} <${e.fromEmail}>\r\n` +
      `To: ${e.toEmail}\r\n` +
      `Subject: ${e.subject}\r\n` +
      `Message-ID: ${e.messageId}\r\n` +
      `In-Reply-To: ${e.inReplyTo}\r\n` +
      `References: ${e.references}\r\n` +
      `Content-Type: text/plain; charset="utf-8"\r\n` +
      `\r\n` +
      e.bodyText;

    const sesMessage = {
      notificationType: 'Received',
      mail: {
        source: e.fromEmail,
        destination: [e.toEmail],
        headers: [
          { name: 'From', value: `${e.fromName} <${e.fromEmail}>` },
          { name: 'To', value: e.toEmail },
          { name: 'Subject', value: e.subject },
          { name: 'Message-ID', value: e.messageId },
          { name: 'In-Reply-To', value: e.inReplyTo },
          { name: 'References', value: e.references },
        ],
        commonHeaders: {
          from: [`${e.fromName} <${e.fromEmail}>`],
          to: [e.toEmail],
          subject: e.subject,
        },
      },
      content: Buffer.from(mime).toString('base64'),
    };

    return {
      Type: 'Notification',
      Message: JSON.stringify(sesMessage),
    };
  }

  it('normalizes to the same threading metadata across all three parsers', () => {
    const postmark = new PostmarkInboundParser().parse(postmarkPayload(sample));
    const mailgun = new MailgunInboundParser().parse(mailgunPayload(sample));
    const ses = new SESInboundParser().parse(sesPayload(sample));

    const parsers = { postmark, mailgun, ses };

    for (const [name, msg] of Object.entries(parsers)) {
      expect(`${name}:from=${msg.from}`).toBe(`${name}:from=${sample.fromEmail}`);
      expect(`${name}:to=${msg.to}`).toBe(`${name}:to=${sample.toEmail}`);
      expect(`${name}:subject=${msg.subject}`).toBe(`${name}:subject=${sample.subject}`);
      expect(`${name}:inReplyTo=${msg.inReplyTo}`).toBe(`${name}:inReplyTo=${sample.inReplyTo}`);
      expect(`${name}:references=${msg.references.join(' ')}`).toBe(
        `${name}:references=${sample.references}`,
      );
    }
  });

  it('produces the same body text across all three parsers', () => {
    const postmark = new PostmarkInboundParser().parse(postmarkPayload(sample));
    const mailgun = new MailgunInboundParser().parse(mailgunPayload(sample));
    const ses = new SESInboundParser().parse(sesPayload(sample));

    expect(postmark.textBody).toBe(sample.bodyText);
    expect(mailgun.textBody).toBe(sample.bodyText);
    // SES body comes from the decoded MIME; may have a trailing
    // newline depending on the encoder, so test via `contains`.
    expect(ses.textBody).toContain(sample.bodyText);
  });
});
