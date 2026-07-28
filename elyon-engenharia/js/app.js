'use strict';

/* =================================================================
   ELYON ENGENHARIA — aplicação
   Orçamentos multi-serviço, propostas comerciais e laudos técnicos.
   Sem dependências externas; dados persistidos no localStorage.
   ================================================================= */

/* ---------------- armazenamento ---------------- */
const STORE = {
  config: 'elyon.config.v1',
  catalogo: 'elyon.catalogo.v1',
  orcamentos: 'elyon.orcamentos.v1',
  laudos: 'elyon.laudos.v1',
  seq: 'elyon.seq.v1',
  sessao: 'elyon.sessao.v1',
};

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

/* Mescla o catálogo salvo com o padrão: mantém os ajustes do usuário
   e incorpora serviços/campos novos adicionados em versões futuras. */
function mesclarCatalogo(salvo) {
  if (!Array.isArray(salvo) || !salvo.length) return structuredClone(DEFAULT_CATALOGO);
  const resultado = salvo.map((s) => {
    const base = DEFAULT_CATALOGO.find((d) => d.id === s.id);
    return base ? { ...structuredClone(base), ...s } : s;
  });
  DEFAULT_CATALOGO.forEach((d) => {
    if (!resultado.some((s) => s.id === d.id)) resultado.push(structuredClone(d));
  });
  return resultado;
}

let config = carregarObj(STORE.config, DEFAULT_CONFIG);
config.empresa = { ...structuredClone(DEFAULT_CONFIG.empresa), ...(config.empresa || {}) };
config.horaTecnica = { ...structuredClone(DEFAULT_CONFIG.horaTecnica), ...(config.horaTecnica || {}) };

let catalogo = mesclarCatalogo(carregarLista(STORE.catalogo));
let orcamentos = carregarLista(STORE.orcamentos);
let laudos = carregarLista(STORE.laudos);
let seq = carregarObj(STORE.seq, { orc: 0, lau: 0 });

let editorOrc = null;
let editorLau = null;
let dirtyOrc = false;
let dirtyLau = false;

const salvarConfig = () => localStorage.setItem(STORE.config, JSON.stringify(config));
const salvarCatalogo = () => localStorage.setItem(STORE.catalogo, JSON.stringify(catalogo));
const salvarOrcamentos = () => localStorage.setItem(STORE.orcamentos, JSON.stringify(orcamentos));
const salvarLaudos = () => localStorage.setItem(STORE.laudos, JSON.stringify(laudos));
const salvarSeq = () => localStorage.setItem(STORE.seq, JSON.stringify(seq));

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
const getServico = (id) => achar(catalogo, id);
const getModelo = (id) => achar(LAUDO_MODELOS, id);

const hoje = () => new Date().toISOString().slice(0, 10);
const dataBR = (isoData) => {
  if (!isoData) return '—';
  const [a, m, d] = String(isoData).slice(0, 10).split('-');
  return (a && m && d) ? `${d}/${m}/${a}` : '—';
};

function fillSelect(id, lista, selecionado) {
  const select = el(id);
  select.innerHTML = lista.map((item) => `<option value="${esc(item.id)}">${esc(item.nome)}</option>`).join('');
  if (selecionado && lista.some((item) => item.id === selecionado)) select.value = selecionado;
}

function botaoFeedback(botao, texto) {
  const original = botao.textContent;
  botao.textContent = texto;
  setTimeout(() => { botao.textContent = original; }, 1600);
}

function chipStatus(statusId) {
  const st = achar(STATUS_ORCAMENTO, statusId);
  return `<span class="chip chip-${esc(st.id)}">${esc(st.nome)}</span>`;
}

function chipParecer(parecerId) {
  const p = achar(PARECERES, parecerId);
  return `<span class="chip chip-parecer-${esc(p.id)}">${esc(p.nome)}</span>`;
}

/* ---------------- sessão (protótipo SaaS) ----------------
   No protótipo o login é simulado (entrar.html grava a sessão no
   localStorage). Na versão em produção este bloco é substituído
   pelo provedor de autenticação — ver docs/arquitetura-saas.md. */
function carregarSessao() {
  try {
    return JSON.parse(localStorage.getItem(STORE.sessao)) || null;
  } catch {
    return null;
  }
}

function encerrarSessao() {
  localStorage.removeItem(STORE.sessao);
  location.replace('entrar.html');
}

function renderUsuario(sessao) {
  const nome = sessao.nome || 'Engenheiro(a)';
  const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((parte) => parte[0].toUpperCase()).join('') || 'EL';
  el('user-avatar').textContent = iniciais;
  el('user-nome').textContent = nome;
  el('user-email').textContent = sessao.email || '';
  el('user-plano').textContent = sessao.plano || 'Profissional';
}

const TITULOS_ABAS = {
  dashboard: 'Início',
  orcamentos: 'Orçamentos',
  laudos: 'Laudos técnicos',
  horatecnica: 'Hora técnica',
  catalogo: 'Catálogo de serviços',
  config: 'Configurações',
};

/* =================================================================
   MOTOR DE CÁLCULO
   ================================================================= */

function calcularHora(ht) {
  const horasFaturaveis = ht.diasUteis * ht.horasDia * (ht.percProdutivo / 100);
  const custoMensal = ht.proLabore + ht.custosFixos;
  const custoHora = horasFaturaveis > 0 ? custoMensal / horasFaturaveis : 0;
  const fatorImposto = Math.max(1 - ht.impostos / 100, 0.01);
  const valorHora = (custoHora * (1 + ht.margem / 100)) / fatorImposto;
  return { horasFaturaveis, custoMensal, custoHora, valorHora };
}

function calcularOrcamento(orc) {
  const ht = config.horaTecnica;
  const hora = calcularHora(ht);
  const urg = achar(URGENCIAS, orc.urgencia);

  const itens = (orc.itens || []).map((item) => {
    const servico = getServico(item.servicoId);
    const complexidade = achar(servico.complexidades, item.complexidadeId);
    const horas = Math.max(0,
      (servico.horasBase + servico.horasPorUnidade * item.quantidade)
      * complexidade.fator * urg.fator * (1 + (item.ajuste || 0) / 100));
    return { item, servico, complexidade, horas, valor: horas * hora.valorHora };
  });

  const horasItens = itens.reduce((soma, i) => soma + i.horas, 0);
  const horasVisitas = (orc.visitas || 0) * config.horasPorVisita;
  const horasTotal = horasItens + horasVisitas;

  const servicos = horasTotal * hora.valorHora;
  const deslocamento = (orc.visitas || 0) * (orc.km || 0) * 2 * config.custoKm;
  const diretos = (orc.art || 0) + (orc.plotagem || 0) + (orc.outros || 0) + deslocamento;
  const subtotal = servicos + diretos;
  const descontoValor = subtotal * ((orc.desconto || 0) / 100);
  const total = subtotal - descontoValor;

  const fatorImposto = Math.max(1 - ht.impostos / 100, 0.01);
  const precoMinimo = (horasTotal * hora.custoHora) / fatorImposto + diretos;
  const horasDiaProd = ht.horasDia * (ht.percProdutivo / 100);
  const prazoUteis = horasDiaProd > 0 ? Math.ceil(horasTotal / horasDiaProd) : 0;
  const prazoCorridos = Math.ceil(prazoUteis * 1.4);

  return {
    hora, urg, itens,
    horasItens, horasVisitas, horasTotal,
    servicos, deslocamento, diretos, subtotal, descontoValor, total,
    precoMinimo, prazoUteis, prazoCorridos,
  };
}

