'use strict';

const { scoreColor, escapeHtml, decodeReport, shareUrl, chatLink, ownerChatLink, severityLabel, linkIsLocalOnly } = window.AuditUI;

/* ------------------------------------------------------------------ *
 * Report rendering
 * ------------------------------------------------------------------ */

const BRAND = window.AUDIT_BRAND || {};

function applyBrand() {
  const name = BRAND.businessName || 'Website Audit';
  document.getElementById('brandName').textContent = name;
  document.getElementById('brandTagline').textContent = BRAND.tagline || '';
  document.getElementById('brandDot').textContent = (name.trim()[0] || 'A').toUpperCase();
  document.title = `Website Audit Report — ${name}`;
}

function gaugeSvg(score) {
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;
  const color = scoreColor(score);
  return `
    <div class="gauge">
      <svg width="152" height="152" viewBox="0 0 152 152">
        <circle cx="76" cy="76" r="${radius}" fill="none" stroke="#26314f" stroke-width="13"></circle>
        <circle cx="76" cy="76" r="${radius}" fill="none" stroke="${color}" stroke-width="13"
          stroke-linecap="round" stroke-dasharray="${filled} ${circumference}"></circle>
      </svg>
      <div class="value">
        <b style="color:${color}">${score}</b>
        <small>out of 100</small>
      </div>
    </div>`;
}

function categoryBars(report) {
  return report.categories
    .filter((c) => c.score !== null)
    .map((c) => {
      const color = scoreColor(c.score);
      return `
        <div class="cat">
          <div class="cat-head"><b>${escapeHtml(c.label)}</b><span style="color:${color}">${c.score}%</span></div>
          <div class="bar"><span style="width:${c.score}%;background:${color}"></span></div>
        </div>`;
    })
    .join('');
}

function issueCard(issue) {
  return `
    <div class="issue ${issue.severity || 'low'}">
      <div class="issue-head">
        <b>${escapeHtml(issue.title)}</b>
        <span class="badge ${issue.severity || 'low'}">${severityLabel(issue.severity)}</span>
      </div>
      <p>${escapeHtml(issue.detail)}</p>
      ${issue.fix ? `<div class="fix"><b>Fix:</b> ${escapeHtml(issue.fix)}</div>` : ''}
      <p style="font-size:12.5px;color:#8e9bc0;margin-top:6px;">${escapeHtml(issue.categoryLabel || '')}</p>
    </div>`;
}

function contactBlock(report) {
  const wa = ownerChatLink(report, BRAND);
  const lines = [];
  if (BRAND.phone) lines.push(`<div>📞 <a href="tel:${escapeHtml(BRAND.phone.replace(/\s/g, ''))}">${escapeHtml(BRAND.phone)}</a></div>`);
  if (BRAND.email) lines.push(`<div>✉️ <a href="mailto:${escapeHtml(BRAND.email)}">${escapeHtml(BRAND.email)}</a></div>`);
  if (BRAND.website) lines.push(`<div>🌐 <a href="${escapeHtml(BRAND.website)}">${escapeHtml(BRAND.website)}</a></div>`);
  if (BRAND.location) lines.push(`<div>📍 ${escapeHtml(BRAND.location)}</div>`);

  return `
    <div class="cta-block">
      <h2 style="margin-bottom:8px;">Want these fixed?</h2>
      <p style="margin:0 0 16px;color:#c3cbe6;">
        ${escapeHtml(BRAND.offer || 'Get in touch for a free consultation and a fixed-price quote.')}
      </p>
      <div style="display:grid;gap:7px;margin-bottom:18px;font-size:15px;">${lines.join('')}</div>
      <div class="actions no-print">
        <a class="button" href="${escapeHtml(wa)}" target="_blank" rel="noopener">Chat on WhatsApp</a>
      </div>
      <p style="font-size:13px;color:#9aa6c8;margin:14px 0 0;">
        ${escapeHtml(BRAND.businessName || '')}${BRAND.owner ? ` · ${escapeHtml(BRAND.owner)}` : ''}
      </p>
    </div>`;
}

