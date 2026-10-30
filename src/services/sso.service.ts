import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash, createPublicKey, randomBytes, type KeyObject } from 'crypto';
import { deflateRawSync } from 'zlib';
import { DOMParser, type Element } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import * as jwt from 'jsonwebtoken';
import { AuthorizationCode } from 'simple-oauth2';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { accessFeatureEnabled } from '../access/access-features';
import { routeUrl } from '../ui/routes';
import { SettingsService } from './settings.service';
import { SsoMessageIdsService } from './sso-message-ids.service';

/** Why a sign-in was refused: for the log, never for the user. */
export class SsoException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsoException';
  }
}

export interface SsoIdentity {
  email: string;
  name: string;
  role: string;
}

export type SsoProvider = 'none' | 'saml' | 'oauth' | 'jwt';

/** The `sso_*` settings and their defaults, as escalated-laravel's SsoService. */
export const SSO_SETTING_DEFAULTS: Record<string, string> = {
  sso_provider: 'none',
  sso_entity_id: '',
  sso_url: '',
  sso_login_url: '',
  sso_logout_url: '',
  sso_metadata_url: '',
  sso_certificate: '',
  sso_attr_email: 'email',
  sso_attr_name: 'name',
  sso_attr_role: 'role',
  sso_jwt_secret: '',
  sso_jwt_algorithm: 'HS256',
  sso_oauth_authorize_url: '',
  sso_oauth_token_url: '',
  sso_oauth_userinfo_url: '',
  sso_oauth_client_id: '',
  sso_oauth_client_secret: '',
  sso_oauth_scopes: 'openid profile email',
};

export const SSO_JWT_ALGORITHMS = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512'];

const SAML_ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
const SAML_PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const BEARER = 'urn:oasis:names:tc:SAML:2.0:cm:bearer';
/** How long an AuthnRequest ID stays answerable, in seconds. */
export const SAML_REQUEST_TTL = 600;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

function escapeXml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Single sign-on through the provider an admin picks in Admin > Settings >
 * SSO (ADR 2026-10-29-configurable-access-features). Crypto is left to
 * maintained libraries: xml-crypto (XML signatures, as escalated-adonis),
 * simple-oauth2 (OAuth 2 authorization code exchange) and jsonwebtoken.
 *
 * Every validate method returns the same identity, or throws an SsoException.
 */