function contarChecklist(lau) {
  const contagem = { c: 0, nc: 0, na: 0 };
  (lau.respostas || []).forEach((r) => { contagem[r.status] = (contagem[r.status] || 0) + 1; });
  return contagem;
}

function parecerSugerido(lau) {
  const { nc } = contarChecklist(lau);
  if (nc === 0) return 'aprovado';
  if (nc <= 2) return 'ressalvas';
  return 'reprovado';
}

/* =================================================================
   DASHBOARD
   ================================================================= */

function renderDashboard() {
  el('d-qtd-orc').textContent = orcamentos.length;
  el('d-qtd-laudos').textContent = laudos.length;

  const soma = (statusId) => orcamentos
    .filter((o) => o.status === statusId)
    .reduce((soma_, o) => soma_ + (o.resumo?.total || 0), 0);

  el('d-pipeline').textContent = moeda(soma('enviada'));
  el('d-aprovado').textContent = moeda(soma('aprovada'));

  const aprovadas = orcamentos.filter((o) => o.status === 'aprovada').length;
  const decididas = aprovadas + orcamentos.filter((o) => o.status === 'recusada').length;
  el('d-conversao').textContent = decididas > 0 ? `${Math.round((aprovadas / decididas) * 100)}%` : '—';

  const recentes = [...orcamentos].sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1)).slice(0, 5);
  el('d-recentes-vazio').hidden = recentes.length > 0;
  el('d-recentes-tabela').hidden = recentes.length === 0;
  el('d-recentes').innerHTML = recentes.map((o) => `
    <tr>
      <td>${esc(o.numero || '—')}</td>
      <td>${esc(o.cliente) || '<em>sem cliente</em>'}</td>
      <td>${esc(o.obra) || '—'}</td>
      <td>${moeda(o.resumo?.total)}</td>
      <td>${chipStatus(o.status)}</td>
    </tr>`).join('');
}

/* =================================================================
   ORÇAMENTOS — LISTA
   ================================================================= */

function renderListaOrc() {
  const temItens = orcamentos.length > 0;
  el('orc-vazio').hidden = temItens;
  el('orc-tabela').hidden = !temItens;
  if (!temItens) return;

  const ordenados = [...orcamentos].sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
  el('orc-tbody').innerHTML = ordenados.map((o) => `
    <tr>
      <td>${esc(o.numero || '—')}</td>
      <td>${new Date(o.criadoEm).toLocaleDateString('pt-BR')}</td>
      <td>${esc(o.cliente) || '<em>sem cliente</em>'}</td>
      <td>${esc(o.obra) || '—'}</td>
      <td>${moeda(o.resumo?.total)}</td>
      <td>
        <select class="status-inline st-${esc(o.status)}" data-id="${o.id}">
          ${STATUS_ORCAMENTO.map((s) => `<option value="${s.id}" ${s.id === o.status ? 'selected' : ''}>${s.nome}</option>`).join('')}
        </select>
      </td>
      <td>
        <div class="acoes-linha">
          <button data-acao="abrir" data-id="${o.id}">Abrir</button>
          <button data-acao="proposta" data-id="${o.id}">Proposta</button>
          <button data-acao="duplicar" data-id="${o.id}">Duplicar</button>
          <button data-acao="excluir" data-id="${o.id}" class="perigo">Excluir</button>
        </div>
      </td>
    </tr>`).join('');
}

function acaoListaOrc(acao, id) {
  const orc = orcamentos.find((o) => o.id === id);
  if (!orc) return;

  if (acao === 'abrir') {
    editorOrc = structuredClone(orc);
    dirtyOrc = false;
    renderEditorOrc();
  } else if (acao === 'proposta') {
    gerarPropostaDoc(orc);
  } else if (acao === 'duplicar') {
    const copia = structuredClone(orc);
    copia.id = `orc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
    copia.numero = proximoNumero('orc');
    copia.status = 'rascunho';
    copia.criadoEm = new Date().toISOString();
    orcamentos.push(copia);
    salvarOrcamentos();
    renderListaOrc();
    renderDashboard();
  } else if (acao === 'excluir') {
    if (!confirm(`Excluir o orçamento ${orc.numero || 'sem número'}?`)) return;
    orcamentos = orcamentos.filter((o) => o.id !== id);
    if (editorOrc && editorOrc.id === id) { editorOrc = null; mostrarListaOrc(); }
    salvarOrcamentos();
    renderListaOrc();
    renderDashboard();
  }
}

function proximoNumero(tipo) {
  const ano = new Date().getFullYear();
  seq[tipo] = (seq[tipo] || 0) + 1;
  salvarSeq();
  const prefixo = tipo === 'orc' ? 'ORC' : 'LAU';
  return `${prefixo}-${ano}-${String(seq[tipo]).padStart(3, '0')}`;
}

/* =================================================================
   ORÇAMENTOS — EDITOR
   ================================================================= */

function novoOrcamento() {
  const primeiroServico = catalogo[0];
  editorOrc = {
    id: `orc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
    numero: null,
    criadoEm: new Date().toISOString(),
    status: 'rascunho',
    cliente: '', contato: '', obra: '', endereco: '',
    itens: [{
      servicoId: primeiroServico.id,
      quantidade: primeiroServico.qtdPadrao,
      complexidadeId: primeiroServico.complexidades[0].id,
      ajuste: 0,
    }],
    urgencia: 'normal', visitas: 1, km: 10,
    art: 110, plotagem: 0, outros: 0, desconto: 0,
    pagamento: '5050', pagamentoTxt: '', validade: 15,
  };
  dirtyOrc = false;
  renderEditorOrc();
}

function mostrarListaOrc() {
  el('orc-editor-view').hidden = true;
  el('orc-lista-view').hidden = false;
  renderListaOrc();
}

