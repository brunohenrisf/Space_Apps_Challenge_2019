/**
 * O aprendiz: lê o histórico e propõe rotinas.
 *
 * Isto é a aposta do produto (docs/produto.md) e é o motivo de o painel
 * ter migrado para o Raspberry Pi — no ESP32 não havia onde guardar
 * meses de histórico nem relógio confiável para datá-lo.
 *
 * Não há modelo nem nuvem: são três detectores sobre contagem de
 * frequência. O que importa aqui não é sofisticação, é **não sugerir
 * bobagem** — uma sugestão ruim custa a confiança de todas as próximas.
 * Daí os limiares conservadores e a regra de ouro: só ação manual conta
 * como sinal.
 */
import { tipoDeDia, faixa, faixaParaHora } from './historico.mjs';

/* Limiares. Deliberadamente altos: é melhor sugerir pouco e certo. */
const JANELA_DIAS      = 30;   // horizonte de observação
const MIN_OCORRENCIAS  = 8;    // dias distintos com a ação
const MIN_CONFIANCA    = 0.60; // proporção dos dias elegíveis
const RECUO_DIAS       = 21;
const RECUO_MIN        = 4;    // disparos observados
const RECUO_RAZAO      = 0.40; // proporção cancelada na mão
const RECUO_JANELA_MIN = 10;   // minutos para considerar cancelamento
const CORR_JANELA_MIN  = 90;   // minutos após a virada de modo
const CORR_MIN         = 6;
const CORR_RAZAO       = 0.60;

