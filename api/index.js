/**
 * api/index.js
 * Vercel Serverless Function Entry Point
 */
const app = require('../server');

module.exports = (req, res) => {
  return app(req, res);
};
