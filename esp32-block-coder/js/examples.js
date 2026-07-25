/*
 * examples.js - projetos prontos para abrir com um clique.
 * Cada exemplo monta os blocos direto no modelo usando o atalho `b`.
 */
(function (EBC) {
  'use strict';

  var Model = EBC.Model;

  /** b(tipo, {f: campos, v: valores encaixados, s: ramos}) -> id */
  function builder(ws) {
    return function b(type, opts) {
      var id = Model.newBlock(ws, type);
      var blk = ws.blocks[id];
      opts = opts || {};
      Object.keys(opts.f || {}).forEach(function (k) { blk.fields[k] = String(opts.f[k]); });
      Object.keys(opts.v || {}).forEach(function (k) { blk.values[k] = opts.v[k]; });
      Object.keys(opts.s || {}).forEach(function (k) { blk.stmts[k] = opts.s[k]; });
      return id;
    };
  }

  var EXAMPLES = [
    {
      id: 'blank',
      name: 'Projeto em branco',
      desc: 'Só os blocos "ao iniciar" e "repetir para sempre".',
      build: function (ws, b) {
        Model.addStack(ws, [b('on_setup', { s: { DO: [b('serial_begin', {})] } })], 40, 40);
        Model.addStack(ws, [b('on_loop', {})], 40, 200);
      }
    },
    {
      id: 'blink',
      name: 'Pisca-pisca (Blink)',
      desc: 'LED do pino 2 acendendo e apagando a cada meio segundo.',
      build: function (ws, b) {
        Model.addStack(ws, [b('on_setup', {
          s: { DO: [b('serial_begin', {}), b('pin_mode', { f: { PIN: '2', MODE: 'OUTPUT' } })] }
        })], 40, 40);

        Model.addStack(ws, [b('on_loop', {
          s: {
            DO: [
              b('led_set', { f: { PIN: '2', VAL: 'HIGH' } }),
              b('wait_ms', { f: { MS: '500' } }),
              b('led_set', { f: { PIN: '2', VAL: 'LOW' } }),
              b('wait_ms', { f: { MS: '500' } })
            ]
          }
        })], 40, 220);
      }
    },
    {
      id: 'botao',
      name: 'Botão liga o LED',
      desc: 'Botão no pino 4 (para o GND) controla o LED do pino 2.',
      build: function (ws, b) {
        Model.addStack(ws, [b('on_setup', { s: { DO: [b('serial_begin', {})] } })], 40, 40);
        Model.addStack(ws, [b('on_loop', {
          s: {
            DO: [
              b('if_else', {
                v: { COND: b('button_pressed', { f: { PIN: '4' } }) },
                s: {
                  DO: [
                    b('led_set', { f: { PIN: '2', VAL: 'HIGH' } }),
                    b('serial_print', { f: { NL: 'println' }, v: { V: b('text_string', { f: { S: 'botão pressionado' } }) } })
                  ],
                  ELSE: [b('led_set', { f: { PIN: '2', VAL: 'LOW' } })]
                }
              }),
              b('wait_ms', { f: { MS: '50' } })
            ]
          }
        })], 40, 200);
      }
    },
    {
      id: 'potenciometro',
      name: 'Potenciômetro no Serial',
      desc: 'Lê o pino 34, converte para 0–100% e mostra no Monitor Serial.',
      build: function (ws, b) {
        Model.addVariable(ws, 'leitura', 'int', '0');
        Model.addStack(ws, [b('on_setup', { s: { DO: [b('serial_begin', {})] } })], 40, 40);
        Model.addStack(ws, [b('on_loop', {
          s: {
            DO: [
              b('var_set', {
                f: { VAR: 'leitura' },
                v: {
                  V: b('math_map', {
                    f: { A1: '0', A2: '4095', B1: '0', B2: '100' },
                    v: { V: b('analog_read', { f: { PIN: '34' } }) }
                  })
                }
              }),
              b('serial_print', {
                f: { NL: 'println' },
                v: {
                  V: b('text_join', {
                    f: { A: 'nível: ' },
                    v: { B: b('var_get', { f: { VAR: 'leitura' } }) }
                  })
                }
              }),
              b('wait_ms', { f: { MS: '200' } })
            ]
          }
        })], 40, 200);
      }
    },
    {
      id: 'fade',
      name: 'LED com brilho suave (PWM)',
      desc: 'Aumenta e diminui o brilho do LED usando PWM.',
      build: function (ws, b) {
        Model.addVariable(ws, 'brilho', 'int', '0');
        Model.addStack(ws, [b('on_setup', {
          s: { DO: [b('pwm_setup', { f: { PIN: '2', FREQ: '5000', RES: '8' } })] }
        })], 40, 40);
        Model.addStack(ws, [b('on_loop', {
          s: {
            DO: [
              b('for_range', {
                f: { VAR: 'brilho', FROM: '0', TO: '255', STEP: '5' },
                s: {
                  DO: [
                    b('pwm_write', { f: { PIN: '2' }, v: { V: b('var_get', { f: { VAR: 'brilho' } }) } }),
                    b('wait_ms', { f: { MS: '15' } })
                  ]
                }
              }),
              b('for_range', {
                f: { VAR: 'brilho', FROM: '0', TO: '255', STEP: '5' },
                s: {
                  DO: [
                    b('pwm_write', {
                      f: { PIN: '2' },
                      v: {
                        V: b('math_arith', {
                          f: { A: '255', OP: '-' },
                          v: { B: b('var_get', { f: { VAR: 'brilho' } }) }
                        })
                      }
                    }),
                    b('wait_ms', { f: { MS: '15' } })
                  ]
                }
              })
            ]
          }
        })], 40, 200);
      }
    },
    {
      id: 'dht',
      name: 'Temperatura e umidade (DHT11)',
      desc: 'Lê o sensor DHT11 no pino 15 e imprime a cada 2 segundos.',
      build: function (ws, b) {
        Model.addStack(ws, [b('on_setup', { s: { DO: [b('serial_begin', {})] } })], 40, 40);
        Model.addStack(ws, [b('on_loop', {
          s: {
            DO: [
              b('serial_print', {
                f: { NL: 'println' },
                v: {
                  V: b('text_join', {
                    f: { A: 'Temperatura (C): ' },
                    v: { B: b('dht_read', { f: { WHAT: 'readTemperature', MODEL: 'DHT11', PIN: '15' } }) }
                  })
                }
              }),
              b('serial_print', {
                f: { NL: 'println' },
                v: {
                  V: b('text_join', {
                    f: { A: 'Umidade (%): ' },
                    v: { B: b('dht_read', { f: { WHAT: 'readHumidity', MODEL: 'DHT11', PIN: '15' } }) }
                  })
                }
              }),
              b('wait_ms', { f: { MS: '2000' } })
            ]
          }
        })], 40, 200);
      }
    },
    {
      id: 'ultrassom',
      name: 'Alarme de distância',
      desc: 'HC-SR04: se algo chegar a menos de 20 cm, o buzzer apita.',
      build: function (ws, b) {
        Model.addVariable(ws, 'distancia', 'float', '0');
        Model.addStack(ws, [b('on_setup', { s: { DO: [b('serial_begin', {})] } })], 40, 40);
        Model.addStack(ws, [b('on_loop', {
          s: {
            DO: [
              b('var_set', {
                f: { VAR: 'distancia' },
                v: { V: b('ultrasonic_cm', { f: { TRIG: '5', ECHO: '18' } }) }
              }),
              b('serial_print', {
                f: { NL: 'println' },
                v: {
                  V: b('text_join', {
                    f: { A: 'cm: ' },
                    v: { B: b('var_get', { f: { VAR: 'distancia' } }) }
                  })
                }
              }),
              b('if_do', {
                v: {
                  COND: b('logic_compare', {
                    f: { OP: '<', B: '20' },
                    v: { A: b('var_get', { f: { VAR: 'distancia' } }) }
                  })
                },
                s: { DO: [b('buzzer_tone', { f: { FREQ: '880', PIN: '12', MS: '150' } })] }
              }),
              b('wait_ms', { f: { MS: '200' } })
            ]
          }
        })], 40, 200);
      }
    },
    {
      id: 'wifi',
      name: 'Conectar no Wi-Fi',
      desc: 'Conecta na rede, mostra o IP e o sinal no Monitor Serial.',
      build: function (ws, b) {
        Model.addStack(ws, [b('on_setup', {
          s: {
            DO: [
              b('serial_begin', {}),
              b('wifi_connect', { f: { SSID: 'MinhaRede', PASS: 'minhasenha' } }),
              b('serial_print', {
                f: { NL: 'println' },
                v: { V: b('text_join', { f: { A: 'IP: ' }, v: { B: b('wifi_ip', {}) } }) }
              })
            ]
          }
        })], 40, 40);
        Model.addStack(ws, [b('on_loop', {
          s: {
            DO: [
              b('if_do', {
                v: { COND: b('wifi_connected', {}) },
                s: {
                  DO: [b('serial_print', {
                    f: { NL: 'println' },
                    v: { V: b('text_join', { f: { A: 'sinal (dBm): ' }, v: { B: b('wifi_rssi', {}) } }) }
                  })]
                }
              }),
              b('wait_ms', { f: { MS: '5000' } })
            ]
          }
        })], 40, 280);
      }
    },
    {
      id: 'sleep',
      name: 'Sensor com economia de bateria',
      desc: 'Lê o sensor, envia pela Serial e entra em deep sleep por 30 s.',
      build: function (ws, b) {
        Model.addStack(ws, [b('on_setup', {
          s: {
            DO: [
              b('serial_begin', {}),
              b('wait_ms', { f: { MS: '200' } }),
              b('serial_print', {
                f: { NL: 'println' },
                v: {
                  V: b('text_join', {
                    f: { A: 'leitura: ' },
                    v: { B: b('analog_read', { f: { PIN: '34' } }) }
                  })
                }
              }),
              b('wait_ms', { f: { MS: '100' } }),
              b('deep_sleep', { f: { SEC: '30' } })
            ]
          }
        })], 40, 40);
        Model.addStack(ws, [b('on_loop', {})], 40, 320);
      }
    }
  ];

  EBC.EXAMPLES = EXAMPLES;

  EBC.loadExample = function (id) {
    var spec = EXAMPLES.filter(function (e) { return e.id === id; })[0];
    if (!spec) return null;
    var ws = Model.create();
    ws.name = spec.name;
    spec.build(ws, builder(ws));
    return ws;
  };
})(window.EBC = window.EBC || {});
