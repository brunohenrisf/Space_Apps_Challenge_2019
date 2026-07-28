'use strict';

/* =================================================================
   OrçaElétrico — plataforma de orçamentos para projetos elétricos
   Sem dependências externas. Dados persistidos no localStorage.
   ================================================================= */

/* ---------------- chaves de armazenamento ---------------- */
const STORE = {
  config: 'orcaeletrico.config.v1',
  params: 'orcaeletrico.params.v1',
  orcamentos: 'orcaeletrico.orcamentos.v1',
};

/* ---------------- valores padrão ---------------- */
const DEFAULT_CONFIG = {
  proLabore: 8000,
  custosFixos: 2500,
  diasUteis: 21,
  horasDia: 8,
  percProdutivo: 65,
  impostos: 8.5,
  margem: 25,
};

const DEFAULT_PARAMS = {
  profissional: { nome: '', registro: '', contato: '' },
  tipos: [
    { id: 'res_uni',      nome: 'Residencial unifamiliar',           base: 8,  porM2: 0.15 },
    { id: 'res_multi',    nome: 'Residencial multifamiliar',         base: 24, porM2: 0.10 },
    { id: 'comercial',    nome: 'Comercial / escritórios / lojas',   base: 16, porM2: 0.18 },
    { id: 'industrial',   nome: 'Industrial / galpões com processo', base: 40, porM2: 0.25 },
    { id: 'fotovoltaico', nome: 'Fotovoltaico (área ocupada)',       base: 12, porM2: 0.06 },
    { id: 'spda',         nome: 'SPDA / aterramento',                base: 10, porM2: 0.05 },
    { id: 'reforma',      nome: 'Reforma / retrofit (com as-built)', base: 12, porM2: 0.20 },
    { id: 'laudo',        nome: 'Laudo / vistoria técnica',          base: 6,  porM2: 0.03 },
  ],
  complexidade: [
    { id: 'baixa',      nome: 'Baixa — padrão repetitivo, poucas cargas',            fator: 0.85 },
    { id: 'media',      nome: 'Média — projeto típico',                              fator: 1.0 },
    { id: 'alta',       nome: 'Alta — cargas especiais, automação, gerador',         fator: 1.3 },
    { id: 'muito_alta', nome: 'Muito alta — subestação, missão crítica, industrial', fator: 1.6 },
  ],
  infoEntrada: [
    { id: 'boa',     nome: 'Completa — arquitetônico atualizado, layout definido', fator: 1.0 },
    { id: 'parcial', nome: 'Parcial — faltam definições, retrabalho provável',     fator: 1.15 },
    { id: 'ruim',    nome: 'Precária — exige levantamento em campo',               fator: 1.3 },
  ],
  urgencia: [
    { id: 'normal',   nome: 'Prazo normal',          fator: 1.0 },
    { id: 'apertado', nome: 'Prazo apertado (+15%)', fator: 1.15 },
    { id: 'urgente',  nome: 'Urgente (+30%)',        fator: 1.3 },
  ],
  etapas: [
    { nome: 'Levantamento e briefing',         perc: 10 },
    { nome: 'Estudo preliminar / anteprojeto', perc: 15 },
    { nome: 'Dimensionamento e cálculos',      perc: 25 },
    { nome: 'Desenho das pranchas',            perc: 30 },
    { nome: 'Memorial, listas e documentos',   perc: 12 },
    { nome: 'Revisões, entrega e ART',         perc: 8 },
  ],
  fatorCompat: 1.15,
  percRevisaoExtra: 8,
  horasPorVisita: 3,
  custoKm: 1.8,
};

/* ---------------- estado ---------------- */
function carregarObj(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return structuredClone(padrao);
    return { ...structuredClone(padrao), ...JSON.parse(bruto) };
  } catch {
    return structuredClone(padrao);
  }
}

function carregarLista(chave) {
  try {
    const dado = JSON.parse(localStorage.getItem(chave) || '[]');
    return Array.isArray(dado) ? dado : [];
  } catch {
    return [];
  }
}

