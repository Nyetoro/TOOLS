'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runAudit } = require('./lib/audit');

const PORT = Number(process.env.PORT || 4321);
// Bound to loopback by default: this tool holds your lead list and exposes an
// unauthenticated API, so it should not be reachable by everyone on your Wi-Fi.
// Set HOST=0.0.0.0 to open it to your phone on the same network.
const HOST = process.env.HOST || '127.0.0.1';

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.jsonl');

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const LEAD_STATUSES = ['new', 'contacted', 'replied', 'won', 'lost'];

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload-too-large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid-json'));
      }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ *
 * Lead store
 *
 * A flat JSONL file is plenty for a personal lead list. Every write rewrites
 * the file atomically so a crash mid-write cannot corrupt the list.
 * ------------------------------------------------------------------ */

function loadLeads() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  return fs
    .readFileSync(LEADS_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeLeads(leads) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${LEADS_FILE}.tmp`;
  const body = leads.map((l) => JSON.stringify(l)).join('\n');
  fs.writeFileSync(tmp, leads.length ? `${body}\n` : '', 'utf8');
  fs.renameSync(tmp, LEADS_FILE);
}

/** Matches an existing lead on name + website so re-auditing updates rather than duplicates. */
function leadKey(name, url) {
  return `${String(name || '').trim().toLowerCase()}|${String(url || '').trim().toLowerCase()}`;
}

function saveLead(report) {
  if (IS_SERVERLESS) return null;
  try {
    const entry = {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      status: 'new',
      name: report.business.name,
      url: report.business.url,
      phone: report.business.phone,
      whatsapp: report.business.whatsapp,
      instagram: report.business.instagram,
      notes: report.business.notes,
      score: report.score,
      grade: report.grade,
      band: report.band,
      hasWebsite: report.site.hadUrl !== false,
      topIssue: report.topFixes[0] ? report.topFixes[0].title : null,
      issues: report.issues.length,
      critical: report.counts.critical,
    };

    const leads = loadLeads();
    const index = leads.findIndex((l) => leadKey(l.name, l.url) === leadKey(entry.name, entry.url));

    if (index >= 0) {
      // Keep the original id, creation time and outreach progress; refresh the audit facts.
      const previous = leads[index];
      entry.id = previous.id;
      entry.savedAt = previous.savedAt;
      entry.status = previous.status || 'new';
      entry.notes = entry.notes || previous.notes || null;
      entry.lastAuditedAt = new Date().toISOString();
      leads[index] = entry;
    } else {
      leads.unshift(entry);
    }

    writeLeads(leads);
    return entry;
  } catch {
    return null; // logging must never break an audit
  }
}

function leadsToCsv(leads) {
  const columns = [
    'savedAt', 'status', 'name', 'url', 'phone', 'whatsapp', 'instagram',
    'score', 'grade', 'band', 'critical', 'issues', 'topIssue', 'notes',
  ];
  const escape = (value) => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.join(','),
    ...leads.map((l) => columns.map((c) => escape(l[c])).join(',')),
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const root = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : `${PUBLIC_DIR}${path.sep}`;
  const target = path.normalize(path.join(PUBLIC_DIR, relative));

  // Block traversal outside public/.
  if (!target.startsWith(root)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

async function handleAudit(req, res) {
  let payload;
  try {
    payload = await readBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  if (!payload.name && !payload.url) {
    return sendJson(res, 400, { error: 'Provide at least a business name or a website address.' });
  }

  try {
    const report = await runAudit(payload, { timeoutMs: Number(payload.timeoutMs) || 15_000 });
    const saved = payload.save ? saveLead(report) : null;
    if (saved) report.leadId = saved.id;
    return sendJson(res, 200, report);
  } catch (err) {
    return sendJson(res, 500, { error: 'audit-failed', message: err.message });
  }
}

function handleLeadPatch(req, res, id) {
  return readBody(req)
    .then((patch) => {
      const leads = loadLeads();
      const lead = leads.find((l) => l.id === id);
      if (!lead) return sendJson(res, 404, { error: 'lead-not-found' });

      if (patch.status !== undefined) {
        if (!LEAD_STATUSES.includes(patch.status)) {
          return sendJson(res, 400, { error: 'invalid-status', allowed: LEAD_STATUSES });
        }
        lead.status = patch.status;
      }
      if (patch.notes !== undefined) lead.notes = String(patch.notes).slice(0, 2000);
      if (patch.phone !== undefined) lead.phone = String(patch.phone).slice(0, 40);
      if (patch.whatsapp !== undefined) lead.whatsapp = String(patch.whatsapp).slice(0, 40);

      lead.updatedAt = new Date().toISOString();
      writeLeads(leads);
      return sendJson(res, 200, { ok: true, lead });
    })
    .catch((err) => sendJson(res, 400, { error: err.message }));
}

function handleLeadDelete(res, id) {
  const leads = loadLeads();
  const remaining = leads.filter((l) => l.id !== id);
  if (remaining.length === leads.length) return sendJson(res, 404, { error: 'lead-not-found' });
  writeLeads(remaining);
  return sendJson(res, 200, { ok: true, removed: id });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      serverless: IS_SERVERLESS,
      leadStore: IS_SERVERLESS ? 'disabled' : 'file',
    });
  }

  if (pathname === '/api/audit' && req.method === 'POST') {
    return handleAudit(req, res);
  }

  if (pathname === '/api/leads' && req.method === 'GET') {
    const leads = loadLeads().sort((a, b) => a.score - b.score);
    return sendJson(res, 200, {
      count: leads.length,
      leads,
      persistent: !IS_SERVERLESS,
      statuses: LEAD_STATUSES,
    });
  }

  if (pathname === '/api/leads.csv' && req.method === 'GET') {
    const csv = leadsToCsv(loadLeads().sort((a, b) => a.score - b.score));
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="leads.csv"',
    });
    return res.end(csv);
  }

  const leadMatch = pathname.match(/^\/api\/leads\/([A-Za-z0-9-]+)$/);
  if (leadMatch) {
    if (req.method === 'PATCH' || req.method === 'PUT') return handleLeadPatch(req, res, leadMatch[1]);
    if (req.method === 'DELETE') return handleLeadDelete(res, leadMatch[1]);
    return sendJson(res, 405, { error: 'method-not-allowed' });
  }

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'unknown-endpoint' });
  }

  return serveStatic(req, res, pathname);
});

if (require.main === module) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} is already in use - another copy of this tool is probably running.`);
      console.error(`  Close it, or use a different port:  $env:PORT=4322; node server.js\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, HOST, () => {
    console.log(`\n  Digital Presence Audit running at http://localhost:${PORT}`);
    if (HOST === '0.0.0.0') {
      console.log('  Open to your local network (HOST=0.0.0.0) - your lead list has no password.');
    }
    if (IS_SERVERLESS) console.log('  Serverless mode: lead logging is disabled.');
    console.log('');
  });
}

module.exports = server;
