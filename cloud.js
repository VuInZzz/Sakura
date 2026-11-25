/* OCR中文文库 · 云服务接入
 * 纯静态站无构建步骤：本地自带 WorkBuddy Cloud SDK 全局包，CDN 兜底。
 * 所有连接参数来自 workbuddy_cloud_service 返回的 publicConfig（仅公开值）。
 */
(function (global) {
  'use strict';

  var PUBLIC_CONFIG = {
    endpoint: 'https://ocr-chinese-library.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_ZeiBWI4d9U9NeJeRacojjS_9WfzSSj4vUdKkV1CZ15DmKQeAE1OfqBR'
  };
  var TABLE = 'reader_shelf';
  var cloud = null;
  var sdkPromise = null;

  // 推断文库根路径（cloud.js 位于根），供子目录页面拼 SDK 与链接的绝对地址
  var ROOT = './';
  try {
    var cs = document.currentScript || (function () {
      var s = document.querySelectorAll('script[src$="cloud.js"]');
      return s.length ? s[s.length - 1] : null;
    })();
    if (cs && cs.src) ROOT = new URL('.', cs.src).href;
  } catch (e) { /* 保留默认 ./ */ }

  // 本地自带 SDK（随站点发布，不依赖外部 CDN）；CDN 作为兜底
  var SDK_LOCAL = ROOT + 'workbuddy-cloud-sdk.global.js';
  var SDK_CDN = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';

  function injectScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function loadSdk() {
    if (global.WorkBuddyCloud && global.WorkBuddyCloud.createWorkBuddyCloud) {
      return Promise.resolve();
    }
    if (sdkPromise) return sdkPromise;
    sdkPromise = injectScript(SDK_LOCAL).catch(function () {
      return injectScript(SDK_CDN);
    }).then(function () {
      if (global.WorkBuddyCloud && global.WorkBuddyCloud.createWorkBuddyCloud) return;
      throw new Error('云服务脚本加载异常，请稍后重试');
    }).catch(function () {
      sdkPromise = null;
      throw new Error('无法加载云服务脚本，请检查网络后重试');
    });
    return sdkPromise;
  }

  function getCloud() {
    if (cloud) return Promise.resolve(cloud);
    return loadSdk().then(function () {
      cloud = global.WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: PUBLIC_CONFIG.endpoint,
        oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
        publishableKey: PUBLIC_CONFIG.publishableKey
      });
      return cloud;
    });
  }

  // 把 SDK/网络错误转成用户可读提示，避免静默失败
  function readableError(err) {
    var msg = (err && err.message) ? String(err.message) : '';
    var low = msg.toLowerCase();
    if (!msg) return '操作失败，请稍后重试';
    if (low.indexOf('network') >= 0 || low.indexOf('fetch') >= 0 || low.indexOf('timeout') >= 0) {
      return '无法连接云服务，请检查网络后重试';
    }
    if (low.indexOf('unauthenticated') >= 0 || low.indexOf('not signed in') >= 0 ||
        low.indexOf('invalid_grant') >= 0) {
      return '登录状态已失效，请重新登录';
    }
    if (low.indexOf('permission') >= 0 || low.indexOf('row-level security') >= 0 || low.indexOf('42501') >= 0) {
      return '没有权限执行此操作';
    }
    if (low.indexOf('quota') >= 0 || low.indexOf('limit') >= 0 || low.indexOf('429') >= 0) {
      return '云服务额度已用完，请联系管理员';
    }
    return msg;
  }

  function baseUrl(go) {
    var u = new URL(location.href);
    u.pathname = '/';
    ['code', 'state', 'provider', 'go'].forEach(function (k) { u.searchParams.delete(k); });
    if (go) u.searchParams.set('go', go);
    return u.toString();
  }

  /* 登录：必须在用户点击时调用；同标签页跳转，PKCE 验证才有效 */
  function signIn(go) {
    return getCloud().then(function (c) {
      return c.auth.signInWithOAuth({ provider: 'workbuddy', redirectTo: baseUrl(go) });
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message || '登录入口暂时不可用');
      if (!res.data || !res.data.url) throw new Error('登录入口暂时不可用');
      location.assign(res.data.url);
    }).catch(function (e) { throw new Error(readableError(e)); });
  }

  /* 回调分发：仅站点根（index.html）在启动时调用；普通访问走会话恢复 */
  function handleCallback() {
    return getCloud().then(function (c) {
      var u = new URL(location.href);
      if (!u.searchParams.has('code') && !u.searchParams.has('error')) return null;
      var provider = u.searchParams.get('provider');
      if (provider !== 'workbuddy') {
        throw new Error('授权回调缺少有效的登录方式，请重新登录');
      }
      if (typeof c.auth.handleWorkBuddyCallback !== 'function') {
        throw new Error('登录组件版本不匹配，请刷新后重试');
      }
      return c.auth.handleWorkBuddyCallback().then(function (res) {
        if (res.error) throw new Error(res.error.message || '登录失败');
        var go = u.searchParams.get('go');
        ['code', 'state', 'provider', 'go'].forEach(function (k) { u.searchParams.delete(k); });
        history.replaceState(null, '', u.pathname + u.search + u.hash);
        if (go === 'shelf') location.replace(ROOT + '我的书架.html');
        return res.data;
      });
    }).catch(function (e) { throw new Error(readableError(e)); });
  }

  function getSession() {
    return getCloud().then(function (c) { return c.auth.getSession(); });
  }

  function getUser() {
    return getCloud().then(function (c) { return c.auth.getUser(); });
  }

  function signOut() {
    return getCloud().then(function (c) { return c.auth.signOut(); })
      .catch(function (e) { throw new Error(readableError(e)); });
  }

  /* 读取当前用户的书架；kind 为 'favorite' 或 'progress'，省略则全部 */
  function listShelf(kind) {
    return getCloud().then(function (c) {
      var q = c.database.from(TABLE).select('*').order('created_at', { ascending: false });
      if (kind) q = q.eq('kind', kind);
      return q;
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message || '读取书架失败');
      return res.data || [];
    }).catch(function (e) { throw new Error(readableError(e)); });
  }

  /* 写入收藏或进度；owner_id 由数据库 DEFAULT auth.uid() 填充，前端不发送 */
  function saveShelf(item) {
    var kind = item.kind === 'progress' ? 'progress' : 'favorite';
    return getCloud().then(function (c) {
      return c.auth.getSession().then(function (s) {
        if (!s.data || !s.data.session) throw new Error('请先登录后再收藏');
        var user = s.data.session.user || {};
        return c.database.from(TABLE).upsert({
          book_key: item.bookKey,
          book_title: item.bookTitle,
          item_title: item.itemTitle || null,
          item_url: item.itemUrl,
          kind: kind,
          owner_name: user.name || null
        }, { onConflict: 'owner_id,book_key,item_url,kind' }).select();
      });
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message || '保存失败');
      return (res.data && res.data[0]) || null;
    }).catch(function (e) { throw new Error(readableError(e)); });
  }

  function removeShelf(id) {
    return getCloud().then(function (c) {
      return c.database.from(TABLE).delete().eq('id', id).select();
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message || '删除失败');
      if (!res.data || res.data.length === 0) throw new Error('条目不存在或不属于当前账号');
      return res.data[0];
    }).catch(function (e) { throw new Error(readableError(e)); });
  }

  global.CloudShelf = {
    ROOT: ROOT,
    signIn: signIn,
    handleCallback: handleCallback,
    getSession: getSession,
    getUser: getUser,
    signOut: signOut,
    listShelf: listShelf,
    saveShelf: saveShelf,
    removeShelf: removeShelf,
    readableError: readableError
  };
})(window);