let config = carregarObj(STORE.config, DEFAULT_CONFIG);
let params = carregarObj(STORE.params, DEFAULT_PARAMS);
let orcamentos = carregarLista(STORE.orcamentos);
let editandoId = null;

const salvarConfig = () => localStorage.setItem(STORE.config, JSON.stringify(config));
const salvarParams = () => localStorage.setItem(STORE.params, JSON.stringify(params));
const salvarOrcamentos = () => localStorage.setItem(STORE.orcamentos, JSON.stringify(orcamentos));

/* ---------------- utilidades ---------------- */
const el = (id) => document.getElementById(id);

const numDe = (id) => {
  const v = parseFloat(el(id).value);
  return Number.isFinite(v) ? v : 0;
};

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = (v) => fmtMoeda.format(Number.isFinite(v) ? v : 0);
const fmtH = (v) => `${(Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
));

const achar = (lista, id) => lista.find((item) => item.id === id) || lista[0];

/* =================================================================
   NÚCLEO DE CÁLCULO
   ================================================================= */

/** Custo e valor de venda da hora técnica a partir da configuração. */
function calcularHora(cfg) {
  const horasFaturaveis = cfg.diasUteis * cfg.horasDia * (cfg.percProdutivo / 100);
  const custoMensal = cfg.proLabore + cfg.custosFixos;
  const custoHora = horasFaturaveis > 0 ? custoMensal / horasFaturaveis : 0;
  const fatorImposto = Math.max(1 - cfg.impostos / 100, 0.01);
  const valorHora = (custoHora * (1 + cfg.margem / 100)) / fatorImposto;
  return { horasFaturaveis, custoMensal, custoHora, valorHora };
}

/** Composição completa de um orçamento a partir dos dados do formulário. */
function calcularOrcamento(inp) {
  const hora = calcularHora(config);
  const tipo = achar(params.tipos, inp.tipo);
  const comp = achar(params.complexidade, inp.complexidade);
  const info = achar(params.infoEntrada, inp.info);
  const urg = achar(params.urgencia, inp.urgencia);

  // Estimativa de horas
  const horasBase = tipo.base + tipo.porM2 * inp.area;
  const fator = comp.fator * info.fator * urg.fator * (inp.compat ? params.fatorCompat : 1);
  const horasProjeto = horasBase * fator;
  const horasRevisoes = horasBase * (params.percRevisaoExtra / 100) * inp.revisoes;
  const horasVisitas = inp.visitas * params.horasPorVisita;
  const horasTotal = horasProjeto + horasRevisoes + horasVisitas;

  // Distribuição por etapas (horas de projeto + revisões; visitas em linha própria)
  const somaPerc = params.etapas.reduce((s, e) => s + (e.perc || 0), 0) || 1;
  const etapas = params.etapas.map((e) => ({
    nome: e.nome,
    horas: (horasProjeto + horasRevisoes) * ((e.perc || 0) / somaPerc),
  }));

  // Valores
  const valorHora = inp.valorHoraManual > 0 ? inp.valorHoraManual : hora.valorHora;
  const servicos = horasTotal * valorHora;
  const deslocamento = inp.visitas * inp.km * 2 * params.custoKm;
  const diretos = inp.art + inp.plotagem + inp.outros + deslocamento;
  const subtotal = servicos + diretos;
  const desconto = subtotal * (inp.desconto / 100);
  const total = subtotal - desconto;

  // Indicadores
  const fatorImposto = Math.max(1 - config.impostos / 100, 0.01);
  const precoMinimo = (horasTotal * hora.custoHora) / fatorImposto + diretos;
  const precoM2 = inp.area > 0 ? total / inp.area : 0;
  const horasPorDia = config.horasDia * (config.percProdutivo / 100);
  const prazoUteis = horasPorDia > 0 ? Math.ceil(horasTotal / horasPorDia) : 0;
  const prazoCorridos = Math.ceil(prazoUteis * 1.4);

  return {
    hora, tipo, comp, info, urg,
    horasBase, horasProjeto, horasRevisoes, horasVisitas, horasTotal, etapas,
    valorHora, servicos, deslocamento, diretos, subtotal, desconto, total,
    precoMinimo, precoM2, prazoUteis, prazoCorridos,
  };
}

/* =================================================================
   ABA: HORA TÉCNICA
   ================================================================= */

function preencherFormConfig() {
  el('c-prolabore').value = config.proLabore;
  el('c-fixos').value = config.custosFixos;
  el('c-dias').value = config.diasUteis;
  el('c-horasdia').value = config.horasDia;
  el('c-produtivo').value = config.percProdutivo;
  el('c-impostos').value = config.impostos;
  el('c-margem').value = config.margem;
}

function lerFormConfig() {
  config = {
    proLabore: numDe('c-prolabore'),
    custosFixos: numDe('c-fixos'),
    diasUteis: numDe('c-dias'),
    horasDia: numDe('c-horasdia'),
    percProdutivo: numDe('c-produtivo'),
    impostos: numDe('c-impostos'),
    margem: numDe('c-margem'),
  };
}

function renderHora() {
  const h = calcularHora(config);
  el('h-out-horas').textContent = fmtH(h.horasFaturaveis);
  el('h-out-custo').textContent = moeda(h.custoMensal);
  el('h-out-custohora').textContent = `${moeda(h.custoHora)} / h`;
  el('h-out-valorhora').textContent = `${moeda(h.valorHora)} / h`;
}

/* =================================================================
   ABA: PARÂMETROS
   ================================================================= */

function renderParams() {
  el('p-nome').value = params.profissional.nome;
  el('p-registro').value = params.profissional.registro;
  el('p-contato').value = params.profissional.contato;

  el('p-tipos').innerHTML = params.tipos.map((t, i) => `
    <tr>
      <td><input type="text" data-grupo="tipos" data-col="nome" data-i="${i}" value="${esc(t.nome)}"></td>
      <td><input type="number" step="any" min="0" data-grupo="tipos" data-col="base" data-i="${i}" value="${t.base}"></td>
      <td><input type="number" step="any" min="0" data-grupo="tipos" data-col="porM2" data-i="${i}" value="${t.porM2}"></td>
    </tr>`).join('');

  el('p-complex').innerHTML = params.complexidade.map((c, i) => `
    <tr>
      <td><input type="text" data-grupo="complexidade" data-col="nome" data-i="${i}" value="${esc(c.nome)}"></td>
      <td><input type="number" step="any" min="0" data-grupo="complexidade" data-col="fator" data-i="${i}" value="${c.fator}"></td>
    </tr>`).join('');

  el('p-etapas').innerHTML = params.etapas.map((e, i) => `
    <tr>
      <td><input type="text" data-grupo="etapas" data-col="nome" data-i="${i}" value="${esc(e.nome)}"></td>
      <td><input type="number" step="any" min="0" data-grupo="etapas" data-col="perc" data-i="${i}" value="${e.perc}"></td>
    </tr>`).join('');

  el('p-fatorcompat').value = params.fatorCompat;
  el('p-percrevisao').value = params.percRevisaoExtra;
  el('p-horasvisita').value = params.horasPorVisita;
  el('p-custokm').value = params.custoKm;
}

function lerParams() {
  params.profissional = {
    nome: el('p-nome').value.trim(),
    registro: el('p-registro').value.trim(),
    contato: el('p-contato').value.trim(),
  };

  document.querySelectorAll('#tab-parametros input[data-grupo]').forEach((input) => {
    const lista = params[input.dataset.grupo];
    const item = lista && lista[Number(input.dataset.i)];
    if (!item) return;
    const col = input.dataset.col;
    if (input.type === 'number') {
      const v = parseFloat(input.value);
      item[col] = Number.isFinite(v) ? v : 0;
    } else {
      item[col] = input.value;
    }
  });

  params.fatorCompat = numDe('p-fatorcompat');
  params.percRevisaoExtra = numDe('p-percrevisao');
  params.horasPorVisita = numDe('p-horasvisita');
  params.custoKm = numDe('p-custokm');
}

/* =================================================================
   ABA: NOVO ORÇAMENTO
   ================================================================= */

function preencherSelects() {
  const montar = (id, lista, padrao) => {
    const select = el(id);
    const atual = select.value;
    select.innerHTML = lista.map((item) => `<option value="${esc(item.id)}">${esc(item.nome)}</option>`).join('');
    if (lista.some((item) => item.id === atual)) {
      select.value = atual;
    } else if (padrao && lista.some((item) => item.id === padrao)) {
      select.value = padrao;
    }
  };
  montar('o-tipo', params.tipos);
  montar('o-complexidade', params.complexidade, 'media');
  montar('o-info', params.infoEntrada, 'boa');
  montar('o-urgencia', params.urgencia, 'normal');
}

function lerFormOrcamento() {
  return {
    cliente: el('o-cliente').value.trim(),
    obra: el('o-obra').value.trim(),
    tipo: el('o-tipo').value,
    area: numDe('o-area'),
    complexidade: el('o-complexidade').value,
    info: el('o-info').value,
    urgencia: el('o-urgencia').value,
    compat: el('o-compat').checked,
    revisoes: numDe('o-revisoes'),
    visitas: numDe('o-visitas'),
    km: numDe('o-km'),
    art: numDe('o-art'),
    plotagem: numDe('o-plotagem'),
    outros: numDe('o-outros'),
    desconto: numDe('o-desconto'),
    valorHoraManual: numDe('o-valorhora'),
  };
}

function preencherFormOrcamento(inp) {
  el('o-cliente').value = inp.cliente || '';
  el('o-obra').value = inp.obra || '';
  el('o-tipo').value = inp.tipo;
  el('o-area').value = inp.area;
  el('o-complexidade').value = inp.complexidade;
  el('o-info').value = inp.info;
  el('o-urgencia').value = inp.urgencia;
  el('o-compat').checked = !!inp.compat;
  el('o-revisoes').value = inp.revisoes;
  el('o-visitas').value = inp.visitas;
  el('o-km').value = inp.km;
  el('o-art').value = inp.art;
  el('o-plotagem').value = inp.plotagem;
  el('o-outros').value = inp.outros;
  el('o-desconto').value = inp.desconto;
  el('o-valorhora').value = inp.valorHoraManual || 0;
}

function limparFormOrcamento() {
  editandoId = null;
  preencherFormOrcamento({
    cliente: '', obra: '',
    tipo: params.tipos[0].id, area: 150,
    complexidade: 'media', info: 'boa', urgencia: 'normal',
    compat: false, revisoes: 0, visitas: 1, km: 10,
    art: 110, plotagem: 0, outros: 0, desconto: 0, valorHoraManual: 0,
  });
  renderResumo();
}

function renderResumo() {
  const inp = lerFormOrcamento();
  const r = calcularOrcamento(inp);

  el('r-valorhora').textContent = `${moeda(r.valorHora)} / h`;

  const linhasEtapas = r.etapas.map((e) => `<tr><td>${esc(e.nome)}</td><td>${fmtH(e.horas)}</td></tr>`);
  if (r.horasVisitas > 0) {
    linhasEtapas.push(`<tr><td>Visitas técnicas (${inp.visitas}×)</td><td>${fmtH(r.horasVisitas)}</td></tr>`);
  }
  el('r-etapas').innerHTML = linhasEtapas.join('');
  el('r-horas').textContent = fmtH(r.horasTotal);

  const linhas = [];
  linhas.push(['Serviços de engenharia', `${fmtH(r.horasTotal)} × ${moeda(r.valorHora)}`, r.servicos]);
  if (inp.art > 0) linhas.push(['ART / TRT', '', inp.art]);
  if (r.deslocamento > 0) linhas.push(['Deslocamento', `${inp.visitas}× · ${inp.km} km (ida e volta)`, r.deslocamento]);
  if (inp.plotagem > 0) linhas.push(['Plotagem / impressões', '', inp.plotagem]);
  if (inp.outros > 0) linhas.push(['Outros custos', '', inp.outros]);

  let html = linhas.map(([nome, detalhe, valor]) => `
    <tr>
      <td>${esc(nome)}${detalhe ? ` <small>(${esc(detalhe)})</small>` : ''}</td>
      <td>${moeda(valor)}</td>
    </tr>`).join('');

  html += `<tr class="subtotal"><td>Subtotal</td><td>${moeda(r.subtotal)}</td></tr>`;
  if (r.desconto > 0) {
    html += `<tr class="desconto"><td>Desconto (${inp.desconto}%)</td><td>− ${moeda(r.desconto)}</td></tr>`;
  }
  el('r-comp').innerHTML = html;

  el('r-total').textContent = moeda(r.total);
  el('r-minimo').textContent = moeda(r.precoMinimo);
  el('r-precom2').textContent = inp.area > 0 ? `${moeda(r.precoM2)}/m²` : '—';
  el('r-prazo').textContent = r.prazoUteis > 0 ? `${r.prazoUteis} dias úteis` : '—';

  const abaixoDoCusto = r.total < r.precoMinimo;
  el('r-total').style.color = abaixoDoCusto ? '#ffb4a8' : '';
  el('r-minimo').style.color = abaixoDoCusto ? '#b3372f' : '';
}

/* =================================================================
   ABA: ORÇAMENTOS SALVOS
   ================================================================= */

function salvarOrcamentoAtual() {
  const inp = lerFormOrcamento();
  const r = calcularOrcamento(inp);
  const registro = {
    id: editandoId || `orc-${Date.now().toString(36)}`,
    criadoEm: new Date().toISOString(),
    inputs: inp,
    resumo: { horasTotal: r.horasTotal, total: r.total },
  };

  const posicao = orcamentos.findIndex((o) => o.id === registro.id);
  if (posicao >= 0) {
    registro.criadoEm = orcamentos[posicao].criadoEm;
    orcamentos[posicao] = registro;
  } else {
    orcamentos.push(registro);
  }
  editandoId = registro.id;
  salvarOrcamentos();
  renderSalvos();

  const botao = el('b-salvar');
  const original = botao.textContent;
  botao.textContent = '✓ Salvo!';
  setTimeout(() => { botao.textContent = original; }, 1500);
}

function renderSalvos() {
  el('qtd-salvos').textContent = orcamentos.length;
  const temItens = orcamentos.length > 0;
  el('s-vazio').hidden = temItens;
  el('s-tabela').hidden = !temItens;
  if (!temItens) return;

  const ordenados = [...orcamentos].sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
  el('s-tbody').innerHTML = ordenados.map((o) => `
    <tr>
      <td>${new Date(o.criadoEm).toLocaleDateString('pt-BR')}</td>
      <td>${esc(o.inputs.cliente) || '<em>sem cliente</em>'}</td>
      <td>${esc(o.inputs.obra) || '<em>sem título</em>'}</td>
      <td>${fmtH(o.resumo.horasTotal)}</td>
      <td>${moeda(o.resumo.total)}</td>
      <td>
        <div class="acoes-linha">
          <button data-acao="abrir" data-id="${o.id}">Abrir</button>
          <button data-acao="proposta" data-id="${o.id}">Proposta</button>
          <button data-acao="excluir" data-id="${o.id}" class="perigo">Excluir</button>
        </div>
      </td>
    </tr>`).join('');
}

function acaoSalvo(acao, id) {
  const orc = orcamentos.find((o) => o.id === id);
  if (!orc) return;

  if (acao === 'abrir') {
    editandoId = id;
    preencherFormOrcamento(orc.inputs);
    renderResumo();
    trocarAba('orcamento');
  } else if (acao === 'proposta') {
    gerarProposta(orc.inputs);
  } else if (acao === 'excluir') {
    if (!confirm(`Excluir o orçamento "${orc.inputs.obra || 'sem título'}"?`)) return;
    orcamentos = orcamentos.filter((o) => o.id !== id);
    if (editandoId === id) editandoId = null;
    salvarOrcamentos();
    renderSalvos();
  }
}

/* =================================================================
   PROPOSTA PARA IMPRESSÃO
   ================================================================= */

function gerarProposta(inp) {
  const r = calcularOrcamento(inp);
  const prof = params.profissional;
  const hoje = new Date().toLocaleDateString('pt-BR');

  const linhasInvestimento = [
    `<tr><td>Serviços de engenharia (${fmtH(r.horasTotal)} de trabalho técnico)</td><td>${moeda(r.servicos)}</td></tr>`,
  ];
  if (inp.art > 0) linhasInvestimento.push(`<tr><td>ART / TRT</td><td>${moeda(inp.art)}</td></tr>`);
  if (r.deslocamento > 0) linhasInvestimento.push(`<tr><td>Deslocamentos (${inp.visitas} visita(s) técnica(s))</td><td>${moeda(r.deslocamento)}</td></tr>`);
  if (inp.plotagem > 0) linhasInvestimento.push(`<tr><td>Plotagem / impressões</td><td>${moeda(inp.plotagem)}</td></tr>`);
  if (inp.outros > 0) linhasInvestimento.push(`<tr><td>Outros custos</td><td>${moeda(inp.outros)}</td></tr>`);
  if (r.desconto > 0) linhasInvestimento.push(`<tr><td>Desconto comercial (${inp.desconto}%)</td><td>− ${moeda(r.desconto)}</td></tr>`);
  linhasInvestimento.push(`<tr class="total"><td>INVESTIMENTO TOTAL</td><td>${moeda(r.total)}</td></tr>`);

  el('proposta').innerHTML = `
    <h1>Proposta de Serviços — Projeto Elétrico</h1>
    <div class="cabecalho-prof">
      ${prof.nome ? `<strong>${esc(prof.nome)}</strong>` : ''}
      ${prof.registro ? ` · ${esc(prof.registro)}` : ''}
      ${prof.contato ? ` · ${esc(prof.contato)}` : ''}
      <br>Data: ${hoje} · Validade: 15 dias
    </div>

    <h2>Cliente e objeto</h2>
    <table>
      <tr><td style="width:30%"><strong>Cliente</strong></td><td>${esc(inp.cliente) || '—'}</td></tr>
      <tr><td><strong>Obra / projeto</strong></td><td>${esc(inp.obra) || '—'}</td></tr>
      <tr><td><strong>Tipo</strong></td><td>${esc(r.tipo.nome)}</td></tr>
      <tr><td><strong>Área de referência</strong></td><td>${inp.area.toLocaleString('pt-BR')} m²</td></tr>
    </table>

    <h2>Escopo dos serviços</h2>
    <ul>
      ${r.etapas.map((e) => `<li>${esc(e.nome)}</li>`).join('')}
      ${inp.visitas > 0 ? `<li>${inp.visitas} visita(s) técnica(s) à obra</li>` : ''}
    </ul>

    <h2>Investimento</h2>
    <table>${linhasInvestimento.join('')}</table>

    <h2>Prazo e condições</h2>
    <ul>
      <li>Prazo estimado de execução: ${r.prazoUteis} dia(s) útil(eis) (~${r.prazoCorridos} dias corridos), contados a partir do recebimento das informações completas.</li>
      <li>Forma de pagamento sugerida: 50% na aprovação da proposta e 50% na entrega final.</li>
      <li>Estão inclusas ${Math.max(inp.revisoes, 0) + 2} rodada(s) de revisão. Revisões adicionais serão orçadas à parte.</li>
      <li>Não estão inclusos: taxas de concessionária, execução da obra, materiais e serviços de terceiros não listados.</li>
    </ul>

    <div class="assinatura">
      <div class="linha"></div>
      ${esc(prof.nome) || 'Responsável técnico'}<br>
      ${esc(prof.registro) || ''}
    </div>

    <p class="nota-rodape">Proposta gerada pela plataforma OrçaElétrico em ${hoje}.</p>
  `;

  window.print();
}

/* =================================================================
   NAVEGAÇÃO E BACKUP
   ================================================================= */

function trocarAba(nome) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === nome));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${nome}`));
}

