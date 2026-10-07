'use strict';

const { fetchPage, fetchAsset, normalizeUrl } = require('./fetch-page');

const CATEGORIES = {
  reach: 'Reachability & Trust',
  mobile: 'Mobile Experience',
  find: 'Findability & SEO',
  contact: 'Contactability',
  convert: 'Conversion',
  quality: 'Content Quality',
};

const CURRENT_YEAR = new Date().getFullYear();

/* ------------------------------------------------------------------ *
 * Signal detection
 * ------------------------------------------------------------------ */

const stripTags = (html) => String(html || '').replace(/<[^>]*>/g, ' ');
const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function attr(html, pattern) {
  const m = html.match(pattern);
  return m ? m[1] : null;
}

function hasMeaningfulAlt(tag) {
  const m = tag.match(/\balt\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!m) return false;
  const value = collapse(m[2] ?? m[3] ?? '');
  return value.length > 0;
}

/** Collects third-party proof from an optional Instagram/Facebook handle. */
function normalizeHandle(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const urlMatch = raw.match(/(?:instagram\.com|facebook\.com|fb\.com)\/([A-Za-z0-9._-]+)/i);
  return urlMatch ? urlMatch[1] : raw.replace(/^@/, '');
}

/* ------------------------------------------------------------------ *
 * Check construction
 * ------------------------------------------------------------------ */

function makeCheck(id, category, weight, status, title, detail, fix) {
  return { id, category, categoryLabel: CATEGORIES[category], weight, status, title, detail, fix };
}

