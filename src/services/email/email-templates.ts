export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface TicketCreatedData {
  ticket: { id: number; referenceNumber: string; subject: string; description: string };
  contact: { email: string; name: string | null };
  appName: string;
  appUrl?: string;
  guestAccessToken: string;
}

export interface ReplyPostedData {
  ticket: { id: number; referenceNumber: string; subject: string };
  reply: { body: string };
  contact: { email: string; name: string | null };
  appName: string;
  appUrl?: string;
  guestAccessToken: string;
}

export interface SignupInviteData {
  ticket: { id: number; referenceNumber: string };
  contact: { email: string; name: string | null };
  appName: string;
  signupUrl: string;
}

const LINE = '\n\n';

function greeting(name: string | null): string {
  return name ? `Hi ${name},` : 'Hi,';
}

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
  );
}

function htmlWrap(inner: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222">${inner}</body></html>`;
}

export function renderTicketCreated(data: TicketCreatedData): RenderedEmail {
  const { ticket, contact, appName, appUrl, guestAccessToken } = data;
  const portalLink = appUrl
    ? `${appUrl}/tickets/${ticket.id}?guest_token=${guestAccessToken}`
    : null;

  const subject = `[${ticket.referenceNumber}] We received your request — ${ticket.subject}`;
  const text =
    `${greeting(contact.name)}${LINE}` +
    `Thanks for reaching out to ${appName}. We've received your request and will get back to you soon.${LINE}` +
    `Reference: ${ticket.referenceNumber}${LINE}` +
    `Subject: ${ticket.subject}${LINE}` +
    `Your message:\n${ticket.description}${LINE}` +
    (portalLink ? `View or reply: ${portalLink}${LINE}` : '') +
    `— ${appName}`;

  const html = htmlWrap(
    `<p>${greeting(contact.name)}</p>` +
      `<p>Thanks for reaching out to <strong>${escape(appName)}</strong>. We've received your request and will get back to you soon.</p>` +
      `<p><strong>Reference:</strong> ${escape(ticket.referenceNumber)}<br/>` +
      `<strong>Subject:</strong> ${escape(ticket.subject)}</p>` +
      `<blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#555">${escape(ticket.description).replace(/\n/g, '<br/>')}</blockquote>` +
      (portalLink
        ? `<p><a href="${portalLink}">View or reply to your ticket</a></p>`
        : '') +
      `<p style="color:#888;font-size:12px">— ${escape(appName)}</p>`,
  );

  return { subject, html, text };
}

export function renderReplyPosted(data: ReplyPostedData): RenderedEmail {
  const { ticket, reply, contact, appName, appUrl, guestAccessToken } = data;
  const portalLink = appUrl
    ? `${appUrl}/tickets/${ticket.id}?guest_token=${guestAccessToken}`
    : null;

  const subject = `[${ticket.referenceNumber}] Re: ${ticket.subject}`;
  const text =
    `${greeting(contact.name)}${LINE}` +
    `We've posted a reply on your ticket.${LINE}` +
    `${reply.body}${LINE}` +
    (portalLink ? `View the full conversation: ${portalLink}${LINE}` : '') +
    `— ${appName}`;

  const html = htmlWrap(
    `<p>${greeting(contact.name)}</p>` +
      `<p>We've posted a reply on your ticket.</p>` +
      `<blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#555">${escape(reply.body).replace(/\n/g, '<br/>')}</blockquote>` +
      (portalLink
        ? `<p><a href="${portalLink}">View the full conversation</a></p>`
        : '') +
      `<p style="color:#888;font-size:12px">— ${escape(appName)}</p>`,
  );

  return { subject, html, text };
}

export function renderSignupInvite(data: SignupInviteData): RenderedEmail {
  const { ticket, contact, appName, signupUrl } = data;
  const subject = `Create your ${appName} account to track ticket ${ticket.referenceNumber}`;
  const text =
    `${greeting(contact.name)}${LINE}` +
    `You can create an account to track this ticket (and all future ones) from one place.${LINE}` +
    `Create your account: ${signupUrl}${LINE}` +
    `— ${appName}`;

  const html = htmlWrap(
    `<p>${greeting(contact.name)}</p>` +
      `<p>You can create an account to track this ticket (and all future ones) from one place.</p>` +
      `<p><a href="${signupUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block">Create your ${escape(appName)} account</a></p>` +
      `<p style="color:#888;font-size:12px">— ${escape(appName)}</p>`,
  );

  return { subject, html, text };
}
