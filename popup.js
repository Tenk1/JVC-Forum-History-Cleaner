/* global browser */
(() => {
  'use strict';

  const STORAGE_KEY = 'jfc.settings.v1';
  const DEFAULTS = {
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

  let pollTimer = null;
  let lastState = null;
  let connected = false;

  const $ = selector => document.querySelector(selector);


  function safeJvcHref(value) {
    try {
      const url = new URL(String(value || ''), 'https://www.jeuxvideo.com/');
      return url.protocol === 'https:' && url.hostname === 'www.jeuxvideo.com' ? url.href : 'https://www.jeuxvideo.com/';
    } catch (_) {
      return 'https://www.jeuxvideo.com/';
    }
  }

  function renderPreview(preview) {
    const container = $('#preview');
    const fragment = document.createDocumentFragment();

    if (!preview.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Aucun résultat pour le moment.';
      fragment.appendChild(empty);
    } else {
      for (const item of preview) {
        const card = document.createElement('div');
        card.className = 'preview-item';

        const link = document.createElement('a');
        link.href = safeJvcHref(item.href);
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = `#${String(item.id ?? '')}`;
        card.appendChild(link);

        const meta = document.createElement('small');
        const parts = [];
        if (item.dateText) parts.push(String(item.dateText));
        if (item.forumId) parts.push(`forum ${String(item.forumId)}`);
        if (item.topicId) parts.push(`topic ${String(item.topicId)}`);
        meta.textContent = parts.join(' · ');
        card.appendChild(meta);

        const excerpt = document.createElement('div');
        const text = String(item.text || '');
        excerpt.textContent = `${text.slice(0, 160)}${text.length > 160 ? '…' : ''}`;
        card.appendChild(excerpt);

        fragment.appendChild(card);
      }
    }

    container.replaceChildren(fragment);
  }

  function renderLogs(logs) {
    const container = $('#log');
    const fragment = document.createDocumentFragment();
    const allowedKinds = new Set(['info', 'ok', 'warn', 'error']);

    for (const entry of logs) {
      const line = document.createElement('div');
      line.classList.add('log-line');
      const kind = allowedKinds.has(entry?.kind) ? entry.kind : 'info';
      line.classList.add(kind);
      line.textContent = `[${String(entry?.stamp || '')}] ${String(entry?.text || '')}`;
      fragment.appendChild(line);
    }

    container.replaceChildren(fragment);
    container.scrollTop = container.scrollHeight;
  }

  async function bg(message) {
    return browser.runtime.sendMessage(message);
  }

  function readSettings() {
    return {
      dryRun: $('#dry').checked,
      fromDate: $('#from').value,
      toDate: $('#to').value,
      includeForums: $('#include-forums').value,
      excludeForums: $('#exclude-forums').value,
      keepMessages: $('#keep-messages').value,
      keepTopics: $('#keep-topics').value,
      maxLength: $('#max-length').value,
      delayMs: Math.max(500, Number($('#delay').value || 1600))
    };
  }

  function fillSettings(settings) {
    const value = { ...DEFAULTS, ...(settings || {}) };
    $('#dry').checked = Boolean(value.dryRun);
    $('#from').value = value.fromDate || '';
    $('#to').value = value.toDate || '';
    $('#include-forums').value = value.includeForums || '';
    $('#exclude-forums').value = value.excludeForums || '';
    $('#keep-messages').value = value.keepMessages || '';
    $('#keep-topics').value = value.keepTopics || '';
    $('#max-length').value = value.maxLength ?? '';
    $('#delay').value = Math.max(500, Number(value.delayMs || 1600));
  }

  async function loadStoredSettings() {
    try {
      const result = await browser.storage.local.get(STORAGE_KEY);
      fillSettings(result[STORAGE_KEY]);
    } catch (_) {
      fillSettings(DEFAULTS);
    }
  }

  function setConnectedState(state) {
    connected = Boolean(state?.loggedInPseudo);
    const status = $('#connection-status');
    const card = $('#connection-card');
    const cleaner = $('#cleaner');

    if (connected) {
      status.textContent = `Connecté : ${state.loggedInPseudo}`;
      card.hidden = true;
      cleaner.hidden = false;
    } else {
      status.textContent = 'Aucune session JVC détectée';
      card.hidden = false;
      cleaner.hidden = true;
      $('#connection-message').textContent = 'Connecte-toi à Jeuxvideo.com, puis clique sur « Réessayer ». Tu peux rester sur le site que tu consultes actuellement.';
    }
  }

  function renderState(state) {
    if (!state) return;
    lastState = state;
    setConnectedState(state);

    const stats = state.stats || {};
    $('#scanned').textContent = String(stats.scanned || 0);
    $('#matched').textContent = String(stats.matched || 0);
    $('#deleted').textContent = String(stats.deleted || 0);
    $('#failed').textContent = String(stats.failed || 0);

    let runtimeText = 'Prêt.';
    if (state.running && state.paused) runtimeText = state.pauseReason || 'En pause.';
    else if (state.running) runtimeText = `Traitement en cours · ${stats.pages || 0} page(s) lue(s)`;
    else if (state.stopRequested) runtimeText = 'Arrêté.';
    else if ((stats.scanned || 0) > 0) runtimeText = 'Terminé.';
    $('#runtime-status').textContent = runtimeText;

    const denominator = Math.max(1, Number(stats.matched || 0));
    const completed = state.settings?.dryRun
      ? Number(stats.matched || 0)
      : Number(stats.deleted || 0) + Number(stats.failed || 0);
    $('#progress-bar').style.width = `${Math.min(100, (completed / denominator) * 100)}%`;

    $('#start').disabled = Boolean(state.running) || !connected;
    $('#pause').disabled = !state.running || state.paused;
    $('#resume').disabled = !state.running || !state.paused;
    $('#stop').disabled = !state.running;
    $('#clear').disabled = Boolean(state.running);

    renderPreview(Array.isArray(state.preview) ? state.preview : []);
    renderLogs(Array.isArray(state.logs) ? state.logs : []);
  }

  async function refreshState(showLoading = false, forceReload = false) {
    if (showLoading) {
      $('#connection-status').textContent = 'Connexion à Jeuxvideo.com…';
      $('#connection-message').textContent = 'Vérification de ta session JVC…';
    }
    try {
      const state = await bg({ type: 'JFC_BG_ENSURE_HELPER', forceReload });
      renderState(state);
      return state;
    } catch (error) {
      connected = false;
      $('#connection-status').textContent = 'Impossible de joindre JVC';
      $('#connection-card').hidden = false;
      $('#cleaner').hidden = true;
      $('#connection-message').textContent = error?.message || 'Impossible de vérifier la session Jeuxvideo.com.';
      return null;
    }
  }

  async function pollState() {
    try {
      const state = await bg({ type: 'JFC_BG_GET_STATE' });
      renderState(state);
    } catch (_) {}
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollState, 500);
  }

  function openTutorial(section = null) {
    $('#tutorial').hidden = false;
    if (section) {
      const target = $(`#tutorial-${section}`);
      target?.scrollIntoView({ block: 'start' });
    }
  }

  function closeTutorial() {
    $('#tutorial').hidden = true;
  }

  function exportState() {
    if (!lastState) return;
    const payload = {
      extension: 'JVC Forum History Cleaner',
      version: lastState.version || '1.1.1',
      exportedAt: new Date().toISOString(),
      settings: readSettings(),
      stats: lastState.stats || {},
      preview: lastState.preview || [],
      logs: lastState.logs || []
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `jvc-forum-cleaner-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function sendCommand(command, settings = null) {
    try {
      const result = await bg({ type: 'JFC_BG_COMMAND', command, settings });
      await pollState();
      return result;
    } catch (error) {
      alert(error?.message || 'Impossible de communiquer avec Jeuxvideo.com.');
      return null;
    }
  }

  async function init() {
    await loadStoredSettings();

    $('#retry-session').addEventListener('click', () => refreshState(true, true));
    $('#open-jvc').addEventListener('click', () => bg({ type: 'JFC_BG_OPEN_JVC' }));
    $('#open-history').addEventListener('click', () => bg({ type: 'JFC_BG_OPEN_HISTORY' }));

    $('#start').addEventListener('click', async () => {
      if (!connected) return;
      const settings = readSettings();
      if (!settings.dryRun) {
        const confirmed = confirm('Supprimer définitivement les messages correspondant aux filtres ?');
        if (!confirmed) return;
      }
      await sendCommand('start', settings);
    });
    $('#pause').addEventListener('click', () => sendCommand('pause'));
    $('#resume').addEventListener('click', () => sendCommand('resume'));
    $('#stop').addEventListener('click', () => sendCommand('stop'));
    $('#clear').addEventListener('click', () => sendCommand('clear'));
    $('#export').addEventListener('click', exportState);

    $('#open-tutorial').addEventListener('click', () => openTutorial());
    $('#tutorial-inline').addEventListener('click', () => openTutorial());
    document.querySelectorAll('[data-tutorial]').forEach(button => {
      button.addEventListener('click', () => openTutorial(button.dataset.tutorial));
    });
    $('#close-tutorial').addEventListener('click', closeTutorial);
    $('#tutorial-done').addEventListener('click', closeTutorial);
    document.querySelectorAll('[data-close-tutorial]').forEach(element => element.addEventListener('click', closeTutorial));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('#tutorial').hidden) closeTutorial();
    });

    await refreshState(true);
    startPolling();
  }

  window.addEventListener('unload', () => {
    if (pollTimer) clearInterval(pollTimer);
  });

  init();
})();
