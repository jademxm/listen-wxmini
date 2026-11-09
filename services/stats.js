const { get } = require('./api');

function getStats() {
  return get('/me/stats');
}

module.exports = { getStats };
