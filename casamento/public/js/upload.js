/* Página do convidado: seleção, preparo e envio das fotos. */
(function () {
  'use strict';

  var MAX_FILES = 40;
  var CONCURRENCY = 2;
  var THUMB_EDGE = 480; // miniatura para o painel dos noivos
  var OPTIMIZE_EDGE = 2560; // ainda imprime bem, mas sobe rápido no 4G do salão
  var OPTIMIZE_MIN_BYTES = 1.2 * 1024 * 1024;
  var NAME_KEY = 'casamento:nome';

  var $ = function (id) {
    return document.getElementById(id);
  };

  var els = {
    date: $('event-date'),
    names: $('couple-names'),
    welcome: $('welcome'),
    stepPick: $('step-pick'),
    stepDetails: $('step-details'),
    stepProgress: $('step-progress'),
    stepDone: $('step-done'),
    camera: $('input-camera'),
    gallery: $('input-gallery'),
    btnCamera: $('btn-camera'),
    btnGallery: $('btn-gallery'),
    selection: $('selection'),
    pickNote: $('pick-note'),
    guestName: $('guest-name'),
    guestMessage: $('guest-message'),
    optimize: $('optimize'),
    btnSend: $('btn-send'),
    formError: $('form-error'),
    barFill: $('bar-fill'),
    progressLabel: $('progress-label'),
    uploadList: $('upload-list'),
    doneTitle: $('done-title'),
    doneText: $('done-text'),
    doneError: $('done-error'),
    btnAgain: $('btn-again'),
    btnRetry: $('btn-retry'),
  };

  var items = [];
  var uploading = false;

  // --- Cabeçalho ----------------------------------------------------------

  (function applyConfig() {
    var node = document.getElementById('config');
    var couple = {};
    try {
      couple = JSON.parse(node ? node.textContent : '{}') || {};
    } catch (error) {
      couple = {};
    }
    if (couple.names) {
      els.names.textContent = couple.names;
      document.title = 'Fotos do casamento — ' + couple.names;
    }
    if (couple.date) {
      els.date.textContent = couple.date;
      els.date.hidden = false;
    }
    els.welcome.textContent =
      couple.welcome || 'Você guardou um momento nosso na sua câmera. Manda pra gente?';
  })();

  els.guestName.value = localStorage.getItem(NAME_KEY) || '';

  // --- Seleção de arquivos -------------------------------------------------

  els.btnCamera.addEventListener('click', function () {
    els.camera.click();
  });
  els.btnGallery.addEventListener('click', function () {
    els.gallery.click();
  });
  els.camera.addEventListener('change', onPick);
  els.gallery.addEventListener('change', onPick);

  function onPick(event) {
    addFiles(event.target.files);
    event.target.value = ''; // permite escolher o mesmo arquivo de novo
  }

  function looksLikeImage(file) {
    if (file.type && file.type.indexOf('image/') === 0) return true;
    // Alguns Android entregam HEIC/HEIF com type vazio.
    return !file.type && /\.(jpe?g|png|gif|webp|avif|heic|heif)$/i.test(file.name || '');
  }

  function addFiles(fileList) {
    var rejected = 0;
    var full = false;

    Array.prototype.forEach.call(fileList || [], function (file) {
      if (!looksLikeImage(file)) {
        rejected += 1;
        return;
      }
      if (items.length >= MAX_FILES) {
        full = true;
        return;
      }
      var key = [file.name, file.size, file.lastModified].join('|');
      if (
        items.some(function (item) {
          return item.key === key;
        })
      ) {
        return;
      }
      items.push({
        key: key,
        file: file,
        url: URL.createObjectURL(file),
        state: 'pendente',
        fraction: 0,
        error: '',
      });
    });

    if (rejected > 0) {
      showFormError('Alguns arquivos não são fotos e foram ignorados.');
    } else if (full) {
      showFormError('Dá pra mandar até ' + MAX_FILES + ' fotos por vez. Envie o resto em seguida.');
    } else {
      hideFormError();
    }

    render();
  }

  function removeItem(key) {
    items = items.filter(function (item) {
      if (item.key !== key) return true;
      URL.revokeObjectURL(item.url);
      return false;
    });
    hideFormError();
    render();
  }

  function render() {
    els.selection.textContent = '';

    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'thumb';

      var img = document.createElement('img');
      img.src = item.url;
      img.alt = '';
      img.loading = 'lazy';
      li.appendChild(img);

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'thumb-remove';
      button.setAttribute('aria-label', 'Remover foto');
      button.textContent = '×';
      button.addEventListener('click', function () {
        removeItem(item.key);
      });
      li.appendChild(button);

      els.selection.appendChild(li);
    });

    var has = items.length > 0;
    els.stepDetails.hidden = !has;
    els.pickNote.hidden = has;
    els.btnSend.textContent =
      items.length > 1 ? 'Enviar ' + items.length + ' fotos' : 'Enviar foto';
  }

  function showFormError(message) {
    els.formError.textContent = message;
    els.formError.hidden = false;
  }

  function hideFormError() {
    els.formError.hidden = true;
  }

  // --- Preparo da imagem no navegador --------------------------------------

  function drawScaled(bitmap, maxEdge) {
    var scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    var ctx = canvas.getContext('2d');
    // Fundo branco: PNG com transparência vira JPEG sem alfa.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function toBlob(canvas, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(
        function (blob) {
          resolve(blob);
        },
        'image/jpeg',
        quality,
      );
    });
  }

  function loadBitmap(file) {
    if (typeof createImageBitmap !== 'function') return Promise.resolve(null);
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
      // HEIC em navegador que não decodifica, arquivo corrompido, memória etc.
      return createImageBitmap(file).catch(function () {
        return null;
      });
    });
  }

  /**
   * Devolve o que será enviado. Se o navegador não conseguir decodificar a
   * imagem (HEIC no Android, por exemplo), manda o arquivo original sem
   * miniatura — o servidor aceita e o painel exibe a original.
   */
  function prepare(file, optimize) {
    return loadBitmap(file).then(function (bitmap) {
      if (!bitmap) return { payload: file, thumb: null };

      return toBlob(drawScaled(bitmap, THUMB_EDGE), 0.7).then(function (thumb) {
        var result = { payload: file, thumb: thumb };
        var tooBig =
          file.size > OPTIMIZE_MIN_BYTES &&
          Math.max(bitmap.width, bitmap.height) > OPTIMIZE_EDGE;

        if (!optimize || !tooBig) {
          if (bitmap.close) bitmap.close();
          return result;
        }

        return toBlob(drawScaled(bitmap, OPTIMIZE_EDGE), 0.85).then(function (optimized) {
          if (bitmap.close) bitmap.close();
          if (optimized && optimized.size < file.size) result.payload = optimized;
          return result;
        });
      });
    });
  }

  // --- Envio ----------------------------------------------------------------

  function send(item, prepared) {
    return new Promise(function (resolve, reject) {
      var form = new FormData();
      form.append('photo', prepared.payload, item.file.name || 'foto.jpg');
      if (prepared.thumb) form.append('thumb', prepared.thumb, 'thumb.jpg');
      form.append('guestName', els.guestName.value.trim());
      form.append('message', els.guestMessage.value.trim());

      var request = new XMLHttpRequest();
      request.open('POST', '/api/fotos');
      request.timeout = 5 * 60 * 1000;

      request.upload.addEventListener('progress', function (event) {
        if (!event.lengthComputable) return;
        item.fraction = event.loaded / event.total;
        paintProgress();
      });

      request.addEventListener('load', function () {
        if (request.status >= 200 && request.status < 300) return resolve();
        var message = 'Não deu para enviar. Tente de novo.';
        try {
          message = JSON.parse(request.responseText).error || message;
        } catch (error) {
          /* resposta sem JSON: fica a mensagem padrão */
        }
        reject(new Error(message));
      });
      request.addEventListener('error', function () {
        reject(new Error('Sem conexão. Verifique a internet e tente de novo.'));
      });
      request.addEventListener('timeout', function () {
        reject(new Error('A conexão está lenta demais. Tente perto do roteador.'));
      });

      request.send(form);
    });
  }

  function paintProgress() {
    var queue = items.filter(function (item) {
      return item.state !== 'ok';
    });
    var total = queue.length || 1;
    var done = queue.reduce(function (sum, item) {
      return sum + (item.state === 'ok' ? 1 : item.fraction);
    }, 0);
    var sent = items.filter(function (item) {
      return item.state === 'ok';
    }).length;

    els.barFill.style.width = Math.round((done / total) * 100) + '%';
    els.progressLabel.textContent = sent + ' de ' + items.length + ' enviadas';
  }

  function renderUploadList() {
    els.uploadList.textContent = '';
    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'upload-item';
      li.dataset.state = item.state;
      li.dataset.key = item.key;

      var img = document.createElement('img');
      img.src = item.url;
      img.alt = '';
      li.appendChild(img);

      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.file.name || 'foto';
      li.appendChild(name);

      var state = document.createElement('span');
      state.className = 'state';
      state.textContent = stateLabel(item);
      li.appendChild(state);

      els.uploadList.appendChild(li);
    });
  }

  function stateLabel(item) {
    if (item.state === 'ok') return 'enviada';
    if (item.state === 'erro') return 'falhou';
    if (item.state === 'enviando') return Math.round(item.fraction * 100) + '%';
    return 'na fila';
  }

  function updateItemRow(item) {
    var row = els.uploadList.querySelector('[data-key="' + CSS.escape(item.key) + '"]');
    if (!row) return;
    row.dataset.state = item.state;
    row.querySelector('.state').textContent = stateLabel(item);
  }

  function runPool(queue, worker) {
    var index = 0;
    var lanes = [];
    for (var i = 0; i < Math.min(CONCURRENCY, queue.length); i += 1) {
      lanes.push(
        (function next() {
          if (index >= queue.length) return Promise.resolve();
          var current = queue[index];
          index += 1;
          return worker(current).then(next);
        })(),
      );
    }
    return Promise.all(lanes);
  }

  function startUpload() {
    var queue = items.filter(function (item) {
      return item.state !== 'ok';
    });
    if (queue.length === 0 || uploading) return;

    uploading = true;
    localStorage.setItem(NAME_KEY, els.guestName.value.trim());

    els.stepPick.hidden = true;
    els.stepDetails.hidden = true;
    els.stepDone.hidden = true;
    els.stepProgress.hidden = false;
    els.progressLabel.textContent = 'Preparando…';
    els.barFill.style.width = '0%';

    queue.forEach(function (item) {
      item.state = 'pendente';
      item.fraction = 0;
      item.error = '';
    });
    renderUploadList();

    var optimize = els.optimize.checked;

    runPool(queue, function (item) {
      item.state = 'enviando';
      updateItemRow(item);

      return prepare(item.file, optimize)
        .then(function (prepared) {
          return send(item, prepared);
        })
        .then(function () {
          item.state = 'ok';
          item.fraction = 1;
        })
        .catch(function (error) {
          item.state = 'erro';
          item.fraction = 0;
          item.error = error.message;
        })
        .then(function () {
          updateItemRow(item);
          paintProgress();
        });
    }).then(finish);
  }

  function finish() {
    uploading = false;

    var failed = items.filter(function (item) {
      return item.state === 'erro';
    });
    var sent = items.length - failed.length;

    els.stepProgress.hidden = true;
    els.stepDone.hidden = false;

    if (failed.length === 0) {
      els.doneTitle.textContent = sent > 1 ? 'Recebemos suas fotos!' : 'Recebemos sua foto!';
      els.doneText.textContent =
        'Obrigado por registrar esse momento com a gente. Se tirar mais, é só voltar aqui.';
      els.doneError.hidden = true;
      els.btnRetry.hidden = true;

      items.forEach(function (item) {
        URL.revokeObjectURL(item.url);
      });
      items = [];
      render();
    } else {
      els.doneTitle.textContent = sent > 0 ? 'Quase lá' : 'Não consegui enviar';
      els.doneText.textContent =
        sent > 0
          ? sent + ' de ' + (sent + failed.length) + ' fotos foram enviadas.'
          : 'Nenhuma foto chegou aos noivos.';
      els.doneError.textContent = failed[0].error;
      els.doneError.hidden = false;
      els.btnRetry.hidden = false;
    }
  }

  els.btnSend.addEventListener('click', startUpload);
  els.btnRetry.addEventListener('click', startUpload);

  els.btnAgain.addEventListener('click', function () {
    els.stepDone.hidden = true;
    els.stepPick.hidden = false;
    els.stepDetails.hidden = items.length === 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('beforeunload', function (event) {
    if (!uploading) return;
    event.preventDefault();
    event.returnValue = '';
  });
})();
