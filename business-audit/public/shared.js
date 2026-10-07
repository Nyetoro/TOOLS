'use strict';

/* Shared helpers for the audit pages. Loaded by index.html and report.html.
   Everything is wrapped so the only global this file creates is window.AuditUI. */
(function () {
  const PLAIN = '0';
  const DEFLATED = '1';

  const SCORE_COLORS = [
    { min: 85, color: '#2fd18b' },
    { min: 70, color: '#8bcf3f' },
    { min: 50, color: '#f5c542' },
    { min: 30, color: '#ff8a3d' },
    { min: 0, color: '#ff4d5e' },
  ];

  function scoreColor(score) {
    return SCORE_COLORS.find((s) => score >= s.min).color;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toBase64Url(bytes) {
    let binary = '';
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }

  /**
   * A full report is ~16 KB of JSON, which becomes a ~22 KB URL if encoded raw —
   * too long to survive being pasted into WhatsApp. Deflating first brings it to
   * roughly 4 KB. Browsers without CompressionStream fall back to plain base64,
   * which still works, just with an unwieldy link.
   */
  async function encodeReport(report) {
    const bytes = new TextEncoder().encode(JSON.stringify(report));

    if (typeof CompressionStream === 'function') {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const packed = new Uint8Array(await new Response(stream).arrayBuffer());
        return DEFLATED + toBase64Url(packed);
      } catch {
        /* fall through to plain encoding */
      }
    }
    return PLAIN + toBase64Url(bytes);
  }

  async function decodeReport(encoded) {
    const prefix = encoded[0];

    if (prefix !== PLAIN && prefix !== DEFLATED) {
      // Link produced before compression was introduced.
      return JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    }

    const bytes = fromBase64Url(encoded.slice(1));

    if (prefix === DEFLATED) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function shareUrl(report, publicUrl) {
    const base = publicUrl
      ? `${String(publicUrl).replace(/\/+$/, '')}/report.html`
      : location.origin + location.pathname.replace(/[^/]*$/, 'report.html');
    return `${base}#r=${await encodeReport(report)}`;
  }

  /**
   * True when the report lives on localhost, which means the link you are about
   * to send a client opens nothing on their device. This is the single easiest
   * way to lose a lead, so the report page warns loudly about it.
   */
  function linkIsLocalOnly(publicUrl) {
    if (publicUrl) return false;
    return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(location.hostname);
  }

  function openerText(report, brand) {
    return String(brand.opener || '')
      .replace(/\{name\}/g, report.business.name || 'there')
      .replace(/\{score\}/g, report.score);
  }

  /**
   * Chat link aimed at a specific number. Pass the prospect's number to reach out,
   * or `brand.whatsapp` to give the prospect a way to reach you.
   * With no number, WhatsApp opens its own contact picker.
   */
  async function chatLink(report, targetPhone, brand = {}) {
    const digits = String(targetPhone || '').replace(/\D/g, '');
    const body = `${openerText(report, brand)}\n\n${await shareUrl(report, brand.publicUrl)}`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
  }

  /** Link to the person running this tool, for the report's call-to-action. */
  function ownerChatLink(report, brand = {}) {
    const digits = String(brand.whatsapp || '').replace(/\D/g, '');
    const body = `Hello ${brand.owner || brand.businessName || 'there'}, I saw the report for ${report.business.name || 'my business'} and I would like to talk about fixing it.`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
  }

  function severityLabel(sev) {
    return { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }[sev] || 'Info';
  }

  window.AuditUI = {
    scoreColor, escapeHtml, encodeReport, decodeReport, shareUrl, linkIsLocalOnly,
    chatLink, ownerChatLink, severityLabel,
  };
})();
