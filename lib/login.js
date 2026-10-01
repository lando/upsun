'use strict';

const http = require('http');
const crypto = require('crypto');
const os = require('os');
const readline = require('readline');
const childProcess = require('child_process');
const api = require('./api');
const {API_CONFIG} = require('./cli');
const tokens = require('./tokens');
const utils = require('./utils');

/**
 * @param {string} [username] Console username.
 * @param {object} [config] Console endpoint.
 * @returns {string} Console fallback URL.
 */
exports.getTokensUrl = (username, config = API_CONFIG) => username ?
  `${config.console_url}/-/users/${encodeURIComponent(username)}/settings/tokens` :
  `${config.console_url}/-/users/me/settings`;

/**
 * @param {string} url Authorization URL.
 * @param {object} [options] Injectable host platform, environment and spawn.
 * @param {string} [options.platform] Host platform.
 * @param {object} [options.env] Host environment.
 * @param {Function} [options.spawn] Process launcher.
 * @returns {boolean} Whether a browser launch was attempted.
 */
exports.openBrowser = (url, {platform = process.platform, env = process.env, spawn = childProcess.spawn} = {}) => {
  let command;
  let args = [url];
  if (platform === 'darwin') command = 'open';
  else if (platform === 'win32' || (platform === 'linux' && (env.WSL_DISTRO_NAME || env.WSL_INTEROP))) {
    command = platform === 'win32' ? 'rundll32' : 'rundll32.exe';
    args = ['url.dll,FileProtocolHandler', url];
  } else if (platform === 'linux' && (env.DISPLAY || env.WAYLAND_DISPLAY)) command = 'xdg-open';
  else return false;
  const child = spawn(command, args, {detached: true, stdio: 'ignore'});
  child.on('error', () => {
    // An unavailable opener is harmless: the terminal also displays the URL.
  });
  child.unref();
  return true;
};

const escapeHtml = text => String(text).replace(/[&<>"']/g, char =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'}[char]));
const abortError = () => Object.assign(new Error('Browser login aborted'), {name: 'AbortError'});

// Upsun only creates API tokens within 5 minutes of a login (a 401 step-up challenge with max_age=300),
// so ask for that freshness up front to avoid a second browser trip for stale sessions.
const TOKEN_MAX_AGE = 300;
const isStepUp = error => error.status === 401 && error.body?.error === 'insufficient_user_authentication';

/**
 * @param {object} options Client, endpoints, browser callbacks and cancellation.
 * @param {string} options.clientId Public client ID.
 * @param {object} [options.config] API endpoints.
 * @param {Function} [options.open] Browser launcher.
 * @param {Function} [options.onUrl] URL output callback.
 * @param {AbortSignal} [options.signal] Cancellation signal.
 * @param {number} [options.timeout] Timeout in milliseconds.
 * @param {number} [options.maxAge] Maximum age in seconds of the browser's login session.
 * @param {string|string[]} [options.amr] Required authentication methods.
 * @returns {Promise<object>} Authorization code, redirect URI and verifier.
 */
exports.authorize = ({clientId, config = API_CONFIG, open = exports.openBrowser, onUrl = () => {},
  signal, timeout = 600000, maxAge, amr}) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  let redirectUri;
  let settled = false;
  let answering = false;
  const finish = (error, result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    server.close();
    server.closeAllConnections();
    if (error) reject(error);
    else resolve(result);
  };
  // Once a callback is being answered, a late Enter or timeout must not discard its result
  const abort = () => answering || finish(abortError());
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/') {
      res.writeHead(404).end();
      return;
    }
    if (url.searchParams.get('state') !== state) {
      res.writeHead(400).end();
      return;
    }
    const errorCode = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (!errorCode && !code) {
      res.writeHead(400).end();
      return;
    }
    // Upsun reports the consent screen's Cancel button as consent_required, with a server-centric description
    const declined = ['access_denied', 'consent_required'].includes(errorCode);
    const error = errorCode ? Object.assign(new Error(declined ? 'You declined access in the browser' :
      url.searchParams.get('error_description') || errorCode), {code: errorCode}) : undefined;
    answering = true;
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(error ? `<p>Lando couldn't log in to Upsun: ${escapeHtml(error.message.replace(/\.$/, ''))}. ` +
      'Return to your terminal to paste an API token instead.</p>' :
      '<p>Lando is logged in to Upsun. You can close this tab and return to your terminal.</p>');
    res.on('finish', () => finish(error, {code, redirectUri, verifier}));
  });
  server.on('error', finish);
  signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => answering || finish(new Error('Timed out waiting for the browser login')), timeout);
  server.listen(0, '127.0.0.1', () => {
    if (settled) {
      server.close();
      return;
    }
    const address = server.address();
    if (!address || typeof address === 'string') return finish(new Error('Unable to bind the login callback'));
    redirectUri = `http://127.0.0.1:${address.port}`;
    const url = new URL(`${config.authentication_url}/oauth2/authorize`);
    const params = new URLSearchParams({response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
      code_challenge: challenge, code_challenge_method: 'S256', state});
    if (maxAge !== undefined) params.set('max_age', String(maxAge));
    // Same encoding as the Upsun CLI: one space-separated value
    if (amr?.length) params.set('amr', [].concat(amr).join(' '));
    url.search = params.toString();
    try {
      onUrl(url.toString());
      open(url.toString());
    } catch (error) {
      finish(error);
    }
  });
});

