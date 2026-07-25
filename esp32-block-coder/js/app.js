/*
 * app.js - liga tudo: paleta, area de trabalho, painel de codigo e barra
 * de ferramentas.
 */
(function (EBC) {
  'use strict';

  var Model = EBC.Model;
  var Render = EBC.Render;

  var STORAGE_KEY = 'ebc.project.v1';
  var STORAGE_OPTS = 'ebc.opts.v1';

  var App = {
    ws: null,
    zoom: 1,
    selected: null,
    history: [],
    future: [],
    opts: { core: '3' }
  };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  /* ------------------------------ paleta ----------------------------- */

  function buildPalette() {
    var nav = $('#cat-nav');
    var list = $('#palette-blocks');
    nav.innerHTML = '';
    list.innerHTML = '';

    Object.keys(EBC.CATEGORIES).forEach(function (key) {
      var cat = EBC.CATEGORIES[key];

      var tab = document.createElement('button');
      tab.className = 'cat-tab';
      tab.dataset.cat = key;
      tab.style.setProperty('--c', cat.color);
      tab.innerHTML = '<span class="dot"></span>' + cat.name;
      tab.addEventListener('click', function () { showCategory(key); });
      nav.appendChild(tab);

      var group = document.createElement('div');
      group.className = 'cat-group';
      group.dataset.cat = key;

      var title = document.createElement('h3');
      title.className = 'cat-title';
      title.style.setProperty('--c', cat.color);
      title.textContent = cat.name;
      group.appendChild(title);

      if (key === 'variables') group.appendChild(buildVariablesPanel());

      EBC.BLOCK_ORDER.filter(function (t) { return EBC.getDef(t).cat === key; })
        .forEach(function (type) {
          var item = document.createElement('div');
          item.className = 'palette-item';
          item.dataset.type = type;
          item.appendChild(Render.preview(App.ws, type));
          var d = EBC.getDef(type);
          if (d.tip) item.title = d.tip;
          group.appendChild(item);
        });

      list.appendChild(group);
    });
  }

  function showCategory(key) {
    $$('.cat-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.cat === key);
    });
    var group = $('.cat-group[data-cat="' + key + '"]');
    if (group) group.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------------------- variaveis ---------------------------- */

  function buildVariablesPanel() {
    var box = document.createElement('div');
    box.className = 'vars-panel';

    var add = document.createElement('button');
    add.className = 'btn btn-small btn-accent';
    add.textContent = '+ Criar variável';
    add.addEventListener('click', function () {
      var name = window.prompt('Nome da variável:', 'contador');
      if (!name) return;
      App.pushHistory();
      if (!Model.addVariable(App.ws, name, 'int', '0')) {
        window.alert('Já existe uma variável com esse nome.');
        return;
      }
      afterChange();
      buildPalette();
      showCategory('variables');
    });
    box.appendChild(add);

    var ul = document.createElement('ul');
    ul.className = 'vars-list';
    App.ws.variables.forEach(function (v) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="var-name"></span>';
      li.querySelector('.var-name').textContent = v.name;

      var type = document.createElement('select');
      type.className = 'var-type';
      type.title = 'Tipo da variável';
      [['int', 'número inteiro'], ['float', 'número decimal'],
        ['bool', 'verdadeiro/falso'], ['string', 'texto']].forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0];
        op.textContent = o[1];
        type.appendChild(op);
      });
      type.value = v.type;
      type.addEventListener('change', function () {
        App.pushHistory();
        v.type = type.value;
        v.init = v.type === 'string' ? '' : (v.type === 'bool' ? 'false' : '0');
        afterChange();
      });
      li.appendChild(type);

      var ren = document.createElement('button');
      ren.className = 'icon-btn';
      ren.title = 'Renomear';
      ren.textContent = '✎';
      ren.addEventListener('click', function () {
        var nn = window.prompt('Novo nome para "' + v.name + '":', v.name);
        if (!nn) return;
        App.pushHistory();
        if (!Model.renameVariable(App.ws, v.name, nn)) {
          window.alert('Nome inválido ou já usado.');
          return;
        }
        afterChange();
        buildPalette();
        showCategory('variables');
      });

      var del = document.createElement('button');
      del.className = 'icon-btn';
      del.title = 'Apagar';
      del.textContent = '×';
      del.addEventListener('click', function () {
        App.pushHistory();
        Model.removeVariable(App.ws, v.name);
        afterChange();
        buildPalette();
        showCategory('variables');
      });

      li.appendChild(ren);
      li.appendChild(del);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }

  /* --------------------------- area de trabalho ---------------------- */

  function renderWorkspace() {
    Render.workspace(App.ws, App.surface, {});
    if (App.selected && App.ws.blocks[App.selected]) {
      var node = App.surface.querySelector('.block[data-id="' + App.selected + '"]');
      if (node) node.classList.add('selected');
    }
  }

  function applyZoom() {
    App.surface.style.transform = 'scale(' + App.zoom + ')';
    $('#zoom-label').textContent = Math.round(App.zoom * 100) + '%';
  }

  /* ---------------------------- codigo ------------------------------- */

  var KEYWORDS = ('if else for while do return break continue void int float double bool char ' +
    'true false const unsigned long short static String byte uint8_t uint16_t uint32_t uint64_t ' +
    'HIGH LOW INPUT OUTPUT INPUT_PULLUP INPUT_PULLDOWN struct class new delete').split(' ');

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlight(code) {
    var re = new RegExp([
      '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)',        // 1 comentario
      '("(?:[^"\\\\]|\\\\.)*")',                        // 2 string
      "('(?:[^'\\\\]|\\\\.)*')",                        // 3 char
      '(#\\s*\\w+)',                                    // 4 diretiva
      '\\b(\\d+\\.?\\d*[fFuUlL]*)\\b',                  // 5 numero
      '\\b(' + KEYWORDS.join('|') + ')\\b',             // 6 palavra-chave
      '\\b([A-Za-z_]\\w*)(?=\\s*\\()'                   // 7 funcao
    ].join('|'), 'g');

    var out = '';
    var last = 0;
    var m;
    while ((m = re.exec(code)) !== null) {
      out += escapeHtml(code.slice(last, m.index));
      var cls = m[1] ? 'c-com' : m[2] ? 'c-str' : m[3] ? 'c-str'
        : m[4] ? 'c-pre' : m[5] ? 'c-num' : m[6] ? 'c-kw' : 'c-fn';
      out += '<span class="' + cls + '">' + escapeHtml(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    out += escapeHtml(code.slice(last));
    return out;
  }

  var lastCode = '';

  function refreshCode() {
    var result = EBC.Generator.generate(App.ws, App.opts);
    lastCode = result.code;
    $('#code').innerHTML = highlight(result.code);

    var warnBox = $('#warnings');
    warnBox.innerHTML = '';
    result.warnings.forEach(function (w) {
      var li = document.createElement('li');
      li.textContent = w;
      warnBox.appendChild(li);
    });
    warnBox.parentElement.classList.toggle('hidden', result.warnings.length === 0);

    var libBox = $('#libs');
    libBox.innerHTML = '';
    result.libs.forEach(function (l) {
      var li = document.createElement('li');
      li.textContent = l;
      libBox.appendChild(li);
    });
    libBox.parentElement.classList.toggle('hidden', result.libs.length === 0);

    var lines = result.code.split('\n').length;
    $('#code-stats').textContent = lines + ' linhas · ' + Object.keys(App.ws.blocks).length + ' blocos';
  }

  /* ------------------------- historico / salvar ---------------------- */

  function pushSnapshot(json) {
    App.history.push(json);
    if (App.history.length > 60) App.history.shift();
    App.future.length = 0;
    updateHistoryButtons();
  }

  function pushHistory() {
    pushSnapshot(Model.serialize(App.ws));
  }

  function undo() {
    if (!App.history.length) return;
    App.future.push(Model.serialize(App.ws));
    App.ws = Model.deserialize(App.history.pop());
    App.selected = null;
    buildPalette();
    afterChange();
  }

  function redo() {
    if (!App.future.length) return;
    App.history.push(Model.serialize(App.ws));
    App.ws = Model.deserialize(App.future.pop());
    App.selected = null;
    buildPalette();
    afterChange();
  }

  function updateHistoryButtons() {
    $('#btn-undo').disabled = App.history.length === 0;
    $('#btn-redo').disabled = App.future.length === 0;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, Model.serialize(App.ws));
      localStorage.setItem(STORAGE_OPTS, JSON.stringify(App.opts));
    } catch (e) {
      /* modo privado ou armazenamento cheio: seguimos sem salvar */
    }
  }

  function afterChange() {
    if ($('#project-name').value !== App.ws.name) $('#project-name').value = App.ws.name;
    renderWorkspace();
    refreshCode();
    save();
    updateHistoryButtons();
  }

  /* --------------------------- arquivos ------------------------------ */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function slug(name) {
    var s = EBC.Generator.sanitizeIdent(name || 'projeto');
    return s.replace(/^_+|_+$/g, '') || 'projeto';
  }

  function copyCode() {
    var done = function () { flash('#btn-copy', 'Copiado!'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastCode).then(done, fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = lastCode;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignora */ }
      document.body.removeChild(ta);
    }
  }

  function flash(sel, msg) {
    var btn = $(sel);
    var old = btn.textContent;
    btn.textContent = msg;
    btn.classList.add('ok');
    setTimeout(function () {
      btn.textContent = old;
      btn.classList.remove('ok');
    }, 1200);
  }

  /* --------------------------- menus --------------------------------- */

  function buildExamplesMenu() {
    var menu = $('#examples-menu');
    menu.innerHTML = '';
    EBC.EXAMPLES.forEach(function (ex) {
      var item = document.createElement('button');
      item.className = 'menu-item';
      item.innerHTML = '<strong></strong><small></small>';
      item.querySelector('strong').textContent = ex.name;
      item.querySelector('small').textContent = ex.desc;
      item.addEventListener('click', function () {
        pushHistory();
        App.ws = EBC.loadExample(ex.id);
        App.selected = null;
        closeMenus();
        buildPalette();
        afterChange();
      });
      menu.appendChild(item);
    });
  }

  function closeMenus() {
    $$('.menu').forEach(function (m) { m.classList.add('hidden'); });
  }

  function showContextMenu(x, y, id) {
    var menu = $('#ctx-menu');
    menu.innerHTML = '';
    var def = Model.defOf(App.ws, id);

    function add(label, fn) {
      var b = document.createElement('button');
      b.className = 'menu-item';
      b.textContent = label;
      b.addEventListener('click', function () {
        menu.classList.add('hidden');
        fn();
      });
      menu.appendChild(b);
    }

    add('Duplicar', function () {
      pushHistory();
      var copy = Model.duplicate(App.ws, id);
      var node = App.surface.querySelector('.block[data-id="' + id + '"]');
      var r = node.getBoundingClientRect();
      var sr = App.surface.getBoundingClientRect();
      Model.addStack(App.ws, [copy],
        (r.left - sr.left) / App.zoom + 24, (r.top - sr.top) / App.zoom + 24);
      afterChange();
    });

    add('Apagar', function () {
      pushHistory();
      Model.deleteBlock(App.ws, id);
      App.selected = null;
      afterChange();
    });

    if (def && def.tip) {
      var info = document.createElement('div');
      info.className = 'menu-info';
      info.textContent = def.tip;
      menu.appendChild(info);
    }

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.remove('hidden');
  }

  /* ---------------------------- panorama ----------------------------- */

  function setupPanning() {
    var canvas = App.canvas;
    var panning = false;
    var start = null;

    canvas.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.block')) return;
      if (e.button !== undefined && e.button !== 0) return;
      panning = true;
      start = { x: e.clientX, y: e.clientY, sl: canvas.scrollLeft, st: canvas.scrollTop };
      canvas.classList.add('panning');
      App.selected = null;
      $$('.block.selected').forEach(function (n) { n.classList.remove('selected'); });
    });

    window.addEventListener('pointermove', function (e) {
      if (!panning) return;
      canvas.scrollLeft = start.sl - (e.clientX - start.x);
      canvas.scrollTop = start.st - (e.clientY - start.y);
    });

    window.addEventListener('pointerup', function () {
      panning = false;
      canvas.classList.remove('panning');
    });
  }

  /* ------------------------------ init -------------------------------- */

  function bindToolbar() {
    $('#btn-new').addEventListener('click', function () {
      if (!window.confirm('Começar um projeto novo? O atual será descartado.')) return;
      pushHistory();
      App.ws = EBC.loadExample('blank');
      App.selected = null;
      buildPalette();
      afterChange();
    });

    $('#btn-save').addEventListener('click', function () {
      download(slug(App.ws.name) + '.json', Model.serialize(App.ws), 'application/json');
    });

    $('#file-open').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          pushHistory();
          App.ws = Model.deserialize(String(reader.result));
          App.selected = null;
          buildPalette();
          afterChange();
        } catch (err) {
          window.alert('Não consegui ler esse arquivo: ' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $('#btn-open').addEventListener('click', function () { $('#file-open').click(); });

    $('#btn-ino').addEventListener('click', function () {
      download(slug(App.ws.name) + '.ino', lastCode, 'text/plain;charset=utf-8');
    });

    $('#btn-copy').addEventListener('click', copyCode);
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-redo').addEventListener('click', redo);

    $('#btn-examples').addEventListener('click', function (e) {
      e.stopPropagation();
      var m = $('#examples-menu');
      var wasHidden = m.classList.contains('hidden');
      closeMenus();
      m.classList.toggle('hidden', !wasHidden);
    });

    $('#core-select').addEventListener('change', function (e) {
      App.opts.core = e.target.value;
      refreshCode();
      save();
    });

    $('#project-name').addEventListener('input', function (e) {
      App.ws.name = e.target.value;
      refreshCode();
      save();
    });

    $('#btn-zoom-in').addEventListener('click', function () {
      App.zoom = Math.min(1.6, App.zoom + 0.1);
      applyZoom();
    });
    $('#btn-zoom-out').addEventListener('click', function () {
      App.zoom = Math.max(0.4, App.zoom - 0.1);
      applyZoom();
    });
    $('#btn-zoom-reset').addEventListener('click', function () {
      App.zoom = 1;
      applyZoom();
    });

    $('#btn-help').addEventListener('click', function () {
      $('#help-modal').classList.remove('hidden');
    });
    $('#help-close').addEventListener('click', function () {
      $('#help-modal').classList.add('hidden');
    });
    $('#help-modal').addEventListener('click', function (e) {
      if (e.target.id === 'help-modal') $('#help-modal').classList.add('hidden');
    });

    $('#btn-clean').addEventListener('click', function () {
      var loose = App.ws.stacks.filter(function (s) {
        var first = App.ws.blocks[s.list[0]];
        var d = first && EBC.getDef(first.type);
        return !(d && d.kind === 'hat');
      }).length;
      if (loose && !window.confirm('Isso vai apagar ' + loose +
          ' pilha(s) de blocos que estão soltas. Continuar?')) {
        return;
      }
      pushHistory();
      // remove pilhas soltas (as que nao comecam com bloco-chapeu)
      App.ws.stacks = App.ws.stacks.filter(function (s) {
        var first = App.ws.blocks[s.list[0]];
        var d = first && EBC.getDef(first.type);
        var keep = d && d.kind === 'hat';
        if (!keep) {
          s.list.forEach(function (id) {
            Model.descendants(App.ws, id).forEach(function (x) { delete App.ws.blocks[x]; });
          });
        }
        return keep;
      });
      // reorganiza as pilhas restantes em coluna
      var y = 30;
      App.ws.stacks.forEach(function (s) {
        s.x = 30;
        s.y = y;
        y += 240;
      });
      afterChange();
    });
  }

  function bindWorkspaceEvents() {
    // campos: gravam no modelo sem redesenhar (senao o foco se perde)
    App.surface.addEventListener('input', function (e) {
      var f = e.target.closest('[data-arg]');
      if (!f) return;
      Model.setField(App.ws, f.dataset.block, f.dataset.arg, f.value);
      if (f.classList.contains('field-num') || f.classList.contains('field-text')) {
        Render.autosize(f);
      }
      refreshCode();
      save();
    });
    App.surface.addEventListener('change', function (e) {
      var f = e.target.closest('[data-arg]');
      if (!f) return;
      Model.setField(App.ws, f.dataset.block, f.dataset.arg, f.value);
      refreshCode();
      save();
    });

    // A selecao e definida ao terminar o arraste (ver drag.js): o evento
    // 'click' nao serve aqui porque o alvo original ja saiu do DOM.
    App.surface.addEventListener('contextmenu', function (e) {
      var node = e.target.closest('.block');
      if (!node || !node.dataset.id) return;
      e.preventDefault();
      App.selected = node.dataset.id;
      showContextMenu(e.clientX, e.clientY, node.dataset.id);
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('#ctx-menu')) $('#ctx-menu').classList.add('hidden');
      if (!e.target.closest('#btn-examples') && !e.target.closest('#examples-menu')) closeMenus();
    });

    document.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if ((e.key === 'Delete' || e.key === 'Backspace') && App.selected && !typing) {
        e.preventDefault();
        pushHistory();
        Model.deleteBlock(App.ws, App.selected);
        App.selected = null;
        afterChange();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if (e.key === 'Escape') {
        $('#help-modal').classList.add('hidden');
        $('#ctx-menu').classList.add('hidden');
        closeMenus();
      }
    });
  }

  function init() {
    App.canvas = $('#canvas');
    App.surface = $('#surface');
    App.dragLayer = $('#drag-layer');
    App.palette = $('#palette');
    App.trash = $('#trash');

    App.pushHistory = pushHistory;
    App.pushSnapshot = pushSnapshot;
    App.restore = function (json) { App.ws = Model.deserialize(json); };
    App.afterChange = afterChange;
    App.renderWorkspace = renderWorkspace;
    App.setTrashHot = function (on) { App.trash.classList.toggle('hot', !!on); };

    try {
      var savedOpts = localStorage.getItem(STORAGE_OPTS);
      if (savedOpts) App.opts = JSON.parse(savedOpts);
      var saved = localStorage.getItem(STORAGE_KEY);
      App.ws = saved ? Model.deserialize(saved) : EBC.loadExample('blink');
    } catch (e) {
      App.ws = EBC.loadExample('blink');
    }
    if (!App.ws) App.ws = EBC.loadExample('blank');

    $('#core-select').value = App.opts.core;
    $('#project-name').value = App.ws.name;

    buildPalette();
    buildExamplesMenu();
    bindToolbar();
    bindWorkspaceEvents();
    setupPanning();
    applyZoom();
    renderWorkspace();
    refreshCode();
    updateHistoryButtons();
    showCategory('structure');

    new EBC.Dragger(App);
    window.EBC.App = App;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.EBC = window.EBC || {});