function render(report) {
  const hasSite = report.site.hadUrl !== false && report.site.reachable !== false;
  const counts = report.counts;
  const critical = report.issues.filter((i) => i.severity === 'critical');
  const high = report.issues.filter((i) => i.severity === 'high');
  const rest = report.issues.filter((i) => i.severity === 'medium' || i.severity === 'low');

  const generated = new Date(report.generatedAt);
  const siteLine = report.site.finalUrl
    ? `<a href="${escapeHtml(report.site.finalUrl)}" target="_blank" rel="noopener">${escapeHtml(report.site.finalUrl)}</a>`
    : report.business.url
      ? escapeHtml(report.business.url)
      : 'No website';

  document.getElementById('app').innerHTML = `
    ${linkIsLocalOnly(BRAND.publicUrl) ? `
      <div class="note bad no-print">
        <b>This link only works on this computer.</b> It points at <code>localhost</code>, so a client
        who opens it on their phone sees nothing.<br>
        Deploy the tool (see the README) then put the address in <code>config.js</code> as
        <code>publicUrl</code>, or use <b>Save as PDF</b> and send the file instead.
      </div>` : ''}

    <h1>Digital presence report</h1>
    <p class="lede">
      ${escapeHtml(report.business.name || 'This business')} — audited ${generated.toLocaleDateString()} at
      ${generated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.<br>
      ${siteLine}
    </p>

    <div class="card">
      <div class="score-hero">
        ${gaugeSvg(report.score)}
        <div style="flex:1;min-width:240px;">
          <div class="badge ${critical.length ? 'critical' : report.score >= 70 ? 'good' : 'medium'}" style="margin-bottom:10px;">
            ${escapeHtml(report.band)}
          </div>
          <h2 style="margin-bottom:6px;">${report.score >= 70 ? 'Solid foundation' : 'Clear room to grow'}</h2>
          <p style="margin:0;color:#c3cbe6;">${escapeHtml(report.verdict)}</p>
          <p style="margin:12px 0 0;color:#9aa6c8;font-size:14px;">
            ${counts.pass} checks passed · ${counts.warn} warnings · ${counts.fail} failures
            ${counts.unknown ? `· ${counts.unknown} not verifiable` : ''}
          </p>
        </div>
      </div>

      <div class="grid stats" style="margin-top:22px;">
        <div class="card" style="box-shadow:none;padding:15px;">
          <div style="font-size:26px;font-weight:700;color:#ff4d5e;">${counts.critical}</div>
          <div style="font-size:13px;color:#9aa6c8;">Critical issues</div>
        </div>
        <div class="card" style="box-shadow:none;padding:15px;">
          <div style="font-size:26px;font-weight:700;color:#ff8a3d;">${counts.high}</div>
          <div style="font-size:13px;color:#9aa6c8;">High issues</div>
        </div>
        <div class="card" style="box-shadow:none;padding:15px;">
          <div style="font-size:26px;font-weight:700;color:#5b8cff;">${hasSite && report.site.totalMs ? `${report.site.totalMs} ms` : '—'}</div>
          <div style="font-size:13px;color:#9aa6c8;">Load time</div>
        </div>
        <div class="card" style="box-shadow:none;padding:15px;">
          <div style="font-size:26px;font-weight:700;color:#5b8cff;">${hasSite && report.site.bytes ? `${Math.round(report.site.bytes / 1024)} KB` : '—'}</div>
          <div style="font-size:13px;color:#9aa6c8;">Page size</div>
        </div>
      </div>
    </div>

    ${!report.site.hadUrl || report.site.reachable === false ? `
      <div class="note ${report.site.hadUrl ? 'bad' : 'warn'}">
        ${report.site.hadUrl
          ? 'The website could not be loaded, so only limited checks were possible. Confirm it in a browser before quoting.'
          : 'No website was provided for this business. The report below covers what an online presence should include.'}
      </div>` : ''}

    <div class="grid two" style="margin-top:18px;">
      <div class="card">
        <h2>Score by area</h2>
        ${categoryBars(report)}
      </div>
      <div class="card">
        <h2>Fix these first</h2>
        <ol style="padding-left:19px;margin:0;color:#c3cbe6;font-size:14.5px;">
          ${report.topFixes.map((f) => `
            <li style="margin-bottom:13px;">
              <b style="color:#eef2ff;">${escapeHtml(f.title)}</b>
              <span class="badge ${f.severity || 'low'}" style="margin-left:6px;">${severityLabel(f.severity)}</span>
              <div style="margin-top:5px;">${escapeHtml(f.fix)}</div>
            </li>`).join('')}
        </ol>
      </div>
    </div>

    <div class="card" style="margin-top:18px;">
      <h2>Everything found (${report.issues.length})</h2>
      ${critical.length ? `<h3 style="margin:16px 0 9px;color:#ff4d5e;">Critical — losing customers today</h3>${critical.map(issueCard).join('')}` : ''}
      ${high.length ? `<h3 style="margin:20px 0 9px;color:#ff8a3d;">High priority</h3>${high.map(issueCard).join('')}` : ''}
      ${rest.length ? `<h3 style="margin:20px 0 9px;color:#9aa6c8;">Worth fixing</h3>${rest.map(issueCard).join('')}` : ''}
      ${report.issues.length === 0 ? '<p class="note good">No problems detected. This site is in excellent shape.</p>' : ''}
    </div>

    <div class="card" style="margin-top:18px;">
      <h2>Full check log</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Result</th><th>Check</th><th>Area</th></tr></thead>
          <tbody>
            ${report.checks.map((c) => `
              <tr>
                <td><span class="badge ${c.status === 'pass' ? 'good' : c.status === 'warn' ? 'medium' : c.status === 'fail' ? 'critical' : 'neutral'}">${c.status}</span></td>
                <td>${escapeHtml(c.title)}</td>
                <td style="color:#9aa6c8;">${escapeHtml(c.categoryLabel)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    ${contactBlock(report)}`;

  document.getElementById('reportFooter').innerHTML =
    `Generated automatically from publicly available page markup on ${generated.toLocaleString()}. ` +
    `Automated checks may miss content rendered by JavaScript or blocked by the server — confirm anything important on the live site.`;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function loadReport() {
  const hash = location.hash || '';
  const match = hash.match(/^#r=(.+)$/);
  if (match) {
    try {
      return await decodeReport(match[1]);
    } catch {
      return null;
    }
  }
  try {
    const stored = sessionStorage.getItem('lastReport');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

async function boot() {
  applyBrand();
  const report = await loadReport();

  if (!report) {
    document.getElementById('app').innerHTML = `
      <div class="note bad">
        No report data was found in this link. Open a report from the audit page, or paste a share link
        that includes the full report.
      </div>
      <p><a class="button" href="index.html">Run a new audit</a></p>`;
    return;
  }

  if (location.hash) sessionStorage.setItem('lastReport', JSON.stringify(report));
  render(report);

  // Build the links up front so the click handlers stay synchronous and the
  // browser still treats them as user-initiated (no popup blocking).
  const link = await shareUrl(report, BRAND.publicUrl);
  const waUrl = await chatLink(report, report.business.whatsapp || report.business.phone, BRAND);

  document.getElementById('copyLink').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(link);
      e.target.textContent = 'Copied!';
    } catch {
      window.prompt('Copy this share link:', link);
    }
    setTimeout(() => {
      e.target.textContent = 'Copy share link';
    }, 1800);
  });

  document.getElementById('waSend').addEventListener('click', () => {
    window.open(waUrl, '_blank', 'noopener');
  });

  document.getElementById('printBtn').addEventListener('click', () => window.print());

  document.getElementById('jsonBtn').addEventListener('click', () => {
    const safeName = (report.business.name || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit-${safeName}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

boot().catch((err) => {
  document.getElementById('app').innerHTML = `
    <div class="note bad">This report link could not be read (${escapeHtml(err.message)}).
    Ask for it to be sent again, or run a new audit.</div>
    <p><a class="button" href="index.html">Run a new audit</a></p>`;
});
