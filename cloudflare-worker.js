// ============================================================
//  D-Tools Report — Cloudflare Worker (CORS Proxy)
//
//  Deployment: Cloudflare Dashboard → Workers & Pages → Create
//  Copy this entire file into the worker editor and deploy.
//
//  What it does:
//    1. Receives POST /proxy requests from the browser
//    2. Adds the correct D-Tools auth header for SI or Cloud
//    3. Forwards the request to the D-Tools API
//    4. Returns the response with CORS headers so the browser
//       can read it
//
//  SECURITY NOTES:
//    - The allowed origins list below restricts which domains
//      can call this worker. Update it with your GitHub Pages URL.
//    - API keys are transmitted over HTTPS only.
//    - The worker does not log or store API keys.
// ============================================================

// ── Allowed origins (update with your GitHub Pages URL) ─────
const ALLOWED_ORIGINS = [
  'https://YOUR-GITHUB-USERNAME.github.io',  // ← replace this
  'http://localhost',                          // for local testing
  'http://127.0.0.1',
  'http://localhost:5500',                     // VS Code Live Server
  'http://127.0.0.1:5500'
];

// ── D-Tools API base URLs ────────────────────────────────────
const SI_BASE_URL    = 'https://api.d-tools.com';
const CLOUD_BASE_URL = 'https://api.d-tools.cloud'; // ← Confirm when Cloud API access is granted

// ── Cloudflare Worker entry point ───────────────────────────
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const origin = request.headers.get('Origin') || '';

  // ── CORS preflight ────────────────────────────────────────
  if (request.method === 'OPTIONS') {
    return corsPreflightResponse(origin);
  }

  // ── Only accept POST /proxy ───────────────────────────────
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/proxy') {
    return errorResponse('Not found', 404, origin);
  }

  // ── Parse request body ────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400, origin);
  }

  const { apiType, apiKey, endpoint, method = 'GET', params } = body;

  // ── Validate required fields ──────────────────────────────
  if (!apiType || !apiKey || !endpoint) {
    return errorResponse('Missing required fields: apiType, apiKey, endpoint', 400, origin);
  }
  if (!['si', 'cloud'].includes(apiType)) {
    return errorResponse('apiType must be "si" or "cloud"', 400, origin);
  }

  // ── Build the D-Tools target URL ──────────────────────────
  const baseUrl    = apiType === 'si' ? SI_BASE_URL : CLOUD_BASE_URL;
  let   targetUrl  = baseUrl + endpoint;

  if (params && Object.keys(params).length > 0) {
    targetUrl += '?' + buildQueryString(params);
  }

  // ── Build auth headers ────────────────────────────────────
  const dtoolsHeaders = {
    'Content-Type': 'application/json',
    'Accept':       'application/json'
  };

  if (apiType === 'si') {
    dtoolsHeaders['X-DTSI-ApiKey'] = apiKey;
  } else {
    dtoolsHeaders['X-API-Key'] = apiKey;
  }

  // ── Forward request to D-Tools ────────────────────────────
  let dtoolsResponse;
  try {
    dtoolsResponse = await fetch(targetUrl, {
      method: method.toUpperCase(),
      headers: dtoolsHeaders
    });
  } catch (err) {
    return errorResponse(
      `Failed to reach D-Tools API: ${err.message}`,
      502,
      origin
    );
  }

  // ── Read and return the response ──────────────────────────
  const responseText = await dtoolsResponse.text();

  return new Response(responseText, {
    status: dtoolsResponse.status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': allowedOriginHeader(origin),
      'Vary':                        'Origin'
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────

function buildQueryString(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        parts.push(`${encodeURIComponent(key + '[' + i + ']')}=${encodeURIComponent(v)}`);
      });
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}

function allowedOriginHeader(origin) {
  // Return the specific origin if it's in the allowlist,
  // otherwise return the first allowed origin (blocks others).
  return ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];
}

function corsPreflightResponse(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  allowedOriginHeader(origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age':       '86400',
      'Vary':                         'Origin'
    }
  });
}

function errorResponse(message, status, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': allowedOriginHeader(origin),
      'Vary':                        'Origin'
    }
  });
}
