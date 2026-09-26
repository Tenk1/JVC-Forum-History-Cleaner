/* global browser */
(() => {
  'use strict';

  const HELPER_URL = 'https://www.jeuxvideo.com/';
  let helperTabId = null;
  let helperPromise = null;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function getHelperTab() {
    if (helperTabId == null) return null;
    try {
      const tab = await browser.tabs.get(helperTabId);
      if (!/^https:\/\/www\.jeuxvideo\.com\//i.test(tab.url || '')) return null;
      return tab;
    } catch (_) {
      helperTabId = null;
      return null;
    }
  }

  async function waitForContentScript(tabId, timeoutMs = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const status = await browser.tabs.sendMessage(tabId, { type: 'JFC_WORKER_STATUS' });
        if (status) return status;
      } catch (_) {}
      await sleep(180);
    }
    throw new Error('La page Jeuxvideo.com n’a pas fini de charger.');
  }

  async function ensureHelperTab(forceReload = false) {
    if (helperPromise) return helperPromise;
    helperPromise = (async () => {
      let tab = await getHelperTab();
      if (!tab) {
        tab = await browser.tabs.create({ url: HELPER_URL, active: false });
        helperTabId = tab.id;
      } else if (forceReload) {
        await browser.tabs.reload(tab.id);
      }

      const status = await waitForContentScript(tab.id);
      return { tabId: tab.id, status };
    })();

    try {
      return await helperPromise;
    } finally {
      helperPromise = null;
    }
  }

  async function forwardToWorker(message) {
    const { tabId } = await ensureHelperTab();
    return browser.tabs.sendMessage(tabId, message);
  }

  async function closeHelperIfIdle() {
    const tab = await getHelperTab();
    if (!tab) return { ok: true };
    try {
      const state = await browser.tabs.sendMessage(tab.id, { type: 'JFC_WORKER_GET_STATE' });
      if (state?.running) return { ok: false, running: true };
    } catch (_) {}
    try { await browser.tabs.remove(tab.id); } catch (_) {}
    helperTabId = null;
    return { ok: true };
  }

  browser.tabs.onRemoved.addListener(tabId => {
    if (tabId === helperTabId) helperTabId = null;
  });

  browser.runtime.onMessage.addListener(message => {
    if (!message?.type) return undefined;

    if (message.type === 'JFC_BG_ENSURE_HELPER') {
      return ensureHelperTab(Boolean(message.forceReload)).then(result => result.status);
    }

    if (message.type === 'JFC_BG_GET_STATE') {
      return forwardToWorker({ type: 'JFC_WORKER_GET_STATE' });
    }

    if (message.type === 'JFC_BG_COMMAND') {
      return forwardToWorker({
        type: 'JFC_WORKER_COMMAND',
        command: message.command,
        settings: message.settings || null
      });
    }

    if (message.type === 'JFC_BG_OPEN_JVC') {
      return browser.tabs.create({ url: HELPER_URL, active: true }).then(() => ({ ok: true }));
    }

    if (message.type === 'JFC_BG_OPEN_HISTORY') {
      return ensureHelperTab().then(async ({ status }) => {
        if (!status?.accountProfileUrl) return { ok: false };
        const separator = status.accountProfileUrl.includes('?') ? '&' : '?';
        await browser.tabs.create({ url: `${status.accountProfileUrl}${separator}mode=historique_forum`, active: true });
        return { ok: true };
      });
    }

    if (message.type === 'JFC_BG_RELEASE_HELPER') {
      return closeHelperIfIdle();
    }

    return undefined;
  });
})();
