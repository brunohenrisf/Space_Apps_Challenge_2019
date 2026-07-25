/*
 * render.js - desenha os blocos como elementos HTML.
 *
 * Toda sequencia de comandos vira um `.stmt-list`, tanto no topo da tela
 * (com data-stack) quanto dentro de um ramo (com data-owner + data-input).
 * O arrastar/soltar so precisa conhecer esses dois alvos: `.stmt-list` e
 * `.socket`.
 */
(function (EBC) {
  'use strict';

  var Model = EBC.Model;
  var Render = {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function autosize(input) {
    var len = String(input.value || '').length;
    var min = input.dataset.kind === 'num' ? 3 : 4;
    input.style.width = (Math.max(min, len + 1) * 8 + 10) + 'px';
  }
  Render.autosize = autosize;

  function fieldInput(block, name, arg, opts) {
    var value = block.fields[name] !== undefined ? block.fields[name] : '';
    var input;

    if (arg.type === 'select') {
      input = el('select', 'field field-select');
      arg.options.forEach(function (o) {
        var op = el('option', null, o[0]);
        op.value = o[1];
        input.appendChild(op);
      });
      input.value = value;
    } else if (arg.type === 'var') {
      input = el('select', 'field field-select field-var');
      if (!opts.ws.variables.length) {
        var none = el('option', null, '(sem variáveis)');
        none.value = '';
        input.appendChild(none);
      }
      opts.ws.variables.forEach(function (v) {
        var op = el('option', null, v.name);
        op.value = v.name;
        input.appendChild(op);
      });
      input.value = value;
    } else {
      input = el('input', 'field field-' + (arg.type === 'num' ? 'num' : 'text'));
      input.type = 'text';
      input.inputMode = arg.type === 'num' ? 'decimal' : 'text';
      input.dataset.kind = arg.type === 'num' ? 'num' : 'str';
      input.value = value;
      autosize(input);
    }

    input.dataset.block = block.id;
    input.dataset.arg = name;
    if (opts.preview) {
      input.tabIndex = -1;
      input.disabled = true;
    }
    return input;
  }

  function socket(block, name, arg, opts) {
    var s = el('span', 'socket socket-' + arg.type);
    s.dataset.owner = block.id;
    s.dataset.input = name;
    s.dataset.accepts = arg.type;

    var childId = block.values[name];
    if (childId && opts.ws.blocks[childId]) {
      s.classList.add('filled');
      s.appendChild(Render.block(opts.ws, childId, opts));
    } else if (arg.type === 'bool') {
      s.classList.add('empty', 'bool');
    } else {
      s.classList.add('empty');
      s.appendChild(fieldInput(block, name, arg, opts));
    }
    return s;
  }

  /** Um `.stmt-list`, com marcador de "arraste aqui" quando vazio. */
  Render.stmtList = function (ws, ids, meta, opts) {
    var list = el('div', 'stmt-list');
    if (meta.stackIndex !== undefined) {
      list.dataset.stack = String(meta.stackIndex);
    } else {
      list.dataset.owner = meta.ownerId;
      list.dataset.input = meta.input;
    }
    if (!ids.length) list.classList.add('is-empty');
    ids.forEach(function (id) {
      if (ws.blocks[id]) list.appendChild(Render.block(ws, id, opts));
    });
    return list;
  };

  /** Desenha um bloco (e recursivamente tudo que estiver dentro dele). */
  Render.block = function (ws, id, opts) {
    opts = opts || {};
    opts.ws = ws;
    var b = ws.blocks[id];
    var d = EBC.getDef(b.type);
    var cat = EBC.CATEGORIES[d.cat];

    var root = el('div', 'block block-' + d.kind + (opts.preview ? ' is-preview' : ''));
    root.dataset.id = id;
    root.dataset.type = b.type;
    root.dataset.kind = d.kind;
    if (d.out) root.dataset.out = d.out;
    root.style.setProperty('--c', cat.color);
    if (d.tip) root.title = d.tip;

    EBC.parseText(d.text).forEach(function (line) {
      if (line.branch) {
        var branch = el('div', 'branch');
        branch.appendChild(Render.stmtList(ws, b.stmts[line.branch] || [],
          { ownerId: id, input: line.branch }, opts));
        root.appendChild(branch);
        return;
      }
      var row = el('div', 'row');
      line.parts.forEach(function (p) {
        if (p.label !== undefined) {
          var t = p.label;
          if (!t.trim()) {
            row.appendChild(document.createTextNode(' '));
            return;
          }
          row.appendChild(el('span', 'lbl', t.trim()));
          return;
        }
        var arg = d.args[p.arg];
        if (!arg) return;
        if (arg.kind === 'value') row.appendChild(socket(b, p.arg, arg, opts));
        else if (arg.kind === 'field') row.appendChild(fieldInput(b, p.arg, arg, opts));
      });
      root.appendChild(row);
    });

    return root;
  };

  /** Redesenha a area de trabalho inteira. */
  Render.workspace = function (ws, surface, opts) {
    opts = opts || {};
    var keep = surface.querySelector('#drag-layer');
    surface.innerHTML = '';
    ws.stacks.forEach(function (stack, i) {
      var wrap = el('div', 'stack');
      wrap.style.left = stack.x + 'px';
      wrap.style.top = stack.y + 'px';
      wrap.dataset.stack = String(i);
      wrap.appendChild(Render.stmtList(ws, stack.list, { stackIndex: i }, opts));
      surface.appendChild(wrap);
    });
    if (keep) surface.appendChild(keep);
  };

  /** Miniatura usada na paleta lateral. */
  Render.preview = function (ws, type) {
    var tmp = Model.create();
    tmp.variables = ws.variables;
    var id = Model.newBlock(tmp, type);
    var node = Render.block(tmp, id, { preview: true });
    node.removeAttribute('data-id');
    return node;
  };

  EBC.Render = Render;
})(window.EBC = window.EBC || {});
