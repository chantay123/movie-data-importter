import dns from 'node:dns';
import tls from 'node:tls';
import type { SecureVersion } from 'node:tls';

/**
 * Network compatibility layer for the MongoDB connection.
 *
 * Some corporate / residential networks break the two mechanisms the MongoDB
 * Node driver relies on:
 *
 *   1. **SRV resolution** — `dns.resolveSrv()` is answered with `ECONNREFUSED`
 *      by the DNS resolver configured on the machine, even though the record
 *      exists. `nslookup -type=SRV` succeeds, so the record is fine: only the
 *      resolver used by Node is broken. Overriding the resolver list with a
 *      public DNS server fixes it.
 *   2. **TLS 1.3 handshake** — the handshake never completes against the Atlas
 *      hosts, the socket simply stalls until the connection times out. Forcing
 *      TLS 1.2 (still perfectly secure for MongoDB) makes the handshake succeed
 *      immediately.
 *
 * Both fixes are opt-out and configurable through the environment so that they
 * can be disabled on a machine with a healthy network.
 */

/**
 * Reads a string environment variable.
 *
 * @param name - Name of the variable.
 * @param fallback - Value used when the variable is missing or empty.
 * @returns The value.
 */
function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * Applies the DNS and TLS workarounds required by the current network.
 *
 * Safe to call several times: every step is idempotent.
 *
 * @returns A short summary of the applied workarounds.
 */
export function applyMongoNetworkWorkarounds(): string[] {
  const applied: string[] = [];

  const dnsServers = readString('MONGODB_DNS_SERVERS', '8.8.8.8,1.1.1.1')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  if (dnsServers.length > 0) {
    dns.setServers(dnsServers);
    applied.push(`dns servers -> ${dnsServers.join(', ')}`);
  }

  const maxTlsVersion = readString('MONGODB_MAX_TLS_VERSION', 'TLSv1.2');

  if (maxTlsVersion && tls.DEFAULT_MAX_VERSION !== maxTlsVersion) {
    tls.DEFAULT_MAX_VERSION = maxTlsVersion as SecureVersion;
    applied.push(`tls max version -> ${maxTlsVersion}`);
  }

  return applied;
}