function exportarDados() {
  const blob = new Blob(
    [JSON.stringify({ config, params, orcamentos }, null, 2)],
    { type: 'application/json' },
  );
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'orcaeletrico-backup.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

function importarDados(arquivo) {
  const leitor = new FileReader();
  leitor.onload = () => {
    try {
      const dado = JSON.parse(leitor.result);
      if (dado.config) config = { ...structuredClone(DEFAULT_CONFIG), ...dado.config };
      if (dado.params) params = { ...structuredClone(DEFAULT_PARAMS), ...dado.params };
      if (Array.isArray(dado.orcamentos)) orcamentos = dado.orcamentos;
      salvarConfig(); salvarParams(); salvarOrcamentos();
      renderTudo();
      alert('Dados importados com sucesso.');
    } catch {
      alert('Arquivo inválido. Use um backup exportado pela própria plataforma.');
    }
  };
  leitor.readAsText(arquivo);
}

function restaurarPadroes() {
  if (!confirm('Restaurar os parâmetros e a hora técnica para os valores padrão? Os orçamentos salvos serão mantidos.')) return;
  config = structuredClone(DEFAULT_CONFIG);
  params = structuredClone(DEFAULT_PARAMS);
  salvarConfig(); salvarParams();
  renderTudo();
}

function renderTudo() {
  preencherFormConfig();
  renderHora();
  renderParams();
  preencherSelects();
  renderResumo();
  renderSalvos();
}

/* =================================================================
   INICIALIZAÇÃO
   ================================================================= */

document.addEventListener('DOMContentLoaded', () => {
  renderTudo();

  // Navegação por abas
  document.querySelectorAll('nav button').forEach((botao) => {
    botao.addEventListener('click', () => trocarAba(botao.dataset.tab));
  });

  // Hora técnica: recalcula e salva a cada alteração
  el('tab-hora').addEventListener('input', () => {
    lerFormConfig();
    salvarConfig();
    renderHora();
    renderResumo();
  });

  // Parâmetros: recalcula e salva a cada alteração
  el('tab-parametros').addEventListener('input', (evento) => {
    if (evento.target.type === 'file') return;
    lerParams();
    salvarParams();
    preencherSelects();
    renderResumo();
  });

  // Formulário de orçamento: resumo ao vivo
  ['input', 'change'].forEach((tipoEvento) => {
    el('tab-orcamento').addEventListener(tipoEvento, (evento) => {
      if (evento.target.tagName === 'BUTTON') return;
      renderResumo();
    });
  });

  // Ações do orçamento
  el('b-salvar').addEventListener('click', salvarOrcamentoAtual);
  el('b-proposta').addEventListener('click', () => gerarProposta(lerFormOrcamento()));
  el('b-limpar').addEventListener('click', limparFormOrcamento);

  // Ações da lista de salvos (delegação)
  el('s-tbody').addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-acao]');
    if (botao) acaoSalvo(botao.dataset.acao, botao.dataset.id);
  });

  // Backup
  el('p-exportar').addEventListener('click', exportarDados);
  el('p-importar').addEventListener('click', () => el('p-file').click());
  el('p-file').addEventListener('change', (evento) => {
    if (evento.target.files[0]) importarDados(evento.target.files[0]);
    evento.target.value = '';
  });
  el('p-restaurar').addEventListener('click', restaurarPadroes);
});
