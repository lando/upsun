'use strict';

const {API_CONFIG} = require('./cli');

// Same public OAuth client the Upsun CLI and platformsh-client use for API token exchange
const CLIENT_AUTH = `Basic ${Buffer.from('platform-cli:').toString('base64')}`;

const request = async (url, options = {}) => {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const method = options.method || 'GET';
    throw new Error(body?.error_description || body?.message ||
      `${method} ${url} failed with HTTP ${response.status}`);
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
  return request(`${config.api_url}/me`, {headers: {Authorization: `Bearer ${accessToken}`}});
};