function severityFor(check) {
  const { status, weight } = check;
  if (status === 'fail') return weight >= 8 ? 'critical' : weight >= 4 ? 'high' : 'medium';
  if (status === 'warn') return weight >= 5 ? 'medium' : 'low';
  return null;
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_WEIGHT_FOR_IMPACT = { critical: 4, high: 3, medium: 2, low: 1 };

function scoreOf(checks) {
  let earned = 0;
  let possible = 0;
  for (const c of checks) {
    if (c.status === 'unknown') continue;
    possible += c.weight;
    if (c.status === 'pass') earned += c.weight;
    else if (c.status === 'warn') earned += c.weight * 0.5;
  }
  return possible === 0 ? 0 : Math.round((earned / possible) * 100);
}

function gradeFor(score) {
  if (score >= 85) return { grade: 'A', band: 'Strong' };
  if (score >= 70) return { grade: 'B', band: 'Decent' };
  if (score >= 50) return { grade: 'C', band: 'Losing customers' };
  if (score >= 30) return { grade: 'D', band: 'Costing you business' };
  return { grade: 'F', band: 'Bleeding customers' };
}

function verdictFor(score, band) {
  if (score >= 85) return `This site is in ${band.toLowerCase()} shape. Only small refinements are needed.`;
  if (score >= 70) return `This site is ${band.toLowerCase()}, but there are clear gaps costing real enquiries.`;
  if (score >= 50) return `This site is ${band.toLowerCase()} every day. Fixing the items below is where the money is.`;
  if (score >= 30) return `This site is ${band.toLowerCase()}. Most visitors leave before they can contact you.`;
  return `This site is ${band.toLowerCase()}. Treat the top fixes below as urgent.`;
}

/* ------------------------------------------------------------------ *
 * The two audit paths
 * ------------------------------------------------------------------ */

function noWebsiteAudit(business) {
  const label = business.name || 'This business';
  const checks = [
    makeCheck('no-site', 'reach', 20, 'fail', 'No website could be found',
      `${label} has no working website at the address provided, so customers searching online hit a dead end.`,
      'Publish a simple one-page site: what you do, proof, location, a way to contact you.'),
    makeCheck('no-site-trust', 'reach', 10, 'fail', 'Nothing verifies the business online',
      'With no site, buyers cannot check legitimacy before paying — the biggest barrier for new customers.',
      'A live site with real photos, location and reviews is the fastest way to build trust.'),
    makeCheck('no-site-search', 'find', 12, 'fail', 'Invisible in search results',
      'Google has no page of yours to rank, so competitors take every "near me" search.',
      'Claim your Google Business Profile today, then add a website that backs it up.'),
    makeCheck('no-site-contact', 'contact', 14, 'fail', 'No single place to send customers',
      'Every enquiry depends on someone already having your number saved.',
      'One link you can drop in WhatsApp, Instagram bio and status: site + WhatsApp button.'),
    makeCheck('no-site-convert', 'convert', 8, 'fail', 'No way to order, book or buy online',
      'Customers who want to act at 11pm cannot, and they will not remember to come back.',
      'Add an order/enquiry form and a WhatsApp click-to-chat button.'),
    makeCheck('no-site-quality', 'quality', 6, 'fail', 'No content to be found from searches',
      'Prices, services, opening hours and directions are not published anywhere indexed.',
      'Publish services + prices + hours. These are the exact things customers search for.'),
  ];

  return finalizeAudit({ business, site: { reachable: false, hadUrl: false }, checks });
}

/* ------------------------------------------------------------------ */

async function auditWebsite(business, siteInput, options = {}) {
  const page = await fetchPage(siteInput, { timeoutMs: options.timeoutMs ?? 15_000 });

  if (!page.ok) {
    const reason =
      page.error === 'timeout'
        ? 'the server did not respond in time'
        : page.error === 'ENOTFOUND'
          ? 'the domain name does not resolve'
          : page.error === 'ECONNREFUSED'
            ? 'the server refused the connection'
            : page.error === 'too-many-redirects'
              ? 'the site is stuck in a redirect loop'
              : `the request failed (${page.error})`;

    const checks = [
      makeCheck('site-reachable', 'reach', 12, 'fail', 'Website is unreachable',
        `We tried to load the site and ${reason}. Any visitor doing the same sees an error page.`,
        'Restore the hosting or move to reliable hosting. A dead site is worse than no site.'),
      makeCheck('https', 'reach', 6, 'unknown', 'Security (HTTPS) could not be checked',
        'We could not load the page, so encryption status is unknown.',
        'Once the site is back online, confirm it loads on https:// with a valid certificate.'),
      makeCheck('phone', 'contact', 8, 'unknown', 'Phone number not verifiable',
        'The page could not be read, so we cannot confirm a clickable phone number.',
        'Put a tap-to-call number in the header of every page.'),
      makeCheck('whatsapp', 'contact', 8, 'unknown', 'WhatsApp button not verifiable',
        'The page could not be read, so we cannot confirm a WhatsApp link.',
        'Add a click-to-chat WhatsApp button — it is the highest-converting contact method.'),
      makeCheck('meta-description', 'find', 4, 'unknown', 'Search snippet not verifiable',
        'The page could not be read, so we cannot check your Google description.',
        'Write a 150-character description covering service, city and a reason to click.'),
    ];

    return finalizeAudit({
      business,
      site: { reachable: false, hadUrl: true, error: page.error, requestedUrl: siteInput, redirects: page.redirects },
      checks,
    });
  }

  const html = page.body || '';
  const finalUrl = page.finalUrl;
  const head = html.slice(0, 120_000);
  const body = html.slice(0, 600_000);
  const text = collapse(stripTags(body));
  const lowerHtml = body.toLowerCase();
  const origin = new URL(finalUrl).origin;

  const checks = [];

  /* ---------------- Reachability & trust ---------------- */

  const status = page.status;
  const statusOk = status >= 200 && status < 300;
  checks.push(makeCheck('site-reachable', 'reach', 12, statusOk ? 'pass' : 'fail',
    statusOk ? 'Website loads normally' : `Website returns a ${status} error`,
    statusOk
      ? `The page responded with HTTP ${status} in ${page.totalMs} ms.`
      : `The server returned HTTP ${status}. Visitors see an error, not your business.`,
    statusOk ? 'No action needed.' : 'Fix the server error before spending on anything else.'));

  const isHttps = finalUrl.startsWith('https://');
  checks.push(makeCheck('https', 'reach', 6, isHttps ? 'pass' : 'fail',
    isHttps ? 'Secure connection (HTTPS)' : 'Site is not secure (no HTTPS)',
    isHttps
      ? 'The site loads over an encrypted connection.'
      : 'The site loads over plain HTTP. Chrome and WhatsApp label it "Not secure".',
    isHttps ? 'No action needed.' : 'Install a free SSL certificate and force HTTPS on every page.'));

  if (page.startUrl && page.startUrl.startsWith('http://')) {
    const upgraded = page.redirectedToHttps;
    checks.push(makeCheck('https-redirect', 'reach', 2, upgraded ? 'pass' : 'warn',
      upgraded ? 'Old HTTP links upgrade to HTTPS' : 'Typed "http://" does not upgrade to HTTPS',
      upgraded
        ? 'Visitors entering the site without a protocol are upgraded automatically.'
        : 'People typing the plain address can land on an insecure copy of the site.',
      upgraded ? 'No action needed.' : 'Add a permanent redirect from http:// to https://.'));
  }

  if (page.redirects.length > 0) {
    checks.push(makeCheck('redirect-chain', 'reach', 2, 'warn',
      `Site goes through ${page.redirects.length} redirect${page.redirects.length > 1 ? 's' : ''} before loading`,
      `Chain: ${page.redirects.map((r) => r.to).join(' -> ')}. Each hop adds delay on slow mobile networks.`,
      'Point links directly at the final address.'));
  }

  /* ---------------- Mobile experience ---------------- */

  const viewportMatch = head.match(/<meta[^>]+name\s*=\s*["']viewport["'][^>]*>/i);
  const viewportContent = viewportMatch ? collapse(attr(viewportMatch[0], /content\s*=\s*["']([^"']*)["']/i) || '') : null;
  const hasViewportTag = Boolean(viewportMatch);
  const hasDeviceWidth = /width\s*=\s*device-width/i.test(viewportContent || '');
  const viewportOk = hasViewportTag && hasDeviceWidth;

  checks.push(makeCheck('viewport', 'mobile', 10, viewportOk ? 'pass' : 'fail',
    viewportOk
      ? 'Scales correctly on phones'
      : hasViewportTag
        ? 'Mobile viewport is incomplete'
        : 'Not configured for mobile screens',
    viewportOk
      ? 'The viewport tag sets width=device-width, so the layout matches the phone screen.'
      : hasViewportTag
        ? `A viewport tag exists but omits width=device-width (found: "${viewportContent}"). Phones therefore render the desktop width scaled down, so text needs pinch-zoom to read.`
        : 'There is no mobile viewport tag, so phones render the desktop layout shrunk down — text is unreadable without pinch-zoom.',
    viewportOk ? 'No action needed.' : 'Set <meta name="viewport" content="width=device-width, initial-scale=1">.'));

  const stylesheetHrefs = [];
  const linkTagRe = /<link\b[^>]*>/gi;
  let linkMatch;
  while ((linkMatch = linkTagRe.exec(head)) !== null) {
    const tag = linkMatch[0];
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) continue;
    const href = attr(tag, /\bhref\s*=\s*["']([^"']+)["']/i);
    if (!href) continue;
    try {
      const abs = new URL(href, finalUrl);
      if (abs.origin === origin) stylesheetHrefs.push(abs.href);
    } catch {
      /* ignore malformed hrefs */
    }
  }

  const inlineStyle = [...body.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  let responsiveEvidence = /@media/i.test(inlineStyle);
  let cssChecked = responsiveEvidence;
  let cssUnreadable = false;

  if (!responsiveEvidence) {
    const toTry = stylesheetHrefs.slice(0, 3);
    for (const href of toTry) {
      const css = await fetchAsset(href, { maxBytes: 400_000, timeoutMs: 8000 });
      if (css.ok && css.body) {
        cssChecked = true;
        if (/@media/i.test(css.body)) {
          responsiveEvidence = true;
          break;
        }
      } else if (!css.ok) {
        cssUnreadable = true;
      }
    }
  }

  if (stylesheetHrefs.length === 0 && !inlineStyle) {
    checks.push(makeCheck('responsive-css', 'mobile', 8, 'unknown',
      'Could not evaluate responsive styling',
      'No stylesheets were found on the page, so layout behaviour could not be assessed.',
      'Confirm the site rearranges itself into a single column on a phone.'));
  } else {
    checks.push(makeCheck('responsive-css', 'mobile', 8,
      responsiveEvidence ? 'pass' : cssChecked || !cssUnreadable ? 'fail' : 'warn',
      responsiveEvidence ? 'Uses responsive layout rules' : 'No responsive layout rules detected',
      responsiveEvidence
        ? 'Media queries were found, so the design adapts across screen sizes.'
        : 'No media queries were found in the page or its stylesheets, which usually means one fixed layout for every screen.',
      responsiveEvidence ? 'No action needed.' : 'Switch the layout to a responsive grid so sections stack on phones.'));

    if (!responsiveEvidence && cssUnreadable) {
      checks.push(makeCheck('responsive-verify', 'mobile', 2, 'unknown',
        'Some stylesheets could not be downloaded',
        'Part of the styling is hosted elsewhere or blocked automated requests, so the check is partial.',
        'Open the site on a phone and confirm nothing overflows horizontally.'));
    }
  }

  /* ---------------- Findability & SEO ---------------- */

  const titleText = collapse(stripTags(attr(head, /<title[^>]*>([\s\S]*?)<\/title>/i) || ''));
  const titleOk = titleText.length >= 15 && titleText.length <= 65;
  checks.push(makeCheck('title', 'find', 5,
    !titleText ? 'fail' : titleOk ? 'pass' : 'warn',
    !titleText
      ? 'No page title'
      : titleOk
        ? 'Page title is well formed'
        : `Page title is ${titleText.length} characters (aim for 15-65)`,
    titleText
      ? `Title: "${titleText}". It is what appears as the blue link on Google.`
      : 'The browser tab and Google result show the raw address instead of a business name.',
    titleOk ? 'No action needed.' : 'Write a title like "Service + City | Business Name".'));

  const metaDesc = collapse(attr(head, /<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["']([^"']*)["']/i)
    || attr(head, /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+name\s*=\s*["']description["']/i) || '');
  checks.push(makeCheck('meta-description', 'find', 4,
    !metaDesc ? 'fail' : metaDesc.length >= 50 && metaDesc.length <= 160 ? 'pass' : 'warn',
    !metaDesc
      ? 'No Google description set'
      : metaDesc.length >= 50 && metaDesc.length <= 160
        ? 'Google description is well written'
        : `Google description is ${metaDesc.length} characters (aim for 50-160)`,
    metaDesc
      ? `Description: "${metaDesc}".`
      : 'Google writes its own snippet for you, which usually mentions prices or competitors instead of your strengths.',
    !metaDesc ? 'Add a meta description naming your service, city and a reason to click.' : 'Trim or expand it to fit the snippet.'));

  const h1s = [...head.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => collapse(stripTags(m[1]))).filter(Boolean);
  const h1sInBody = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => collapse(stripTags(m[1]))).filter(Boolean);
  const allH1 = h1s.length ? h1s : h1sInBody;
  checks.push(makeCheck('h1', 'find', 3, allH1.length ? 'pass' : 'fail',
    allH1.length ? 'Main heading present' : 'No main heading (H1)',
    allH1.length
      ? `Heading: "${allH1[0]}".`
      : 'Search engines use the H1 to understand what the page is about.',
    allH1.length ? 'No action needed.' : 'Add one clear H1 stating what you sell and where.'));

  const hasOg = /property\s*=\s*["']og:(title|description|image)["']/i.test(head);
  const hasOgImage = /property\s*=\s*["']og:image["']/i.test(head);
  checks.push(makeCheck('og-tags', 'find', 4, hasOg ? 'pass' : 'fail',
    hasOg ? 'Shares well in chats and social feeds' : 'Looks broken when shared on WhatsApp',
    hasOg
      ? `Social preview tags found${hasOgImage ? ', including an image' : ' (but no preview image)'}.`
      : 'When someone pastes your link into WhatsApp or Facebook, no image, title or description appears — it looks like spam.',
    hasOg ? (hasOgImage ? 'No action needed.' : 'Add an og:image so the preview shows a photo.') : 'Add og:title, og:description and og:image tags.'));

  const hasFavicon = /<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["']/i.test(head);
  checks.push(makeCheck('favicon', 'find', 2, hasFavicon ? 'pass' : 'warn',
    hasFavicon ? 'Has a browser icon' : 'No favicon set',
    hasFavicon
      ? 'A site icon is linked, so tabs and bookmarks look finished.'
      : 'Tabs and bookmarks show a generic icon, which reads as unfinished.',
    hasFavicon ? 'No action needed.' : 'Add a favicon and an apple-touch-icon.'));

  const lang = attr(head, /<html[^>]*\blang\s*=\s*["']([^"']+)["']/i);
  checks.push(makeCheck('lang', 'find', 1, lang ? 'pass' : 'warn',
    lang ? `Page language declared (${lang})` : 'Page language not declared',
    lang
      ? 'Assistive tech and translation tools know what language to use.'
      : 'Screen readers may guess the language and mispronounce your content.',
    lang ? 'No action needed.' : 'Add lang="en" (or your locale) to the <html> tag.'));

  const [robots, sitemap] = await Promise.all([
    fetchAsset(`${origin}/robots.txt`, { maxBytes: 60_000, timeoutMs: 8000 }),
    fetchAsset(`${origin}/sitemap.xml`, { maxBytes: 300_000, timeoutMs: 8000 }),
  ]);
  const robotsOk = robots.ok && robots.status === 200 && /(user-agent|disallow|allow|sitemap)/i.test(robots.body || '');
  const sitemapOk = sitemap.ok && sitemap.status === 200 && /<(urlset|sitemapindex)/i.test(sitemap.body || '');

  checks.push(makeCheck('robots', 'find', 2, robotsOk ? 'pass' : 'warn',
    robotsOk ? 'Search engines are guided by robots.txt' : 'No robots.txt file',
    robotsOk
      ? 'A crawl directive file exists, so indexing is under control.'
      : 'Without it, you have no control over what search engines crawl or ignore.',
    robotsOk ? 'No action needed.' : 'Add a robots.txt that points to your sitemap.'));

  checks.push(makeCheck('sitemap', 'find', 2, sitemapOk ? 'pass' : 'warn',
    sitemapOk ? 'XML sitemap found' : 'No XML sitemap found',
    sitemapOk
      ? 'A sitemap lists your pages so search engines can index them all.'
      : 'Search engines have to discover your pages by luck, so newer pages may never rank.',
    sitemapOk ? 'No action needed.' : 'Generate a sitemap.xml and submit it in Google Search Console.'));

  /* ---------------- Contactability ---------------- */

  const telLink = /href\s*=\s*["']tel:[^"']+["']/i.test(body) || /href\s*=\s*["']tel:[^"']+["']/i.test(head);
  const phoneRegex = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/;
  const phoneInText = phoneRegex.test(text) && (text.match(/\d/g) || []).length >= 7;
  const hasPhone = telLink || phoneInText;
  checks.push(makeCheck('phone', 'contact', 8, hasPhone ? (telLink ? 'pass' : 'warn') : 'fail',
    hasPhone
      ? telLink ? 'Tap-to-call phone number present' : 'A phone number is shown but not tappable'
      : 'No phone number found',
    hasPhone
      ? telLink
        ? 'A clickable tel: link was found, so a mobile visitor can call with one tap.'
        : 'A number appears on the page but is plain text, so mobile visitors must copy it manually and often give up.'
      : 'Visitors found no way to phone you from the site.',
    hasPhone && telLink ? 'No action needed.' : 'Show the number as a clickable tel: link in the header.'));

  const waLink = /(?:wa\.me\/|api\.whatsapp\.com|web\.whatsapp\.com|whatsapp:\/\/)/i.test(body);
  checks.push(makeCheck('whatsapp', 'contact', 8, waLink ? 'pass' : 'fail',
    waLink ? 'WhatsApp click-to-chat is wired up' : 'No WhatsApp click-to-chat link',
    waLink
      ? 'A WhatsApp link was found, so chat opens with one tap — the highest-converting contact route for local buyers.'
      : 'There is no one-tap chat button, so the most common way people prefer to contact a business is missing.',
    waLink ? 'No action needed.' : 'Add a floating "Chat on WhatsApp" button with a pre-filled message.'));

  const mailLink = /href\s*=\s*["']mailto:[^"']+["']/i.test(body);
  const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
  const hasEmail = mailLink || emailRegex;
  checks.push(makeCheck('email', 'contact', 4, hasEmail ? (mailLink ? 'pass' : 'warn') : 'fail',
    hasEmail
      ? mailLink ? 'Email address is clickable' : 'Email shown but not clickable'
      : 'No email address found',
    hasEmail ? 'An email contact route exists on the page.' : 'Businesses without an email fall back on phone only, losing after-hours enquiries.',
    hasEmail && mailLink ? 'No action needed.' : 'Add a mailto: link or a simple enquiry form.'));

  const mapEvidence = /(maps\.google|google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|<iframe[^>]*(?:map|location))/i.test(body);
  const addressWords = /(visit us|find us|our (?:office|address|location)|address\s*:|\b(?:suite|plot|no\.|street|road|avenue|close|lane|estate|plaza|mall)\b)/i.test(text);
  const hasLocation = mapEvidence || addressWords;
  checks.push(makeCheck('location', 'contact', 5, hasLocation ? (mapEvidence ? 'pass' : 'warn') : 'fail',
    mapEvidence
      ? 'Map and location are embedded'
      : hasLocation
        ? 'Address in text only, no map'
        : 'No address or map found',
    mapEvidence
      ? 'An embedded map removes the friction for first-time walk-in customers.'
      : hasLocation
        ? 'The address is written out but not map-linked, so people must copy it into a maps app.'
        : 'Customers cannot tell where the business is, which stops walk-ins and delivery orders.',
    mapEvidence ? 'No action needed.' : 'Embed a Google Map and link the address for directions.'));

  const hasForm = /<form\b[^>]*>/i.test(body);
  const hasContactLink = /href\s*=\s*["'][^"']*(contact|enquir|inquir|booking|book|appointment)[^"']*["']/i.test(body);
  const hasContactRoute = hasForm || hasContactLink || waLink;
  checks.push(makeCheck('contact-route', 'contact', 4, hasContactRoute ? 'pass' : 'fail',
    hasContactRoute ? 'A clear way to make contact exists' : 'No contact form, booking page or contact link',
    hasContactRoute
      ? 'Visitors have an obvious next step to reach the business.'
      : 'A visitor who is convinced has nowhere to go, so the enquiry is lost.',
    hasContactRoute ? 'No action needed.' : 'Add a short enquiry form and link it in the main menu.'));

  /* ---------------- Conversion ---------------- */

  const ctaWords = /(book now|book an appointment|book a|order now|order online|buy now|shop now|call now|enquire|inquiry|inquiry now|get a quote|request a quote|free quote|get started|sign up|subscribe|reserve|schedule|whatsapp us|chat with us|message us|contact us today)/i;
  const hasCta = ctaWords.test(text) || ctaWords.test(body);
  checks.push(makeCheck('cta', 'convert', 6, hasCta ? 'pass' : 'warn',
    hasCta ? 'Contains action-driving language' : 'No clear call to action',
    hasCta
      ? 'The page tells visitors what to do next rather than leaving them to explore.'
      : 'Nothing on the page asks the visitor to act, so most simply leave.',
    hasCta ? 'No action needed.' : 'Add one obvious button per section: "Get a quote", "Order now", "Book a visit".'));

  const paymentEvidence = /(paystack|flutterwave|stripe|paypal|opay|monnify|remita|interswitch|square|razorpay|pay on delivery|cash on delivery|bank transfer|add to cart|checkout)/i.test(body);
  checks.push(makeCheck('payment', 'convert', 3, paymentEvidence ? 'pass' : 'warn',
    paymentEvidence ? 'Online payment or ordering signals found' : 'No online payment or ordering shown',
    paymentEvidence
      ? 'There is a way to pay or order without phoning, which captures after-hours buyers.'
      : 'Buyers can only act during working hours and through you, which caps how much you can sell.',
    paymentEvidence ? 'No action needed.' : 'Add an order form plus a payment link (Paystack/Flutterwave are quick to add).'));

  const socials = ['instagram.com', 'facebook.com', 'fb.com', 'x.com', 'twitter.com', 'tiktok.com', 'linkedin.com', 'youtube.com', 't.me']
    .filter((d) => lowerHtml.includes(d));
  checks.push(makeCheck('social', 'convert', 3, socials.length ? 'pass' : 'warn',
    socials.length ? `Links to ${socials.length} social profile${socials.length > 1 ? 's' : ''}` : 'No social profile links',
    socials.length
      ? 'Visitors can verify the business is active and real before buying.'
      : 'Buyers who check social proof find nothing, which stalls cautious first-time customers.',
    socials.length ? 'No action needed.' : 'Link your active Instagram, Facebook or TikTok from the header and footer.'));

  const hoursEvidence = /(opening hours|working hours|open(?:ing)?\s*(?:hours|times)|mon(?:day)?\s*[-–—to]+\s*fri|monday\s*[-–—to]+\s*saturday|24\/7|9\s*(?::00)?\s*(?:am)?\s*[-–—to]+\s*5)/i.test(text);
  checks.push(makeCheck('hours', 'convert', 3, hoursEvidence ? 'pass' : 'warn',
    hoursEvidence ? 'Opening hours are published' : 'Opening hours not stated',
    hoursEvidence
      ? 'Customers know when they can reach or visit, which reduces wasted calls.'
      : 'Unclear hours cause missed visits and repeated "are you open?" calls.',
    hoursEvidence ? 'No action needed.' : 'Publish opening hours and mark public holidays.'));

  /* ---------------- Content quality ---------------- */

  const yearMatches = [...text.matchAll(/(?:©|&copy;|\(c\)|copyright)[^0-9]{0,60}?(19|20)\d{2}/gi)]
    .map((m) => Number(m[0].match(/(19|20)\d{2}/)[0]));
  const latestYear = yearMatches.length ? Math.max(...yearMatches) : null;
  if (latestYear !== null) {
    const stale = latestYear < CURRENT_YEAR;
    checks.push(makeCheck('stale-year', 'quality', 3, stale ? 'fail' : 'pass',
      stale ? `Footer still says ${latestYear}` : 'Copyright year is current',
      stale
        ? `The footer shows ${latestYear} while it is now ${CURRENT_YEAR}. Visitors read a stale date as "this business may be closed".`
        : 'The footer date is up to date, which signals an active business.',
      stale ? 'Update the footer year automatically so it never goes stale again.' : 'No action needed.'));
  }

  const placeholder = /(lorem ipsum|dolor sit amet|insert text here|your text here|sample text|placeholder text)/i.test(text);
  checks.push(makeCheck('placeholder', 'quality', 4, placeholder ? 'fail' : 'pass',
    placeholder ? 'Placeholder text is live on the site' : 'No placeholder text found',
    placeholder
      ? 'Filler text from a template is published, which signals the site was never finished.'
      : 'All visible copy appears to be real content.',
    placeholder ? 'Replace all filler copy with descriptions of your actual services.' : 'No action needed.'));

  const comingSoon = /(coming soon|under construction|site is being (?:built|updated)|launching soon|stay tuned)/i.test(text);
  checks.push(makeCheck('coming-soon', 'quality', 4, comingSoon ? 'fail' : 'pass',
    comingSoon ? 'Site says "coming soon" / "under construction"' : 'Site is live with real content',
    comingSoon
      ? 'A visitor arriving now is told nothing useful, so the visit is wasted.'
      : 'The site presents finished content to visitors.',
    comingSoon ? 'Ship a one-page version with services, contact details and hours while the full site is built.' : 'No action needed.'));

  const imgTags = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const missingAlt = imgTags.filter((t) => !hasMeaningfulAlt(t)).length;
  if (imgTags.length > 0) {
    const ratio = missingAlt / imgTags.length;
    const status = ratio === 0 ? 'pass' : ratio <= 0.34 ? 'warn' : 'fail';
    checks.push(makeCheck('image-alt', 'quality', 3, status,
      status === 'pass' ? 'All images have alt text' : `${missingAlt} of ${imgTags.length} images lack alt text`,
      status === 'pass'
        ? 'Images carry descriptions, which helps accessibility and image search.'
        : 'Unlabelled images are invisible to screen readers and to Google Images, where local buyers often search.',
      status === 'pass' ? 'No action needed.' : 'Describe each image briefly in its alt attribute.'));
  }

  const htmlKb = Math.round(page.bytes / 1024);
  const weightStatus = page.tooLarge || htmlKb > 800 ? 'fail' : htmlKb > 350 ? 'warn' : 'pass';
  checks.push(makeCheck('page-weight', 'quality', 2, weightStatus,
    `Page HTML is ${htmlKb} KB${page.truncated ? ' (capped)' : ''}`,
    weightStatus === 'pass'
      ? 'The HTML document is a reasonable size for a mobile connection.'
      : 'A heavy page costs visitors on slow mobile data, and most will leave before it finishes loading.',
    weightStatus === 'pass' ? 'No action needed.' : 'Compress images, defer scripts and remove unused plugins.'));

  const ttfb = page.ttfbMs;
  const speedStatus = ttfb < 800 ? 'pass' : ttfb < 2000 ? 'warn' : 'fail';
  checks.push(makeCheck('response-time', 'quality', 4, speedStatus,
    `Server responded in ${ttfb} ms`,
    speedStatus === 'pass'
      ? 'The server answers quickly, so pages feel instant.'
      : `A ${ttfb} ms first-byte time is slow. Every extra second of loading loses roughly a fifth of mobile visitors.`,
    speedStatus === 'pass' ? 'No action needed.' : 'Enable caching and a CDN, and move to faster hosting if needed.'));

  return finalizeAudit({
    business,
    site: {
      reachable: true,
      hadUrl: true,
      requestedUrl: siteInput,
      finalUrl,
      status,
      bytes: page.bytes,
      ttfbMs: page.ttfbMs,
      totalMs: page.totalMs,
      truncated: page.truncated,
      redirects: page.redirects,
    },
    checks,
  });
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

function finalizeAudit({ business, site, checks }) {
  const enriched = checks.map((c) => ({ ...c, severity: severityFor(c) }));

  const issues = enriched
    .filter((c) => c.status === 'fail' || c.status === 'warn')
    .sort((a, b) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 9;
      const sb = SEVERITY_ORDER[b.severity] ?? 9;
      if (sa !== sb) return sa - sb;
      return b.weight - a.weight;
    });

  const topFixes = issues
    .filter((c) => c.status === 'fail')
    .slice(0, 5)
    .map((c, i) => ({
      rank: i + 1,
      severity: c.severity,
      title: c.title,
      fix: c.fix,
      why: c.detail,
      impact: SEVERITY_WEIGHT_FOR_IMPACT[c.severity] || 1,
    }));

  if (topFixes.length === 0) {
    const warnings = issues.slice(0, 5).map((c, i) => ({
      rank: i + 1, severity: c.severity, title: c.title, fix: c.fix, why: c.detail, impact: 1,
    }));
    topFixes.push(...warnings);
  }

  const score = scoreOf(enriched);
  const { grade, band } = gradeFor(score);

  const categories = Object.entries(CATEGORIES).map(([key, label]) => {
    const group = enriched.filter((c) => c.category === key);
    let earned = 0;
    let possible = 0;
    for (const c of group) {
      if (c.status === 'unknown') continue;
      possible += c.weight;
      if (c.status === 'pass') earned += c.weight;
      else if (c.status === 'warn') earned += c.weight * 0.5;
    }
    return {
      key,
      label,
      score: possible === 0 ? null : Math.round((earned / possible) * 100),
      checks: group.length,
      failures: group.filter((c) => c.status === 'fail').length,
      warnings: group.filter((c) => c.status === 'warn').length,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    business: { ...business, handle: normalizeHandle(business.instagram) },
    site,
    score,
    grade,
    band,
    verdict: verdictFor(score, band),
    categories,
    checks: enriched,
    issues,
    topFixes,
    counts: {
      pass: enriched.filter((c) => c.status === 'pass').length,
      warn: enriched.filter((c) => c.status === 'warn').length,
      fail: enriched.filter((c) => c.status === 'fail').length,
      unknown: enriched.filter((c) => c.status === 'unknown').length,
      critical: enriched.filter((c) => c.severity === 'critical').length,
      high: enriched.filter((c) => c.severity === 'high').length,
    },
  };
}

/**
 * Entry point. Business without a usable URL gets the "no website" report,
 * which is the strongest lead this tool can produce.
 */
async function runAudit(input, options = {}) {
  const business = {
    name: String(input.name || '').trim() || null,
    url: String(input.url || '').trim() || null,
    phone: String(input.phone || '').trim() || null,
    whatsapp: String(input.whatsapp || '').trim() || null,
    instagram: String(input.instagram || '').trim() || null,
    notes: String(input.notes || '').trim() || null,
  };

  const normalized = normalizeUrl(business.url);
  if (!normalized) {
    return noWebsiteAudit(business);
  }
  business.url = normalized;
  return auditWebsite(business, normalized, options);
}

module.exports = { runAudit, CATEGORIES };
