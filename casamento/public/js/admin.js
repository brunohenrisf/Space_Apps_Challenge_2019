/* Painel dos noivos: login, galeria completa, moderação e download. */
(function () {
  'use strict';

  var $ = function (id) {
    return document.getElementById(id);
  };

  var els = {
    viewLogin: $('view-login'),
    viewPanel: $('view-panel'),
    loginForm: $('login-form'),
    password: $('password'),
    loginError: $('login-error'),
    loginSubmit: $('login-submit'),
    panelTitle: $('panel-title'),
    stats: $('stats'),
    grid: $('grid'),
    empty: $('empty'),
    panelError: $('panel-error'),
    showHidden: $('show-hidden'),
    btnDownload: $('btn-download'),
    btnRefresh: $('btn-refresh'),
    btnLogout: $('btn-logout'),
    viewer: $('viewer'),
    viewerImage: $('viewer-image'),
    viewerGuest: $('viewer-guest'),
    viewerMessage: $('viewer-message'),
    viewerMeta: $('viewer-meta'),
    viewerDownload: $('viewer-download'),
    viewerHide: $('viewer-hide'),
    viewerDelete: $('viewer-delete'),
    viewerClose: $('viewer-close'),
    viewerPrev: $('viewer-prev'),
    viewerNext: $('viewer-next'),
  };

  var photos = [];
  var visible = [];
  var current = -1;

  // --- Utilidades -----------------------------------------------------------

  function api(path, options) {
    var settings = options || {};
    settings.headers = settings.headers || {};
    settings.headers.Accept = 'application/json';
    if (settings.body) settings.headers['Content-Type'] = 'application/json';

    return fetch(path, settings).then(function (response) {
      if (response.status === 401) {
        showLogin();
        throw new Error('Sessão expirada. Entre novamente.');
      }
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!response.ok) throw new Error(data.error || 'Algo deu errado.');
          return data;
        });
    });
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    var mb = bytes / (1024 * 1024);
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return mb >= 10 ? Math.round(mb) + ' MB' : mb.toFixed(1) + ' MB';
  }

  function formatDate(iso) {
    var date = new Date(iso);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function showPanelError(message) {
    els.panelError.textContent = message;
    els.panelError.hidden = false;
  }

  // --- Telas ----------------------------------------------------------------

  function showLogin() {
    els.viewPanel.hidden = true;
    els.viewLogin.hidden = false;
    closeViewer();
  }

  function showPanel() {
    els.viewLogin.hidden = true;
    els.viewPanel.hidden = false;
  }

  els.loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    els.loginError.hidden = true;
    els.loginSubmit.disabled = true;

    api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: els.password.value }),
    })
      .then(function () {
        els.password.value = '';
        showPanel();
        return load();
      })
      .catch(function (error) {
        els.loginError.textContent = error.message;
        els.loginError.hidden = false;
      })
      .then(function () {
        els.loginSubmit.disabled = false;
      });
  });

  els.btnLogout.addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST' })
      .catch(function () {})
      .then(showLogin);
  });

  // --- Carregamento e desenho ------------------------------------------------

  function load() {
    return api('/api/admin/photos')
      .then(function (data) {
        photos = data.photos || [];
        if (data.couple && data.couple.names) {
          els.panelTitle.textContent = data.couple.names;
          document.title = 'Painel — ' + data.couple.names;
        }
        els.panelError.hidden = true;
        renderStats(data.stats);
        renderGrid();
      })
      .catch(function (error) {
        showPanelError(error.message);
      });
  }

  function plural(count, singular, many) {
    return count === 1 ? singular : many;
  }

  function renderStats(stats) {
    var cards = [
      { value: stats.total, label: plural(stats.total, 'foto', 'fotos') },
      { value: stats.guests, label: plural(stats.guests, 'convidado', 'convidados') },
      { value: formatBytes(stats.bytes), label: 'no total' },
    ];
    if (stats.hidden > 0) {
      cards.push({ value: stats.hidden, label: plural(stats.hidden, 'oculta', 'ocultas') });
    }

    els.stats.textContent = '';
    cards.forEach(function (card) {
      var box = document.createElement('div');
      box.className = 'stat';

      var value = document.createElement('p');
      value.className = 'stat-value';
      value.textContent = card.value;
      box.appendChild(value);

      var label = document.createElement('p');
      label.className = 'stat-label';
      label.textContent = card.label;
      box.appendChild(label);

      els.stats.appendChild(box);
    });
  }

  function renderGrid() {
    visible = photos.filter(function (photo) {
      return els.showHidden.checked || !photo.hidden;
    });

    els.grid.textContent = '';
    els.empty.hidden = visible.length > 0;

    visible.forEach(function (photo, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'card-photo';
      button.dataset.hidden = String(photo.hidden);
      button.setAttribute(
        'aria-label',
        'Abrir foto de ' + (photo.guestName || 'convidado sem nome'),
      );

      var img = document.createElement('img');
      img.src = '/api/admin/photos/' + photo.id + '/miniatura';
      img.alt = '';
      img.loading = 'lazy';
      button.appendChild(img);

      if (photo.hidden) {
        var badge = document.createElement('span');
        badge.className = 'card-badge';
        badge.textContent = 'oculta';
        button.appendChild(badge);
      }

      if (photo.message) {
        // SVG em vez de um caractere: nem todo aparelho tem o glifo do envelope.
        var note = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        note.setAttribute('class', 'card-note');
        note.setAttribute('viewBox', '0 0 24 24');
        note.setAttribute('aria-hidden', 'true');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 8L4.3 7H19.7L12 13z');
        note.appendChild(path);
        var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = photo.message;
        note.appendChild(title);
        button.appendChild(note);
      }

      var tag = document.createElement('span');
      tag.className = 'card-tag';
      tag.textContent = photo.guestName || formatDate(photo.uploadedAt);
      button.appendChild(tag);

      button.addEventListener('click', function () {
        openViewer(index);
      });
      els.grid.appendChild(button);
    });
  }

  els.showHidden.addEventListener('change', renderGrid);
  els.btnRefresh.addEventListener('click', load);

  els.btnDownload.addEventListener('click', function () {
    window.location.href =
      '/api/admin/download?includeHidden=' + (els.showHidden.checked ? '1' : '0');
  });

  // --- Visualizador ----------------------------------------------------------

  function openViewer(index) {
    if (index < 0 || index >= visible.length) return;
    current = index;
    var photo = visible[index];

    els.viewerImage.src = '/api/admin/photos/' + photo.id + '/arquivo';
    els.viewerImage.alt = photo.message || 'Foto enviada por ' + (photo.guestName || 'convidado');
    els.viewerGuest.textContent = photo.guestName || 'Convidado sem nome';
    els.viewerMessage.textContent = photo.message || '';
    els.viewerMeta.textContent =
      formatDate(photo.uploadedAt) + ' · ' + formatBytes(photo.size) + ' · ' + photo.originalName;
    els.viewerDownload.href = '/api/admin/photos/' + photo.id + '/arquivo?download=1';
    els.viewerHide.textContent = photo.hidden ? 'Mostrar de novo' : 'Ocultar';
    els.viewerPrev.hidden = index === 0;
    els.viewerNext.hidden = index === visible.length - 1;

    els.viewer.hidden = false;
    document.body.style.overflow = 'hidden';
    els.viewerClose.focus();
  }

  function closeViewer() {
    els.viewer.hidden = true;
    els.viewerImage.removeAttribute('src');
    document.body.style.overflow = '';
    current = -1;
  }

  function step(delta) {
    if (current === -1) return;
    var next = current + delta;
    if (next >= 0 && next < visible.length) openViewer(next);
  }

  els.viewerClose.addEventListener('click', closeViewer);
  els.viewerPrev.addEventListener('click', function () {
    step(-1);
  });
  els.viewerNext.addEventListener('click', function () {
    step(1);
  });

  els.viewer.addEventListener('click', function (event) {
    if (event.target === els.viewer) closeViewer();
  });

  document.addEventListener('keydown', function (event) {
    if (els.viewer.hidden) return;
    if (event.key === 'Escape') closeViewer();
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  });

  els.viewerHide.addEventListener('click', function () {
    if (current === -1) return;
    var photo = visible[current];

    api('/api/admin/photos/' + photo.id, {
      method: 'PATCH',
      body: JSON.stringify({ hidden: !photo.hidden }),
    })
      .then(function (data) {
        photo.hidden = data.hidden;
        renderStats(data.stats);
        var wasAt = current;
        renderGrid();
        // Se a foto saiu da lista filtrada, o visualizador não tem mais o que mostrar.
        if (visible.indexOf(photo) === -1) closeViewer();
        else openViewer(Math.min(wasAt, visible.length - 1));
      })
      .catch(function (error) {
        showPanelError(error.message);
      });
  });

  els.viewerDelete.addEventListener('click', function () {
    if (current === -1) return;
    var photo = visible[current];
    if (!window.confirm('Excluir esta foto para sempre? Não dá para desfazer.')) return;

    api('/api/admin/photos/' + photo.id, { method: 'DELETE' })
      .then(function (data) {
        photos = photos.filter(function (item) {
          return item.id !== photo.id;
        });
        renderStats(data.stats);
        var wasAt = current;
        renderGrid();
        if (visible.length === 0) closeViewer();
        else openViewer(Math.min(wasAt, visible.length - 1));
      })
      .catch(function (error) {
        showPanelError(error.message);
      });
  });

  // --- Início ---------------------------------------------------------------

  api('/api/admin/session')
    .then(function (data) {
      if (!data.authenticated) return showLogin();
      showPanel();
      return load();
    })
    .catch(showLogin);
})();
