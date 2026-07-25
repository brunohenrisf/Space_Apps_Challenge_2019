/*
 * blocks.js - catalogo de categorias e definicoes de blocos.
 *
 * Definicao de um bloco:
 *   type  : identificador unico (usado na serializacao)
 *   cat   : categoria (chave de EBC.CATEGORIES)
 *   kind  : 'hat' (chapeu, so no nivel raiz) | 'stmt' (comando) | 'value' (valor)
 *   out    : para kind 'value', o tipo devolvido: 'num' | 'bool' | 'str'
 *   text  : rotulo. Linhas separadas por "\n". Uma linha ">NOME" vira um
 *           encaixe de comandos (ramo em C). "%NOME%" insere um argumento.
 *   args  : mapa NOME -> descricao do argumento
 *             {kind:'value', type:'num'|'str'|'bool', def:valor}  encaixe com campo embutido
 *             {kind:'field', type:'num'|'str'|'select'|'var', def, options:[[rotulo,valor]]}
 *             {kind:'stmt'}                                        ramo de comandos
 *   gen   : (a, c) => codigo. Em 'stmt'/'hat' devolve comandos; em 'value',
 *           uma expressao. `a.NOME` ja vem pronto para uso, `a.raw.NOME` e o
 *           valor cru do campo. `c` e o contexto do gerador (ver generator.js).
 */
