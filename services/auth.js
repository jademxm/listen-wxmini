const { API_BASE, STORAGE_KEYS } = require('./config');

let pending = null;

function login() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (!res.code) {
          reject(new Error('wx.login 未返回 code'));
          return;
        }
        wx.request({
          url: API_BASE + '/auth/login',
          method: 'POST',
          data: { code: res.code },
          header: { 'Content-Type': 'application/json' },
          timeout: 15000,
          success(resp) {
            const body = resp.data || {};
            if (resp.statusCode === 200 && body.code === 0 && body.data && body.data.token) {
              wx.setStorageSync(STORAGE_KEYS.token, body.data.token);
              resolve(body.data.token);
            } else {
              reject(new Error(body.message || '微信登录失败'));
            }
          },
          fail() {
            reject(new Error('登录请求失败'));
          },
        });
      },
      fail() {
        reject(new Error('wx.login 调用失败'));
      },
    });
  });
}

function ensureToken(force) {
  if (!force) {
    const cached = wx.getStorageSync(STORAGE_KEYS.token);
    if (cached) return Promise.resolve(cached);
  }
  if (!pending) {
    pending = login().then(
      (token) => { pending = null; return token; },
      (err) => { pending = null; throw err; }
    );
  }
  return pending;
}

function clearToken() {
  wx.removeStorageSync(STORAGE_KEYS.token);
}

module.exports = { ensureToken, clearToken };
