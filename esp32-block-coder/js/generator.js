/*
 * generator.js - transforma a arvore de blocos num sketch .ino para ESP32.
 *
 * O contexto passado para cada bloco (`c`) permite registrar coisas que nao
 * moram no ponto onde o bloco esta: includes, objetos globais, linhas extras
 * no comeco do setup() e funcoes auxiliares.
 */
(function (EBC) {
  'use strict';

  var Model = EBC.Model;

  function indent(text, pad) {
    pad = pad || '  ';
    if (!text) return '';
    return text.split('\n').map(function (l) {
      return l.length ? pad + l : l;
    }).join('\n');
  }

  function sanitizeIdent(name) {
    var s = String(name || '');
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/[^A-Za-z0-9_]/g, '_');
    if (!s || /^[0-9]/.test(s)) s = '_' + s;
    return s;
  }

  var C_TYPE = { int: 'int', float: 'float', bool: 'bool', string: 'String' };

  function makeContext(ws, opts) {
    var includes = [];
    var globals = [];
    var globalKeys = {};
    var setupPre = [];
    var setupKeys = {};
    var helpers = [];
    var helperKeys = {};
    var warnings = [];
    var pinModes = {};
    var pwmPins = {};
    var nextChannel = 0;
    var tempCount = 0;

    var c = {
      opts: opts,
      ws: ws,
      warnings: warnings,

      include: function (h) {
        if (includes.indexOf(h) < 0) includes.push(h);
      },
      global: function (key, code) {
        if (globalKeys[key]) return;
        globalKeys[key] = true;
        globals.push(code);
      },
      setupLine: function (key, code) {
        if (setupKeys[key]) return;
        setupKeys[key] = true;
        setupPre.push(code);
      },
      helper: function (key, code) {
        if (helperKeys[key]) return;
        helperKeys[key] = true;
        helpers.push(code);
      },
      warn: function (msg) {
        if (warnings.indexOf(msg) < 0) warnings.push(msg);
      },

      /** Indenta um corpo de comandos e envolve em chaves. */
      wrap: function (body) {
        return body && body.trim() ? '{\n' + indent(body) + '\n}' : '{\n}';
      },
      quote: function (s) {
        return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
      },
      isLiteralPin: function (expr) {
        return /^\d+$/.test(String(expr).trim());
      },
      tempVar: function (base) {
        tempCount += 1;
        return base + (tempCount > 1 ? tempCount : '');
      },
      varName: function (name) {
        return sanitizeIdent(name);
      },

      /** Registra que o usuario ja configurou o pino manualmente. */
      markPinConfigured: function (pin) {
        if (c.isLiteralPin(pin)) pinModes[String(pin).trim()] = 'manual';
      },
      /** Configura o pino no setup automaticamente (so para pinos fixos). */
      autoPinMode: function (pin, mode) {
        if (!c.isLiteralPin(pin)) return;
        var p = String(pin).trim();
        if (pinModes[p]) return;
        pinModes[p] = mode;
        c.setupLine('pinMode:' + p, 'pinMode(' + p + ', ' + mode + ');');
      },

      /* -------------------------- PWM ------------------------------- */

      pwmAttach: function (pin, freq, res, inline) {
        var key = c.isLiteralPin(pin) ? String(pin).trim() : null;
        if (key && pwmPins[key]) {
          return inline ? '' : '// PWM do pino ' + key + ' já estava preparado';
        }
        var line;
        if (opts.core === '2') {
          var ch = nextChannel++;
          if (key) pwmPins[key] = { channel: ch, res: res };
          line = 'ledcSetup(' + ch + ', ' + freq + ', ' + res + ');\n' +
            'ledcAttachPin(' + pin + ', ' + ch + ');';
        } else {
          if (key) pwmPins[key] = { channel: null, res: res };
          line = 'ledcAttach(' + pin + ', ' + freq + ', ' + res + ');';
        }
        return line;
      },

      pwmWrite: function (pin, value) {
        var key = c.isLiteralPin(pin) ? String(pin).trim() : null;
        var info = key ? pwmPins[key] : null;
        if (!info && key) {
          // O usuario nao usou o bloco "preparar PWM": preparamos no setup.
          var setupCode = c.pwmAttach(pin, 5000, '8', true);
          if (setupCode) c.setupLine('pwm:' + key, setupCode);
          info = pwmPins[key];
        }
        if (opts.core === '2') {
          var ch = info && info.channel !== null && info.channel !== undefined ? info.channel : 0;
          if (!key) {
            c.warn('PWM com pino variável no core 2.x usa sempre o canal 0. Prefira um número fixo de pino.');
          }
          return 'ledcWrite(' + ch + ', ' + value + ');';
        }
        return 'ledcWrite(' + pin + ', ' + value + ');';
      },

      tone: function (pin, freq, ms) {
        if (opts.core === '2') {
          var ch = 15;
          c.setupLine('tone-ch', 'ledcSetup(' + ch + ', 2000, 8);');
          return 'ledcAttachPin(' + pin + ', ' + ch + ');\n' +
            'ledcWriteTone(' + ch + ', ' + freq + ');\n' +
            'delay(' + ms + ');\n' +
            'ledcWriteTone(' + ch + ', 0);';
        }
        return 'tone(' + pin + ', ' + freq + ', ' + ms + ');';
      },
      noTone: function (pin) {
        if (opts.core === '2') return 'ledcWriteTone(15, 0);';
        return 'noTone(' + pin + ');';
      },

      /* --------------------- objetos de bibliotecas ------------------ */

      dhtObject: function (pin, model) {
        var p = String(pin).replace(/[^A-Za-z0-9]/g, '_');
        var name = 'dht_' + p;
        c.include('DHT.h');
        c.global('dht:' + p, 'DHT ' + name + '(' + pin + ', ' + model + ');');
        c.setupLine('dht-begin:' + p, name + '.begin();');
        return name;
      },

      servoObject: function (pin) {
        var p = String(pin).replace(/[^A-Za-z0-9]/g, '_');
        var name = 'servo_' + p;
        c.include('ESP32Servo.h');
        c.global('servo:' + p, 'Servo ' + name + ';');
        c.setupLine('servo-attach:' + p, name + '.attach(' + pin + ');');
        return name;
      },

      /* ------------------------- resultado --------------------------- */

      collected: function () {
        return {
          includes: includes, globals: globals, setupPre: setupPre,
          helpers: helpers, warnings: warnings
        };
      }
    };

    return c;
  }

  /** Gera o codigo de um unico bloco (comando ou valor). */
  function genBlock(ws, id, c) {
    var b = Model.get(ws, id);
    if (!b) return '';
    var d = EBC.getDef(b.type);
    if (!d) return '';

    var a = { raw: {} };
    Object.keys(d.args).forEach(function (name) {
      var arg = d.args[name];
      if (arg.kind === 'stmt') {
        a[name] = genList(ws, b.stmts[name] || [], c);
        return;
      }
      if (arg.kind === 'field') {
        a.raw[name] = b.fields[name] !== undefined ? b.fields[name] : '';
        a[name] = a.raw[name];
        if (arg.type === 'var') {
          var known = ws.variables.some(function (v) { return v.name === a.raw[name]; });
          if (!known) {
            c.warn(a.raw[name]
              ? 'A variável "' + a.raw[name] + '" não existe mais. Escolha outra no bloco.'
              : 'Um bloco precisa de uma variável. Crie uma na categoria Variáveis.');
          }
        }
        return;
      }
      // arg.kind === 'value': bloco encaixado tem prioridade sobre o campo
      var child = b.values[name];
      a.raw[name] = b.fields[name] !== undefined ? b.fields[name] : '';
      if (child) {
        a[name] = genBlock(ws, child, c);
      } else if (arg.type === 'bool') {
        a[name] = 'false';
      } else if (arg.type === 'str') {
        a[name] = c.quote(a.raw[name]);
      } else {
        var n = String(a.raw[name]).trim();
        a[name] = n === '' || isNaN(Number(n)) ? '0' : n;
      }
    });

    var out = d.gen(a, c);
    return out === undefined || out === null ? '' : String(out);
  }

  /** Gera uma sequencia de comandos, uma linha por bloco. */
  function genList(ws, ids, c) {
    var parts = [];
    ids.forEach(function (id) {
      var code = genBlock(ws, id, c);
      if (code && code.trim()) parts.push(code);
    });
    return parts.join('\n');
  }

  /**
   * Gera o sketch completo.
   * @returns {{code: string, warnings: string[]}}
   */
  function generate(ws, opts) {
    opts = opts || {};
    opts.core = opts.core || '3';
    var c = makeContext(ws, opts);

    var setupHats = [];
    var loopHats = [];
    var orphans = 0;

    ws.stacks.forEach(function (stack) {
      var firstId = stack.list[0];
      var first = Model.get(ws, firstId);
      var d = first && EBC.getDef(first.type);
      if (d && d.kind === 'hat') {
        if (first.type === 'on_setup') setupHats.push(first);
        else if (first.type === 'on_loop') loopHats.push(first);
        if (stack.list.length > 1) {
          c.warn('Blocos colocados depois de um bloco-chapéu foram ignorados.');
        }
      } else {
        orphans += 1;
      }
    });

    if (orphans > 0) {
      c.warn(orphans + ' pilha(s) de blocos estão soltas e não entram no código. ' +
        'Encaixe-as em "ao iniciar" ou "repetir para sempre".');
    }
    if (setupHats.length > 1) c.warn('Existe mais de um bloco "ao iniciar". Só o primeiro foi usado.');
    if (loopHats.length > 1) c.warn('Existe mais de um bloco "repetir para sempre". Só o primeiro foi usado.');
    if (!setupHats.length && !loopHats.length) {
      c.warn('Arraste os blocos "ao iniciar" e "repetir para sempre" para começar.');
    }

    // O corpo e gerado antes do cabecalho porque e durante a geracao que os
    // blocos registram includes, globais e linhas de setup.
    var setupBody = setupHats.length ? genList(ws, setupHats[0].stmts.DO || [], c) : '';
    var loopBody = loopHats.length ? genList(ws, loopHats[0].stmts.DO || [], c) : '';

    var col = c.collected();
    var out = [];

    out.push('/*');
    out.push(' * ' + (ws.name || 'Projeto ESP32'));
    out.push(' * Gerado pelo ESP32 Block Coder.');
    out.push(' * Placa: ESP32 Dev Module | Arduino-ESP32 core ' + (opts.core === '2' ? '2.x' : '3.x'));
    out.push(' */');
    out.push('');

    if (col.includes.length) {
      col.includes.forEach(function (h) { out.push('#include <' + h + '>'); });
      out.push('');
    }

    if (ws.variables.length) {
      out.push('// Variáveis');
      ws.variables.forEach(function (v) {
        var type = C_TYPE[v.type] || 'int';
        var init = String(v.init === undefined || v.init === '' ? '0' : v.init);
        if (type === 'String') init = c.quote(v.init || '');
        if (type === 'bool' && init !== 'true' && init !== 'false') init = 'false';
        out.push(type + ' ' + sanitizeIdent(v.name) + ' = ' + init + ';');
      });
      out.push('');
    }

    if (col.globals.length) {
      out.push('// Componentes');
      col.globals.forEach(function (g) { out.push(g); });
      out.push('');
    }

    if (col.helpers.length) {
      col.helpers.forEach(function (h) { out.push(h); out.push(''); });
    }

    out.push('void setup() {');
    if (col.setupPre.length) {
      out.push(indent(col.setupPre.join('\n')));
    }
    if (setupBody.trim()) out.push(indent(setupBody));
    out.push('}');
    out.push('');
    out.push('void loop() {');
    if (loopBody.trim()) {
      out.push(indent(loopBody));
    } else {
      out.push('  // nada aqui ainda');
    }
    out.push('}');
    out.push('');

    return { code: out.join('\n'), warnings: col.warnings, libs: collectLibs(ws) };
  }

  /** Bibliotecas externas que o sketch vai precisar. */
  function collectLibs(ws) {
    var libs = [];
    Object.keys(ws.blocks).forEach(function (id) {
      var d = EBC.getDef(ws.blocks[id].type);
      if (d && d.lib && libs.indexOf(d.lib) < 0) libs.push(d.lib);
    });
    return libs;
  }

  EBC.Generator = { generate: generate, sanitizeIdent: sanitizeIdent };
})(window.EBC = window.EBC || {});