(function (EBC) {
  'use strict';

  EBC.CATEGORIES = {
    structure: { name: 'Estrutura', color: '#e2724a', icon: '\u25B6' },
    control: { name: 'Controle', color: '#e0a02c', icon: '\u21BB' },
    logic: { name: 'L\u00f3gica', color: '#4a90d9', icon: '\u2696' },
    math: { name: 'Matem\u00e1tica', color: '#2f9e6f', icon: '\u03A3' },
    text: { name: 'Texto', color: '#a763c9', icon: '\u201C' },
    variables: { name: 'Vari\u00e1veis', color: '#d8556e', icon: 'x' },
    io: { name: 'Entradas/Sa\u00eddas', color: '#22908f', icon: '\u25C9' },
    analog: { name: 'Anal\u00f3gico/PWM', color: '#7a63d0', icon: '\u223F' },
    sensors: { name: 'Sensores/Atuadores', color: '#c98a2e', icon: '\u2699' },
    serial: { name: 'Serial', color: '#5f7183', icon: '\u2328' },
    wifi: { name: 'Wi-Fi', color: '#1f87a8', icon: '\u21EB' }
  };

  var DEFS = {};
  var ORDER = [];

  function def(d) {
    DEFS[d.type] = d;
    ORDER.push(d.type);
    return d;
  }

  /* ------------------------------------------------------------------ */
  /* Estrutura                                                           */
  /* ------------------------------------------------------------------ */

  def({
    type: 'on_setup', cat: 'structure', kind: 'hat',
    tip: 'Roda uma unica vez quando a placa liga ou e reiniciada.',
    text: '\u25B6 ao iniciar (setup)\n>DO',
    args: { DO: { kind: 'stmt' } },
    gen: function (a) { return a.DO; }
  });

  def({
    type: 'on_loop', cat: 'structure', kind: 'hat',
    tip: 'Roda para sempre, repetidamente, depois do setup.',
    text: '\u21BB repetir para sempre (loop)\n>DO',
    args: { DO: { kind: 'stmt' } },
    gen: function (a) { return a.DO; }
  });

  def({
    type: 'comment', cat: 'structure', kind: 'stmt',
    tip: 'Uma anotacao no codigo. Nao faz nada na placa.',
    text: 'nota %TEXT%',
    args: { TEXT: { kind: 'field', type: 'str', def: 'explique aqui' } },
    gen: function (a) { return '// ' + a.raw.TEXT; }
  });

  def({
    type: 'raw_code', cat: 'structure', kind: 'stmt',
    tip: 'Escreva C++ direto, para o que os blocos ainda nao cobrem.',
    text: 'c\u00f3digo C++ %CODE%',
    args: { CODE: { kind: 'field', type: 'str', def: 'digitalWrite(2, HIGH);' } },
    gen: function (a) { return a.raw.CODE; }
  });

  def({
    type: 'raw_expr', cat: 'structure', kind: 'value', out: 'num',
    tip: 'Uma expressao C++ escrita a mao.',
    text: 'express\u00e3o %CODE%',
    args: { CODE: { kind: 'field', type: 'str', def: 'millis() / 1000' } },
    gen: function (a) { return '(' + a.raw.CODE + ')'; }
  });

  def({
    type: 'deep_sleep', cat: 'structure', kind: 'stmt',
    tip: 'Desliga quase tudo para economizar bateria. A placa reinicia ao acordar.',
    text: 'dormir (deep sleep) por %SEC% segundos',
    args: { SEC: { kind: 'value', type: 'num', def: 10 } },
    gen: function (a) {
      return 'esp_sleep_enable_timer_wakeup((uint64_t)(' + a.SEC + ') * 1000000ULL);\n' +
        'esp_deep_sleep_start();';
    }
  });

  def({
    type: 'restart', cat: 'structure', kind: 'stmt',
    tip: 'Reinicia a placa por software.',
    text: 'reiniciar a placa',
    args: {},
    gen: function () { return 'ESP.restart();'; }
  });

  /* ------------------------------------------------------------------ */
  /* Controle                                                            */
  /* ------------------------------------------------------------------ */

  def({
    type: 'wait_ms', cat: 'control', kind: 'stmt',
    tip: 'Pausa o programa. 1000 ms = 1 segundo.',
    text: 'esperar %MS% ms',
    args: { MS: { kind: 'value', type: 'num', def: 1000 } },
    gen: function (a) { return 'delay(' + a.MS + ');'; }
  });

  def({
    type: 'wait_us', cat: 'control', kind: 'stmt',
    tip: 'Pausa curta, em microssegundos.',
    text: 'esperar %US% \u00b5s',
    args: { US: { kind: 'value', type: 'num', def: 100 } },
    gen: function (a) { return 'delayMicroseconds(' + a.US + ');'; }
  });

  def({
    type: 'if_do', cat: 'control', kind: 'stmt',
    tip: 'Executa os comandos apenas se a condicao for verdadeira.',
    text: 'se %COND% ent\u00e3o\n>DO',
    args: { COND: { kind: 'value', type: 'bool' }, DO: { kind: 'stmt' } },
    gen: function (a, c) { return 'if (' + a.COND + ') ' + c.wrap(a.DO); }
  });

  def({
    type: 'if_else', cat: 'control', kind: 'stmt',
    tip: 'Escolhe entre dois caminhos.',
    text: 'se %COND% ent\u00e3o\n>DO\nsen\u00e3o\n>ELSE',
    args: { COND: { kind: 'value', type: 'bool' }, DO: { kind: 'stmt' }, ELSE: { kind: 'stmt' } },
    gen: function (a, c) {
      return 'if (' + a.COND + ') ' + c.wrap(a.DO) + ' else ' + c.wrap(a.ELSE);
    }
  });

  def({
    type: 'repeat_times', cat: 'control', kind: 'stmt',
    tip: 'Repete os comandos um numero fixo de vezes.',
    text: 'repetir %N% vezes\n>DO',
    args: { N: { kind: 'value', type: 'num', def: 10 }, DO: { kind: 'stmt' } },
    gen: function (a, c) {
      var i = c.tempVar('i');
      return 'for (int ' + i + ' = 0; ' + i + ' < ' + a.N + '; ' + i + '++) ' + c.wrap(a.DO);
    }
  });

  def({
    type: 'for_range', cat: 'control', kind: 'stmt',
    tip: 'Conta de um numero ate outro, guardando o valor numa variavel.',
    text: 'contar %VAR% de %FROM% at\u00e9 %TO% (passo %STEP%)\n>DO',
    args: {
      VAR: { kind: 'field', type: 'var' },
      FROM: { kind: 'value', type: 'num', def: 1 },
      TO: { kind: 'value', type: 'num', def: 10 },
      STEP: { kind: 'value', type: 'num', def: 1 },
      DO: { kind: 'stmt' }
    },
    gen: function (a, c) {
      var v = c.varName(a.raw.VAR);
      return 'for (' + v + ' = ' + a.FROM + '; ' + v + ' <= ' + a.TO + '; ' + v + ' += ' + a.STEP + ') ' + c.wrap(a.DO);
    }
  });

  def({
    type: 'while_do', cat: 'control', kind: 'stmt',
    tip: 'Repete enquanto a condicao continuar verdadeira.',
    text: 'enquanto %COND%\n>DO',
    args: { COND: { kind: 'value', type: 'bool' }, DO: { kind: 'stmt' } },
    gen: function (a, c) { return 'while (' + a.COND + ') ' + c.wrap(a.DO); }
  });

  def({
    type: 'wait_until', cat: 'control', kind: 'stmt',
    tip: 'Trava o programa ate a condicao virar verdadeira.',
    text: 'esperar at\u00e9 que %COND%',
    args: { COND: { kind: 'value', type: 'bool' } },
    gen: function (a) { return 'while (!(' + a.COND + ')) { delay(1); }'; }
  });

  def({
    type: 'break_stmt', cat: 'control', kind: 'stmt',
    tip: 'Sai da repeticao atual.',
    text: 'sair da repeti\u00e7\u00e3o',
    args: {},
    gen: function () { return 'break;'; }
  });

  def({
    type: 'continue_stmt', cat: 'control', kind: 'stmt',
    tip: 'Pula para a proxima volta da repeticao.',
    text: 'pular para a pr\u00f3xima repeti\u00e7\u00e3o',
    args: {},
    gen: function () { return 'continue;'; }
  });

  /* ------------------------------------------------------------------ */
  /* Logica                                                              */
  /* ------------------------------------------------------------------ */

  def({
    type: 'logic_bool', cat: 'logic', kind: 'value', out: 'bool',
    text: '%V%',
    args: {
      V: {
        kind: 'field', type: 'select', def: 'true',
        options: [['verdadeiro', 'true'], ['falso', 'false']]
      }
    },
    gen: function (a) { return a.raw.V; }
  });

  def({
    type: 'logic_compare', cat: 'logic', kind: 'value', out: 'bool',
    tip: 'Compara dois valores.',
    text: '%A% %OP% %B%',
    args: {
      A: { kind: 'value', type: 'num', def: 0 },
      OP: {
        kind: 'field', type: 'select', def: '==',
        options: [['=', '=='], ['\u2260', '!='], ['<', '<'], ['\u2264', '<='], ['>', '>'], ['\u2265', '>=']]
      },
      B: { kind: 'value', type: 'num', def: 0 }
    },
    gen: function (a) { return '(' + a.A + ' ' + a.raw.OP + ' ' + a.B + ')'; }
  });

  def({
    type: 'logic_op', cat: 'logic', kind: 'value', out: 'bool',
    tip: '"e" exige as duas condicoes; "ou" exige pelo menos uma.',
    text: '%A% %OP% %B%',
    args: {
      A: { kind: 'value', type: 'bool' },
      OP: { kind: 'field', type: 'select', def: '&&', options: [['e', '&&'], ['ou', '||']] },
      B: { kind: 'value', type: 'bool' }
    },
    gen: function (a) { return '(' + a.A + ' ' + a.raw.OP + ' ' + a.B + ')'; }
  });

  def({
    type: 'logic_not', cat: 'logic', kind: 'value', out: 'bool',
    tip: 'Inverte: verdadeiro vira falso e vice-versa.',
    text: 'n\u00e3o %A%',
    args: { A: { kind: 'value', type: 'bool' } },
    gen: function (a) { return '(!' + a.A + ')'; }
  });

  /* ------------------------------------------------------------------ */
  /* Matematica                                                          */
  /* ------------------------------------------------------------------ */

  def({
    type: 'math_number', cat: 'math', kind: 'value', out: 'num',
    text: '%N%',
    args: { N: { kind: 'field', type: 'num', def: 0 } },
    gen: function (a) { return a.raw.N === '' ? '0' : String(a.raw.N); }
  });

  def({
    type: 'math_arith', cat: 'math', kind: 'value', out: 'num',
    text: '%A% %OP% %B%',
    args: {
      A: { kind: 'value', type: 'num', def: 1 },
      OP: {
        kind: 'field', type: 'select', def: '+',
        options: [['+', '+'], ['\u2212', '-'], ['\u00d7', '*'], ['\u00f7', '/'], ['resto de', '%']]
      },
      B: { kind: 'value', type: 'num', def: 1 }
    },
    gen: function (a) { return '(' + a.A + ' ' + a.raw.OP + ' ' + a.B + ')'; }
  });

  def({
    type: 'math_func', cat: 'math', kind: 'value', out: 'num',
    text: '%F% de %A%',
    args: {
      F: {
        kind: 'field', type: 'select', def: 'abs',
        options: [['valor absoluto', 'abs'], ['raiz quadrada', 'sqrt'], ['seno', 'sin'],
          ['cosseno', 'cos'], ['tangente', 'tan'], ['logaritmo', 'log'], ['arredondar', 'round']]
      },
      A: { kind: 'value', type: 'num', def: 1 }
    },
    gen: function (a) { return a.raw.F + '(' + a.A + ')'; }
  });

  def({
    type: 'math_random', cat: 'math', kind: 'value', out: 'num',
    tip: 'Sorteia um numero inteiro entre os dois valores (inclusive).',
    text: 'sortear de %A% at\u00e9 %B%',
    args: {
      A: { kind: 'value', type: 'num', def: 1 },
      B: { kind: 'value', type: 'num', def: 100 }
    },
    gen: function (a) { return 'random(' + a.A + ', (' + a.B + ') + 1)'; }
  });

  def({
    type: 'math_map', cat: 'math', kind: 'value', out: 'num',
    tip: 'Converte um valor de uma faixa para outra. Ex.: 0..4095 do ADC para 0..100%.',
    text: 'converter %V% de %A1%..%A2% para %B1%..%B2%',
    args: {
      V: { kind: 'value', type: 'num', def: 0 },
      A1: { kind: 'value', type: 'num', def: 0 },
      A2: { kind: 'value', type: 'num', def: 4095 },
      B1: { kind: 'value', type: 'num', def: 0 },
      B2: { kind: 'value', type: 'num', def: 100 }
    },
    gen: function (a) {
      return 'map(' + a.V + ', ' + a.A1 + ', ' + a.A2 + ', ' + a.B1 + ', ' + a.B2 + ')';
    }
  });

  def({
    type: 'math_constrain', cat: 'math', kind: 'value', out: 'num',
    tip: 'Prende o valor entre um minimo e um maximo.',
    text: 'limitar %V% entre %A% e %B%',
    args: {
      V: { kind: 'value', type: 'num', def: 0 },
      A: { kind: 'value', type: 'num', def: 0 },
      B: { kind: 'value', type: 'num', def: 255 }
    },
    gen: function (a) { return 'constrain(' + a.V + ', ' + a.A + ', ' + a.B + ')'; }
  });

  def({
    type: 'math_millis', cat: 'math', kind: 'value', out: 'num',
    tip: 'Tempo desde que a placa ligou.',
    text: '%F% desde o in\u00edcio',
    args: {
      F: {
        kind: 'field', type: 'select', def: 'millis',
        options: [['milissegundos', 'millis'], ['microssegundos', 'micros']]
      }
    },
    gen: function (a) { return a.raw.F + '()'; }
  });

  /* ------------------------------------------------------------------ */
  /* Texto                                                               */
  /* ------------------------------------------------------------------ */

  def({
    type: 'text_string', cat: 'text', kind: 'value', out: 'str',
    text: '\u201C %S% \u201D',
    args: { S: { kind: 'field', type: 'str', def: 'ol\u00e1' } },
    gen: function (a, c) { return c.quote(a.raw.S); }
  });

  def({
    type: 'text_join', cat: 'text', kind: 'value', out: 'str',
    tip: 'Cola dois valores num texto so.',
    text: 'juntar %A% com %B%',
    args: {
      A: { kind: 'value', type: 'str', def: 'valor: ' },
      B: { kind: 'value', type: 'num', def: 0 }
    },
    gen: function (a) { return '(String(' + a.A + ') + String(' + a.B + '))'; }
  });

  def({
    type: 'text_to_number', cat: 'text', kind: 'value', out: 'num',
    tip: 'Converte um texto em numero.',
    text: 'texto %S% como %T%',
    args: {
      S: { kind: 'value', type: 'str', def: '10' },
      T: { kind: 'field', type: 'select', def: 'toInt', options: [['inteiro', 'toInt'], ['decimal', 'toFloat']] }
    },
    gen: function (a) { return 'String(' + a.S + ').' + a.raw.T + '()'; }
  });

  /* ------------------------------------------------------------------ */
  /* Variaveis                                                           */
  /* ------------------------------------------------------------------ */

  def({
    type: 'var_get', cat: 'variables', kind: 'value', out: 'num',
    text: '%VAR%',
    args: { VAR: { kind: 'field', type: 'var' } },
    gen: function (a, c) { return c.varName(a.raw.VAR); }
  });

  def({
    type: 'var_set', cat: 'variables', kind: 'stmt',
    tip: 'Guarda um valor na variavel.',
    text: 'definir %VAR% como %V%',
    args: { VAR: { kind: 'field', type: 'var' }, V: { kind: 'value', type: 'num', def: 0 } },
    gen: function (a, c) { return c.varName(a.raw.VAR) + ' = ' + a.V + ';'; }
  });

  def({
    type: 'var_change', cat: 'variables', kind: 'stmt',
    tip: 'Soma um valor ao que ja esta guardado.',
    text: 'aumentar %VAR% em %V%',
    args: { VAR: { kind: 'field', type: 'var' }, V: { kind: 'value', type: 'num', def: 1 } },
    gen: function (a, c) { return c.varName(a.raw.VAR) + ' += ' + a.V + ';'; }
  });

  /* ------------------------------------------------------------------ */
  /* Entradas/Saidas digitais                                            */
  /* ------------------------------------------------------------------ */

  def({
    type: 'pin_mode', cat: 'io', kind: 'stmt',
    tip: 'Define se o pino e entrada ou saida. Normalmente vai no "ao iniciar".',
    text: 'configurar pino %PIN% como %MODE%',
    args: {
      PIN: { kind: 'value', type: 'num', def: 2 },
      MODE: {
        kind: 'field', type: 'select', def: 'OUTPUT',
        options: [['sa\u00edda', 'OUTPUT'], ['entrada', 'INPUT'],
          ['entrada com pull-up', 'INPUT_PULLUP'], ['entrada com pull-down', 'INPUT_PULLDOWN']]
      }
    },
    gen: function (a, c) {
      c.markPinConfigured(a.PIN);
      return 'pinMode(' + a.PIN + ', ' + a.raw.MODE + ');';
    }
  });

  def({
    type: 'digital_write', cat: 'io', kind: 'stmt',
    tip: 'Liga (3,3 V) ou desliga (0 V) um pino de saida.',
    text: 'escrever digital pino %PIN% = %VAL%',
    args: {
      PIN: { kind: 'value', type: 'num', def: 2 },
      VAL: { kind: 'field', type: 'select', def: 'HIGH', options: [['ALTO (3,3 V)', 'HIGH'], ['BAIXO (0 V)', 'LOW']] }
    },
    gen: function (a, c) {
      c.autoPinMode(a.PIN, 'OUTPUT');
      return 'digitalWrite(' + a.PIN + ', ' + a.raw.VAL + ');';
    }
  });

  def({
    type: 'digital_write_expr', cat: 'io', kind: 'stmt',
    tip: 'Como o anterior, mas o nivel vem de uma condicao.',
    text: 'escrever digital pino %PIN% = %VAL%',
    args: {
      PIN: { kind: 'value', type: 'num', def: 2 },
      VAL: { kind: 'value', type: 'bool' }
    },
    gen: function (a, c) {
      c.autoPinMode(a.PIN, 'OUTPUT');
      return 'digitalWrite(' + a.PIN + ', (' + a.VAL + ') ? HIGH : LOW);';
    }
  });

  def({
    type: 'digital_toggle', cat: 'io', kind: 'stmt',
    tip: 'Inverte o estado atual do pino.',
    text: 'inverter pino %PIN%',
    args: { PIN: { kind: 'value', type: 'num', def: 2 } },
    gen: function (a, c) {
      c.autoPinMode(a.PIN, 'OUTPUT');
      return 'digitalWrite(' + a.PIN + ', !digitalRead(' + a.PIN + '));';
    }
  });

  def({
    type: 'digital_read', cat: 'io', kind: 'value', out: 'bool',
    tip: 'Le se o pino esta em nivel alto.',
    text: 'pino %PIN% est\u00e1 %VAL%',
    args: {
      PIN: { kind: 'value', type: 'num', def: 4 },
      VAL: { kind: 'field', type: 'select', def: 'HIGH', options: [['ALTO', 'HIGH'], ['BAIXO', 'LOW']] }
    },
    gen: function (a) { return '(digitalRead(' + a.PIN + ') == ' + a.raw.VAL + ')'; }
  });

  def({
    type: 'led_set', cat: 'io', kind: 'stmt',
    tip: 'Atalho para LED: ja configura o pino como saida sozinho.',
    text: 'LED no pino %PIN% %VAL%',
    args: {
      PIN: { kind: 'value', type: 'num', def: 2 },
      VAL: { kind: 'field', type: 'select', def: 'HIGH', options: [['ligado', 'HIGH'], ['desligado', 'LOW']] }
    },
    gen: function (a, c) {
      c.autoPinMode(a.PIN, 'OUTPUT');
      return 'digitalWrite(' + a.PIN + ', ' + a.raw.VAL + ');';
    }
  });

  def({
    type: 'button_pressed', cat: 'io', kind: 'value', out: 'bool',
    tip: 'Botao ligado entre o pino e o GND. Configura o pull-up interno sozinho.',
    text: 'bot\u00e3o no pino %PIN% pressionado',
    args: { PIN: { kind: 'value', type: 'num', def: 4 } },
    gen: function (a, c) {
      c.autoPinMode(a.PIN, 'INPUT_PULLUP');
      return '(digitalRead(' + a.PIN + ') == LOW)';
    }
  });

  /* ------------------------------------------------------------------ */
  /* Analogico / PWM                                                     */
  /* ------------------------------------------------------------------ */

  def({
    type: 'analog_read', cat: 'analog', kind: 'value', out: 'num',
    tip: 'Le a tensao do pino. Por padrao devolve 0..4095.',
    text: 'ler anal\u00f3gico do pino %PIN%',
    args: { PIN: { kind: 'value', type: 'num', def: 34 } },
    gen: function (a) { return 'analogRead(' + a.PIN + ')'; }
  });

  def({
    type: 'analog_read_mv', cat: 'analog', kind: 'value', out: 'num',
    tip: 'Le o pino ja convertido para milivolts.',
    text: 'ler pino %PIN% em milivolts',
    args: { PIN: { kind: 'value', type: 'num', def: 34 } },
    gen: function (a) { return 'analogReadMilliVolts(' + a.PIN + ')'; }
  });

  def({
    type: 'analog_resolution', cat: 'analog', kind: 'stmt',
    tip: 'Muda a resolucao da leitura analogica (9 a 12 bits).',
    text: 'resolu\u00e7\u00e3o da leitura anal\u00f3gica %BITS% bits',
    args: {
      BITS: {
        kind: 'field', type: 'select', def: '12',
        options: [['12 (0..4095)', '12'], ['11 (0..2047)', '11'], ['10 (0..1023)', '10'], ['9 (0..511)', '9']]
      }
    },
    gen: function (a) { return 'analogReadResolution(' + a.raw.BITS + ');'; }
  });

  def({
    type: 'pwm_setup', cat: 'analog', kind: 'stmt',
    tip: 'Prepara o pino para PWM. Use no "ao iniciar".',
    text: 'preparar PWM no pino %PIN% com %FREQ% Hz e %RES% bits',
    args: {
      PIN: { kind: 'value', type: 'num', def: 2 },
      FREQ: { kind: 'value', type: 'num', def: 5000 },
      RES: {
        kind: 'field', type: 'select', def: '8',
        options: [['8 (0..255)', '8'], ['10 (0..1023)', '10'], ['12 (0..4095)', '12']]
      }
    },
    gen: function (a, c) { return c.pwmAttach(a.PIN, a.FREQ, a.raw.RES, false); }
  });

  def({
    type: 'pwm_write', cat: 'analog', kind: 'stmt',
    tip: 'Ajusta a intensidade do PWM (brilho do LED, velocidade do motor...).',
    text: 'PWM no pino %PIN% = %V%',
    args: {
      PIN: { kind: 'value', type: 'num', def: 2 },
      V: { kind: 'value', type: 'num', def: 128 }
    },
    gen: function (a, c) { return c.pwmWrite(a.PIN, a.V); }
  });

  def({
    type: 'dac_write', cat: 'analog', kind: 'stmt',
    tip: 'Saida analogica real. So funciona nos pinos 25 e 26.',
    text: 'sa\u00edda anal\u00f3gica (DAC) pino %PIN% = %V%',
    args: {
      PIN: { kind: 'field', type: 'select', def: '25', options: [['25', '25'], ['26', '26']] },
      V: { kind: 'value', type: 'num', def: 128 }
    },
    gen: function (a) { return 'dacWrite(' + a.raw.PIN + ', ' + a.V + ');'; }
  });

  def({
    type: 'touch_read', cat: 'analog', kind: 'value', out: 'num',
    tip: 'Sensor de toque capacitivo. Quanto menor o valor, mais forte o toque.',
    text: 'leitura de toque no pino %PIN%',
    args: { PIN: { kind: 'value', type: 'num', def: 4 } },
    gen: function (a) { return 'touchRead(' + a.PIN + ')'; }
  });

  def({
    type: 'touch_pressed', cat: 'analog', kind: 'value', out: 'bool',
    tip: 'Verdadeiro quando o toque passa do limiar.',
    text: 'toque no pino %PIN% (limiar %TH%)',
    args: {
      PIN: { kind: 'value', type: 'num', def: 4 },
      TH: { kind: 'value', type: 'num', def: 40 }
    },
    gen: function (a) { return '(touchRead(' + a.PIN + ') < ' + a.TH + ')'; }
  });

  /* ------------------------------------------------------------------ */
  /* Sensores / atuadores                                                */
  /* ------------------------------------------------------------------ */

  def({
    type: 'dht_read', cat: 'sensors', kind: 'value', out: 'num',
    tip: 'Sensor DHT11/DHT22. Precisa da biblioteca "DHT sensor library".',
    lib: 'DHT sensor library (Adafruit)',
    text: 'ler %WHAT% do %MODEL% no pino %PIN%',
    args: {
      WHAT: {
        kind: 'field', type: 'select', def: 'readTemperature',
        options: [['temperatura (\u00b0C)', 'readTemperature'], ['umidade (%)', 'readHumidity']]
      },
      MODEL: { kind: 'field', type: 'select', def: 'DHT11', options: [['DHT11', 'DHT11'], ['DHT22', 'DHT22']] },
      PIN: { kind: 'field', type: 'num', def: 15 }
    },
    gen: function (a, c) {
      var obj = c.dhtObject(a.raw.PIN, a.raw.MODEL);
      return obj + '.' + a.raw.WHAT + '()';
    }
  });

  def({
    type: 'ultrasonic_cm', cat: 'sensors', kind: 'value', out: 'num',
    tip: 'Sensor de distancia HC-SR04. Devolve centimetros (0 se nao houver eco).',
    text: 'dist\u00e2ncia (cm) HC-SR04 trig %TRIG% echo %ECHO%',
    args: {
      TRIG: { kind: 'value', type: 'num', def: 5 },
      ECHO: { kind: 'value', type: 'num', def: 18 }
    },
    gen: function (a, c) {
      c.helper('lerDistanciaCM',
        'float lerDistanciaCM(int trigPin, int echoPin) {\n' +
        '  pinMode(trigPin, OUTPUT);\n' +
        '  pinMode(echoPin, INPUT);\n' +
        '  digitalWrite(trigPin, LOW);\n' +
        '  delayMicroseconds(2);\n' +
        '  digitalWrite(trigPin, HIGH);\n' +
        '  delayMicroseconds(10);\n' +
        '  digitalWrite(trigPin, LOW);\n' +
        '  unsigned long duracao = pulseIn(echoPin, HIGH, 30000UL);\n' +
        '  return duracao * 0.0343f / 2.0f;\n' +
        '}');
      return 'lerDistanciaCM(' + a.TRIG + ', ' + a.ECHO + ')';
    }
  });

  def({
    type: 'servo_write', cat: 'sensors', kind: 'stmt',
    tip: 'Gira um servo motor. Precisa da biblioteca ESP32Servo.',
    lib: 'ESP32Servo',
    text: 'girar servo do pino %PIN% para %ANG% graus',
    args: {
      PIN: { kind: 'field', type: 'num', def: 13 },
      ANG: { kind: 'value', type: 'num', def: 90 }
    },
    gen: function (a, c) {
      var obj = c.servoObject(a.raw.PIN);
      return obj + '.write(constrain(' + a.ANG + ', 0, 180));';
    }
  });

  def({
    type: 'buzzer_tone', cat: 'sensors', kind: 'stmt',
    tip: 'Toca uma nota no buzzer.',
    text: 'tocar %FREQ% Hz no pino %PIN% por %MS% ms',
    args: {
      FREQ: { kind: 'value', type: 'num', def: 440 },
      PIN: { kind: 'value', type: 'num', def: 12 },
      MS: { kind: 'value', type: 'num', def: 200 }
    },
    gen: function (a, c) { return c.tone(a.PIN, a.FREQ, a.MS); }
  });

  def({
    type: 'buzzer_stop', cat: 'sensors', kind: 'stmt',
    tip: 'Silencia o buzzer.',
    text: 'parar som no pino %PIN%',
    args: { PIN: { kind: 'value', type: 'num', def: 12 } },
    gen: function (a, c) { return c.noTone(a.PIN); }
  });

  /* ------------------------------------------------------------------ */
  /* Serial                                                              */
  /* ------------------------------------------------------------------ */

  def({
    type: 'serial_begin', cat: 'serial', kind: 'stmt',
    tip: 'Abre a comunicacao com o computador. Use no "ao iniciar".',
    text: 'iniciar Serial a %BAUD%',
    args: {
      BAUD: {
        kind: 'field', type: 'select', def: '115200',
        options: [['115200', '115200'], ['9600', '9600'], ['57600', '57600'], ['250000', '250000']]
      }
    },
    gen: function (a) { return 'Serial.begin(' + a.raw.BAUD + ');'; }
  });

  def({
    type: 'serial_print', cat: 'serial', kind: 'stmt',
    tip: 'Escreve no Monitor Serial.',
    text: 'Serial escrever %V% %NL%',
    args: {
      V: { kind: 'value', type: 'str', def: 'ol\u00e1' },
      NL: {
        kind: 'field', type: 'select', def: 'println',
        options: [['com quebra de linha', 'println'], ['na mesma linha', 'print']]
      }
    },
    gen: function (a) { return 'Serial.' + a.raw.NL + '(' + a.V + ');'; }
  });

  def({
    type: 'serial_available', cat: 'serial', kind: 'value', out: 'bool',
    tip: 'Verdadeiro quando chegou algo pela Serial.',
    text: 'chegou dado na Serial',
    args: {},
    gen: function () { return '(Serial.available() > 0)'; }
  });

  def({
    type: 'serial_read', cat: 'serial', kind: 'value', out: 'str',
    tip: 'Le o texto recebido ate a quebra de linha.',
    text: 'ler texto da Serial',
    args: {},
    gen: function () { return 'Serial.readStringUntil(\'\\n\')'; }
  });

  /* ------------------------------------------------------------------ */
  /* Wi-Fi                                                               */
  /* ------------------------------------------------------------------ */

  def({
    type: 'wifi_connect', cat: 'wifi', kind: 'stmt',
    tip: 'Conecta na rede e espera ate conseguir. Use no "ao iniciar".',
    text: 'conectar no Wi-Fi rede %SSID% senha %PASS%',
    args: {
      SSID: { kind: 'value', type: 'str', def: 'MinhaRede' },
      PASS: { kind: 'value', type: 'str', def: 'minhasenha' }
    },
    gen: function (a, c) {
      c.include('WiFi.h');
      return 'WiFi.mode(WIFI_STA);\n' +
        'WiFi.begin(' + a.SSID + ', ' + a.PASS + ');\n' +
        'while (WiFi.status() != WL_CONNECTED) {\n' +
        '  delay(500);\n' +
        '}';
    }
  });

  def({
    type: 'wifi_connected', cat: 'wifi', kind: 'value', out: 'bool',
    text: 'Wi-Fi conectado',
    args: {},
    gen: function (c0, c) { c.include('WiFi.h'); return '(WiFi.status() == WL_CONNECTED)'; }
  });

  def({
    type: 'wifi_ip', cat: 'wifi', kind: 'value', out: 'str',
    tip: 'Endereco IP que o roteador deu para a placa.',
    text: 'IP local',
    args: {},
    gen: function (c0, c) { c.include('WiFi.h'); return 'WiFi.localIP().toString()'; }
  });

  def({
    type: 'wifi_rssi', cat: 'wifi', kind: 'value', out: 'num',
    tip: 'Forca do sinal em dBm (quanto mais perto de 0, melhor).',
    text: 'for\u00e7a do sinal (dBm)',
    args: {},
    gen: function (c0, c) { c.include('WiFi.h'); return 'WiFi.RSSI()'; }
  });

  def({
    type: 'http_get', cat: 'wifi', kind: 'value', out: 'str',
    tip: 'Faz uma requisicao HTTP GET e devolve a resposta como texto.',
    text: 'HTTP GET %URL%',
    args: { URL: { kind: 'value', type: 'str', def: 'http://example.com/api' } },
    gen: function (a, c) {
      c.include('WiFi.h');
      c.include('HTTPClient.h');
      c.helper('httpGet',
        'String httpGet(String url) {\n' +
        '  if (WiFi.status() != WL_CONNECTED) return "";\n' +
        '  HTTPClient http;\n' +
        '  http.begin(url);\n' +
        '  int codigo = http.GET();\n' +
        '  String resposta = (codigo > 0) ? http.getString() : "";\n' +
        '  http.end();\n' +
        '  return resposta;\n' +
        '}');
      return 'httpGet(' + a.URL + ')';
    }
  });

  def({
    type: 'http_post', cat: 'wifi', kind: 'stmt',
    tip: 'Envia dados para um servidor via HTTP POST.',
    text: 'HTTP POST %URL% com %BODY%',
    args: {
      URL: { kind: 'value', type: 'str', def: 'http://example.com/api' },
      BODY: { kind: 'value', type: 'str', def: '{"valor":1}' }
    },
    gen: function (a, c) {
      c.include('WiFi.h');
      c.include('HTTPClient.h');
      c.helper('httpPost',
        'int httpPost(String url, String corpo) {\n' +
        '  if (WiFi.status() != WL_CONNECTED) return -1;\n' +
        '  HTTPClient http;\n' +
        '  http.begin(url);\n' +
        '  http.addHeader("Content-Type", "application/json");\n' +
        '  int codigo = http.POST(corpo);\n' +
        '  http.end();\n' +
        '  return codigo;\n' +
        '}');
      return 'httpPost(' + a.URL + ', ' + a.BODY + ');';
    }
  });

  EBC.BLOCKS = DEFS;
  EBC.BLOCK_ORDER = ORDER;

  EBC.getDef = function (type) {
    return DEFS[type] || null;
  };

  /** Divide o rotulo em linhas e cada linha em pedacos de texto/argumento. */
  EBC.parseText = function (text) {
    return text.split('\n').map(function (line) {
      if (line.charAt(0) === '>') {
        return { branch: line.slice(1).trim() };
      }
      var parts = [];
      var re = /%([A-Z0-9_]+)%/g;
      var last = 0;
      var m;
      while ((m = re.exec(line)) !== null) {
        if (m.index > last) parts.push({ label: line.slice(last, m.index) });
        parts.push({ arg: m[1] });
        last = m.index + m[0].length;
      }
      if (last < line.length) parts.push({ label: line.slice(last) });
      return { parts: parts };
    });
  };
})(window.EBC = window.EBC || {});
