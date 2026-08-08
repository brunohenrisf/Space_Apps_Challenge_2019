/**
 * Histórico de ações da casa.
 *
 * JSONL append-only, uma linha por evento, arquivo por mês. Não é banco
 * por escolha, não por preguiça:
 *
 *  - Zero dependência nativa. `better-sqlite3` compila, e compilar em
 *    arm64/armhf no Pi de um cliente é onde a instalação trava.
 *  - Volume não pede banco. Uma casa movimentada gera ~200 eventos por
 *    dia; um ano cabe em 7 MB e carrega na memória em menos de um
 *    segundo. Filtrar 70 mil objetos leva microssegundos.
 *  - Dá para depurar com `tail`. Num chamado às 22h isso vale muito.
 *  - Backup é `tar`. Restaurar é copiar de volta.
 *
 * Se um dia a casa virar prédio, SQLite entra no lugar sem que nada
 * fora deste arquivo precise mudar.
 */
import { appendFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Um evento: { ts, id, acao, valor, modo, origem } */
export class Historico {
  #dir;
  #memoria = [];          // tudo que foi lido na partida + o que entrou depois
  #maxDias;

  constructor(dir, { maxDias = 120 } = {}) {
    this.#dir = dir;
    this.#maxDias = maxDias;
    mkdirSync(dir, { recursive: true });
    this.#carregar();
  }

  #arquivo(ts) {
    const d = new Date(ts);
    return join(this.#dir, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.jsonl`);
  }

  #carregar() {
    const corte = Date.now() - this.#maxDias * 864e5;
    if (!existsSync(this.#dir)) return;

    for (const nome of readdirSync(this.#dir).filter(n => n.endsWith('.jsonl')).sort()) {
      for (const linha of readFileSync(join(this.#dir, nome), 'utf8').split('\n')) {
        if (!linha) continue;
        try {
          const e = JSON.parse(linha);
          if (e.ts >= corte) this.#memoria.push(e);
        } catch (_) { /* linha truncada por queda de energia: descarta e segue */ }
      }
    }
    this.#memoria.sort((a, b) => a.ts - b.ts);
  }

  /**
   * Registra um evento.
   * `origem` é o que torna o aprendizado possível: só ação manual conta
   * como sinal. Se a rotina que a casa criou realimentasse o histórico,
   * ela confirmaria o próprio palpite para sempre.
   */
  registrar(ev) {
    const e = { ts: Date.now(), ...ev };
    this.#memoria.push(e);
    try {
      appendFileSync(this.#arquivo(e.ts), JSON.stringify(e) + '\n');
    } catch (err) {
      console.error('[hist] não consegui gravar:', err.message);
    }
    return e;
  }

  /** Eventos dos últimos N dias, opcionalmente filtrados. */
  desde(dias, filtro) {
    const corte = Date.now() - dias * 864e5;
    let out = this.#memoria.filter(e => e.ts >= corte);
    if (filtro) out = out.filter(filtro);
    return out;
  }

  get tamanho() { return this.#memoria.length; }
}

/** Dia útil ou fim de semana — a divisão que a casa de fato tem. */
export const tipoDeDia = ts => {
  const d = new Date(ts).getDay();
  return d === 0 || d === 6 ? 'fds' : 'util';
};

/** Faixa de 15 minutos dentro do dia: 0..95. */
export const faixa = ts => {
  const d = new Date(ts);
  return d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
};

export const faixaParaHora = f => {
  const h = Math.floor(f / 4), m = (f % 4) * 15;
  return `${String(h).padStart(2, '0')}h${m ? String(m).padStart(2, '0') : ''}`;
};
