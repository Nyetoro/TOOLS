'use strict';

/* Vercel serverless entry point for POST /api/audit.
   Lead persistence is unavailable here (no durable disk), so `save` is ignored. */

const { runAudit } = require('../lib/audit');

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }

  let payload;
  try {
    payload = await readBody(req);
  } catch {
    res.status(400).json({ error: 'invalid-json' });
    return;
  }

  if (!payload.name && !payload.url) {
    res.status(400).json({ error: 'Provide at least a business name or a website address.' });
    return;
  }

  try {
    const report = await runAudit(payload, { timeoutMs: 12_000 });
    res.status(200).json(report);
  } catch (err) {
    res.status(500).json({ error: 'audit-failed', message: err.message });
  }
};