@Injectable()
export class SsoService {
  constructor(
    private readonly settings: SettingsService,
    private readonly messageIds: SsoMessageIdsService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  enabled(): boolean {
    return accessFeatureEnabled(this.options, 'sso');
  }

  async config(): Promise<Record<string, string>> {
    const config: Record<string, string> = {};
    for (const [key, fallback] of Object.entries(SSO_SETTING_DEFAULTS)) {
      const value = await this.settings.get(key, fallback);
      config[key] = value === null || value === undefined ? fallback : String(value);
    }
    // The single URL older versions stored.
    const legacy = config.sso_url.trim();
    if (legacy) {
      if (!config.sso_login_url) config.sso_login_url = legacy;
      if (config.sso_provider === 'oauth' && !config.sso_oauth_authorize_url) {
        config.sso_oauth_authorize_url = legacy;
      }
    }
    return config;
  }

  async saveConfig(data: Record<string, unknown>): Promise<void> {
    for (const key of Object.keys(SSO_SETTING_DEFAULTS)) {
      if (key in data) await this.settings.set(key, String(data[key] ?? ''), 'string');
    }
  }

  async provider(): Promise<SsoProvider> {
    const provider = String((await this.settings.get('sso_provider', 'none')) ?? 'none');
    return (['saml', 'oauth', 'jwt'] as const).includes(provider as any)
      ? (provider as SsoProvider)
      : 'none';
  }

  /** This install's base URL: `appUrl`, else the request's origin. */
  baseUrl(request: any): string {
    const configured = String(this.options?.appUrl ?? '').replace(/\/+$/, '');
    if (configured) return configured;
    const protocol = request?.protocol ?? (request?.secure ? 'https' : 'http');
    return `${protocol}://${request?.headers?.host ?? 'localhost'}`;
  }

  url(request: any, name: string): string {
    return this.baseUrl(request) + routeUrl(name);
  }

  spEntityId(request: any): string {
    return (
      this.options?.sso?.spEntityId ||
      process.env.ESCALATED_SSO_SP_ENTITY_ID ||
      this.url(request, 'escalated.sso.saml.metadata')
    );
  }

  /** The URLs an admin gives the identity provider. */
  endpoints(request: any): Record<string, string> {
    return {
      login: this.url(request, 'escalated.sso.login'),
      sp_entity_id: this.spEntityId(request),
      metadata: this.url(request, 'escalated.sso.saml.metadata'),
      acs: this.url(request, 'escalated.sso.saml.acs'),
      oauth_redirect: this.url(request, 'escalated.sso.oauth.callback'),
      jwt_callback: this.url(request, 'escalated.sso.jwt.callback'),
    };
  }

  clockSkew(): number {
    const raw = this.options?.sso?.clockSkew ?? process.env.ESCALATED_SSO_CLOCK_SKEW ?? 120;
    const parsed = Number.parseInt(String(raw), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 300) : 120;
  }

  allowIdpInitiated(): boolean {
    return truthy(
      this.options?.sso?.allowIdpInitiated ?? process.env.ESCALATED_SSO_ALLOW_IDP_INITIATED,
    );
  }

  // ---- SAML ------------------------------------------------------------------

  /**
   * The IdP sign-in URL for a new AuthnRequest (HTTP-Redirect binding). Its ID
   * is stored server-side, since the IdP's cross-site POST back carries no
   * SameSite=Lax session cookie, and must come back as InResponseTo within
   * SAML_REQUEST_TTL.
   */
  async samlLoginUrl(request: any): Promise<string> {
    const config = await this.config();
    this.idpKey(config.sso_certificate);
    const idpUrl = config.sso_login_url.trim();
    if (!idpUrl) throw new SsoException('SAML refused: no IdP sign-in URL is configured.');

    const id = `_${randomBytes(20).toString('hex')}`;
    await this.messageIds.remember(
      'saml_request',
      id,
      Math.floor(Date.now() / 1000) + SAML_REQUEST_TTL,
    );
    const xml =
      `<samlp:AuthnRequest xmlns:samlp="${SAML_PROTOCOL_NS}" xmlns:saml="${SAML_ASSERTION_NS}"` +
      ` ID="${id}" Version="2.0" IssueInstant="${new Date().toISOString()}"` +
      ` Destination="${escapeXml(idpUrl)}"` +
      ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"` +
      ` AssertionConsumerServiceURL="${escapeXml(this.url(request, 'escalated.sso.saml.acs'))}">` +
      `<saml:Issuer>${escapeXml(this.spEntityId(request))}</saml:Issuer>` +
      `<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified" AllowCreate="true"/>` +
      `</samlp:AuthnRequest>`;
    const query = new URLSearchParams({
      SAMLRequest: deflateRawSync(Buffer.from(xml, 'utf8')).toString('base64'),
    });
    return idpUrl + (idpUrl.includes('?') ? '&' : '?') + query.toString();
  }

  samlMetadata(request: any): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(this.spEntityId(request))}">` +
      `<md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="${SAML_PROTOCOL_NS}">` +
      `<md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified</md:NameIDFormat>` +
      `<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(this.url(request, 'escalated.sso.saml.acs'))}" index="1"/>` +
      `</md:SPSSODescriptor></md:EntityDescriptor>`
    );
  }

  /**
   * Validates a base64 SAMLResponse posted to the ACS. Accepted only when the
   * IdP certificate is configured; the single assertion carries a signature
   * by it (a key in KeyInfo is never trusted, and the user is read from the
   * signed XML); Issuer is `sso_entity_id`; Audience names our SP entity ID;
   * Destination and the bearer Recipient are our ACS URL; the validity
   * windows hold (clock skew); InResponseTo names a pending request (or
   * IdP-initiated sign-in is on); and the assertion ID is new.
   */
  async validateSamlResponse(request: any, samlResponse: string): Promise<SsoIdentity> {
    const config = await this.config();
    const key = this.idpKey(config.sso_certificate);
    const entityId = config.sso_entity_id.trim();
    if (!entityId) throw new SsoException('SAML refused: no IdP entity ID is configured.');
    const spEntityId = this.spEntityId(request);
    const acsUrl = this.url(request, 'escalated.sso.saml.acs');
    const skew = this.clockSkew();
    const now = Math.floor(Date.now() / 1000);

    const xml = Buffer.from(String(samlResponse ?? ''), 'base64').toString('utf8');
    const doc = this.parseXml(xml);
    if (doc.getElementsByTagNameNS(SAML_ASSERTION_NS, 'EncryptedAssertion').length > 0) {
      throw new SsoException('SAML refused: encrypted assertions are not supported.');
    }
    if (doc.getElementsByTagNameNS(SAML_ASSERTION_NS, 'Assertion').length !== 1) {
      throw new SsoException('SAML refused: the response must carry exactly one assertion.');
    }
    const root = doc.documentElement as unknown as Element;
    const assertion = this.signedAssertion(xml, root, key);

    const issuer = (
      this.children(assertion, SAML_ASSERTION_NS, 'Issuer')[0]?.textContent ?? ''
    ).trim();
    if (issuer !== entityId) {
      throw new SsoException(`SAML refused: Issuer [${issuer}] is not [${entityId}].`);
    }

    const conditions = this.children(assertion, SAML_ASSERTION_NS, 'Conditions')[0];
    if (!conditions) throw new SsoException('SAML refused: the assertion has no Conditions.');
    const conditionsUntil = this.window(conditions, now, skew, 'assertion');
    this.audience(conditions, spEntityId);

    const isResponse = this.is(root, SAML_PROTOCOL_NS, 'Response');
    const destination = isResponse ? root.getAttribute('Destination') : null;
    if (isResponse && destination !== acsUrl) {
      throw new SsoException(
        `SAML refused: Destination [${destination ?? ''}] is not [${acsUrl}].`,
      );
    }

    const confirmation = this.bearer(assertion, acsUrl, now, skew);
    const outer = isResponse ? root.getAttribute('InResponseTo') || null : null;
    if (outer && outer !== confirmation.inResponseTo) {
      throw new SsoException('SAML refused: the Response and assertion answer different requests.');
    }
    const inResponseTo = confirmation.inResponseTo ?? outer;
    if (inResponseTo) {
      if (!(await this.messageIds.consume('saml_request', inResponseTo))) {
        throw new SsoException(
          `SAML refused: InResponseTo [${inResponseTo}] is not a pending request.`,
        );
      }
    } else if (!this.allowIdpInitiated()) {
      throw new SsoException(
        'SAML refused: unsolicited response (no InResponseTo) and IdP-initiated sign-in is off.',
      );
    }

    const assertionId = assertion.getAttribute('ID') || '';
    const until = Math.max(conditionsUntil ?? 0, confirmation.notOnOrAfter) + skew;
    if (!assertionId || !(await this.messageIds.claim('saml_assertion', assertionId, until))) {
      throw new SsoException(`SAML refused: assertion [${assertionId}] was already used.`);
    }

    const attributes = this.attributes(assertion);
    let email = attributes[config.sso_attr_email || 'email'] ?? '';
    if (!email) {
      const nameId = (
        assertion.getElementsByTagNameNS(SAML_ASSERTION_NS, 'NameID')[0]?.textContent ?? ''
      ).trim();
      if (EMAIL.test(nameId)) email = nameId;
    }
    return this.identity(
      email,
      attributes[config.sso_attr_name || 'name'] ?? '',
      attributes[config.sso_attr_role || 'role'] ?? '',
    );
  }

  private idpKey(certificate: string): KeyObject {
    const raw = String(certificate ?? '').trim();
    if (!raw) throw new SsoException('SAML refused: no IdP certificate is configured.');
    if (raw.includes('PRIVATE KEY')) {
      throw new SsoException('SAML refused: the IdP certificate must not be a private key.');
    }
    const pem = raw.includes('-----BEGIN')
      ? raw
      : [
          '-----BEGIN CERTIFICATE-----',
          ...(raw.replace(/\s+/g, '').match(/.{1,64}/g) ?? []),
          '-----END CERTIFICATE-----',
          '',
        ].join('\n');
    try {
      return createPublicKey(pem);
    } catch {
      throw new SsoException('SAML refused: the IdP certificate could not be read.');
    }
  }

  private parseXml(xml: string) {
    let doc: any = null;
    try {
      doc = new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
    } catch {
      doc = null;
    }
    if (!doc || !doc.documentElement) throw new SsoException('SAML refused: malformed XML.');
    return doc;
  }

  /**
   * The assertion, parsed from the XML its own signature covers. Only a
   * signature inside the assertion counts: a signed Response around an
   * unsigned assertion is refused.
   */
  private signedAssertion(xml: string, root: Element, key: KeyObject): Element {
    const assertion = this.is(root, SAML_ASSERTION_NS, 'Assertion')
      ? root
      : (root.getElementsByTagNameNS(SAML_ASSERTION_NS, 'Assertion')[0] as Element | undefined);
    if (!assertion) throw new SsoException('SAML refused: no assertion.');
    const signatures = this.children(assertion, XMLDSIG_NS, 'Signature');
    if (!signatures.length) throw new SsoException('SAML refused: the assertion is not signed.');

    for (const signature of signatures) {
      const verifier = new SignedXml({ publicCert: key, getCertFromKeyInfo: () => null });
      let signed: string[] = [];
      try {
        verifier.loadSignature(signature as any);
        if (verifier.checkSignature(xml)) signed = verifier.getSignedReferences();
      } catch {
        signed = [];
      }
      if (signed.length !== 1) continue;
      const signedRoot = this.parseXml(signed[0]).documentElement as Element;
      if (this.is(signedRoot, SAML_ASSERTION_NS, 'Assertion')) return signedRoot;
    }
    throw new SsoException(
      'SAML refused: the assertion signature does not verify against the IdP certificate.',
    );
  }

  private is(node: Element | null | undefined, ns: string, localName: string): boolean {
    return !!node && node.namespaceURI === ns && node.localName === localName;
  }

  private children(parent: Element, ns: string, localName: string): Element[] {
    return (Array.from(parent.childNodes) as unknown as Element[]).filter((node) =>
      this.is(node, ns, localName),
    );
  }

  private time(value: string, attribute: string): number {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw new SsoException(`SAML refused: ${attribute} is not a time.`);
    return Math.floor(ms / 1000);
  }

  private window(el: Element, now: number, skew: number, what: string): number | null {
    const notBefore = el.getAttribute('NotBefore');
    if (notBefore && this.time(notBefore, 'NotBefore') > now + skew) {
      throw new SsoException(`SAML refused: the ${what} is not yet valid.`);
    }
    const notOnOrAfter = el.getAttribute('NotOnOrAfter');
    if (!notOnOrAfter) return null;
    const until = this.time(notOnOrAfter, 'NotOnOrAfter');
    if (now >= until + skew) throw new SsoException(`SAML refused: the ${what} has expired.`);
    return until;
  }

  private audience(conditions: Element, spEntityId: string): void {
    const restrictions = this.children(conditions, SAML_ASSERTION_NS, 'AudienceRestriction');
    if (!restrictions.length) {
      throw new SsoException('SAML refused: the assertion names no Audience.');
    }
    for (const restriction of restrictions) {
      const audiences = this.children(restriction, SAML_ASSERTION_NS, 'Audience').map((a) =>
        (a.textContent ?? '').trim(),
      );
      if (!audiences.includes(spEntityId)) {
        throw new SsoException(
          `SAML refused: [${spEntityId}] is not an Audience of the assertion.`,
        );
      }
    }
  }

  private bearer(
    assertion: Element,
    acsUrl: string,
    now: number,
    skew: number,
  ): { inResponseTo: string | null; notOnOrAfter: number } {
    const subject = this.children(assertion, SAML_ASSERTION_NS, 'Subject')[0];
    const bearers = subject
      ? this.children(subject, SAML_ASSERTION_NS, 'SubjectConfirmation').filter(
          (c) => c.getAttribute('Method') === BEARER,
        )
      : [];
    if (!bearers.length) throw new SsoException('SAML refused: no bearer SubjectConfirmation.');
    let first: SsoException | null = null;
    for (const bearer of bearers) {
      try {
        const data = this.children(bearer, SAML_ASSERTION_NS, 'SubjectConfirmationData')[0];
        if (!data) throw new SsoException('SAML refused: no SubjectConfirmationData.');
        const recipient = data.getAttribute('Recipient');
        if (recipient !== acsUrl) {
          throw new SsoException(
            `SAML refused: Recipient [${recipient ?? ''}] is not [${acsUrl}].`,
          );
        }
        const notOnOrAfter = this.window(data, now, skew, 'subject confirmation');
        if (notOnOrAfter === null) {
          throw new SsoException('SAML refused: SubjectConfirmationData has no NotOnOrAfter.');
        }
        return { inResponseTo: data.getAttribute('InResponseTo') || null, notOnOrAfter };
      } catch (error) {
        if (!(error instanceof SsoException)) throw error;
        first ??= error;
      }
    }
    throw first!;
  }

  private attributes(assertion: Element): Record<string, string> {
    const found: Record<string, string> = {};
    for (const attribute of Array.from(
      assertion.getElementsByTagNameNS(SAML_ASSERTION_NS, 'Attribute'),
    ) as unknown as Element[]) {
      const name = attribute.getAttribute('Name');
      const value = attribute.getElementsByTagNameNS(SAML_ASSERTION_NS, 'AttributeValue')[0];
      if (name && value) found[name] = (value.textContent ?? '').trim();
    }
    return found;
  }

  // ---- OAuth 2 / OIDC -----------------------------------------------------------

  private async oauthClient(config: Record<string, string>): Promise<AuthorizationCode> {
    const authorize = new URL(config.sso_oauth_authorize_url);
    const token = new URL(config.sso_oauth_token_url);
    return new AuthorizationCode({
      client: { id: config.sso_oauth_client_id, secret: config.sso_oauth_client_secret },
      auth: {
        authorizeHost: authorize.origin,
        authorizePath: authorize.pathname + authorize.search,
        tokenHost: token.origin,
        tokenPath: token.pathname + token.search,
      },
      options: { authorizationMethod: 'body' },
    });
  }

  /**
   * The provider's authorization URL with a fresh `state` and a PKCE (S256)
   * challenge. The caller keeps `state` and `verifier` in the session.
   */
  async oauthStart(request: any): Promise<{ url: string; state: string; verifier: string }> {
    const config = await this.config();
    if (
      !config.sso_oauth_authorize_url ||
      !config.sso_oauth_token_url ||
      !config.sso_oauth_client_id
    ) {
      throw new SsoException('OAuth refused: the provider is not fully configured.');
    }
    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const client = await this.oauthClient(config);
    const url = client.authorizeURL({
      redirect_uri: this.url(request, 'escalated.sso.oauth.callback'),
      scope: config.sso_oauth_scopes.split(/[\s,]+/).filter(Boolean),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    } as any);
    return { url, state, verifier };
  }

  /**
   * Exchanges the authorization code (with the PKCE verifier) server to
   * server and reads the profile from the userinfo endpoint.
   */
  async oauthIdentity(request: any, code: string, verifier: string): Promise<SsoIdentity> {
    const config = await this.config();
    let profile: Record<string, any>;
    try {
      const client = await this.oauthClient(config);
      const token = await client.getToken({
        code,
        redirect_uri: this.url(request, 'escalated.sso.oauth.callback'),
        code_verifier: verifier,
      } as any);
      const accessToken = String((token.token as any)?.access_token ?? '');
      if (!accessToken) throw new Error('no access token');
      const res = await fetch(config.sso_oauth_userinfo_url, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`userinfo answered ${res.status}`);
      profile = (await res.json()) as Record<string, any>;
    } catch (error) {
      throw new SsoException(`OAuth refused: ${(error as Error)?.message ?? error}`);
    }
    if ([false, 'false', 0, '0'].includes(profile?.email_verified)) {
      throw new SsoException('OAuth refused: the provider says the email is not verified.');
    }
    const claim = (name: string, fallback = '') =>
      String(profile?.[name] ?? (fallback ? profile?.[fallback] : '') ?? '').trim();
    return this.identity(
      claim(config.sso_attr_email || 'email', 'email'),
      claim(config.sso_attr_name || 'name', 'name'),
      claim(config.sso_attr_role || 'role'),
    );
  }

  // ---- JWT -----------------------------------------------------------------

  /** Where JWT sign-in starts: the configured login URL, told where to come back. */
  async jwtLoginUrl(request: any): Promise<string> {
    const config = await this.config();
    const url = (config.sso_login_url || config.sso_url).trim();
    if (!url) throw new SsoException('JWT sign-in has no login URL configured.');
    const query = new URLSearchParams({
      return_to: this.url(request, 'escalated.sso.jwt.callback'),
    });
    return url + (url.includes('?') ? '&' : '?') + query.toString();
  }

  /**
   * Validates a JWT handed back by the identity provider: `alg` must be the
   * configured algorithm (so `none` and algorithm switching are refused);
   * `exp` is required; `nbf`/`iat` hold within the clock skew; `aud` names
   * this install; and `jti` is present and used once.
   */
  async validateJwt(token: string): Promise<SsoIdentity> {
    const config = await this.config();
    const algorithm = config.sso_jwt_algorithm || 'HS256';
    const secret = config.sso_jwt_secret;
    if (!SSO_JWT_ALGORITHMS.includes(algorithm)) {
      throw new SsoException(`JWT refused: unsupported algorithm ${algorithm}.`);
    }
    if (!secret) throw new SsoException('JWT refused: no secret or public key is configured.');
    const audience =
      this.options?.sso?.jwtAudience ||
      process.env.ESCALATED_SSO_JWT_AUDIENCE ||
      this.options?.appUrl;
    if (!audience)
      throw new SsoException('JWT refused: no audience is configured (sso.jwtAudience or appUrl).');

    let claims: Record<string, any>;
    try {
      claims = jwt.verify(String(token ?? ''), secret, {
        algorithms: [algorithm as jwt.Algorithm],
        audience,
        clockTolerance: this.clockSkew(),
      }) as Record<string, any>;
    } catch (error) {
      throw new SsoException(`JWT refused: ${(error as Error)?.message ?? error}`);
    }
    if (typeof claims !== 'object' || claims === null || typeof claims.exp !== 'number') {
      throw new SsoException('JWT refused: no exp claim.');
    }
    const jti =
      typeof claims.jti === 'string' || typeof claims.jti === 'number' ? String(claims.jti) : '';
    if (!jti) throw new SsoException('JWT refused: no jti claim.');
    if (!(await this.messageIds.claim('jwt', jti, claims.exp + this.clockSkew()))) {
      throw new SsoException(`JWT refused: jti [${jti}] was already used.`);
    }
    const claim = (name: string, fallback = '') =>
      String(claims[name] ?? (fallback ? claims[fallback] : '') ?? '').trim();
    return this.identity(
      claim(config.sso_attr_email || 'email', 'email'),
      claim(config.sso_attr_name || 'name', 'name'),
      claim(config.sso_attr_role || 'role'),
    );
  }

  private identity(email: string, name: string, role: string): SsoIdentity {
    if (!EMAIL.test(email)) throw new SsoException('SSO refused: no valid email in the identity.');
    return { email, name, role };
  }
}
