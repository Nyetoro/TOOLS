'use strict';

const { escapeHtml, chatLink, severityLabel, scoreColor, linkIsLocalOnly } = window.AuditUI;
const BRAND = window.AUDIT_BRAND || {};

document.getElementById('brandName').textContent = BRAND.businessName || 'Digital Presence Audit';
document.getElementById('brandTagline').textContent = BRAND.tagline || 'Find the gaps, then start the conversation';
document.getElementById('brandDot').textContent = ((BRAND.businessName || 'A').trim()[0] || 'A').toUpperCase();

// Warn early: links generated on localhost cannot be opened by a client.
if (linkIsLocalOnly(BRAND.publicUrl)) {
  document.getElementById('localWarning').innerHTML = `
    <div class="note bad">
      <b>Report links currently point at <code>localhost</code>.</b>
      They work on this computer only — a client could not open one on their phone.
      Deploy this tool (see the README) then set <code>publicUrl</code> in
      <code>config.js</code>, or use <b>Save as PDF</b> on a report and send the file.
    </div>`;
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`);
    });
    if (tab.dataset.tab === 'leads') loadLeads();
  });
});

/* ------------------------------------------------------------------ *
 * Audit transport
 * ------------------------------------------------------------------ */

async function requestAudit(payload) {
  const res = await fetch('/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Audit failed');
  return data;
}

function openReport(report) {
  sessionStorage.setItem('lastReport', JSON.stringify(report));
  location.href = 'report.html';
}

/* ------------------------------------------------------------------ *
 * Single audit
 * ------------------------------------------------------------------ */

const singleForm = document.getElementById('singleForm');
const sStatus = document.getElementById('s-status');
const sLog = document.getElementById('s-log');

const STAGES = [
  'Resolving the address…',
  'Downloading the page…',
  'Checking mobile behaviour…',
  'Checking contact routes…',
  'Checking search visibility…',
  'Scoring the results…',
];

singleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = document.getElementById('s-submit');
  submit.disabled = true;
  sStatus.innerHTML = '<span class="spinner"></span>';

  let stage = 0;
  sLog.textContent = STAGES[0];
  const ticker = setInterval(() => {
    stage = Math.min(stage + 1, STAGES.length - 1);
    sLog.textContent = STAGES.slice(0, stage + 1).join('\n');
  }, 1400);

  const payload = {
    name: document.getElementById('s-name').value.trim(),
    url: document.getElementById('s-url').value.trim(),
    phone: document.getElementById('s-phone').value.trim(),
    instagram: document.getElementById('s-instagram').value.trim(),
    notes: document.getElementById('s-notes').value.trim(),
    save: document.getElementById('s-save').checked,
  };

  try {
    const report = await requestAudit(payload);
    clearInterval(ticker);
    sLog.textContent = `${STAGES.join('\n')}\n\nDone — score ${report.score}/100.`;
    openReport(report);
  } catch (err) {
    clearInterval(ticker);
    sLog.textContent = '';
    sStatus.innerHTML = '';
    sLog.innerHTML = `<span style="color:#ff8a3d">${escapeHtml(err.message)}</span>`;
  } finally {
    submit.disabled = false;
  }
});

/* ------------------------------------------------------------------ *
 * Bulk audit — the lead-hunting engine
 * ------------------------------------------------------------------ */

const MAX_BULK = 100;

const bulkForm = document.getElementById('bulkForm');
const bSubmit = document.getElementById('b-submit');
const bStop = document.getElementById('b-stop');
const bCsv = document.getElementById('b-csv');
const bLog = document.getElementById('b-log');
const bResults = document.getElementById('b-results');
const bList = document.getElementById('b-list');

let stopRequested = false;
let bulkRows = [];

/**
 * Parses one business per line:
 *   Name, website.com, phone
 * The website and phone are optional and may appear in either order.
 */
function parseList(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) return null;

      const name = parts[0];
      let url = '';
      let phone = '';

      for (const part of parts.slice(1)) {
        if (/^\+?[\d][\d\s()+-]{6,}$/.test(part)) phone = part;
        else if (!url) url = part;
      }

      // A single token that looks like a domain is the website, not the name.
      if (parts.length === 1 && /\.[a-z]{2,}(\/|$)/i.test(name) && !name.includes(' ')) {
        url = name;
      }

      return { name, url, phone };
    })
    .filter(Boolean);
}

/** Turns an imported CSV or TXT file into the same line format. */
function fileToLines(text) {
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  if (rows.length === 0) return '';

  const looksLikeCsv = rows[0].includes(',');

  // Skip a header row such as "Business Name,Website,Phone".
  const start = looksLikeCsv && /name|business|company|site|url|website|phone/i.test(rows[0]) ? 1 : 0;

  return rows
    .slice(start)
    .map((line) => {
      const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      return cells.filter(Boolean).join(', ');
    })
    .join('\n');
}

document.getElementById('b-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const lines = fileToLines(text);
    bList.value = [bList.value.trim(), lines].filter(Boolean).join('\n');
    bLog.textContent = `Imported ${lines.split('\n').filter(Boolean).length} row(s) from ${file.name}.`;
  } catch {
    bLog.textContent = 'That file could not be read. Use a .csv or .txt file.';
  }
  event.target.value = '';
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

bulkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const sites = parseList(bList.value);

  if (sites.length === 0) {
    bLog.textContent = 'Paste at least one business.';
    return;
  }

  if (sites.length > MAX_BULK) {
    bLog.innerHTML = `<span style="color:#ff8a3d">That is ${sites.length} businesses. `
      + `Keep it to ${MAX_BULK} per run so you stay a polite visitor and the page stays responsive — `
      + `split the list and run it in batches.</span>`;
    return;
  }

  stopRequested = false;
  bulkRows = [];
  bResults.innerHTML = '';
  bSubmit.disabled = true;
  bStop.style.display = 'inline-flex';
  bCsv.style.display = 'none';

  const save = document.getElementById('b-save').checked;
  const done = [];
  const estimate = Math.max(1, Math.round((sites.length * 3.2) / 60));

  for (let i = 0; i < sites.length; i++) {
    if (stopRequested) break;
    const site = sites[i];
    bLog.textContent = `Auditing ${i + 1} of ${sites.length} (~${estimate} min total): ${site.name}…`;

    try {
      const report = await requestAudit({ ...site, save });
      // Precompute the outreach link so the button stays a plain, reliable anchor.
      report.outreachUrl = await chatLink(report, site.phone, BRAND);
      done.push(report);
      bLog.textContent = `Audited ${i + 1} of ${sites.length}: ${site.name} — ${report.score}/100`;
    } catch (err) {
      bLog.textContent = `Failed: ${site.name} (${err.message})`;
    }

    bulkRows = [...done].sort((a, b) => a.score - b.score);
    renderBulkResults(bulkRows);

    // Be a polite guest on other people's servers.
    if (i < sites.length - 1) await sleep(1200);
  }

  bSubmit.disabled = false;
  bStop.style.display = 'none';
  if (bulkRows.length) bCsv.style.display = 'inline-flex';
  bLog.textContent += `\n\nFinished. ${bulkRows.length} report(s) ready, worst score first.`;
});

bStop.addEventListener('click', () => {
  stopRequested = true;
});

bCsv.addEventListener('click', () => {
  const header = ['name', 'url', 'score', 'grade', 'band', 'critical', 'high', 'topIssue', 'topFix'];
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = bulkRows.map((r) => [
    r.business.name, r.site.finalUrl || r.business.url || 'no website', r.score, r.grade, r.band,
    r.counts.critical, r.counts.high,
    r.topFixes[0] ? r.topFixes[0].title : '',
    r.topFixes[0] ? r.topFixes[0].fix : '',
  ].map(esc).join(','));

  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'audit-leads.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

function renderBulkResults(rows) {
  bResults.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Score</th><th>Business</th><th>Biggest issue</th><th>Reach them</th></tr>
        </thead>
        <tbody>
          ${rows.map((r) => {
            const color = scoreColor(r.score);
            const top = r.topFixes[0];
            return `
              <tr>
                <td class="score-cell" style="color:${color}">
                  ${r.score}<div class="badge ${r.score >= 70 ? 'good' : r.score >= 50 ? 'medium' : 'critical'}" style="margin-top:5px;">${escapeHtml(r.band)}</div>
                </td>
                <td>
                  <b>${escapeHtml(r.business.name)}</b>
                  <div style="font-size:12.5px;color:#9aa6c8;">${escapeHtml(r.site.finalUrl || r.business.url || 'No website')}</div>
                </td>
                <td>
                  ${top ? `<span class="badge ${top.severity}">${severityLabel(top.severity)}</span><div style="font-size:13px;margin-top:5px;">${escapeHtml(top.title)}</div>` : '<span class="badge good">Clean</span>'}
                </td>
                <td>
                  <div class="actions">
                    <button class="ghost" type="button" data-open="${rows.indexOf(r)}" style="padding:6px 12px;font-size:13px;">Open report</button>
                    <a class="ghost" style="padding:6px 12px;font-size:13px;" target="_blank" rel="noopener"
                       href="${escapeHtml(r.outreachUrl || '#')}">WhatsApp them</a>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  bResults.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = bulkRows[Number(btn.dataset.open)];
      if (r) openReport(r);
    });
  });
}