const mediana = xs => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const diaDe = ts => new Date(ts).toDateString();
const arred5 = n => Math.round(n / 5) * 5;
/** Minuto do dia -> "6h45". Sem zero à esquerda: é como se fala. */
const hhmm = m => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2,'0') : ''}`;

/** Quantos dias de cada tipo existem na janela observada. */
function diasElegiveis(dias) {
  const c = { util: 0, fds: 0 };
  for (let i = 0; i < dias; i++) c[tipoDeDia(Date.now() - i * 864e5)]++;
  return c;
}

/* ═══════════════════════════════════════════════════════════════
   1. Padrão de horário
   "Você acende X quase sempre por volta das 6h45, em dia útil."
   ═══════════════════════════════════════════════════════════════ */
function padraoDeHorario(hist, catalogo) {
  const out = [];
  const elegiveis = diasElegiveis(JANELA_DIAS);

  for (const dev of catalogo.devices) {
    if (!dev.caps?.includes('onoff')) continue;

    const acoes = hist.desde(JANELA_DIAS,
      e => e.id === dev.id && e.origem === 'manual' && e.acao === 'on');
    if (acoes.length < MIN_OCORRENCIAS) continue;

    for (const tipo of ['util', 'fds']) {
      const doTipo = acoes.filter(e => tipoDeDia(e.ts) === tipo);
      if (doTipo.length < MIN_OCORRENCIAS) continue;

      // Histograma de 15 min, suavizado com os vizinhos: ninguém acende
      // a luz no mesmo minuto todo dia, e ±15 min ainda é "de manhã".
      const balde = new Array(96).fill(0);
      for (const e of doTipo) balde[faixa(e.ts)]++;
      const suave = balde.map((_, i) =>
        balde[(i + 95) % 96] + balde[i] + balde[(i + 1) % 96]);

      const pico = suave.indexOf(Math.max(...suave));
      const naJanela = doTipo.filter(e => {
        const d = Math.abs(faixa(e.ts) - pico);
        return Math.min(d, 96 - d) <= 1;
      });

      const dias = new Set(naJanela.map(e => diaDe(e.ts)));
      const confianca = dias.size / (elegiveis[tipo] || 1);
      if (dias.size < MIN_OCORRENCIAS || confianca < MIN_CONFIANCA) continue;

      // O horário e os valores propostos saem do que a casa fez, não de um
      // padrão inventado: mediana do que a família de fato usou. O balde
      // tem 15 min de largura, então anunciar o centro dele erraria em
      // até 15 min — a mediana dos horários reais, não.
      const minutos = mediana(naJanela.map(e => {
        const d = new Date(e.ts); return d.getHours() * 60 + d.getMinutes();
      }));
      const hora  = hhmm(arred5(minutos));
      const bri   = mediana(naJanela.map(e => e.valor?.bri).filter(Number.isFinite));
      const kelvin= mediana(naJanela.map(e => e.valor?.k).filter(Number.isFinite));
      const quando= tipo === 'util' ? 'de segunda a sexta' : 'aos fins de semana';
      const ajuste= [bri ? `${bri}%` : null, kelvin ? `${kelvin}K` : null].filter(Boolean).join(', ');

      out.push({
        id: `h:${dev.id}:${tipo}:${pico}`,
        tipo: 'criar',
        confianca: Math.round(confianca * 100),
        texto: `Você acende ${aspas(dev.name)} por volta das ${hora} em quase todo ${
          tipo === 'util' ? 'dia útil' : 'fim de semana'}.`,
        evidencia: `${dias.size} dos últimos ${elegiveis[tipo]} dias · sempre entre ${
          faixaParaHora(pico - 1)} e ${faixaParaHora(pico + 1)}`,
        acao: `Acender ${aspas(dev.name)}${ajuste ? ' a ' + ajuste : ''}, às ${hora}, ${quando}`,
        rotina: {
          nome: `${dev.name} às ${hora}`,
          desc: `${ajuste || 'ligada'}, ${quando}`,
          icon: 'ic-clock',
          modos: ['normal'],
          // Minuto do dia, não o balde de 15 min: o cartão anuncia um
          // horário e a rotina precisa agir naquele horário.
          gatilho: { tipo: 'hora', minuto: arred5(minutos), dias: tipo },
          passos: [{ id: dev.id, set: montarSet(bri, kelvin) }]
        }
      });
      break;   // um padrão por dispositivo já basta; mais que isso vira ruído
    }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   2. Recuo
   A rotina dispara e alguém desfaz na mão. A casa pede para parar.
   Este é o detector que impede o cliente de desligar o sistema todo.
   ═══════════════════════════════════════════════════════════════ */
function recuo(hist, rotinas) {
  const out = [];
  const janela = RECUO_JANELA_MIN * 60e3;

  for (const r of rotinas) {
    if (!r.on) continue;
    const disparos = hist.desde(RECUO_DIAS, e => e.origem === 'rotina' && e.rotina === r.id);
    if (disparos.length < RECUO_MIN) continue;

    const cancelados = disparos.filter(d => hist.desde(RECUO_DIAS, e =>
      e.origem === 'manual' && e.id === d.id &&
      e.ts > d.ts && e.ts - d.ts <= janela &&
      e.acao !== d.acao                       // desfez o que a rotina fez
    ).length > 0);

    const razao = cancelados.length / disparos.length;
    if (cancelados.length < 2 || razao < RECUO_RAZAO) continue;

    out.push({
      id: `r:${r.id}`,
      tipo: 'recuar',
      confianca: Math.round(razao * 100),
      texto: `A rotina ${aspas(r.name)} foi cancelada na mão ${
        porExtenso(cancelados.length)} vezes nas últimas semanas.`,
      evidencia: `${cancelados.length} cancelamentos em ${disparos.length} disparos · até ${
        RECUO_JANELA_MIN} min depois`,
      acao: 'Suspender a rotina e perguntar de novo daqui a duas semanas',
      alvo: r.id
    });
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   3. Correlação com a virada de modo
   "A TV fica ligada ~40 min depois que a casa entra no modo Dormindo."
   ═══════════════════════════════════════════════════════════════ */
function correlacaoComModo(hist, catalogo, modoAlvo = 'dormindo') {
  const out = [];
  const janela = CORR_JANELA_MIN * 60e3;
  const viradas = hist.desde(JANELA_DIAS, e => e.acao === 'modo' && e.valor?.modo === modoAlvo);
  if (viradas.length < CORR_MIN) return out;

  for (const dev of catalogo.devices) {
    if (!dev.caps?.includes('onoff')) continue;

    const atrasos = [];
    for (const v of viradas) {
      const desligou = hist.desde(JANELA_DIAS, e =>
        e.id === dev.id && e.origem === 'manual' && e.acao === 'off' &&
        e.ts > v.ts && e.ts - v.ts <= janela)[0];
      if (desligou) atrasos.push(Math.round((desligou.ts - v.ts) / 60e3));
    }

    const razao = atrasos.length / viradas.length;
    if (atrasos.length < CORR_MIN || razao < CORR_RAZAO) continue;

    const med = mediana(atrasos);
    const proposto = Math.max(5, arred5(med));

    out.push({
      id: `c:${dev.id}:${modoAlvo}`,
      tipo: 'criar',
      confianca: Math.round(razao * 100),
      texto: `${aspas(dev.name)} continua ligada, em média, ${med} minutos depois que a casa entra no modo ${
        nomeModo(modoAlvo)}.`,
      evidencia: `${atrasos.length} das últimas ${viradas.length} vezes · mediana de ${med} min`,
      acao: `Desligar ${aspas(dev.name)} ${proposto} min após o modo ${nomeModo(modoAlvo)}`,
      rotina: {
        nome: `${dev.name} depois do ${nomeModo(modoAlvo)}`,
        desc: `Desliga ${proposto} min após o modo ${nomeModo(modoAlvo)}`,
        icon: 'ic-clock',
        modos: [modoAlvo],
        gatilho: { tipo: 'apos-modo', modo: modoAlvo, minutos: proposto },
        passos: [{ id: dev.id, set: { state: 'OFF' } }]
      }
    });
  }
  return out;
}

/* ── Auxiliares ─────────────────────────────────────────────────── */
const aspas = s => `"${s}"`;
const nomeModo = id => ({ normal:'Normal', dormindo:'Dormindo', fora:'Fora', recebendo:'Recebendo' }[id] || id);
const porExtenso = n => ['zero','uma','duas','três','quatro','cinco','seis'][n] || String(n);

function montarSet(bri, kelvin) {
  const s = { state: 'ON' };
  if (Number.isFinite(bri))    s.brightness = Math.round(bri * 2.54);
  if (Number.isFinite(kelvin)) s.color_temp = Math.round(1e6 / kelvin);
  return s;
}

/**
 * Roda os três detectores e devolve as sugestões pendentes, já filtradas
 * pelo que o morador recusou e ordenadas por confiança.
 *
 * `recusadas` é um Set de ids. Sem essa memória a casa reofereceria para
 * sempre o que já ouviu "nunca" — e a próxima sugestão boa seria ignorada
 * junto.
 */
export function sugerir({ historico, catalogo, rotinas, recusadas = new Set(), limite = 5 }) {
  return [
    ...padraoDeHorario(historico, catalogo),
    ...recuo(historico, rotinas),
    ...correlacaoComModo(historico, catalogo)
  ]
    .filter(s => !recusadas.has(s.id))
    .sort((a, b) => b.confianca - a.confianca)
    .slice(0, limite);
}
