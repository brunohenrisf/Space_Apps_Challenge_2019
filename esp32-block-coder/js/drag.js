/*
 * drag.js - arrastar blocos com ponteiro (mouse, toque ou caneta).
 *
 * Fluxo: ao pressionar um bloco ele e removido do modelo, a tela e redesenhada
 * sem ele e uma copia "flutuante" segue o ponteiro. Enquanto isso procuramos o
 * encaixe mais proximo e mostramos onde o bloco vai cair. Ao soltar, o modelo
 * e atualizado de acordo.
 */
(function (EBC) {
  'use strict';

  var Model = EBC.Model;
  var Render = EBC.Render;

  var SNAP_STMT = 90;   // distancia maxima (px) para encaixar comandos
  var SNAP_VALUE = 55;  // idem para valores

  function Dragger(app) {
    this.app = app;
    this.active = null;
    var self = this;

    // Blocos ja na area de trabalho
    app.surface.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest('input, select, button, .socket.empty > .field')) return;
      var node = e.target.closest('.block');
      if (!node || !node.dataset.id || node.closest('#drag-layer')) return;
      e.preventDefault();
      self.startExisting(e, node.dataset.id, node);
    });

    // Blocos vindos da paleta
    app.palette.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var item = e.target.closest('.palette-item');
      if (!item) return;
      e.preventDefault();
      self.startNew(e, item.dataset.type, item);
    });

    window.addEventListener('pointermove', function (e) { self.move(e); });
    window.addEventListener('pointerup', function (e) { self.end(e); });
    window.addEventListener('pointercancel', function (e) { self.end(e); });
  }

  /** Converte coordenadas da tela para coordenadas da area de trabalho. */
  Dragger.prototype.toSurface = function (clientX, clientY) {
    var r = this.app.surface.getBoundingClientRect();
    var z = this.app.zoom;
    return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
  };

  Dragger.prototype.startExisting = function (e, id, node) {
    var ws = this.app.ws;
    var def = Model.defOf(ws, id);
    var rect = node.getBoundingClientRect();
    var grab = this.toSurface(e.clientX, e.clientY);
    var origin = this.toSurface(rect.left, rect.top);

    // Guardamos o estado antes de mexer, mas so vira historico se o bloco
    // realmente for movido - um clique simples nao deve poluir o desfazer.
    var snapshot = Model.serialize(ws);
    var ids = Model.detach(ws, id);
    this.app.renderWorkspace();

    this.begin({
      snapshot: snapshot,
      ids: ids,
      kind: def.kind,
      out: def.out,
      offsetX: grab.x - origin.x,
      offsetY: grab.y - origin.y,
      pointer: { x: e.clientX, y: e.clientY },
      fromPalette: false
    });
  };

  Dragger.prototype.startNew = function (e, type, item) {
    var ws = this.app.ws;
    var def = EBC.getDef(type);
    var rect = item.getBoundingClientRect();

    var snapshot = Model.serialize(ws);
    var id = Model.newBlock(ws, type);

    // O deslocamento vem do item da paleta, que nao esta na escala do canvas.
    var z = this.app.zoom;
    this.begin({
      snapshot: snapshot,
      ids: [id],
      kind: def.kind,
      out: def.out,
      offsetX: (e.clientX - rect.left) / z,
      offsetY: (e.clientY - rect.top) / z,
      pointer: { x: e.clientX, y: e.clientY },
      fromPalette: true
    });
  };

  Dragger.prototype.begin = function (state) {
    var app = this.app;
    var ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    var inner = Render.stmtList(app.ws, state.ids, { stackIndex: -1 }, {});
    inner.removeAttribute('data-stack');
    ghost.appendChild(inner);
    app.dragLayer.appendChild(ghost);

    state.ghost = ghost;
    state.target = null;
    state.moved = false;
    this.active = state;
    document.body.classList.add('is-dragging');
    this.position(state.pointer.x, state.pointer.y);
    this.updateTarget();
  };

  Dragger.prototype.position = function (clientX, clientY) {
    var s = this.active;
    var p = this.toSurface(clientX, clientY);
    s.x = p.x - s.offsetX;
    s.y = p.y - s.offsetY;
    s.ghost.style.left = s.x + 'px';
    s.ghost.style.top = s.y + 'px';
    s.pointer = { x: clientX, y: clientY };
  };

  Dragger.prototype.move = function (e) {
    if (!this.active) return;
    e.preventDefault();
    this.active.moved = true;
    this.position(e.clientX, e.clientY);
    this.updateTarget();
    this.app.setTrashHot(this.overTrash(e.clientX, e.clientY));
  };

  Dragger.prototype.overTrash = function (x, y) {
    var t = this.app.trash.getBoundingClientRect();
    var inTrash = x >= t.left && x <= t.right && y >= t.top && y <= t.bottom;
    var p = this.app.palette.getBoundingClientRect();
    var inPalette = x >= p.left && x <= p.right && y >= p.top && y <= p.bottom;
    return inTrash || inPalette;
  };

  /* --------------------- procura do encaixe ------------------------- */

  Dragger.prototype.clearHints = function () {
    var old = this.app.surface.querySelector('.insert-marker');
    if (old) old.remove();
    Array.prototype.forEach.call(
      this.app.surface.querySelectorAll('.socket.highlight'),
      function (s) { s.classList.remove('highlight'); }
    );
  };

  Dragger.prototype.updateTarget = function () {
    var s = this.active;
    this.clearHints();
    s.target = null;
    if (s.kind === 'hat') return;   // chapeus so ficam soltos no topo

    if (s.kind === 'value') this.findSocket();
    else this.findGap();
  };

  Dragger.prototype.findSocket = function () {
    var s = this.active;
    var ghostRect = s.ghost.getBoundingClientRect();
    var px = ghostRect.left;
    var py = ghostRect.top + ghostRect.height / 2;
    var best = null;
    var bestD = SNAP_VALUE * this.app.zoom;

    Array.prototype.forEach.call(
      this.app.surface.querySelectorAll('.socket'),
      function (sock) {
        if (sock.closest('#drag-layer')) return;
        var accepts = sock.dataset.accepts;
        // um valor booleano nao entra num soquete numerico e vice-versa,
        // mas 'str' e 'num' se aceitam (numero vira texto naturalmente)
        if (accepts === 'bool' && s.out !== 'bool') return;
        if (accepts !== 'bool' && s.out === 'bool') return;
        var r = sock.getBoundingClientRect();
        var d = Math.hypot(r.left - px, (r.top + r.height / 2) - py);
        if (d < bestD) {
          bestD = d;
          best = sock;
        }
      }
    );

    if (best) {
      best.classList.add('highlight');
      s.target = { kind: 'value', ownerId: best.dataset.owner, input: best.dataset.input };
    }
  };

  Dragger.prototype.findGap = function () {
    var s = this.active;
    var ghostRect = s.ghost.getBoundingClientRect();
    var px = ghostRect.left;
    var py = ghostRect.top;
    var best = null;
    var bestD = SNAP_STMT * this.app.zoom;

    Array.prototype.forEach.call(
      this.app.surface.querySelectorAll('.stmt-list'),
      function (list) {
        if (list.closest('#drag-layer')) return;
        // nao deixa encaixar comandos direto no topo do "ao iniciar" (o ramo
        // ja e a lista correta) - listas de topo aceitam qualquer coisa
        var children = Array.prototype.filter.call(list.children, function (ch) {
          return ch.classList.contains('block');
        });
        var lr = list.getBoundingClientRect();
        var points = [];
        children.forEach(function (ch, i) {
          var r = ch.getBoundingClientRect();
          points.push({ index: i, x: r.left, y: r.top, before: ch });
        });
        points.push({
          index: children.length,
          x: lr.left + 8,
          y: children.length ? children[children.length - 1].getBoundingClientRect().bottom : lr.top + 4,
          before: null
        });
        points.forEach(function (p) {
          var d = Math.hypot(p.x - px, p.y - py);
          if (d < bestD) {
            bestD = d;
            best = { list: list, point: p };
          }
        });
      }
    );

    if (!best) return;

    var marker = document.createElement('div');
    marker.className = 'insert-marker';
    if (best.point.before) best.list.insertBefore(marker, best.point.before);
    else best.list.appendChild(marker);

    var meta = { kind: 'list', index: best.point.index };
    if (best.list.dataset.stack !== undefined) {
      meta.stackIndex = parseInt(best.list.dataset.stack, 10);
    } else {
      meta.ownerId = best.list.dataset.owner;
      meta.input = best.list.dataset.input;
    }
    s.target = meta;
  };

  /* -------------------------- soltar -------------------------------- */

  Dragger.prototype.end = function (e) {
    var s = this.active;
    if (!s) return;
    this.active = null;
    document.body.classList.remove('is-dragging');
    this.app.setTrashHot(false);
    this.clearHints();
    s.ghost.remove();

    var app = this.app;

    // Clique sem arrastar: desfaz qualquer mexida e nao registra no historico.
    if (!s.moved) {
      app.restore(s.snapshot);
      app.selected = app.ws.blocks[s.ids[0]] ? s.ids[0] : null;
      app.afterChange();
      return;
    }
    app.pushSnapshot(s.snapshot);

    var ws = app.ws;

    if (this.overTrash(s.pointer.x, s.pointer.y)) {
      s.ids.forEach(function (id) {
        Model.descendants(ws, id).forEach(function (d) { delete ws.blocks[d]; });
      });
      app.selected = null;
      app.afterChange();
      return;
    }

    if (s.target && s.target.kind === 'value') {
      var previous = Model.plugValue(ws, s.target.ownerId, s.target.input, s.ids[0]);
      if (previous) {
        // o bloco que estava no soquete volta a flutuar ao lado
        Model.addStack(ws, [previous], s.x + 24, s.y + 30);
      }
    } else if (s.target && s.target.kind === 'list') {
      var list = Model.listFor(ws, s.target);
      Model.insertIntoList(list, s.ids, s.target.index);
    } else {
      Model.addStack(ws, s.ids, Math.max(0, s.x), Math.max(0, s.y));
    }

    app.selected = s.ids[0];
    app.afterChange();
  };

  EBC.Dragger = Dragger;
})(window.EBC = window.EBC || {});