/* ------------------------------------------------------------------ *
 * Lead list — track who you have contacted and who converted
 * ------------------------------------------------------------------ */

const STATUS_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  replied: 'Replied',
  won: 'Won',
  lost: 'Lost',
};

const STATUS_CLASSES = {
  new: 'low',
  contacted: 'medium',
  replied: 'high',
  won: 'good',
  lost: 'neutral',
};

let allLeads = [];
let leadSearch = '';

async function loadLeads() {
  const body = document.getElementById('l-body');
  const countEl = document.getElementById('leadCount');
  body.innerHTML = '<p class="hint">Loading…</p>';

  try {
    const res = await fetch('/api/leads');
    const data = await res.json();
    allLeads = data.leads || [];
    countEl.textContent = allLeads.length ? `(${allLeads.length})` : '';
    renderLeads(data);
  } catch {
    body.innerHTML = '<p class="note bad">Could not load the lead list.</p>';
  }
}

function renderLeads(meta = {}) {
  const body = document.getElementById('l-body');

  if (allLeads.length === 0) {
    body.innerHTML = `
      ${meta.persistent === false ? '<div class="note warn">Lead storage needs a local disk, so nothing is saved on this host.</div>' : ''}
      <p class="hint">No leads saved yet. Run an audit with "Add this business to my lead list" ticked.</p>`;
    return;
  }

  const term = leadSearch.trim().toLowerCase();
  const visible = term
    ? allLeads.filter((l) => [l.name, l.url, l.phone, l.whatsapp, l.instagram, l.notes, l.topIssue]
      .filter(Boolean).join(' ').toLowerCase().includes(term))
    : allLeads;

  const counts = Object.keys(STATUS_LABELS)
    .map((s) => ({ s, n: allLeads.filter((l) => (l.status || 'new') === s).length }))
    .filter((c) => c.n > 0);

  body.innerHTML = `
    ${meta.persistent === false ? '<div class="note warn">Lead storage needs a local disk, so nothing is saved on this host.</div>' : ''}

    <div class="actions" style="margin-bottom:14px;">
      <input type="search" id="l-search" placeholder="Search name, phone, note…" value="${escapeHtml(leadSearch)}"
             style="flex:1;min-width:200px;padding:10px 13px;border-radius:10px;background:#0e1428;border:1px solid var(--line);color:var(--text);font-family:inherit;font-size:14px;">
    </div>

    <div class="actions" style="margin-bottom:14px;">
      ${counts.map((c) => `<span class="badge ${STATUS_CLASSES[c.s]}">${STATUS_LABELS[c.s]} ${c.n}</span>`).join('')}
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Score</th><th>Business</th><th>Contact</th><th>Biggest issue</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${visible.map((l) => `
            <tr>
              <td class="score-cell" style="color:${scoreColor(l.score)}">${l.score}</td>
              <td>
                <b>${escapeHtml(l.name || '—')}</b>
                <div style="font-size:12.5px;color:#9aa6c8;">${escapeHtml(l.url || 'no website')}</div>
                <input type="text" data-note-input="${escapeHtml(l.id)}" placeholder="Add a note…"
                       value="${escapeHtml(l.notes || '')}"
                       style="margin-top:6px;width:100%;padding:5px 9px;border-radius:7px;background:#0e1428;border:1px solid var(--line);color:#c3cbe6;font-family:inherit;font-size:12.5px;">
              </td>
              <td style="font-size:13px;">${escapeHtml(l.phone || l.whatsapp || l.instagram || '—')}</td>
              <td style="font-size:13px;">${escapeHtml(l.topIssue || '—')}</td>
              <td>
                <select data-lead-status="${escapeHtml(l.id)}"
                        style="padding:6px 9px;border-radius:8px;background:#0e1428;border:1px solid var(--line);color:var(--text);font-family:inherit;font-size:13px;">
                  ${Object.entries(STATUS_LABELS).map(([value, label]) =>
                    `<option value="${value}" ${(l.status || 'new') === value ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
              </td>
              <td>
                <div class="actions" style="flex-wrap:nowrap;">
                  <button class="ghost" type="button" data-reaudit="${escapeHtml(l.id)}" style="padding:6px 11px;font-size:12.5px;">Re-audit</button>
                  <button class="ghost" type="button" data-delete="${escapeHtml(l.id)}" style="padding:6px 11px;font-size:12.5px;">Delete</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${visible.length === 0 ? '<p class="hint">No leads match that search.</p>' : ''}`;

  const search = document.getElementById('l-search');
  search.addEventListener('input', () => {
    leadSearch = search.value;
    const pos = search.selectionStart;
    renderLeads(meta);
    const next = document.getElementById('l-search');
    next.focus();
    next.setSelectionRange(pos, pos);
  });

  body.querySelectorAll('[data-lead-status]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await fetch(`/api/leads/${sel.dataset.leadStatus}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: sel.value }),
        });
        const lead = allLeads.find((l) => l.id === sel.dataset.leadStatus);
        if (lead) lead.status = sel.value;
        renderLeads(meta);
      } catch {
        sel.value = 'new';
      }
    });
  });

  body.querySelectorAll('[data-note-input]').forEach((input) => {
    input.addEventListener('change', async () => {
      const lead = allLeads.find((l) => l.id === input.dataset.noteInput);
      if (!lead || (lead.notes || '') === input.value) return;
      const value = input.value.slice(0, 2000);
      await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: value }),
      });
      lead.notes = value;
      input.blur();
    });
  });

  body.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lead = allLeads.find((l) => l.id === btn.dataset.delete);
      if (!lead) return;

      // Two-step instead of a confirm dialog, so nothing depends on browser modals.
      if (btn.dataset.armed !== 'yes') {
        btn.dataset.armed = 'yes';
        btn.textContent = 'Tap again to delete';
        setTimeout(() => {
          if (document.body.contains(btn)) {
            btn.dataset.armed = 'no';
            btn.textContent = 'Delete';
          }
        }, 5000);
        return;
      }

      await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' });
      allLeads = allLeads.filter((l) => l.id !== lead.id);
      document.getElementById('leadCount').textContent = allLeads.length ? `(${allLeads.length})` : '';
      renderLeads(meta);
    });
  });

  body.querySelectorAll('[data-reaudit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lead = allLeads.find((l) => l.id === btn.dataset.reaudit);
      btn.disabled = true;
      btn.textContent = 'Running…';
      try {
        const report = await requestAudit({
          name: lead.name, url: lead.url, phone: lead.phone,
          instagram: lead.instagram, notes: lead.notes, save: true,
        });
        openReport(report);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Retry re-audit';
        btn.title = `Could not re-audit: ${err.message}`;
        console.error('re-audit failed', err);
      }
    });
  });
}

document.getElementById('l-refresh').addEventListener('click', loadLeads);
