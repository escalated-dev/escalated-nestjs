import { lookup } from 'dns/promises';
import {
  assertPublicWebhookUrl,
  isPublicAddress,
  UnsafeWebhookUrlError,
} from '../../src/services/webhook-url-safety';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));

const lookupMock = lookup as unknown as jest.Mock;

describe('isPublicAddress', () => {
  it.each([
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255', // just below 172.16.0.0/12
    '172.32.0.1', // just above 172.16.0.0/12
    '100.63.255.255', // just below 100.64.0.0/10
    '100.128.0.1', // just above 100.64.0.0/10
    '198.20.0.1', // just above 198.18.0.0/15
    '223.255.255.255', // just below multicast
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])('treats %s as public', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.255.255',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.0.8',
    '198.51.100.7',
    '203.0.113.9',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::7f00:1', // IPv4-compatible 127.0.0.1
    '::ffff:10.0.0.1', // IPv4-mapped private
    '::ffff:a9fe:a9fe', // IPv4-mapped 169.254.169.254
    '64:ff9b::7f00:1', // NAT64 of 127.0.0.1
    '2002:7f00:1::', // 6to4 of 127.0.0.1
    '2001:db8::1',
    '2001::1', // Teredo
    '100::1',
    'fc00::1',
    'fdff:ffff::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
  ])('treats %s as non-public', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('treats something that is not an IP address as non-public', () => {
    expect(isPublicAddress('example.com')).toBe(false);
  });
});

describe('assertPublicWebhookUrl', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it.each(['http://LOCALHOST./hook', 'http://api.localhost/hook'])(
    'refuses %s without resolving it',
    async (url) => {
      await expect(assertPublicWebhookUrl(url)).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
      expect(lookupMock).not.toHaveBeenCalled();
    },
  );

  it('accepts a public IPv6 literal without resolving it', async () => {
    await expect(
      assertPublicWebhookUrl('https://[2606:4700:4700::1111]:8443/hook'),
    ).resolves.toBeUndefined();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('resolves every address of a hostname', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);

    await expect(assertPublicWebhookUrl('https://example.com/hook')).resolves.toBeUndefined();
    expect(lookupMock).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
  });

  it('refuses a hostname that resolves to no addresses', async () => {
    lookupMock.mockResolvedValue([]);

    await expect(assertPublicWebhookUrl('https://example.com/hook')).rejects.toBeInstanceOf(
      UnsafeWebhookUrlError,
    );
  });
});
