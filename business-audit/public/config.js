/**
 * Your branding. This is what every prospect sees on their report,
 * so their first impression of you arrives with their own score on it.
 */
window.AUDIT_BRAND = {
  businessName: 'YOUR STUDIO NAME',
  tagline: 'Websites and digital tools that turn searches into customers',
  owner: 'Your Name',
  phone: '+234 800 000 0000',
  // Digits only, with country code. Used to build the click-to-chat link.
  whatsapp: '2348000000000',
  email: 'you@example.com',
  website: '',
  location: 'Your City',
  offer: 'Free 20-minute call + a fixed-price quote',

  /**
   * IMPORTANT: where this tool is published, e.g. 'https://my-audit.vercel.app'.
   *
   * Report links are built from this. Leave it empty and links point at
   * http://localhost:4321 — which works on your computer only, so a client
   * opening the WhatsApp message you sent them would see nothing.
   * Deploy the tool (see README) and paste the address here.
   */
  publicUrl: '',

  // Pre-written WhatsApp opener. {name} and {score} are replaced automatically.
  opener:
    'Hello {name}, I ran a free check on your website and it scored {score}/100. I found a few things that are costing you enquiries. May I send you the short report?',
};
