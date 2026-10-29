import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import { syncBuiltinESMExports } from 'node:module';

// The release pipeline preloads this guard globally while some tests also
// import it explicitly. Keep the network wrappers idempotent across both paths.
// Test-process preload only. Reject remote HTTP before any request is sent.
export function assertLoopback(input) {
  let hostname;
  if (typeof input === 'string' || input instanceof URL) hostname = new URL(input).hostname;
  else if (input?.url) hostname = new URL(input.url).hostname;
  else hostname = input?.hostname || input?.host || 'localhost';
  hostname = String(hostname).replace(/^\[|\]$/g, '');
  if (hostname !== '::1') hostname = hostname.replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error(`EMULATOR_ONLY_NETWORK: blocked remote host ${hostname}`);
  }
  if (typeof input?.path === 'string' && /^https?:\/\//.test(input.path)) assertLoopback(input.path);
  if (input?.method === 'CONNECT' && typeof input.path === 'string') assertLoopback({ hostname: input.path });
}

const guardInstalled = Symbol.for('nvu.loopback-network-guard.installed');
if (!globalThis[guardInstalled]) {
  globalThis[guardInstalled] = true;

if (globalThis.fetch) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, ...rest) => {
    assertLoopback(input);
    return originalFetch(input, { ...rest[0], redirect: 'error' });
  };
}
for (const transport of [http, https]) {
  for (const method of ['request', 'get']) {
    const original = transport[method];
    transport[method] = function (input, ...rest) {
      assertLoopback(input);
      if (rest[0]?.hostname || rest[0]?.host) assertLoopback(rest[0]);
      return original.call(this, input, ...rest);
    };
  }
}
const originalHttp2Connect = http2.connect;
http2.connect = function(authority, ...rest) {
  assertLoopback(authority);
  return originalHttp2Connect.call(this, authority, ...rest);
};
syncBuiltinESMExports();
}
