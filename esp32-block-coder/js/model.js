/*
 * model.js - estado do projeto e operacoes sobre a arvore de blocos.
 *
 * Formato do workspace (tambem e o formato do arquivo .json salvo):
 *   {
 *     name: 'Meu projeto',
 *     variables: [{name, type, init}],
 *     blocks: { id: {id, type, fields:{}, values:{arg:id|null}, stmts:{arg:[id]}} },
 *     stacks: [{x, y, list:[id]}],
 *     nextId: 12
 *   }
 * Nao ha ponteiro "proximo bloco": uma sequencia de comandos e simplesmente
 * uma lista de ids, seja no topo da tela (stack.list) ou dentro de um ramo
 * (bloco.stmts.NOME). Isso deixa arrastar/soltar bem mais simples.
 */
(function (EBC) {
  'use strict';

  var Model = {};

  Model.create = function () {
    return { name: 'Novo projeto', variables: [], blocks: {}, stacks: [], nextId: 1 };
  };

  /** Cria um bloco solto (ainda sem lugar no workspace) e devolve o id. */
  Model.newBlock = function (ws, type) {
    var d = EBC.getDef(type);
    if (!d) throw new Error('bloco desconhecido: ' + type);
    var id = 'b' + (ws.nextId++);
    var b = { id: id, type: type, fields: {}, values: {}, stmts: {} };
    Object.keys(d.args).forEach(function (name) {
      var arg = d.args[name];
      if (arg.kind === 'stmt') {
        b.stmts[name] = [];
      } else if (arg.kind === 'value') {
        b.values[name] = null;
        if (arg.type !== 'bool') b.fields[name] = arg.def !== undefined ? String(arg.def) : '';
      } else if (arg.kind === 'field') {
        if (arg.type === 'var') {
          b.fields[name] = ws.variables.length ? ws.variables[0].name : '';
        } else if (arg.type === 'select') {
          b.fields[name] = arg.def !== undefined ? String(arg.def) : String(arg.options[0][1]);
        } else {
          b.fields[name] = arg.def !== undefined ? String(arg.def) : '';
        }
      }
    });
    ws.blocks[id] = b;
    return id;
  };

  Model.get = function (ws, id) { return ws.blocks[id] || null; };

  Model.defOf = function (ws, id) {
    var b = ws.blocks[id];
    return b ? EBC.getDef(b.type) : null;
  };

  /** Todos os ids de um bloco e de tudo que esta preso nele. */
  Model.descendants = function (ws, id, out) {
    out = out || [];
    var b = ws.blocks[id];
    if (!b) return out;
    out.push(id);
    Object.keys(b.values).forEach(function (k) {
      if (b.values[k]) Model.descendants(ws, b.values[k], out);
    });
    Object.keys(b.stmts).forEach(function (k) {
      b.stmts[k].forEach(function (cid) { Model.descendants(ws, cid, out); });
    });
    return out;
  };

  /**
   * Onde o bloco esta preso.
   *   {kind:'list', list:[ids], index:n, ownerId?, input?, stackIndex?}
   *   {kind:'value', ownerId, input}
   *   null se estiver solto.
   */
  Model.locate = function (ws, id) {
    for (var s = 0; s < ws.stacks.length; s++) {
      var i = ws.stacks[s].list.indexOf(id);
      if (i >= 0) return { kind: 'list', list: ws.stacks[s].list, index: i, stackIndex: s };
    }
    var ids = Object.keys(ws.blocks);
    for (var k = 0; k < ids.length; k++) {
      var b = ws.blocks[ids[k]];
      var names = Object.keys(b.values);
      for (var v = 0; v < names.length; v++) {
        if (b.values[names[v]] === id) {
          return { kind: 'value', ownerId: b.id, input: names[v] };
        }
      }
      var snames = Object.keys(b.stmts);
      for (var t = 0; t < snames.length; t++) {
        var idx = b.stmts[snames[t]].indexOf(id);
        if (idx >= 0) {
          return { kind: 'list', list: b.stmts[snames[t]], index: idx, ownerId: b.id, input: snames[t] };
        }
      }
    }
    return null;
  };

  /**
   * Solta o bloco de onde estiver.
   * Para comandos, leva junto tudo que estava abaixo dele na mesma sequencia
   * (igual ao Scratch). Devolve a lista de ids que saiu.
   */
  Model.detach = function (ws, id) {
    var loc = Model.locate(ws, id);
    if (!loc) return [id];
    if (loc.kind === 'value') {
      ws.blocks[loc.ownerId].values[loc.input] = null;
      return [id];
    }
    var taken = loc.list.splice(loc.index, loc.list.length - loc.index);
    if (loc.stackIndex !== undefined && loc.list.length === 0) {
      ws.stacks.splice(loc.stackIndex, 1);
    }
    return taken;
  };

  /** Coloca uma sequencia de comandos numa lista, na posicao pedida. */
  Model.insertIntoList = function (list, ids, index) {
    var args = [index, 0].concat(ids);
    Array.prototype.splice.apply(list, args);
  };

  Model.listFor = function (ws, target) {
    if (target.stackIndex !== undefined && target.stackIndex !== null) {
      return ws.stacks[target.stackIndex].list;
    }
    return ws.blocks[target.ownerId].stmts[target.input];
  };

  /** Encaixa um bloco de valor num soquete, devolvendo o que estava la. */
  Model.plugValue = function (ws, ownerId, input, id) {
    var owner = ws.blocks[ownerId];
    var previous = owner.values[input];
    owner.values[input] = id;
    return previous;
  };

  Model.addStack = function (ws, ids, x, y) {
    ws.stacks.push({ x: Math.round(x), y: Math.round(y), list: ids.slice() });
    return ws.stacks.length - 1;
  };

  Model.deleteBlock = function (ws, id) {
    Model.detach(ws, id).forEach(function (rootId) {
      Model.descendants(ws, rootId).forEach(function (d) { delete ws.blocks[d]; });
    });
  };

  /** Copia profunda de um bloco (e de tudo dentro dele) com ids novos. */
  Model.duplicate = function (ws, id) {
    var src = ws.blocks[id];
    if (!src) return null;
    var copyId = Model.newBlock(ws, src.type);
    var copy = ws.blocks[copyId];
    Object.keys(src.fields).forEach(function (k) { copy.fields[k] = src.fields[k]; });
    Object.keys(src.values).forEach(function (k) {
      copy.values[k] = src.values[k] ? Model.duplicate(ws, src.values[k]) : null;
    });
    Object.keys(src.stmts).forEach(function (k) {
      copy.stmts[k] = src.stmts[k].map(function (cid) { return Model.duplicate(ws, cid); });
    });
    return copyId;
  };

  Model.setField = function (ws, id, name, value) {
    var b = ws.blocks[id];
    if (b) b.fields[name] = value;
  };

  /* --------------------------- variaveis ---------------------------- */

  Model.addVariable = function (ws, name, type, init) {
    name = String(name || '').trim();
    if (!name) return null;
    if (ws.variables.some(function (v) { return v.name === name; })) return null;
    ws.variables.push({ name: name, type: type || 'int', init: init === undefined ? '0' : String(init) });
    return name;
  };

  Model.removeVariable = function (ws, name) {
    ws.variables = ws.variables.filter(function (v) { return v.name !== name; });
    var fallback = ws.variables.length ? ws.variables[0].name : '';
    Object.keys(ws.blocks).forEach(function (id) {
      var b = ws.blocks[id];
      var d = EBC.getDef(b.type);
      if (!d) return;
      Object.keys(d.args).forEach(function (arg) {
        if (d.args[arg].kind === 'field' && d.args[arg].type === 'var' && b.fields[arg] === name) {
          b.fields[arg] = fallback;
        }
      });
    });
  };

  Model.renameVariable = function (ws, oldName, newName) {
    newName = String(newName || '').trim();
    if (!newName || ws.variables.some(function (v) { return v.name === newName; })) return false;
    var target = ws.variables.filter(function (v) { return v.name === oldName; })[0];
    if (!target) return false;
    target.name = newName;
    Object.keys(ws.blocks).forEach(function (id) {
      var b = ws.blocks[id];
      var d = EBC.getDef(b.type);
      if (!d) return;
      Object.keys(d.args).forEach(function (arg) {
        if (d.args[arg].kind === 'field' && d.args[arg].type === 'var' && b.fields[arg] === oldName) {
          b.fields[arg] = newName;
        }
      });
    });
    return true;
  };

  /* ------------------------- serializacao --------------------------- */

  Model.serialize = function (ws) {
    return JSON.stringify({
      format: 'esp32-block-coder',
      version: 1,
      name: ws.name,
      variables: ws.variables,
      blocks: ws.blocks,
      stacks: ws.stacks,
      nextId: ws.nextId
    }, null, 2);
  };

  /** Le um projeto salvo, descartando blocos de tipos desconhecidos. */
  Model.deserialize = function (text) {
    var data = typeof text === 'string' ? JSON.parse(text) : text;
    var ws = Model.create();
    ws.name = data.name || 'Projeto';
    ws.variables = Array.isArray(data.variables) ? data.variables : [];
    ws.nextId = data.nextId || 1;
    Object.keys(data.blocks || {}).forEach(function (id) {
      var b = data.blocks[id];
      if (!EBC.getDef(b.type)) return;
      ws.blocks[id] = {
        id: id,
        type: b.type,
        fields: b.fields || {},
        values: b.values || {},
        stmts: b.stmts || {}
      };
    });
    // remove referencias que apontam para blocos que nao existem mais
    Object.keys(ws.blocks).forEach(function (id) {
      var b = ws.blocks[id];
      Object.keys(b.values).forEach(function (k) {
        if (b.values[k] && !ws.blocks[b.values[k]]) b.values[k] = null;
      });
      Object.keys(b.stmts).forEach(function (k) {
        b.stmts[k] = (b.stmts[k] || []).filter(function (cid) { return !!ws.blocks[cid]; });
      });
    });
    (data.stacks || []).forEach(function (s) {
      var list = (s.list || []).filter(function (cid) { return !!ws.blocks[cid]; });
      if (list.length) ws.stacks.push({ x: s.x || 20, y: s.y || 20, list: list });
    });
    var maxId = 0;
    Object.keys(ws.blocks).forEach(function (id) {
      var n = parseInt(String(id).replace(/\D/g, ''), 10);
      if (!isNaN(n) && n > maxId) maxId = n;
    });
    if (ws.nextId <= maxId) ws.nextId = maxId + 1;
    return ws;
  };

  EBC.Model = Model;
})(window.EBC = window.EBC || {});
