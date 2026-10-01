'use strict';

const {API_CONFIG} = require('./cli');

// Same public OAuth client the Upsun CLI and platformsh-client use for API token exchange
const CLIENT_AUTH = `Basic ${Buffer.from('platform-cli:').toString('base64')}`;

const request = async (url, options = {}) => {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const method = options.method || 'GET';
    /** @type {Error & {status?: number}} */
    const error = new Error(body?.error_description || body?.message ||
      `${method} ${url} failed with HTTP ${response.status}`);
    // Callers distinguish a rejected token (4xx) from an outage (5xx/network) by this
    error.status = response.status;
    // Step-up challenges (RFC 9470) carry the required max_age / amr in the body
    error.body = body;
    throw error;
  }
  return body;
};

/**
 * Exchange an Upsun API token for an access token and fetch the account behind it.
 *
 * @param {string} apiToken Upsun API token.
 * @param {{api_url: string, authentication_url: string}} [config] API endpoints.
 * @returns {Promise<object>} The `/me` account, including `mail` and `projects`.
 */
exports.getAccountInfo = async (apiToken, config = API_CONFIG) => {
  const {access_token: accessToken} = await request(`${config.authentication_url}/oauth2/token`, {
    method: 'POST',
    headers: {'Authorization': CLIENT_AUTH, 'Content-Type': 'application/json'},
    body: JSON.stringify({grant_type: 'api_token', api_token: apiToken}),
  });
  return exports.getMe(accessToken, config);
};

/**
 * @param {string} accessToken Access token.
 * @param {object} [config] API endpoints.
 * @returns {Promise<object>} Account profile.
 */
exports.getMe = (accessToken, config = API_CONFIG) =>
  request(`${config.api_url}/me`, {headers: {Authorization: `Bearer ${accessToken}`}});

/**
 * @param {object} [config] API endpoints.
 * @returns {Promise<string>} Public client ID.
 */
exports.registerOAuthClient = async (config = API_CONFIG) => {
  const client = await request(`${config.authentication_url}/oauth2/register`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({client_name: 'Lando', redirect_uris: ['http://127.0.0.1'],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none'}),
  });
  return client.client_id;
};

/**
 * @param {object} authorization Authorization code and PKCE proof.
 * @param {string} authorization.code Authorization code.
 * @param {string} authorization.redirectUri Exact loopback redirect.
 * @param {string} authorization.verifier PKCE verifier.
 * @param {string} authorization.clientId Public client ID.
 * @param {object} [config] API endpoints.
 * @returns {Promise<object>} OAuth credentials.
 */
exports.exchangeAuthorizationCode = ({code, redirectUri, verifier, clientId}, config = API_CONFIG) =>
  request(`${config.authentication_url}/oauth2/token`, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'authorization_code', code, redirect_uri: redirectUri,
      client_id: clientId, code_verifier: verifier}).toString(),
  });

/**
 * @param {string} token Refresh token.
 * @param {string} clientId Public client ID.
 * @param {object} [config] API endpoints.
 * @returns {Promise<object>} Revocation response.
 */
exports.revokeOAuthToken = (token, clientId, config = API_CONFIG) =>
  request(`${config.authentication_url}/oauth2/revoke`, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({token, token_type_hint: 'refresh_token', client_id: clientId}).toString(),
  });

/**
 * @param {string} accessToken Access token.
 * @param {string} userId Account ID.
 * @param {string} name Token name.
 * @param {object} [config] API endpoints.
 * @returns {Promise<object>} Created API token, including its one-time secret.
 */
exports.createApiToken = (accessToken, userId, name, config = API_CONFIG) =>
  request(`${config.api_url}/users/${encodeURIComponent(userId)}/api-tokens`, {
    method: 'POST',
    headers: {'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({name}),
  });