function renderEditorOrc() {
  if (!editorOrc) return;
  el('orc-lista-view').hidden = true;
  el('orc-editor-view').hidden = false;

  el('orc-titulo').textContent = editorOrc.numero ? `Orçamento ${editorOrc.numero}` : 'Novo orçamento';
  fillSelect('oe-status', STATUS_ORCAMENTO, editorOrc.status);
  fillSelect('oe-urgencia', URGENCIAS, editorOrc.urgencia);
  fillSelect('oe-pagamento', PAGAMENTOS, editorOrc.pagamento);

  el('oe-cliente').value = editorOrc.cliente;
  el('oe-contato').value = editorOrc.contato;
  el('oe-obra').value = editorOrc.obra;
  el('oe-endereco').value = editorOrc.endereco;
  el('oe-visitas').value = editorOrc.visitas;
  el('oe-km').value = editorOrc.km;
  el('oe-art').value = editorOrc.art;
  el('oe-plotagem').value = editorOrc.plotagem;
  el('oe-outros').value = editorOrc.outros;
  el('oe-desconto').value = editorOrc.desconto;
  el('oe-validade').value = editorOrc.validade;
  el('oe-pagamento-txt').value = editorOrc.pagamentoTxt || '';
  el('oe-pagamento-txt-wrap').hidden = editorOrc.pagamento !== 'outro';

  renderItensOrc();
  renderResumoOrc();
}

function opcoesServicos(selecionado) {
  const grupos = [['projeto', 'Projetos'], ['laudo', 'Laudos e serviços']];
  return grupos.map(([categoria, rotulo]) => {
    const opcoes = catalogo
      .filter((s) => s.categoria === categoria)
      .map((s) => `<option value="${esc(s.id)}" ${s.id === selecionado ? 'selected' : ''}>${esc(s.nome)}</option>`)
      .join('');
    return opcoes ? `<optgroup label="${rotulo}">${opcoes}</optgroup>` : '';
  }).join('');
}

function renderItensOrc() {
  if (!editorOrc) return;
  el('oe-itens').innerHTML = editorOrc.itens.map((item, idx) => {
    const servico = getServico(item.servicoId);
    const opcoesCx = servico.complexidades
      .map((c) => `<option value="${esc(c.id)}" ${c.id === item.complexidadeId ? 'selected' : ''}>${esc(c.nome)} (×${c.fator})</option>`)
      .join('');
    return `
    <div class="item-servico" data-idx="${idx}">
      <div class="item-grid">
        <label>Serviço
          <select data-campo="servicoId">${opcoesServicos(item.servicoId)}</select>
        </label>
        <label>${esc(servico.unidade.label)}
          <input type="number" min="0" step="any" data-campo="quantidade" value="${item.quantidade}">
        </label>
        <label>Complexidade
          <select data-campo="complexidadeId">${opcoesCx}</select>
        </label>
        <label>Ajuste fino (%)
          <input type="number" step="any" data-campo="ajuste" value="${item.ajuste || 0}" title="Acréscimo ou redução manual sobre as horas deste serviço">
        </label>
        <button type="button" class="item-remover" title="Remover serviço">✕</button>
      </div>
      <div class="item-calc" data-calc>—</div>
    </div>`;
  }).join('') || '<p class="nota">Nenhum serviço no orçamento — adicione ao menos um.</p>';
}

function tratarInputItem(alvo) {
  const linha = alvo.closest('.item-servico');
  if (!linha || !editorOrc) return;
  const item = editorOrc.itens[Number(linha.dataset.idx)];
  if (!item) return;
  const campo = alvo.dataset.campo;

  if (campo === 'servicoId') {
    item.servicoId = alvo.value;
    const servico = getServico(alvo.value);
    item.complexidadeId = servico.complexidades[0].id;
    item.quantidade = servico.qtdPadrao;
    renderItensOrc();
  } else if (campo === 'complexidadeId') {
    item.complexidadeId = alvo.value;
  } else if (campo === 'quantidade' || campo === 'ajuste') {
    const v = parseFloat(alvo.value);
    item[campo] = Number.isFinite(v) ? v : 0;
  }
}

function lerCamposFixosOrc() {
  if (!editorOrc) return;
  editorOrc.status = el('oe-status').value;
  editorOrc.cliente = el('oe-cliente').value.trim();
  editorOrc.contato = el('oe-contato').value.trim();
  editorOrc.obra = el('oe-obra').value.trim();
  editorOrc.endereco = el('oe-endereco').value.trim();
  editorOrc.urgencia = el('oe-urgencia').value;
  editorOrc.visitas = numDe('oe-visitas');
  editorOrc.km = numDe('oe-km');
  editorOrc.art = numDe('oe-art');
  editorOrc.plotagem = numDe('oe-plotagem');
  editorOrc.outros = numDe('oe-outros');
  editorOrc.desconto = numDe('oe-desconto');
  editorOrc.validade = numDe('oe-validade') || 15;
  editorOrc.pagamento = el('oe-pagamento').value;
  editorOrc.pagamentoTxt = el('oe-pagamento-txt').value.trim();
  el('oe-pagamento-txt-wrap').hidden = editorOrc.pagamento !== 'outro';
}

function renderResumoOrc() {
  if (!editorOrc) return;
  const r = calcularOrcamento(editorOrc);

  el('or-valorhora').textContent = `${moeda(r.hora.valorHora)} / h`;
  el('or-qtd-itens').textContent = editorOrc.itens.length;

  // linhas por serviço
  const linhasItens = r.itens.map((ri) => `
    <tr>
      <td>${esc(ri.servico.curto)} <small>(${ri.item.quantidade.toLocaleString('pt-BR')} ${esc(ri.servico.unidade.sufixo)})</small></td>
      <td>${fmtH(ri.horas)} · ${moeda(ri.valor)}</td>
    </tr>`);
  if (r.horasVisitas > 0) {
    linhasItens.push(`<tr><td>Visitas técnicas <small>(${editorOrc.visitas}×)</small></td><td>${fmtH(r.horasVisitas)} · ${moeda(r.horasVisitas * r.hora.valorHora)}</td></tr>`);
  }
  el('or-itens').innerHTML = linhasItens.join('');
  el('or-horas').textContent = fmtH(r.horasTotal);

  // calculadora de cada card de item
  document.querySelectorAll('#oe-itens .item-servico').forEach((linha) => {
    const ri = r.itens[Number(linha.dataset.idx)];
    const alvo = linha.querySelector('[data-calc]');
    if (ri && alvo) alvo.textContent = `→ ${fmtH(ri.horas)} × ${moeda(r.hora.valorHora)} = ${moeda(ri.valor)}`;
  });

  // composição
  const linhas = [];
  linhas.push(`<tr><td>Serviços de engenharia <small>(${fmtH(r.horasTotal)})</small></td><td>${moeda(r.servicos)}</td></tr>`);
  if (editorOrc.art > 0) linhas.push(`<tr><td>ART / TRT</td><td>${moeda(editorOrc.art)}</td></tr>`);
  if (r.deslocamento > 0) linhas.push(`<tr><td>Deslocamento <small>(${editorOrc.visitas}× · ${editorOrc.km} km)</small></td><td>${moeda(r.deslocamento)}</td></tr>`);
  if (editorOrc.plotagem > 0) linhas.push(`<tr><td>Plotagem / impressões</td><td>${moeda(editorOrc.plotagem)}</td></tr>`);
  if (editorOrc.outros > 0) linhas.push(`<tr><td>Outros custos</td><td>${moeda(editorOrc.outros)}</td></tr>`);
  linhas.push(`<tr class="subtotal"><td>Subtotal</td><td>${moeda(r.subtotal)}</td></tr>`);
  if (r.descontoValor > 0) linhas.push(`<tr class="desconto"><td>Desconto (${editorOrc.desconto}%)</td><td>− ${moeda(r.descontoValor)}</td></tr>`);
  el('or-comp').innerHTML = linhas.join('');

  el('or-total').textContent = moeda(r.total);
  el('or-minimo').textContent = moeda(r.precoMinimo);
  el('or-prazo').textContent = r.prazoUteis > 0 ? `${r.prazoUteis} dias úteis` : '—';

  const abaixoDoCusto = r.total < r.precoMinimo;
  el('or-total').style.color = abaixoDoCusto ? '#ffb4a8' : '';
  el('or-minimo').style.color = abaixoDoCusto ? '#b3372f' : '';
}

