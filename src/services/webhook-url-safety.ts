import { lookup } from 'dns/promises';
import { BlockList, isIP } from 'net';

/**
 * Webhook URLs are supplied by admins and fetched by the server, so a stored
 * URL is a way to make Escalated issue requests on the caller's behalf. These
 * checks keep webhooks pointed at the public internet: never loopback, private,
 * link-local (including cloud metadata endpoints) or reserved addresses,
 * whether the URL names an IP literal or a hostname that resolves to one.
 */
export class UnsafeWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeWebhookUrlError';
  }
}

const NON_PUBLIC = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, limited broadcast
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4');
}

// IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are matched against the IPv4
// rules above by BlockList itself.
for (const [network, prefix] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments, Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

/** True when `address` is a valid IP address outside every non-public range. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !NON_PUBLIC.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Throws {@link UnsafeWebhookUrlError} unless `rawUrl` is an http(s) URL whose
 * host is, or resolves only to, public addresses. Every resolved address must
 * be public, so a hostname with one private record is refused.
 */
export async function assertPublicWebhookUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError('Webhook URL is not a valid URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeWebhookUrlError('Webhook URL must use http or https');
  }

  // URL normalizes IPv4 shorthand (127.1, 2130706433) and wraps IPv6 in [].
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const bareHost = host.toLowerCase().replace(/\.$/, '');
  if (!bareHost || bareHost === 'localhost' || bareHost.endsWith('.localhost')) {
    throw nonPublic();
  }

  const addresses = isIP(host) ? [host] : await resolveAll(host);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw nonPublic();
  }
}

async function resolveAll(host: string): Promise<string[]> {
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch {
    throw new UnsafeWebhookUrlError(`Webhook host "${host}" could not be resolved`);
  }
}

function nonPublic(): UnsafeWebhookUrlError {
  return new UnsafeWebhookUrlError(
    'Webhook URL must not target a loopback, private, link-local or reserved address',
  );
}
