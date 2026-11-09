const { API_BASE, STORAGE_KEYS, PAGE_SIZE } = require('./config');

function request(path, options) {
  const opts = options || {};
  const method = opts.method || 'GET';
  const data = opts.data || {};
  const allowRetry = opts.retry !== false;

  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const token = wx.getStorageSync(STORAGE_KEYS.token);
    if (token) header.Authorization = 'Bearer ' + token;

    wx.request({
      url: API_BASE + path,
      method,
      data,
      header,
      timeout: 15000,
      success(res) {
        if (res.statusCode === 401 && allowRetry) {
          const auth = require('./auth');
          auth.clearToken();
          auth.ensureToken(true)
            .then(() => request(path, Object.assign({}, opts, { retry: false })))
            .then(resolve, reject);
          return;
        }

        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
          resolve(body.data);
          return;
        }
        reject(new Error(body.message || ('请求失败 ' + res.statusCode)));
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '网络异常'));
      },
    });
  });
}

function get(path, data) {
  const query = Object.keys(data || {})
    .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
    .join('&');
  return request(path + (query ? '?' + query : ''), { method: 'GET' });
}

function post(path, data) {
  return request(path, { method: 'POST', data: data || {} });
}

function del(path) {
  return request(path, { method: 'DELETE' });
}

function collect(path, page, acc) {
  return get(path, { page: page, per_page: PAGE_SIZE }).then((data) => {
    const list = (data && data.list) || [];
    const all = acc.concat(list);
    if (data && data.has_more && list.length) return collect(path, page + 1, all);
    return all;
  });
}

module.exports = { request, get, post, del, collect };