function salvarOrc() {
  if (!editorOrc) return;
  lerCamposFixosOrc();
  if (!editorOrc.itens.length) {
    alert('Adicione ao menos um serviço ao orçamento antes de salvar.');
    return;
  }
  if (!editorOrc.numero) editorOrc.numero = proximoNumero('orc');

  const r = calcularOrcamento(editorOrc);
  editorOrc.resumo = { horasTotal: r.horasTotal, total: r.total };

  const posicao = orcamentos.findIndex((o) => o.id === editorOrc.id);
  const copia = structuredClone(editorOrc);
  if (posicao >= 0) orcamentos[posicao] = copia; else orcamentos.push(copia);
  salvarOrcamentos();
  dirtyOrc = false;

  el('orc-titulo').textContent = `Orçamento ${editorOrc.numero}`;
  renderDashboard();
  botaoFeedback(el('oe-salvar'), '✓ Salvo!');
}

/* =================================================================
   LAUDOS — LISTA
   ================================================================= */

function renderListaLau() {
  const temItens = laudos.length > 0;
  el('lau-vazio').hidden = temItens;
  el('lau-tabela').hidden = !temItens;
  if (!temItens) return;

  const ordenados = [...laudos].sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
  el('lau-tbody').innerHTML = ordenados.map((l) => `
    <tr>
      <td>${esc(l.numero || '—')}</td>
      <td>${dataBR(l.dataInspecao)}</td>
      <td>${esc(getModelo(l.tipo).titulo)}</td>
      <td>${esc(l.cliente) || '<em>sem cliente</em>'}</td>
      <td>${chipParecer(l.parecer)}</td>
      <td>
        <div class="acoes-linha">
          <button data-acao="abrir" data-id="${l.id}">Abrir</button>
          <button data-acao="doc" data-id="${l.id}">Documento</button>
          <button data-acao="excluir" data-id="${l.id}" class="perigo">Excluir</button>
        </div>
      </td>
    </tr>`).join('');
}

function acaoListaLau(acao, id) {
  const laudo = laudos.find((l) => l.id === id);
  if (!laudo) return;

  if (acao === 'abrir') {
    editorLau = structuredClone(laudo);
    dirtyLau = false;
    renderEditorLau();
  } else if (acao === 'doc') {
    gerarLaudoDoc(laudo);
  } else if (acao === 'excluir') {
    if (!confirm(`Excluir o laudo ${laudo.numero || 'sem número'}?`)) return;
    laudos = laudos.filter((l) => l.id !== id);
    if (editorLau && editorLau.id === id) { editorLau = null; mostrarListaLau(); }
    salvarLaudos();
    renderListaLau();
    renderDashboard();
  }
}

/* =================================================================
   LAUDOS — EDITOR
   ================================================================= */

function respostasPadrao(tipoId) {
  return getModelo(tipoId).itens.map(() => ({ status: 'c', obs: '' }));
}

