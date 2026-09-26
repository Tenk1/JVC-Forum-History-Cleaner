(() => {
  'use strict';

  const READY_ATTR = 'data-jfc-bridge-ready';
  const REQUEST_ATTR = 'data-jfc-request';
  const RESPONSE_ATTR = 'data-jfc-response-ready';
  const PROCESSING_ATTR = 'data-jfc-processing';

  function normalizeAllowedUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      if (url.protocol !== 'https:' || url.hostname !== 'www.jeuxvideo.com') return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  async function performFetch(method, rawUrl, timeoutMs, options) {
    const url = normalizeAllowedUrl(rawUrl);
    if (!url) {
      return { ok: false, status: 0, statusText: 'URL non autorisée', body: '', url: rawUrl, headers: '' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);

    try {
      const headers = {};
      if (options.accept) headers.Accept = options.accept;
      if (options.xRequestedWith) headers['X-Requested-With'] = 'XMLHttpRequest';
      if (options.contentType) headers['Content-Type'] = options.contentType;

      const response = await fetch(url, {
        method: method === 'POST' ? 'POST' : 'GET',
        headers,
        body: options.body != null ? options.body : undefined,
        credentials: 'same-origin',
        signal: controller.signal
      });

      const body = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText || '',
        body,
        url: response.url || url,
        headers: [...response.headers.entries()].map(([key, value]) => `${key}: ${value}`).join('\r\n')
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: error?.name === 'AbortError' ? 'Délai dépassé' : (error?.message || 'Erreur réseau'),
        body: '',
        url,
        headers: ''
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleRequest(node) {
    if (!(node instanceof Element)) return;
    if (node.getAttribute(REQUEST_ATTR) !== '1' || node.getAttribute(PROCESSING_ATTR) === '1') return;

    node.setAttribute(PROCESSING_ATTR, '1');
    const method = node.getAttribute('data-method') || 'GET';
    const url = node.getAttribute('data-url') || '';
    const timeoutMs = Number(node.getAttribute('data-timeout') || 20000);
    const options = {
      body: node.hasAttribute('data-body') ? node.getAttribute('data-body') : null,
      contentType: node.getAttribute('data-content-type') || null,
      xRequestedWith: node.getAttribute('data-x-requested-with') === '1',
      accept: node.getAttribute('data-accept') || null
    };

    const result = await performFetch(method, url, timeoutMs, options);
    try {
      node.textContent = JSON.stringify(result);
      node.setAttribute(RESPONSE_ATTR, '1');
    } catch (_) {}
  }

  function scan(root) {
    if (root instanceof Element && root.matches?.(`[${REQUEST_ATTR}="1"]`)) handleRequest(root);
    root.querySelectorAll?.(`[${REQUEST_ATTR}="1"]`).forEach(handleRequest);
  }

  scan(document);
  if (!window.__JFC_PAGE_BRIDGE__) {
    window.__JFC_PAGE_BRIDGE__ = true;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node instanceof Element) scan(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  document.documentElement?.setAttribute(READY_ATTR, '1');
})();