/**
 * @param {object} options Login endpoints, callbacks, cancellation and token name.
 * @param {object} [options.config] API endpoints.
 * @param {Function} [options.open] Browser launcher.
 * @param {Function} [options.onUrl] URL output callback, passed `{stepUp: true}` for a repeat login.
 * @param {function(): (AbortSignal|undefined)} [options.getSignal] Cancellation signal for each browser wait.
 * @param {number} [options.timeout] Timeout in milliseconds.
 * @param {string} options.name API token name.
 * @returns {Promise<object>} Named API token and account identity.
 */
exports.browserLogin = async ({config = API_CONFIG, open, onUrl = () => {}, getSignal = () => undefined, timeout,
  name}) => {
  const clientId = await api.registerOAuthClient(config);
  const refreshTokens = [];
  const authenticate = async ({stepUp = false, ...requirements}) => {
    const authorization = await exports.authorize({clientId, config, open, signal: getSignal(), timeout,
      ...requirements,
      onUrl: url => onUrl(url, {stepUp})});
    const credentials = await api.exchangeAuthorizationCode({...authorization, clientId}, config);
    refreshTokens.push(credentials.refresh_token);
    return credentials.access_token;
  };
  let me;
  try {
    let accessToken = await authenticate({maxAge: TOKEN_MAX_AGE});
    me = await api.getMe(accessToken, config);
    let created;
    try {
      created = await api.createApiToken(accessToken, me.id, name, config);
    } catch (error) {
      if (!isStepUp(error)) throw error;
      // The server can still demand a fresher or stronger login (e.g. MFA); retry once with its requirements
      accessToken = await authenticate({stepUp: true, maxAge: error.body.max_age, amr: error.body.amr});
      created = await api.createApiToken(accessToken, me.id, name, config);
    }
    return {token: created.token, tokenId: created.id, name: created.name, email: me.mail, username: me.username};
  } catch (error) {
    if (me) error.username = me.username;
    throw error;
  } finally {
    for (const refreshToken of refreshTokens) {
      try {
        await api.revokeOAuthToken(refreshToken, clientId, config);
      } catch {
        // Revocation is best-effort; an auth outage must not discard the created API token.
      }
    }
  }
};

/**
 * @param {object} [input] Terminal input stream.
 * @returns {{promise: Promise<void>, cancel: Function}} Enter listener and cleanup.
 */
exports.waitForEnter = (input = process.stdin) => {
  let listener;
  const promise = new Promise(resolve => {
    if (!input.isTTY) return;
    readline.emitKeypressEvents(input);
    listener = (text, key) => {
      if (key?.name === 'return' || key?.name === 'enter') resolve();
    };
    input.on('keypress', listener);
  });
  return {promise, cancel: () => {
    if (listener) input.removeListener('keypress', listener);
  }};
};

/**
 * @param {object} options Lando cache, vendor and injectable login environment.
 * @param {object} options.lando Lando instance.
 * @param {'upsun'|'platformsh'} options.vendor Token cache vendor.
 * @param {object} [options.config] API and Console endpoints.
 * @param {object} [options.input] Terminal input.
 * @param {object} [options.output] Terminal output.
 * @param {Function} [options.open] Browser launcher.
 * @param {number} [options.timeout] Timeout in milliseconds.
 * @param {string} [options.hostname] Host name used in the token name.
 * @returns {Promise<string|undefined>} API token, or paste-token fallback.
 */
exports.promptBrowserLogin = async ({lando, vendor, config = API_CONFIG, input = process.stdin,
  output = process.stdout, open = exports.openBrowser, timeout = 600000, hostname = os.hostname()}) => {
  // Enter only skips the browser wait it was pressed during: each wait gets a fresh listener and signal,
  // so a stray Enter while the token is created can't cancel a later step-up login
  let enter;
  const getSignal = () => {
    enter?.cancel();
    const controller = new AbortController();
    enter = exports.waitForEnter(input);
    enter.promise.then(() => controller.abort());
    return controller.signal;
  };
  const name = `Lando (${hostname})`;
  let result;
  try {
    result = await exports.browserLogin({config, open, getSignal, timeout, name,
      onUrl: (url, {stepUp} = {}) => output.write((stepUp ?
        '\nUpsun needs you to log in again before it creates an API token.\n' :
        '\nLog in to Upsun in your browser to create an API token for Lando.\n') +
        `If your browser doesn't open, go to:\n  ${url}\n` +
        'Press Enter to skip and paste an API token instead.\n')});
  } catch (error) {
    output.write(error.name === 'AbortError' ? 'Skipped the browser login.\n' :
      `Browser login failed: ${error.message}\n`);
    output.write(`Create an API token at ${exports.getTokensUrl(error.username, config)} (API Tokens tab), ` +
      'then paste it below.\n');
    return undefined;
  } finally {
    enter?.cancel();
  }
  output.write(`Created the API token "${name}" for ${result.email}.\n`);
  try {
    tokens.writeTokens(lando, utils.sortTokens(tokens.readTokens(lando, vendor),
      [{token: result.token, email: result.email, date: Math.floor(Date.now() / 1000)}]), vendor);
  } catch (error) {
    // Upsun shows the secret only once, so still hand it to the running command instead of losing it
    output.write(`Lando couldn't save the token for next time: ${error.message}\n`);
  }
  return result.token;
};
