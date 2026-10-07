# Digital Presence Audit

A lead-generation tool. Enter any business, get a scored report on its online presence, and send
that report to the owner on WhatsApp. Works for schools, clinics, salons, shops, logistics — any
business type.

The report is the sales pitch. You do not have to explain anything.

## Run it

Double-click **`start.bat`** — it starts the server and opens your browser.

Or from a terminal:

```powershell
cd "c:\Users\TOSHIBA\Desktop\TOOLS\business-audit"
node server.js
```

Then open <http://localhost:4321>. No install step and no dependencies — it uses only Node's
built-ins.

The server listens on **loopback only** by default. That matters: the tool holds your lead list and
its API has no password, so it should not be visible to everyone on your Wi-Fi. To reach it from
your phone on the same network, start it with `$env:HOST='0.0.0.0'; node server.js` and accept that
anyone on the network can then read your leads.

## Before you send your first report

Edit [public/config.js](public/config.js) and replace the placeholders with your real details.
Everything the prospect sees about you comes from that one file:

| Field | What it does |
|---|---|
| `businessName` | Your name or studio name, shown on the report |
| `owner` | Your name |
| `phone` | Clickable phone number on the report |
| `whatsapp` | **Digits only, with country code** (e.g. `2348031112222`) — builds the chat button |
| `email`, `website`, `location` | Contact lines on the report |
| `offer` | The call to action, e.g. "Free consultation + fixed-price quote" |
| `publicUrl` | **Where this tool is published.** See below — links do not work for clients without it |
| `opener` | Pre-written WhatsApp message. `{name}` and `{score}` are filled in automatically |

### Publish it before you contact anyone

Report links are built from `publicUrl`. Left empty, they point at `http://localhost:4321` — which
works on your computer and **nowhere else**, so a client opening your WhatsApp message would see
nothing at all. The tool warns you loudly about this on both pages until it is fixed.

Deploy it once (Vercel, free tier is fine), then paste the address into `publicUrl`:

```powershell
npx vercel        # follow the prompts, accept the detected settings
```

`vercel.json` is already set up: `public/` is served as static files and `api/audit.js` runs the
audit as a serverless function. On a serverless host the **lead list is disabled**, because there is
no permanent disk — run the tool locally when you want to keep and track leads, and deploy it for
generating the links you send out. Regenerating a link any time is what makes this painless: open a
lead and press **Re-audit**.

Until it is deployed, **Save as PDF** on any report gives you a file you can send instead.

## The three tabs

**Single audit** — one business. Leave the website box empty if they have none; that produces the
strongest report of all, because the score comes out at 0/100.

**Bulk audit (lead hunting)** — paste a list, one business per line:

```
Bright Future Academy, brightfutureacademy.com, 08031234567
Grace Clinic, graceclinic.ng
Ada's Salon
City Logistics, citylogistics.com, 08029876543
```

The website and phone are both optional, and each is recognised by its shape, so they can be in
either order. You can also **import a .csv or .txt file**; a header row is skipped automatically.
`Ada's Salon` has no website and is scored as "no website". Results are sorted worst score first, so
your hottest prospects sit at the top. Every row gets an **Open report** button and a **WhatsApp
them** button that opens the chat with your opener and the report link already written — with no
phone number, WhatsApp simply asks which contact to use.

Runs are capped at **100 businesses** so you stay a polite visitor and the page stays responsive;
split larger lists into batches. There is a ~1.2s pause between sites, and **Stop** aborts a run
without losing the results gathered so far.

**My lead list** — every audit you saved, worst score first. For each lead you can:

- **Search** by name, phone, note or issue
- Set a **status** (New → Contacted → Replied → Won / Lost) so you never message anyone twice
- Add a **note**
- **Re-audit** to regenerate the report and refresh the score
- **Delete** (two clicks: the first arms it)
- **Download CSV** of the whole list

Re-auditing the same business updates its existing row instead of creating a duplicate, and your
status and notes are preserved.

## What it checks

30 checks across six areas, weighted by how much they actually cost a business:

- **Reachability & Trust** — does the site load, HTTPS, redirect chain
- **Mobile Experience** — viewport configuration, responsive layout rules (it downloads and
  inspects the site's own stylesheets)
- **Findability & SEO** — title, meta description, H1, social share tags, favicon, language,
  robots.txt, sitemap.xml
- **Contactability** — tap-to-call, WhatsApp click-to-chat, email, map/address, contact form
- **Conversion** — calls to action, online payment, social proof, opening hours
- **Content Quality** — stale copyright year, placeholder text, "coming soon", image alt text,
  page weight, server response time

Each finding comes with what it means in business terms and how to fix it. The report ranks the
critical ones first.

## Sharing a report

On the report page, **Copy share link** puts the entire report into the URL. No database, no
server storage, no expiry. Paste it into WhatsApp and the owner sees their own score, your
branding and your contact button. **Send on WhatsApp** opens the chat with the message already
written. **Save as PDF** uses the browser's print-to-PDF with a print stylesheet.

## Notes

- The tool only reads publicly available pages, exactly as a browser does. Audit a handful at a
  time and stop if anyone asks you to.
- Checks are performed on the raw HTML and the site's own CSS. Anything rendered by JavaScript
  after load cannot be seen, so a finding is a strong lead to investigate — always confirm on the
  live site before you quote a price.
- Lead data is written to `data/leads.jsonl` and is gitignored. It is disabled automatically on
  serverless hosts, which have no durable disk.

## Files

| Path | Purpose |
|---|---|
| `start.bat` | Double-click launcher for Windows |
| `server.js` | Local web server, static files and the leads API |
| `lib/fetch-page.js` | Zero-dependency HTTP fetcher with redirect tracking |
| `lib/audit.js` | The 30 checks, weighting and scoring |
| `public/config.js` | **Your branding — edit this** |
| `public/` | The three tabs and the report page |
| `api/` | Serverless entry points for deployment |
| `data/leads.jsonl` | Your lead list (created on first save) |
