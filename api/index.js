'use strict';

// Vercel serverless entry: every request is rewritten here (see vercel.json) and handled by the
// same Express app used locally. server.js only calls listen() when run directly.
module.exports = require('../server.js');