function novoLaudo() {
  const tipo = LAUDO_MODELOS[0].id;
  editorLau = {
    id: `lau-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
    numero: null,
    criadoEm: new Date().toISOString(),
    tipo,
    cliente: '', endereco: '',
    dataInspecao: hoje(),
    acompanhante: '', instrumentos: '', art: '',
    respostas: respostasPadrao(tipo),
    parecer: 'aprovado',
    conclusao: '',
  };
  dirtyLau = false;
  renderEditorLau();
}

function mostrarListaLau() {
  el('lau-editor-view').hidden = true;
  el('lau-lista-view').hidden = false;
  renderListaLau();
}

function renderEditorLau() {
  if (!editorLau) return;
  el('lau-lista-view').hidden = true;
  el('lau-editor-view').hidden = false;

  el('lau-titulo').textContent = editorLau.numero ? `Laudo ${editorLau.numero}` : 'Novo laudo';
  fillSelect('le-tipo', LAUDO_MODELOS.map((m) => ({ id: m.id, nome: m.titulo })), editorLau.tipo);
  fillSelect('le-parecer', PARECERES, editorLau.parecer);

  el('le-cliente').value = editorLau.cliente;
  el('le-endereco').value = editorLau.endereco;
  el('le-data').value = editorLau.dataInspecao;
  el('le-acompanhante').value = editorLau.acompanhante;
  el('le-instrumentos').value = editorLau.instrumentos;
  el('le-art').value = editorLau.art;
  el('le-conclusao').value = editorLau.conclusao;

  renderChecklist();
  renderResumoLau();
}

function renderChecklist() {
  if (!editorLau) return;
  const modelo = getModelo(editorLau.tipo);
  el('le-checklist').innerHTML = modelo.itens.map((texto, i) => {
    const resposta = editorLau.respostas[i] || { status: 'c', obs: '' };
    return `
    <tr>
      <td>${i + 1}. ${esc(texto)}</td>
      <td>
        <select data-chk="${i}" class="sit sit-${resposta.status}">
          <option value="c" ${resposta.status === 'c' ? 'selected' : ''}>Conforme</option>
          <option value="nc" ${resposta.status === 'nc' ? 'selected' : ''}>Não conforme</option>
          <option value="na" ${resposta.status === 'na' ? 'selected' : ''}>Não aplicável</option>
        </select>
      </td>
      <td><input type="text" data-chkobs="${i}" value="${esc(resposta.obs)}" placeholder="Observação (opcional)"></td>
    </tr>`;
  }).join('');
}

function renderResumoLau() {
  if (!editorLau) return;
  const contagem = contarChecklist(editorLau);
  el('lr-c').textContent = contagem.c || 0;
  el('lr-nc').textContent = contagem.nc || 0;
  el('lr-na').textContent = contagem.na || 0;
  el('lr-sugestao').textContent = achar(PARECERES, parecerSugerido(editorLau)).nome;
}

function lerCamposFixosLau() {
  if (!editorLau) return;
  editorLau.cliente = el('le-cliente').value.trim();
  editorLau.endereco = el('le-endereco').value.trim();
  editorLau.dataInspecao = el('le-data').value || hoje();
  editorLau.acompanhante = el('le-acompanhante').value.trim();
  editorLau.instrumentos = el('le-instrumentos').value.trim();
  editorLau.art = el('le-art').value.trim();
  editorLau.parecer = el('le-parecer').value;
  editorLau.conclusao = el('le-conclusao').value;
}

function trocarTipoLaudo(novoTipo) {
  const preenchido = editorLau.respostas.some((r) => r.status !== 'c' || r.obs);
  if (preenchido && !confirm('Trocar o tipo de laudo reinicia o checklist. Continuar?')) {
    el('le-tipo').value = editorLau.tipo;
    return;
  }
  editorLau.tipo = novoTipo;
  editorLau.respostas = respostasPadrao(novoTipo);
  renderChecklist();
  renderResumoLau();
}

function gerarConclusaoAutomatica() {
  if (!editorLau) return;
  lerCamposFixosLau();
  const modelo = getModelo(editorLau.tipo);
  const naoConformes = editorLau.respostas
    .map((r, i) => ({ ...r, texto: modelo.itens[i], num: i + 1 }))
    .filter((r) => r.status === 'nc');

  let texto;
  if (!naoConformes.length) {
    texto = 'Com base na inspeção realizada e nos itens verificados, as instalações encontram-se em conformidade com os requisitos avaliados, não tendo sido identificadas não conformidades na data da inspeção.';
  } else {
    const lista = naoConformes
      .map((r) => `${r.num}) ${r.texto}${r.obs ? ` — ${r.obs}` : ''}`)
      .join('; ');
    texto = `Durante a inspeção foram identificadas ${naoConformes.length} não conformidade(s): ${lista}. `
      + 'Recomenda-se a correção dos itens apontados por profissional habilitado, com nova verificação após as adequações.';
    if (naoConformes.length > 2) {
      texto += ' Diante da quantidade e da criticidade dos itens identificados, a instalação é considerada reprovada até a regularização.';
    }
  }

  const sugestao = parecerSugerido(editorLau);
  editorLau.conclusao = texto;
  editorLau.parecer = sugestao;
  el('le-conclusao').value = texto;
  el('le-parecer').value = sugestao;
  dirtyLau = true;
}

function salvarLau() {
  if (!editorLau) return;
  lerCamposFixosLau();
  if (!editorLau.numero) editorLau.numero = proximoNumero('lau');

  const posicao = laudos.findIndex((l) => l.id === editorLau.id);
  const copia = structuredClone(editorLau);
  if (posicao >= 0) laudos[posicao] = copia; else laudos.push(copia);
  salvarLaudos();
  dirtyLau = false;

  el('lau-titulo').textContent = `Laudo ${editorLau.numero}`;
  renderDashboard();
  botaoFeedback(el('le-salvar'), '✓ Salvo!');
}

/* =================================================================
   DOCUMENTOS PARA IMPRESSÃO (proposta e laudo)
   ================================================================= */

function logoSvg() {
  return `<svg class="doc-logo" viewBox="0 0 100 100" aria-hidden="true">
    <polygon points="50,4 92,27 92,73 50,96 8,73 8,27" fill="#f0a500"/>
    <polygon points="50,10 87,30 87,70 50,90 13,70 13,30" fill="#0d2b45"/>
    <path d="M55 22 L33 55 h14 L45 78 L69 44 h-15 z" fill="#f0a500"/>
  </svg>`;
}

function docCabecalho(tipoDoc, numero) {
  const e = config.empresa;
  const linhas = [
    e.cnpj ? `CNPJ ${e.cnpj}` : '',
    e.endereco,
    e.cidade,
    [e.fone, e.email, e.site].filter(Boolean).join(' · '),
  ].filter(Boolean);

  return `
  <div class="doc-topo">
    <div class="doc-brand">
      ${logoSvg()}
      <div>
        <div class="doc-nome">${esc(e.nome || 'Elyon Engenharia')}</div>
        <div class="doc-slogan">${esc(e.slogan || '')}</div>
      </div>
    </div>
    <div class="doc-info">${linhas.map(esc).join('<br>')}</div>
  </div>
  <div class="doc-faixa"><span>${esc(tipoDoc)}</span><span>${esc(numero || '')}</span></div>`;
}

function docAssinatura(extraLinhas = []) {
  const e = config.empresa;
  const linhas = [
    e.rt || 'Responsável técnico',
    e.crea || '',
    ...extraLinhas,
  ].filter(Boolean);
  return `
  <div class="doc-assinatura">
    <div class="linha"></div>
    ${linhas.map((l) => `${esc(l)}<br>`).join('')}
    ${esc(e.nome || 'Elyon Engenharia')}
  </div>`;
}

function gerarPropostaDoc(orc) {
  const r = calcularOrcamento(orc);
  const agora = new Date().toLocaleDateString('pt-BR');
  const pagamentoTexto = orc.pagamento === 'outro'
    ? (orc.pagamentoTxt || 'A combinar')
    : achar(PAGAMENTOS, orc.pagamento).nome;

  const escopoServicos = r.itens.map((ri, i) => `
    <div class="doc-serv">
      <h3>${i + 1}. ${esc(ri.servico.nome)} — ${ri.item.quantidade.toLocaleString('pt-BR')} ${esc(ri.servico.unidade.sufixo)}</h3>
      <ul>${(ri.servico.escopo || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      <p class="doc-meta">Enquadramento: ${esc(ri.complexidade.nome)} · Carga técnica estimada: ${fmtH(ri.horas)}</p>
    </div>`).join('');

  const linhasInvestimento = r.itens.map((ri) => `
    <tr><td>${esc(ri.servico.nome)} (${ri.item.quantidade.toLocaleString('pt-BR')} ${esc(ri.servico.unidade.sufixo)})</td><td>${moeda(ri.valor)}</td></tr>`);
  if (r.horasVisitas > 0) {
    linhasInvestimento.push(`<tr><td>Visitas técnicas (${orc.visitas}×)</td><td>${moeda(r.horasVisitas * r.hora.valorHora)}</td></tr>`);
  }
  if (orc.art > 0) linhasInvestimento.push(`<tr><td>ART / TRT</td><td>${moeda(orc.art)}</td></tr>`);
  if (r.deslocamento > 0) linhasInvestimento.push(`<tr><td>Deslocamentos</td><td>${moeda(r.deslocamento)}</td></tr>`);
  if (orc.plotagem > 0) linhasInvestimento.push(`<tr><td>Plotagem / impressões</td><td>${moeda(orc.plotagem)}</td></tr>`);
  if (orc.outros > 0) linhasInvestimento.push(`<tr><td>Outros custos</td><td>${moeda(orc.outros)}</td></tr>`);
  if (r.descontoValor > 0) linhasInvestimento.push(`<tr><td>Desconto comercial (${orc.desconto}%)</td><td>− ${moeda(r.descontoValor)}</td></tr>`);
  linhasInvestimento.push(`<tr class="total"><td>INVESTIMENTO TOTAL</td><td>${moeda(r.total)}</td></tr>`);

  el('documento').innerHTML = `
    ${docCabecalho('PROPOSTA COMERCIAL', orc.numero || '')}

    <h2>1. Cliente e objeto</h2>
    <table class="doc-tabela">
      <tr><td class="rotulo">Cliente</td><td>${esc(orc.cliente) || '—'}</td></tr>
      ${orc.contato ? `<tr><td class="rotulo">Contato</td><td>${esc(orc.contato)}</td></tr>` : ''}
      <tr><td class="rotulo">Obra / projeto</td><td>${esc(orc.obra) || '—'}</td></tr>
      ${orc.endereco ? `<tr><td class="rotulo">Endereço</td><td>${esc(orc.endereco)}</td></tr>` : ''}
      <tr><td class="rotulo">Data da proposta</td><td>${agora}</td></tr>
      <tr><td class="rotulo">Validade</td><td>${orc.validade || 15} dias</td></tr>
    </table>

    <h2>2. Escopo dos serviços</h2>
    ${escopoServicos}
    ${orc.visitas > 0 ? `<p class="doc-meta">Inclui ${orc.visitas} visita(s) técnica(s) à obra.</p>` : ''}

    <h2>3. Investimento</h2>
    <table class="doc-tabela">${linhasInvestimento.join('')}</table>

    <h2>4. Prazo e condições</h2>
    <ul>
      <li>Prazo estimado de execução: ${r.prazoUteis} dia(s) útil(eis) (~${r.prazoCorridos} dias corridos), contados a partir do recebimento de todas as informações necessárias.</li>
      <li>Condição de pagamento: ${esc(pagamentoTexto)}.</li>
      <li>Estão inclusas 2 (duas) rodadas de revisão por serviço; revisões adicionais serão orçadas à parte.</li>
      <li>Não estão inclusos: taxas de concessionária e de órgãos públicos, execução de obras, fornecimento de materiais e serviços de terceiros não listados.</li>
    </ul>

    ${docAssinatura()}
    <p class="doc-rodape">Proposta ${esc(orc.numero || '')} gerada em ${agora} pela plataforma Elyon Engenharia.</p>
  `;

  window.print();
}

function gerarLaudoDoc(lau) {
  const modelo = getModelo(lau.tipo);
  const e = config.empresa;
  const agora = new Date().toLocaleDateString('pt-BR');
  const rotuloSituacao = { c: 'CONFORME', nc: 'NÃO CONFORME', na: 'N/A' };

  const linhasChecklist = modelo.itens.map((texto, i) => {
    const resposta = lau.respostas[i] || { status: 'na', obs: '' };
    return `
    <tr>
      <td>${i + 1}. ${esc(texto)}</td>
      <td class="sit-doc sit-doc-${resposta.status}">${rotuloSituacao[resposta.status]}</td>
      <td>${esc(resposta.obs) || '—'}</td>
    </tr>`;
  }).join('');

  const naoConformes = modelo.itens
    .map((texto, i) => ({ texto, num: i + 1, ...(lau.respostas[i] || {}) }))
    .filter((r) => r.status === 'nc');

  const blocoNc = naoConformes.length
    ? `<ol>${naoConformes.map((r) => `<li>${esc(r.texto)}${r.obs ? ` — <em>${esc(r.obs)}</em>` : ''}</li>`).join('')}</ol>`
    : '<p>Não foram identificadas não conformidades nos itens verificados.</p>';

  const parecer = achar(PARECERES, lau.parecer);

  el('documento').innerHTML = `
    ${docCabecalho(modelo.titulo.toUpperCase(), lau.numero || '')}
    <p class="doc-subtitulo">${esc(modelo.subtitulo)}</p>

    <h2>1. Identificação</h2>
    <table class="doc-tabela">
      <tr><td class="rotulo">Cliente / contratante</td><td>${esc(lau.cliente) || '—'}</td></tr>
      <tr><td class="rotulo">Local da inspeção</td><td>${esc(lau.endereco) || '—'}</td></tr>
      <tr><td class="rotulo">Data da inspeção</td><td>${dataBR(lau.dataInspecao)}</td></tr>
      ${lau.acompanhante ? `<tr><td class="rotulo">Acompanhante</td><td>${esc(lau.acompanhante)}</td></tr>` : ''}
      ${lau.instrumentos ? `<tr><td class="rotulo">Instrumentos utilizados</td><td>${esc(lau.instrumentos)}</td></tr>` : ''}
      <tr><td class="rotulo">Responsável técnico</td><td>${esc(e.rt) || '—'} ${e.crea ? `· ${esc(e.crea)}` : ''}</td></tr>
      ${lau.art ? `<tr><td class="rotulo">ART</td><td>${esc(lau.art)}</td></tr>` : ''}
    </table>

    <h2>2. Objetivo</h2>
    <p>${esc(modelo.objetivo)}</p>

    <h2>3. Normas e documentos de referência</h2>
    <ul>${modelo.normas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>

    <h2>4. Metodologia</h2>
    <p>${esc(modelo.metodologia)}</p>

    <h2>5. Resultados da verificação</h2>
    <table class="doc-tabela doc-checklist">
      <tr><th>Item verificado</th><th>Situação</th><th>Observação</th></tr>
      ${linhasChecklist}
    </table>

    <h2>6. Não conformidades e recomendações</h2>
    ${blocoNc}

    <h2>7. Conclusão</h2>
    <p>${esc(lau.conclusao) || 'Conclusão não preenchida.'}</p>
    <div class="doc-parecer parecer-${esc(parecer.id)}">PARECER: ${esc(parecer.nome)}</div>
    <p class="doc-meta">Recomenda-se nova inspeção em até ${modelo.validadeMeses} meses, ou imediatamente após alterações relevantes nas instalações.</p>

    ${docAssinatura(lau.art ? [`ART ${lau.art}`] : [])}
    <p class="doc-rodape">Documento ${esc(lau.numero || '')} gerado em ${agora} pela plataforma Elyon Engenharia. Este laudo reflete as condições observadas na data da inspeção.</p>
  `;

  window.print();
}

/* =================================================================
   HORA TÉCNICA
   ================================================================= */

function preencherHoraTecnica() {
  const ht = config.horaTecnica;
  el('ht-prolabore').value = ht.proLabore;
  el('ht-fixos').value = ht.custosFixos;
  el('ht-dias').value = ht.diasUteis;
  el('ht-horasdia').value = ht.horasDia;
  el('ht-produtivo').value = ht.percProdutivo;
  el('ht-impostos').value = ht.impostos;
  el('ht-margem').value = ht.margem;
  el('ht-horasvisita').value = config.horasPorVisita;
  el('ht-custokm').value = config.custoKm;
}

function lerHoraTecnica() {
  config.horaTecnica = {
    proLabore: numDe('ht-prolabore'),
    custosFixos: numDe('ht-fixos'),
    diasUteis: numDe('ht-dias'),
    horasDia: numDe('ht-horasdia'),
    percProdutivo: numDe('ht-produtivo'),
    impostos: numDe('ht-impostos'),
    margem: numDe('ht-margem'),
  };
  config.horasPorVisita = numDe('ht-horasvisita');
  config.custoKm = numDe('ht-custokm');
}

function renderHoraTecnica() {
  const h = calcularHora(config.horaTecnica);
  el('ht-out-horas').textContent = fmtH(h.horasFaturaveis);
  el('ht-out-custo').textContent = moeda(h.custoMensal);
  el('ht-out-custohora').textContent = `${moeda(h.custoHora)} / h`;
  el('ht-out-valorhora').textContent = `${moeda(h.valorHora)} / h`;
}

/* =================================================================
   CATÁLOGO
   ================================================================= */

function renderCatalogo() {
  el('cat-lista').innerHTML = catalogo.map((s) => `
    <div class="card servico-card" data-sid="${esc(s.id)}">
      <div class="servico-topo">
        <h3>${esc(s.nome)}</h3>
        <span class="badge">${esc(s.unidade.sufixo)}</span>
      </div>
      <div class="grid-3">
        <label>Horas base
          <input type="number" step="any" min="0" data-scampo="horasBase" value="${s.horasBase}">
        </label>
        <label>Horas por ${esc(s.unidade.sufixo)}
          <input type="number" step="any" min="0" data-scampo="horasPorUnidade" value="${s.horasPorUnidade}">
        </label>
        <label>Qtde. padrão
          <input type="number" step="any" min="0" data-scampo="qtdPadrao" value="${s.qtdPadrao}">
        </label>
      </div>
      <h4>Níveis de complexidade (multiplicadores)</h4>
      <table class="editavel">
        <tbody>
          ${s.complexidades.map((c, i) => `
          <tr>
            <td><input type="text" data-cxidx="${i}" data-cxcampo="nome" value="${esc(c.nome)}"></td>
            <td class="col-fator"><input type="number" step="any" min="0" data-cxidx="${i}" data-cxcampo="fator" value="${c.fator}"></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <h4>Escopo na proposta (uma linha por item)</h4>
      <textarea rows="5" data-scampo="escopo">${esc((s.escopo || []).join('\n'))}</textarea>
    </div>`).join('');
}

function tratarInputCatalogo(alvo) {
  const card = alvo.closest('[data-sid]');
  if (!card) return;
  const servico = getServico(card.dataset.sid);
  if (!servico) return;

  if (alvo.dataset.scampo) {
    const campo = alvo.dataset.scampo;
    if (campo === 'escopo') {
      servico.escopo = alvo.value.split('\n').map((linha) => linha.trim()).filter(Boolean);
    } else {
      const v = parseFloat(alvo.value);
      servico[campo] = Number.isFinite(v) ? v : 0;
    }
  } else if (alvo.dataset.cxcampo) {
    const cx = servico.complexidades[Number(alvo.dataset.cxidx)];
    if (!cx) return;
    if (alvo.dataset.cxcampo === 'fator') {
      const v = parseFloat(alvo.value);
      cx.fator = Number.isFinite(v) ? v : 0;
    } else {
      cx.nome = alvo.value;
    }
  }
  salvarCatalogo();
  if (editorOrc) renderResumoOrc();
}

/* =================================================================
   CONFIGURAÇÕES
   ================================================================= */

function preencherConfig() {
  const e = config.empresa;
  el('cfg-nome').value = e.nome;
  el('cfg-slogan').value = e.slogan;
  el('cfg-cnpj').value = e.cnpj;
  el('cfg-endereco').value = e.endereco;
  el('cfg-cidade').value = e.cidade;
  el('cfg-fone').value = e.fone;
  el('cfg-email').value = e.email;
  el('cfg-site').value = e.site;
  el('cfg-rt').value = e.rt;
  el('cfg-crea').value = e.crea;
}

function lerConfigEmpresa() {
  config.empresa = {
    nome: el('cfg-nome').value.trim() || 'Elyon Engenharia',
    slogan: el('cfg-slogan').value.trim(),
    cnpj: el('cfg-cnpj').value.trim(),
    endereco: el('cfg-endereco').value.trim(),
    cidade: el('cfg-cidade').value.trim(),
    fone: el('cfg-fone').value.trim(),
    email: el('cfg-email').value.trim(),
    site: el('cfg-site').value.trim(),
    rt: el('cfg-rt').value.trim(),
    crea: el('cfg-crea').value.trim(),
  };
}

function exportarDados() {
  const blob = new Blob(
    [JSON.stringify({ config, catalogo, orcamentos, laudos, seq }, null, 2)],
    { type: 'application/json' },
  );
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'elyon-backup.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

function importarDados(arquivo) {
  const leitor = new FileReader();
  leitor.onload = () => {
    try {
      const dado = JSON.parse(leitor.result);
      if (dado.config) {
        config = { ...structuredClone(DEFAULT_CONFIG), ...dado.config };
        config.empresa = { ...structuredClone(DEFAULT_CONFIG.empresa), ...(dado.config.empresa || {}) };
        config.horaTecnica = { ...structuredClone(DEFAULT_CONFIG.horaTecnica), ...(dado.config.horaTecnica || {}) };
      }
      if (Array.isArray(dado.catalogo)) catalogo = mesclarCatalogo(dado.catalogo);
      if (Array.isArray(dado.orcamentos)) orcamentos = dado.orcamentos;
      if (Array.isArray(dado.laudos)) laudos = dado.laudos;
      if (dado.seq) seq = { orc: 0, lau: 0, ...dado.seq };
      salvarConfig(); salvarCatalogo(); salvarOrcamentos(); salvarLaudos(); salvarSeq();
      editorOrc = null; editorLau = null;
      mostrarListaOrc(); mostrarListaLau();
      renderTudo();
      alert('Backup importado com sucesso.');
    } catch {
      alert('Arquivo inválido. Use um backup exportado pela própria plataforma.');
    }
  };
  leitor.readAsText(arquivo);
}

function restaurarPadroes() {
  if (!confirm('Restaurar hora técnica, catálogo e dados da empresa para os valores padrão? Orçamentos e laudos salvos serão mantidos.')) return;
  config = structuredClone(DEFAULT_CONFIG);
  catalogo = structuredClone(DEFAULT_CATALOGO);
  salvarConfig(); salvarCatalogo();
  renderTudo();
}

/* =================================================================
   NAVEGAÇÃO E INICIALIZAÇÃO
   ================================================================= */

function trocarAba(nome) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === nome));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${nome}`));
  el('titulo-pagina').textContent = TITULOS_ABAS[nome] || 'Elyon Engenharia';

  if (nome === 'dashboard') renderDashboard();
  else if (nome === 'orcamentos') { if (editorOrc) { renderItensOrc(); renderResumoOrc(); } else renderListaOrc(); }
  else if (nome === 'laudos') { if (editorLau) renderResumoLau(); else renderListaLau(); }
  else if (nome === 'horatecnica') renderHoraTecnica();
  else if (nome === 'catalogo') renderCatalogo();
  else if (nome === 'config') preencherConfig();
}

function renderTudo() {
  preencherHoraTecnica();
  renderHoraTecnica();
  renderCatalogo();
  preencherConfig();
  renderListaOrc();
  renderListaLau();
  renderDashboard();
}

document.addEventListener('DOMContentLoaded', () => {
  // guarda de sessão: sem login, volta para a tela de entrada
  const sessao = carregarSessao();
  if (!sessao) {
    location.replace('entrar.html');
    return;
  }
  renderUsuario(sessao);

  renderTudo();

  // popula selects estáticos do editor de laudo (útil antes da primeira edição)
  fillSelect('le-tipo', LAUDO_MODELOS.map((m) => ({ id: m.id, nome: m.titulo })), LAUDO_MODELOS[0].id);
  fillSelect('le-parecer', PARECERES, 'aprovado');

  // navegação
  document.querySelectorAll('nav button').forEach((botao) => {
    botao.addEventListener('click', () => trocarAba(botao.dataset.tab));
  });

  // shell SaaS: ação rápida da topbar e logout
  el('tb-novo-orc').addEventListener('click', () => { trocarAba('orcamentos'); novoOrcamento(); });
  el('btn-sair').addEventListener('click', encerrarSessao);

  // dashboard — atalhos
  el('d-novo-orc').addEventListener('click', () => { trocarAba('orcamentos'); novoOrcamento(); });
  el('d-novo-laudo').addEventListener('click', () => { trocarAba('laudos'); novoLaudo(); });

  /* ---------- orçamentos ---------- */
  el('orc-novo').addEventListener('click', novoOrcamento);
  el('orc-voltar').addEventListener('click', () => {
    if (dirtyOrc && !confirm('Há alterações não salvas. Descartar?')) return;
    editorOrc = null;
    mostrarListaOrc();
  });

  ['input', 'change'].forEach((tipoEvento) => {
    el('orc-editor-view').addEventListener(tipoEvento, (evento) => {
      if (!editorOrc || evento.target.tagName === 'BUTTON') return;
      if (evento.target.closest('#oe-itens')) tratarInputItem(evento.target);
      else lerCamposFixosOrc();
      dirtyOrc = true;
      renderResumoOrc();
    });
  });

  el('oe-itens').addEventListener('click', (evento) => {
    const botao = evento.target.closest('.item-remover');
    if (!botao || !editorOrc) return;
    const idx = Number(botao.closest('.item-servico').dataset.idx);
    editorOrc.itens.splice(idx, 1);
    dirtyOrc = true;
    renderItensOrc();
    renderResumoOrc();
  });

  el('oe-additem').addEventListener('click', () => {
    if (!editorOrc) return;
    const servico = catalogo[0];
    editorOrc.itens.push({
      servicoId: servico.id,
      quantidade: servico.qtdPadrao,
      complexidadeId: servico.complexidades[0].id,
      ajuste: 0,
    });
    dirtyOrc = true;
    renderItensOrc();
    renderResumoOrc();
  });

  el('oe-salvar').addEventListener('click', salvarOrc);
  el('oe-proposta').addEventListener('click', () => {
    if (!editorOrc) return;
    lerCamposFixosOrc();
    if (!editorOrc.itens.length) { alert('Adicione ao menos um serviço antes de gerar a proposta.'); return; }
    if (dirtyOrc || !editorOrc.numero) salvarOrc();
    gerarPropostaDoc(editorOrc);
  });

  el('orc-tbody').addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-acao]');
    if (botao) acaoListaOrc(botao.dataset.acao, botao.dataset.id);
  });

  el('orc-tbody').addEventListener('change', (evento) => {
    const select = evento.target.closest('select.status-inline');
    if (!select) return;
    const orc = orcamentos.find((o) => o.id === select.dataset.id);
    if (!orc) return;
    orc.status = select.value;
    salvarOrcamentos();
    renderListaOrc();
    renderDashboard();
  });

  /* ---------- laudos ---------- */
  el('lau-novo').addEventListener('click', novoLaudo);
  el('lau-voltar').addEventListener('click', () => {
    if (dirtyLau && !confirm('Há alterações não salvas. Descartar?')) return;
    editorLau = null;
    mostrarListaLau();
  });

  ['input', 'change'].forEach((tipoEvento) => {
    el('lau-editor-view').addEventListener(tipoEvento, (evento) => {
      if (!editorLau || evento.target.tagName === 'BUTTON') return;
      const alvo = evento.target;

      if (alvo.id === 'le-tipo') {
        trocarTipoLaudo(alvo.value);
        return;
      }
      if (alvo.dataset.chk !== undefined) {
        const resposta = editorLau.respostas[Number(alvo.dataset.chk)];
        if (resposta) resposta.status = alvo.value;
        alvo.className = `sit sit-${alvo.value}`;
      } else if (alvo.dataset.chkobs !== undefined) {
        const resposta = editorLau.respostas[Number(alvo.dataset.chkobs)];
        if (resposta) resposta.obs = alvo.value;
      } else {
        lerCamposFixosLau();
      }
      dirtyLau = true;
      renderResumoLau();
    });
  });

  el('le-sugerir').addEventListener('click', gerarConclusaoAutomatica);
  el('le-salvar').addEventListener('click', salvarLau);
  el('le-doc').addEventListener('click', () => {
    if (!editorLau) return;
    lerCamposFixosLau();
    if (dirtyLau || !editorLau.numero) salvarLau();
    gerarLaudoDoc(editorLau);
  });

  el('lau-tbody').addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-acao]');
    if (botao) acaoListaLau(botao.dataset.acao, botao.dataset.id);
  });

  /* ---------- hora técnica ---------- */
  el('tab-horatecnica').addEventListener('input', () => {
    lerHoraTecnica();
    salvarConfig();
    renderHoraTecnica();
    if (editorOrc) renderResumoOrc();
  });

  /* ---------- catálogo ---------- */
  el('cat-lista').addEventListener('input', (evento) => tratarInputCatalogo(evento.target));

  /* ---------- configurações ---------- */
  el('tab-config').addEventListener('input', (evento) => {
    if (evento.target.type === 'file') return;
    lerConfigEmpresa();
    salvarConfig();
  });

  el('cfg-exportar').addEventListener('click', exportarDados);
  el('cfg-importar').addEventListener('click', () => el('cfg-file').click());
  el('cfg-file').addEventListener('change', (evento) => {
    if (evento.target.files[0]) importarDados(evento.target.files[0]);
    evento.target.value = '';
  });
  el('cfg-restaurar').addEventListener('click', restaurarPadroes);
});
