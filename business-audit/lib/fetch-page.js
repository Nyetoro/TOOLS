'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const USER_AGENT =
  'BusinessPresenceAudit/1.0 (automated public-page audit; contact the site owner to request exclusion)';

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Accepts "example.com", "http://example.com", "https://example.com/page".
 * Returns a normalised absolute URL, or null when it cannot be a real host.
 */
function normalizeUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) return null;
  raw = raw.replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw.replace(/^\/+/, '')}`;
  try {
    const url = new URL(raw);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function singleRequest(target, options) {
  const { maxBytes, timeoutMs, accept } = options;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(target);
    } catch {
      return resolve({ ok: false, error: 'invalid-url', url: target });
    }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      target,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: accept,
          'Accept-Language': 'en',
          'Accept-Encoding': 'identity',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const ttfbMs = Date.now() - startedAt;
        const declared = Number(res.headers['content-length'] || 0);

        if (declared && declared > maxBytes) {
          res.destroy();
          return resolve({
            ok: true,
            url: target,
            status: res.statusCode,
            headers: res.headers,
            body: '',
            bytes: declared,
            truncated: true,
            tooLarge: true,
            ttfbMs,
            totalMs: Date.now() - startedAt,
          });
        }

        const chunks = [];
        let size = 0;
        let truncated = false;

        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          resolve({
            ok: true,
            url: target,
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            bytes: size,
            truncated,
            tooLarge: false,
            ttfbMs,
            totalMs: Date.now() - startedAt,
          });
        });

        // Fires when the socket is destroyed early (size cap or non-HTML stream).
        res.on('close', () => {
          resolve({
            ok: true,
            url: target,
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            bytes: size,
            truncated,
            tooLarge: false,
            ttfbMs,
            totalMs: Date.now() - startedAt,
          });
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => {
      const code = err.code || err.message || 'request-failed';
      resolve({ ok: false, error: code === 'timeout' ? 'timeout' : code, url: target });
    });
  });
}

/**
 * Fetches a page, following redirects manually so we can report the chain
 * (an http -> https upgrade is itself a trust signal worth scoring).
 */
async function fetchPage(input, opts = {}) {
  const options = {
    maxBytes: opts.maxBytes ?? 2_500_000,
    timeoutMs: opts.timeoutMs ?? 15_000,
    accept: opts.accept ?? 'text/html,application/xhtml+xml',
    maxRedirects: opts.maxRedirects ?? 5,
  };

  const startUrl = normalizeUrl(input);
  if (!startUrl) return { ok: false, error: 'invalid-url', startUrl: input, redirects: [] };

  let current = startUrl;
  const redirects = [];

  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    const res = await singleRequest(current, options);
    if (!res.ok) return { ...res, startUrl, redirects };

    const location = res.headers.location;
    if (REDIRECT_CODES.has(res.status) && location) {
      const next = new URL(location, current).href;
      redirects.push({ from: current, status: res.status, to: next });
      current = next;
      continue;
    }

    return {
      ...res,
      startUrl,
      finalUrl: current,
      redirects,
      redirectedToHttps: startUrl.startsWith('http://') && current.startsWith('https://'),
    };
  }

  return { ok: false, error: 'too-many-redirects', startUrl, redirects };
}

/** Small helper used for robots.txt / sitemap.xml / stylesheets. */
async function fetchAsset(url, { maxBytes = 400_000, timeoutMs = 8000 } = {}) {
  const res = await singleRequest(url, { maxBytes, timeoutMs, accept: '*/*' });
  return res;
}

module.exports = { fetchPage, fetchAsset, normalizeUrl, USER_AGENT };
