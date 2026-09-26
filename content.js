/* global browser */
(() => {
  'use strict';

  const VERSION = '1.1.1';
  const STORAGE_KEY = 'jfc.settings.v1';
  const MAX_PREVIEW = 100;

  const state = {
    running: false,
    paused: false,
    stopRequested: false,
    pauseReason: '',
    settings: null,
    stats: freshStats(),
    logs: [],
    preview: []
  };

  function freshStats() {
    return { pages: 0, scanned: 0, matched: 0, deleted: 0, skipped: 0, failed: 0 };
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function accountProfile(doc = document) {
    const pseudoElement = doc.querySelector('.headerAccount__pseudo');
    const candidates = [
      pseudoElement?.closest('a[href*="/profil/"]'),
      doc.querySelector('.headerAccount a[href*="/profil/"]'),
      doc.querySelector('a.headerAccount__link[href*="/profil/"]'),
      doc.querySelector('header a[href*="/profil/"]')
    ].filter(Boolean);

    for (const link of candidates) {
      try {
        const href = link.getAttribute('href') || link.href;
        const url = new URL(href, 'https://www.jeuxvideo.com/');
        const match = url.pathname.match(/^\/profil\/([^/?]+)/i);
        if (match) {
          return {
            pseudo: decodeURIComponent(match[1]),
            url: `${url.origin}/profil/${match[1]}`
          };
        }
      } catch (_) {}
    }

    const fallback = pseudoElement?.textContent?.trim() || null;
    return fallback ? {
      pseudo: fallback,
      url: `https://www.jeuxvideo.com/profil/${encodeURIComponent(fallback)}`
    } : null;
  }

  async function ensurePageBridge(timeoutMs = 5000) {
    if (!document.documentElement) throw new Error('Document indisponible');
    if (document.documentElement.getAttribute('data-jfc-bridge-ready') === '1') return;

    let script = document.querySelector('script[data-jfc-bridge]');
    if (!script) {
      script = document.createElement('script');
      script.setAttribute('data-jfc-bridge', '1');
      script.src = browser.runtime.getURL('page-bridge.js');
      script.async = false;
      (document.head || document.documentElement).appendChild(script);
    }

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (document.documentElement.getAttribute('data-jfc-bridge-ready') === '1') return;
      await sleep(40);
    }
    throw new Error('Impossible d’initialiser la connexion avec JVC');
  }

  async function pageRequest(method, url, timeoutMs = 22000, options = {}) {
    try {
      await ensurePageBridge();
    } catch (error) {
      return { ok: false, status: 0, statusText: error?.message || String(error), body: '', url, headers: '' };
    }

    const requestNode = document.createElement('span');
    requestNode.hidden = true;
    requestNode.setAttribute('data-jfc-request', '1');
    requestNode.setAttribute('data-method', method === 'POST' ? 'POST' : 'GET');
    requestNode.setAttribute('data-url', url);
    requestNode.setAttribute('data-timeout', String(timeoutMs));
    if (options.body != null) requestNode.setAttribute('data-body', String(options.body));
    if (options.contentType) requestNode.setAttribute('data-content-type', String(options.contentType));
    if (options.xRequestedWith) requestNode.setAttribute('data-x-requested-with', '1');
    if (options.accept) requestNode.setAttribute('data-accept', String(options.accept));
    (document.body || document.documentElement).appendChild(requestNode);

    const started = Date.now();
    while (Date.now() - started < timeoutMs + 1000) {
      if (requestNode.getAttribute('data-jfc-response-ready') === '1') {
        try {
          const result = JSON.parse(requestNode.textContent || '{}');
          requestNode.remove();
          return result;
        } catch (error) {
          requestNode.remove();
          return { ok: false, status: 0, statusText: `Réponse JVC invalide: ${error.message}`, body: '', url, headers: '' };
        }
      }
      await sleep(35);
    }

    requestNode.remove();
    return { ok: false, status: 0, statusText: 'Délai de communication dépassé', body: '', url, headers: '' };
  }

  async function getAccount() {
    const live = accountProfile(document);
    if (live) return live;

    const response = await pageRequest('GET', 'https://www.jeuxvideo.com/', 18000);
    if (!response.ok || !response.body) return null;
    try {
      const doc = new DOMParser().parseFromString(response.body, 'text/html');
      return accountProfile(doc);
    } catch (_) {
      return null;
    }
  }

  function addLog(text, kind = 'info') {
    const stamp = new Date().toLocaleTimeString('fr-FR');
    state.logs.push({ stamp, text, kind });
    if (state.logs.length > 500) state.logs.splice(0, state.logs.length - 500);
  }

  async function loadSettings() {
    const defaults = {
      dryRun: true,
      fromDate: '',
      toDate: '',
      includeForums: '',
      excludeForums: '',
      keepMessages: '',
      keepTopics: '',
      maxLength: '',
      delayMs: 1600
    };
    const stored = await browser.storage.local.get(STORAGE_KEY);
    state.settings = { ...defaults, ...(stored[STORAGE_KEY] || {}) };
    return state.settings;
  }

  async function saveSettings(settings) {
    state.settings = settings;
    await browser.storage.local.set({ [STORAGE_KEY]: settings });
  }

  function parseIdSet(text) {
    const result = new Set();
    String(text || '').split(/[\s,;]+/).forEach(token => {
      const matches = token.match(/\d{3,}/g);
      matches?.forEach(value => result.add(value));
    });
    return result;
  }

  function makeFilter(settings) {
    const from = settings.fromDate ? new Date(`${settings.fromDate}T00:00:00`) : null;
    const to = settings.toDate ? new Date(`${settings.toDate}T23:59:59.999`) : null;
    const includeForums = parseIdSet(settings.includeForums);
    const excludeForums = parseIdSet(settings.excludeForums);
    const keepMessages = parseIdSet(settings.keepMessages);
    const keepTopics = parseIdSet(settings.keepTopics);
    const maxLength = settings.maxLength === '' ? null : Math.max(0, Number(settings.maxLength));

    return item => {
      if (item.alreadyDeleted) return { ok: false, reason: 'déjà supprimé' };
      if ((from || to) && !item.date) return { ok: false, reason: 'date introuvable' };
      if (from && item.date && item.date < from) return { ok: false, reason: 'avant la date de début' };
      if (to && item.date && item.date > to) return { ok: false, reason: 'après la date de fin' };
      if (includeForums.size && (!item.forumId || !includeForums.has(item.forumId))) return { ok: false, reason: 'forum non inclus' };
      if (excludeForums.size && item.forumId && excludeForums.has(item.forumId)) return { ok: false, reason: 'forum exclu' };
      if (keepMessages.has(item.id)) return { ok: false, reason: 'message protégé' };
      if (keepTopics.size && !item.topicId) return { ok: false, reason: 'topic introuvable (keep-list active)' };
      if (item.topicId && keepTopics.has(item.topicId)) return { ok: false, reason: 'topic protégé' };
      if (maxLength !== null && !item.textAvailable) return { ok: false, reason: 'longueur introuvable' };
      if (maxLength !== null && item.length >= maxLength) return { ok: false, reason: `≥ ${maxLength} caractères` };
      return { ok: true };
    };
  }

  function summarizeReasons(reasonCounts) {
    return [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(' · ');
  }

  async function decodePayloadFromHtml(rawData) {
    const match = String(rawData || '').match(/jvc\.\w+Payload\s*=\s*["']([^"']+)["']/);
    if (!match?.[1]) return null;

    try {
      const bytes = Uint8Array.from(atob(match[1]), char => char.charCodeAt(0));
      try {
        const plain = new TextDecoder().decode(bytes);
        if (/^\s*[{[]/.test(plain)) return JSON.parse(plain);
      } catch (_) {}

      if (typeof DecompressionStream === 'function') {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return await new Response(stream).json();
      }
    } catch (_) {}
    return null;
  }

  function firstStringMatching(value, regex, depth = 0) {
    if (depth > 3 || value == null) return null;
    if (typeof value === 'string') return regex.test(value) ? value : null;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const match = firstStringMatching(entry, regex, depth + 1);
        if (match) return match;
      }
      return null;
    }
    if (typeof value === 'object') {
      for (const entry of Object.values(value)) {
        const match = firstStringMatching(entry, regex, depth + 1);
        if (match) return match;
      }
    }
    return null;
  }

  function stripHtml(html) {
    const source = String(html || '');
    if (!source.includes('<')) return source.replace(/\s+/g, ' ').trim();
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    return (parsed.body?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function firstTextField(message) {
    const keys = ['message', 'content', 'text', 'body', 'html', 'messageText', 'contentMessage'];
    for (const key of keys) {
      const value = message?.[key];
      if (typeof value === 'string' && value.trim()) return stripHtml(value);
    }
    return '';
  }

  function parsePublishedDate(raw) {
    if (!raw) return null;
    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime())) return direct;

    const months = {
      janvier: 0, février: 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
      juillet: 6, août: 7, aout: 7, septembre: 8, octobre: 9, novembre: 10,
      décembre: 11, decembre: 11
    };
    const text = String(raw).trim().toLowerCase();
    const match = text.match(/(\d{1,2})\s+([a-zéèêëàâäîïôöùûüç]+)\s+(\d{4})/i);
    if (!match) return null;
    const month = months[match[2].toLowerCase()];
    if (month == null) return null;
    const date = new Date(Number(match[3]), month, Number(match[1]));
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseHistoryMessage(message) {
    const id = message?.id ?? message?.idMessage ?? message?.messageId;
    if (id == null) return null;

    const url = firstStringMatching(message, /\/forums\/(?:42|0)-\d+-\d+-|\/forums\/message\/\d+|#post_\d+/i) || '';
    const forumTopic = url.match(/\/forums\/(?:42|0)-(\d+)-(\d+)-/i);
    const forumId = String(message?.forumId ?? message?.idForum ?? forumTopic?.[1] ?? '') || null;
    const topicId = String(message?.topicId ?? message?.idTopic ?? forumTopic?.[2] ?? '') || null;
    const text = firstTextField(message);
    const dateText = String(message?.publishedDate ?? message?.date ?? message?.dateMessage ?? '');
    const rawState = message?.stateMessage;

    return {
      id: String(id),
      date: parsePublishedDate(dateText),
      dateText,
      href: url || `https://www.jeuxvideo.com/forums/message/${id}`,
      forumId,
      topicId,
      text,
      textAvailable: Boolean(text),
      length: text.replace(/\s/g, '').length,
      alreadyDeleted: rawState != null && String(rawState).toLowerCase() !== 'msg-visible'
    };
  }

  async function fetchHistoryPage(url) {
    for (let attempt = 1; attempt <= 6; attempt++) {
      await waitIfPaused();
      const response = await pageRequest('GET', url, 24000, {
        accept: 'application/json',
        xRequestedWith: true
      });

      if ([403, 429, 503].includes(response.status)) {
        const wait = Math.min(10000, 2000 + attempt * 1500);
        addLog(`Historique HTTP ${response.status} — nouvel essai ${attempt}/6 dans ${Math.round(wait / 1000)} s.`, 'warn');
        await sleep(wait);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Lecture de l’historique impossible (HTTP ${response.status || 0} ${response.statusText || ''}).`);
      }

      try {
        return JSON.parse(response.body || '{}');
      } catch (_) {
        const payload = await decodePayloadFromHtml(response.body || '');
        if (payload) return payload;
        throw new Error('La réponse de l’historique JVC n’est pas exploitable.');
      }
    }
    throw new Error('Lecture de l’historique impossible après plusieurs tentatives.');
  }

  async function fetchModerationToken(sourceUrl) {
    let url = sourceUrl;
    try {
      const parsed = new URL(url, 'https://www.jeuxvideo.com/');
      if (parsed.hostname !== 'www.jeuxvideo.com') url = null;
      else url = parsed.href;
    } catch (_) {
      url = null;
    }
    if (!url) throw new Error('Impossible de déterminer une page JVC pour récupérer le jeton de modération.');

    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await pageRequest('GET', url, 22000);
      if (response.ok) {
        const payload = await decodePayloadFromHtml(response.body || '');
        const token = payload?.ajaxModerationToken || null;
        if (token) {
          addLog('Jeton de suppression JVC récupéré.', 'ok');
          return token;
        }
      }
      if (attempt < 3) await sleep(1200 * attempt);
    }
    throw new Error('Impossible de récupérer le jeton de modération JVC.');
  }

  async function deleteBatch(ids, currentToken, tokenSourceUrl) {
    const send = async token => {
      const params = new URLSearchParams({ ids: ids.join(','), type: 'delete', ajax_hash: token });
      return pageRequest('POST', `https://www.jeuxvideo.com/forums/message/delete?${params.toString()}`, 24000);
    };

    let token = currentToken || await fetchModerationToken(tokenSourceUrl);
    let response = await send(token);

    if (!response.ok) {
      addLog(`Lot de ${ids.length} message(s) refusé (HTTP ${response.status || 0}) — renouvellement du jeton puis nouvel essai.`, 'warn');
      token = await fetchModerationToken(tokenSourceUrl);
      response = await send(token);
    }

    return { ok: Boolean(response.ok), response, token };
  }

  async function waitIfPaused() {
    while (state.paused && !state.stopRequested) await sleep(250);
    if (state.stopRequested) throw new Error('STOP_REQUESTED');
  }

  async function run(settings) {
    if (state.running) return;

    const account = await getAccount();
    if (!account?.pseudo || !account?.url) {
      addLog('Aucune session Jeuxvideo.com connectée.', 'error');
      return;
    }

    state.running = true;
    state.paused = false;
    state.stopRequested = false;
    state.pauseReason = '';
    state.stats = freshStats();
    state.logs = [];
    state.preview = [];
    await saveSettings(settings);

    const filter = makeFilter(settings);
    const reasonCounts = new Map();
    const seenIds = new Set();
    let url = `${account.url}?mode=historique_forum`;
    let pageIndex = 0;
    let moderationToken = null;

    try {
      addLog(`Analyse de l’historique de ${account.pseudo}${settings.dryRun ? ' (simulation)' : ''}.`, 'info');

      while (url && !state.stopRequested) {
        await waitIfPaused();
        pageIndex++;
        state.stats.pages = pageIndex;

        const data = await fetchHistoryPage(url);
        const rawList = Array.isArray(data?.listMessage) ? data.listMessage : [];
        const items = rawList
          .map(parseHistoryMessage)
          .filter(Boolean)
          .filter(item => {
            if (seenIds.has(item.id)) return false;
            seenIds.add(item.id);
            return true;
          });

        state.stats.scanned += items.length;
        const matched = [];

        for (const item of items) {
          const verdict = filter(item);
          if (!verdict.ok) {
            state.stats.skipped++;
            reasonCounts.set(verdict.reason, (reasonCounts.get(verdict.reason) || 0) + 1);
            continue;
          }
          state.stats.matched++;
          matched.push(item);
          if (state.preview.length < MAX_PREVIEW) state.preview.push(item);
        }

        const next = data?.pagerView?.next?.url || null;
        addLog(`Page ${pageIndex} : ${rawList.length} entrée(s), ${matched.length} correspondant aux filtres · suivante=${next ? 'oui' : 'non'}.`, 'info');

        if (!settings.dryRun && matched.length) {
          const ids = matched.map(item => item.id);
          const tokenSourceUrl = matched.find(item => item.href)?.href || `https://www.jeuxvideo.com/forums/message/${ids[0]}`;
          const result = await deleteBatch(ids, moderationToken, tokenSourceUrl);
          moderationToken = result.token;

          if (!result.ok) {
            state.stats.failed += ids.length;
            throw new Error(`Suppression refusée par JVC (HTTP ${result.response?.status || 0}).`);
          }

          state.stats.deleted += ids.length;
          addLog(`${ids.length} message(s) supprimé(s) sur la page ${pageIndex}.`, 'ok');
          await sleep(Math.max(500, Number(settings.delayMs || 1600)));
        }

        if (!next) break;
        try {
          url = new URL(next, 'https://www.jeuxvideo.com/').href;
        } catch (_) {
          url = null;
        }
      }

      const reasons = summarizeReasons(reasonCounts);
      if (reasons) addLog(`Ignorés par filtres : ${reasons}.`, 'info');
      if (settings.dryRun) {
        addLog(`Simulation terminée : ${state.stats.matched} message(s) correspondant aux filtres sur ${state.stats.pages} page(s).`, state.stats.matched ? 'ok' : 'warn');
      } else {
        addLog(`Suppression terminée : ${state.stats.deleted} message(s) supprimé(s).`, 'ok');
      }
    } catch (error) {
      if (error?.message !== 'STOP_REQUESTED') addLog(`Erreur : ${error?.message || error}`, 'error');
    } finally {
      state.running = false;
      state.paused = false;
      state.pauseReason = '';
      addLog(state.stopRequested ? 'Arrêt demandé.' : 'Traitement terminé.', state.stopRequested ? 'warn' : 'ok');
    }
  }

  function publicState(account = null) {
    return {
      version: VERSION,
      loggedInPseudo: account?.pseudo || null,
      accountProfileUrl: account?.url || null,
      running: state.running,
      paused: state.paused,
      stopRequested: state.stopRequested,
      pauseReason: state.pauseReason,
      settings: state.settings,
      stats: { ...state.stats },
      logs: state.logs.map(entry => ({ ...entry })),
      preview: state.preview.map(item => ({
        id: item.id,
        dateText: item.dateText,
        href: item.href,
        forumId: item.forumId,
        topicId: item.topicId,
        text: item.text,
        length: item.length
      }))
    };
  }

  async function statusWithAccount() {
    const account = await getAccount();
    if (!state.settings) await loadSettings();
    return publicState(account);
  }

  browser.runtime.onMessage.addListener(message => {
    if (message?.type === 'JFC_WORKER_STATUS' || message?.type === 'JFC_WORKER_GET_STATE') {
      return statusWithAccount();
    }

    if (message?.type === 'JFC_WORKER_COMMAND') {
      const command = message.command;
      if (command === 'start') {
        if (state.running) return Promise.resolve({ ok: false, reason: 'already-running' });
        void run(message.settings || {});
        return Promise.resolve({ ok: true });
      }
      if (command === 'pause') {
        if (state.running) {
          state.paused = true;
          state.pauseReason = 'Pause manuelle.';
        }
        return Promise.resolve({ ok: true });
      }
      if (command === 'resume') {
        state.paused = false;
        state.pauseReason = '';
        return Promise.resolve({ ok: true });
      }
      if (command === 'stop') {
        state.stopRequested = true;
        state.paused = false;
        return Promise.resolve({ ok: true });
      }
      if (command === 'clear') {
        if (!state.running) {
          state.logs = [];
          state.preview = [];
          state.stats = freshStats();
          state.stopRequested = false;
        }
        return Promise.resolve({ ok: true });
      }
    }

    return undefined;
  });

  loadSettings().catch(() => {});
})();
