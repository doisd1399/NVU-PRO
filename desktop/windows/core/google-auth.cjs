const fs = require('node:fs');
const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
function equal(a, b) { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && timingSafeEqual(x, y); }
class GoogleAuth {
  constructor({ config, vault, safeStorage, openExternal }) { Object.assign(this, { config, vault, safeStorage, openExternal }); this.pending = false; }
  async verify(idToken, nonce) {
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    this.jwks ||= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    const { payload } = await jwtVerify(idToken, this.jwks, { audience: this.config.clientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'], algorithms: ['RS256'] });
    if (nonce && !equal(payload.nonce, nonce)) throw Error('OAUTH_NONCE_INVALID');
    return idToken;
  }
  save(refreshToken) {
    if (!this.safeStorage.isEncryptionAvailable()) throw Error('WINDOWS_CREDENTIAL_STORAGE_UNAVAILABLE');
    fs.writeFileSync(this.vault, this.safeStorage.encryptString(refreshToken), { mode: 0o600 });
  }
  async exchange(body, nonce) {
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      body: new URLSearchParams({ ...body, client_id: this.config.clientId, ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}) }),
      signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
    const data = await response.json();
    if (!data.id_token) throw Error('GOOGLE_ID_TOKEN_MISSING');
    await this.verify(data.id_token, nonce);
    if (data.refresh_token) this.save(data.refresh_token);
    return { idToken: data.id_token };
  }
  async restore() {
    if (!fs.existsSync(this.vault)) return null;
    if (!this.safeStorage.isEncryptionAvailable()) throw Error('WINDOWS_CREDENTIAL_STORAGE_UNAVAILABLE');
    return this.exchange({ grant_type: 'refresh_token', refresh_token: this.safeStorage.decryptString(fs.readFileSync(this.vault)) });
  }
  clear() { if (fs.existsSync(this.vault)) fs.unlinkSync(this.vault); }
  async signIn() {
    if (!this.config.clientId || !/\.apps\.googleusercontent\.com$/.test(this.config.clientId))
      throw Error('O login Windows ainda precisa ser configurado pelo administrador (cliente OAuth Desktop).');
    if (this.pending) throw Error('O login já está em andamento.');
    this.pending = true;
    let server, timer;
    try {
      const verifier = randomBytes(48).toString('base64url'), state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
      let resolveCode, rejectCode;
      const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
      // Attach a rejection handler before opening the browser to avoid an unhandled timeout.
      codePromise.catch(() => {});
      server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        res.setHeader('Content-Security-Policy', "default-src 'none'"); res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET' || u.pathname !== '/oauth/callback' || !equal(u.searchParams.get('state'), state)) {
          res.writeHead(400); res.end('Retorno de login inválido.'); return;
        }
        res.end('Login recebido. Volte ao aplicativo NVU.');
        const code = u.searchParams.get('code');
        if (u.searchParams.has('error') || !code || code.length > 4096) rejectCode(Error('GOOGLE_LOGIN_CANCELLED'));
        else resolveCode(code);
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const redirect = `http://127.0.0.1:${server.address().port}/oauth/callback`;
      timer = setTimeout(() => rejectCode(Error('GOOGLE_LOGIN_TIMEOUT')), 180000);
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: redirect, response_type: 'code',
        scope: 'openid email profile', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256', state, nonce, access_type: 'offline', prompt: 'consent select_account' }).toString();
      await this.openExternal(url.toString());
      const code = await codePromise;
      return await this.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }, nonce);
    } finally { clearTimeout(timer); if (server) server.close(); this.pending = false; }
  }
}
module.exports = { GoogleAuth, equal };
