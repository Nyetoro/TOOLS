'use strict';

/* Vercel serverless entry point for GET /api/leads.
   Serverless hosts have no durable disk, so the lead list is always empty here. */

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    count: 0,
    leads: [],
    persistent: false,
    statuses: ['new', 'contacted', 'replied', 'won', 'lost'],
    reason: 'Lead storage needs a local disk. Run this tool on your own computer to keep a lead list.',
  });
};
