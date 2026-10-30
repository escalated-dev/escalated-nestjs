import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { SignedXml } from 'xml-crypto';

/**
 * SAML 2.0 responses built the way an IdP sends them, signed with the
 * throwaway IdP key under test/fixtures/saml (shared with escalated-adonis).
 */
const FIXTURES = join(__dirname, '..', 'fixtures', 'saml');
export const IDP_KEY = readFileSync(join(FIXTURES, 'idp-test-key.pem'), 'utf8');
export const IDP_CERT = readFileSync(join(FIXTURES, 'idp-test-cert.pem'), 'utf8');
export const IDP_ENTITY_ID = 'https://idp.example.test/metadata';

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

export interface AssertionOptions {
  email?: string;
  id?: string;
  issuer?: string;
  audiences?: string[] | null;
  notOnOrAfter?: string | null;
  recipient?: string | null;
  inResponseTo?: string | null;
  confirmationNotOnOrAfter?: string | null;
  role?: string;
}

export function assertionXml(
  sp: { entityId: string; acs: string },
  options: AssertionOptions = {},
) {
  const email = options.email ?? 'alice@example.test';
  const id = options.id ?? `_a${randomUUID()}`;
  const issuer = options.issuer ?? IDP_ENTITY_ID;
  const audiences = options.audiences === undefined ? [sp.entityId] : options.audiences;
  const notOnOrAfter = options.notOnOrAfter === undefined ? iso(5 * 60_000) : options.notOnOrAfter;
  const recipient = options.recipient === undefined ? sp.acs : options.recipient;
  const until =
    options.confirmationNotOnOrAfter === undefined
      ? iso(5 * 60_000)
      : options.confirmationNotOnOrAfter;
  const attr = (name: string, value: string | null | undefined) =>
    value === null || value === undefined ? '' : ` ${name}="${value}"`;

  return (
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${iso(0)}">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<saml:Subject><saml:NameID>${email}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData${attr('Recipient', recipient)}${attr('InResponseTo', options.inResponseTo)}${attr('NotOnOrAfter', until)}/>` +
    `</saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions${attr('NotBefore', iso(-60_000))}${attr('NotOnOrAfter', notOnOrAfter)}>` +
    (audiences === null
      ? ''
      : `<saml:AudienceRestriction>${audiences.map((a) => `<saml:Audience>${a}</saml:Audience>`).join('')}</saml:AudienceRestriction>`) +
    `</saml:Conditions>` +
    `<saml:AttributeStatement>` +
    `<saml:Attribute Name="email"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute>` +
    `<saml:Attribute Name="name"><saml:AttributeValue>Signed User</saml:AttributeValue></saml:Attribute>` +
    (options.role
      ? `<saml:Attribute Name="role"><saml:AttributeValue>${options.role}</saml:AttributeValue></saml:Attribute>`
      : '') +
    `</saml:AttributeStatement>` +
    `</saml:Assertion>`
  );
}

export function responseXml(
  inner: string,
  options: { destination?: string | null; inResponseTo?: string | null } = {},
) {
  return (
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r${randomUUID()}" Version="2.0" IssueInstant="${iso(0)}"` +
    (options.destination ? ` Destination="${options.destination}"` : '') +
    (options.inResponseTo ? ` InResponseTo="${options.inResponseTo}"` : '') +
    `>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    inner +
    `</samlp:Response>`
  );
}

/** Signs the element `target` (Assertion or Response) as an IdP would. */
export function sign(xml: string, target: 'Assertion' | 'Response', privateKey: string = IDP_KEY) {
  const signer = new SignedXml({
    privateKey,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  signer.addReference({
    xpath: `//*[local-name(.)='${target}']`,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
  });
  signer.computeSignature(xml, {
    location: {
      reference:
        target === 'Assertion'
          ? "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']"
          : "//*[local-name(.)='Response']/*[local-name(.)='Status']",
      action: target === 'Assertion' ? 'after' : 'before',
    },
  });
  return signer.getSignedXml();
}

export const b64 = (xml: string) => Buffer.from(xml, 'utf8').toString('base64');
