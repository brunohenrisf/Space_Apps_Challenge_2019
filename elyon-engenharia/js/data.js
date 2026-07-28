'use strict';

/* =================================================================
   ELYON ENGENHARIA — dados padrão da plataforma
   -----------------------------------------------------------------
   Catálogo de serviços, fatores globais e modelos de laudo.
   Tudo aqui é apenas o PADRÃO inicial: o catálogo e a hora técnica
   são editáveis pela interface e ficam salvos no navegador.
   ================================================================= */

const URGENCIAS = [
  { id: 'normal',   nome: 'Prazo normal',          fator: 1.0 },
  { id: 'apertado', nome: 'Prazo apertado (+15%)', fator: 1.15 },
  { id: 'urgente',  nome: 'Urgente (+30%)',        fator: 1.3 },
];

const PAGAMENTOS = [
  { id: '5050',    nome: '50% na aprovação · 50% na entrega' },
  { id: '403030',  nome: '40% na aprovação · 30% na entrega parcial · 30% na entrega final' },
  { id: 'avista',  nome: '100% à vista na aprovação' },
  { id: 'faturado', nome: 'Faturado em até 28 dias após a entrega' },
  { id: 'outro',   nome: 'Outro (descrever)' },
];

const STATUS_ORCAMENTO = [
  { id: 'rascunho', nome: 'Rascunho' },
  { id: 'enviada',  nome: 'Enviada' },
  { id: 'aprovada', nome: 'Aprovada' },
  { id: 'recusada', nome: 'Recusada' },
];

const PARECERES = [
  { id: 'aprovado',  nome: 'APROVADO' },
  { id: 'ressalvas', nome: 'APROVADO COM RESSALVAS' },
  { id: 'reprovado', nome: 'REPROVADO' },
];

/* ---------------- configuração padrão ---------------- */
const DEFAULT_CONFIG = {
  empresa: {
    nome: 'Elyon Engenharia',
    slogan: 'Projetos Elétricos e Laudos Técnicos',
    cnpj: '',
    endereco: '',
    cidade: '',
    fone: '',
    email: '',
    site: '',
    rt: '',
    crea: '',
  },
  horaTecnica: {
    proLabore: 8000,
    custosFixos: 2500,
    diasUteis: 21,
    horasDia: 8,
    percProdutivo: 65,
    impostos: 8.5,
    margem: 25,
  },
  horasPorVisita: 3,
  custoKm: 1.8,
};

/* ---------------- catálogo de serviços ----------------
   Cada serviço tem sua própria unidade de medida, equação de
   horas (base + horas/unidade) e níveis de complexidade com
   fatores próprios. Horas = (base + h/un × qtd) × complexidade
   × urgência × (1 + ajuste fino). */
const DEFAULT_CATALOGO = [
  {
    id: 'eletrico',
    nome: 'Projeto Elétrico de Baixa Tensão',
    curto: 'Elétrico BT',
    categoria: 'projeto',
    unidade: { label: 'Área construída (m²)', sufixo: 'm²' },
    qtdPadrao: 150,
    horasBase: 10,
    horasPorUnidade: 0.14,
    complexidades: [
      { id: 'res_padrao', nome: 'Residencial padrão',                fator: 0.9 },
      { id: 'res_alto',   nome: 'Residencial alto padrão',           fator: 1.15 },
      { id: 'comercial',  nome: 'Comercial / escritórios / lojas',   fator: 1.2 },
      { id: 'ind_leve',   nome: 'Industrial leve / galpão',          fator: 1.5 },
      { id: 'ind_pesado', nome: 'Industrial pesado / processo',      fator: 1.9 },
    ],
    escopo: [
      'Plantas baixas com pontos de iluminação, tomadas e circuitos',
      'Diagrama unifilar e quadro de cargas',
      'Dimensionamento de condutores, proteções e eletrodutos',
      'Memorial descritivo e de cálculo',
      'Lista de materiais quantificada',
      'Emissão de ART',
    ],
  },
  {
    id: 'spda',
    nome: 'Projeto de SPDA (NBR 5419)',
    curto: 'SPDA',
    categoria: 'projeto',
    unidade: { label: 'Área de cobertura (m²)', sufixo: 'm²' },
    qtdPadrao: 600,
    horasBase: 8,
    horasPorUnidade: 0.05,
    complexidades: [
      { id: 'simples',    nome: 'Edificação simples / volume único',       fator: 0.85 },
      { id: 'multiplos',  nome: 'Múltiplos volumes / cobertura recortada', fator: 1.15 },
      { id: 'complexa',   nome: 'Estrutura complexa / inflamáveis',        fator: 1.45 },
    ],
    escopo: [
      'Análise de risco conforme NBR 5419-2',
      'Definição do nível de proteção e do método de captação',
      'Projeto de captação, descidas e malha de aterramento',
      'Detalhes construtivos e especificações de materiais',
      'Memorial descritivo e emissão de ART',
    ],
  },
  {
    id: 'subestacao',
    nome: 'Projeto de Subestação (MT)',
    curto: 'Subestação',
    categoria: 'projeto',
    unidade: { label: 'Potência instalada (kVA)', sufixo: 'kVA' },
    qtdPadrao: 300,
    horasBase: 30,
    horasPorUnidade: 0.06,
    complexidades: [
      { id: 'aerea',     nome: 'Aérea em poste',                          fator: 0.8 },
      { id: 'abrigada',  nome: 'Abrigada em alvenaria',                   fator: 1.0 },
      { id: 'blindada',  nome: 'Cabine blindada / metálica',              fator: 1.15 },
      { id: 'complexa',  nome: 'Com geração paralela / seletividade complexa', fator: 1.4 },
    ],
    escopo: [
      'Projeto executivo da subestação (MT/BT)',
      'Diagrama unifilar geral e malha de aterramento',
      'Estudo de proteção e seletividade',
      'Memorial descritivo e de cálculo',
      'Aprovação junto à concessionária',
      'Emissão de ART',
    ],
  },
  {
    id: 'solar',
    nome: 'Projeto Fotovoltaico + Homologação',
    curto: 'Solar',
    categoria: 'projeto',
    unidade: { label: 'Potência do gerador (kWp)', sufixo: 'kWp' },
    qtdPadrao: 10,
    horasBase: 8,
    horasPorUnidade: 0.3,
    complexidades: [
      { id: 'micro_res',  nome: 'Microgeração — telhado residencial',   fator: 0.9 },
      { id: 'comercial',  nome: 'Telhado comercial / industrial',       fator: 1.1 },
      { id: 'solo',       nome: 'Solo / carport',                       fator: 1.3 },
      { id: 'mini',       nome: 'Minigeração (acima de 75 kWp)',        fator: 1.5 },
    ],
    escopo: [
      'Dimensionamento do gerador fotovoltaico e inversores',
      'Layout dos módulos e projeto elétrico CC/CA',
      'Projeto de proteções e aterramento',
      'Formulários e homologação junto à concessionária',
      'Acompanhamento até o parecer de acesso e vistoria',
      'Emissão de ART',
    ],
  },
  {
    id: 'automacao',
    nome: 'Projeto de Automação Residencial',
    curto: 'Automação',
    categoria: 'projeto',
    unidade: { label: 'Pontos automatizados', sufixo: 'pontos' },
    qtdPadrao: 20,
    horasBase: 6,
    horasPorUnidade: 0.5,
    complexidades: [
      { id: 'iluminacao', nome: 'Iluminação e cenas',                       fator: 0.9 },
      { id: 'av',         nome: 'Iluminação + cortinas + áudio/vídeo',      fator: 1.2 },
      { id: 'completa',   nome: 'Integração completa (KNX / casa inteligente)', fator: 1.5 },
    ],
    escopo: [
      'Arquitetura do sistema e topologia de rede',
      'Planta de pontos automatizados e infraestrutura',
      'Diagramas de quadros e módulos de automação',
      'Especificação de equipamentos e programação de cenas',
      'Manual básico de uso do sistema',
    ],
  },
  {
    id: 'cabeamento',
    nome: 'Cabeamento Estruturado / Rede e CFTV',
    curto: 'Cabeamento',
    categoria: 'projeto',
    unidade: { label: 'Pontos (rede + CFTV)', sufixo: 'pontos' },
    qtdPadrao: 30,
    horasBase: 6,
    horasPorUnidade: 0.3,
    complexidades: [
      { id: 'residencial', nome: 'Residencial',                    fator: 0.9 },
      { id: 'escritorio',  nome: 'Escritório / comércio',          fator: 1.1 },
      { id: 'industrial',  nome: 'Industrial / planta de grande porte', fator: 1.35 },
    ],
    escopo: [
      'Planta de pontos de rede, telefonia e CFTV',
      'Topologia da rede e diagrama de racks',
      'Especificação de cabeamento e equipamentos',
      'Lista de materiais quantificada',
    ],
  },
  {
    id: 'laudo_nr10',
    nome: 'Laudo Técnico NR-10 (Prontuário)',
    curto: 'Laudo NR-10',
    categoria: 'laudo',
    unidade: { label: 'Quadros / painéis inspecionados', sufixo: 'quadros' },
    qtdPadrao: 5,
    horasBase: 8,
    horasPorUnidade: 0.7,
    complexidades: [
      { id: 'simples',    nome: 'Instalação simples (até 75 kW)',    fator: 0.85 },
      { id: 'media',      nome: 'Com cabine primária / subestação',  fator: 1.2 },
      { id: 'industrial', nome: 'Industrial / prontuário completo',  fator: 1.6 },
    ],
    escopo: [
      'Inspeção das instalações conforme NR-10',
      'Análise documental (prontuário, treinamentos, EPIs)',
      'Registro fotográfico das não conformidades',
      'Plano de ação com prazos sugeridos',
      'Laudo conclusivo com emissão de ART',
    ],
  },
  {
    id: 'laudo_eletrico',
    nome: 'Laudo de Instalações Elétricas (NBR 5410)',
    curto: 'Laudo Elétrico',
    categoria: 'laudo',
    unidade: { label: 'Área inspecionada (m²)', sufixo: 'm²' },
    qtdPadrao: 300,
    horasBase: 5,
    horasPorUnidade: 0.02,
    complexidades: [
      { id: 'residencial', nome: 'Residencial / pequeno comércio', fator: 0.85 },
      { id: 'comercial',   nome: 'Comercial de médio porte',       fator: 1.15 },
      { id: 'industrial',  nome: 'Industrial',                     fator: 1.5 },
    ],
    escopo: [
      'Inspeção visual e instrumental das instalações',
      'Análise de conformidade com a NBR 5410',
      'Registro fotográfico',
      'Parecer técnico conclusivo com emissão de ART',
    ],
  },
  {
    id: 'laudo_spda',
    nome: 'Laudo de Inspeção de SPDA',
    curto: 'Laudo SPDA',
    categoria: 'laudo',
    unidade: { label: 'Descidas / pontos de medição', sufixo: 'pontos' },
    qtdPadrao: 8,
    horasBase: 5,
    horasPorUnidade: 0.4,
    complexidades: [
      { id: 'unica',     nome: 'Edificação única',       fator: 0.9 },
      { id: 'multiplas', nome: 'Múltiplas edificações',  fator: 1.25 },
    ],
    escopo: [
      'Inspeção visual do sistema conforme NBR 5419',
      'Medição de continuidade e resistência de aterramento',
      'Registro fotográfico',
      'Laudo conclusivo com emissão de ART',
    ],
  },
  {
    id: 'aterramento',
    nome: 'Medição de Aterramento (Resistência Ôhmica)',
    curto: 'Medição Aterr.',
    categoria: 'laudo',
    unidade: { label: 'Pontos de medição', sufixo: 'pontos' },
    qtdPadrao: 6,
    horasBase: 4,
    horasPorUnidade: 0.35,
    complexidades: [
      { id: 'simples',    nome: 'Malha simples / edificação',     fator: 0.9 },
      { id: 'industrial', nome: 'Subestação / malha industrial',  fator: 1.3 },
    ],
    escopo: [
      'Medição de resistência de malha com terrômetro',
      'Relatório com valores medidos e croqui dos pontos',
      'Recomendações de adequação quando necessárias',
      'Emissão de ART',
    ],
  },
  {
    id: 'as_built',
    nome: 'As-built / Regularização de Instalações',
    curto: 'As-built',
    categoria: 'projeto',
    unidade: { label: 'Área levantada (m²)', sufixo: 'm²' },
    qtdPadrao: 150,
    horasBase: 8,
    horasPorUnidade: 0.12,
    complexidades: [
      { id: 'com_docs', nome: 'Com documentação parcial disponível', fator: 1.0 },
      { id: 'sem_docs', nome: 'Sem documentação (levantamento total)', fator: 1.3 },
    ],
    escopo: [
      'Levantamento em campo das instalações existentes',
      'Desenho das plantas as-built',
      'Diagrama unifilar atualizado',
      'Memorial descritivo e emissão de ART',
    ],
  },
];

/* ---------------- modelos de laudo / relatório ----------------
   Usados pelo módulo Laudos: cada modelo traz objetivo, normas,
   metodologia e o checklist de verificação. */
const LAUDO_MODELOS = [
  {
    id: 'nr10',
    titulo: 'Laudo Técnico NR-10',
    subtitulo: 'Análise das instalações e do prontuário elétrico — NR-10',
    objetivo: 'Avaliar as condições de segurança das instalações e serviços em eletricidade da contratante, verificando o atendimento aos requisitos da Norma Regulamentadora nº 10 (NR-10) do Ministério do Trabalho, incluindo a documentação que compõe o Prontuário das Instalações Elétricas.',
    normas: [
      'NR-10 — Segurança em Instalações e Serviços em Eletricidade',
      'NBR 5410:2004 — Instalações elétricas de baixa tensão',
      'NBR 14039 — Instalações elétricas de média tensão (quando aplicável)',
    ],
    metodologia: 'Inspeção visual das instalações elétricas acompanhada de análise documental do prontuário, verificação dos dispositivos de proteção, sinalização, condições dos quadros e painéis, e entrevista com os responsáveis pela manutenção. Os itens verificados foram classificados como Conforme, Não Conforme ou Não Aplicável.',
    validadeMeses: 12,
    itens: [
      'Esquemas unifilares atualizados das instalações',
      'Especificação e controle de EPIs e EPCs',
      'Certificados de treinamento NR-10 dos trabalhadores autorizados',
      'Procedimentos de trabalho documentados',
      'Programa de manutenção das instalações elétricas',
      'Sinalização de segurança nos quadros e áreas de risco',
      'Procedimento de desenergização e bloqueio/etiquetagem (LOTO)',
      'Aterramento e equipotencialização das instalações',
      'Dispositivos DR nas áreas exigidas',
      'Quadros identificados, íntegros e com barreiras de proteção',
      'Delimitação de zonas de risco e controlada',
      'Registros de inspeções e medições anteriores',
    ],
  },
  {
    id: 'inst_eletrica',
    titulo: 'Laudo de Instalações Elétricas',
    subtitulo: 'Inspeção de conformidade com a NBR 5410',
    objetivo: 'Avaliar as condições gerais das instalações elétricas de baixa tensão da edificação, verificando a conformidade com a NBR 5410 e identificando riscos de choque elétrico, incêndio de origem elétrica e falhas de funcionamento.',
    normas: [
      'NBR 5410:2004 — Instalações elétricas de baixa tensão',
      'NR-10 — Segurança em Instalações e Serviços em Eletricidade',
    ],
    metodologia: 'Inspeção visual e instrumental das instalações, abrangendo quadros de distribuição, dispositivos de proteção, condutores acessíveis, tomadas e pontos de utilização. Foram verificadas a integridade física dos componentes, a compatibilidade das proteções com os circuitos e as condições de aterramento. Os itens foram classificados como Conforme, Não Conforme ou Não Aplicável.',
    validadeMeses: 12,
    itens: [
      'Condutores dimensionados e sem sinais de sobreaquecimento',
      'Identificação dos circuitos nos quadros de distribuição',
      'Disjuntores compatíveis com os condutores dos circuitos',
      'Dispositivos DR nas áreas molhadas e tomadas externas',
      'DPS instalados no quadro de entrada',
      'Sistema de aterramento adequado (esquema TN/TT)',
      'Equipotencialização das massas metálicas',
      'Tomadas e interruptores íntegros e bem fixados',
      'Emendas e conexões abrigadas em caixas apropriadas',
      'Quadros organizados, sem improvisações',
      'Ausência de extensões e ligações provisórias permanentes',
      'Iluminação de emergência (quando exigida)',
    ],
  },
  {
    id: 'spda',
    titulo: 'Laudo de Inspeção de SPDA',
    subtitulo: 'Sistema de Proteção contra Descargas Atmosféricas — NBR 5419',
    objetivo: 'Verificar as condições de conservação e funcionamento do Sistema de Proteção contra Descargas Atmosféricas (SPDA) da edificação, avaliando a continuidade elétrica dos componentes e a resistência de aterramento, conforme a NBR 5419.',
    normas: [
      'NBR 5419:2015 (partes 1 a 4) — Proteção contra descargas atmosféricas',
      'NBR 16254 / componentes de SPDA (quando aplicável)',
    ],
    metodologia: 'Inspeção visual dos subsistemas de captação, descida e aterramento, com medição de continuidade elétrica e de resistência de aterramento nos pontos acessíveis, utilizando terrômetro calibrado. Os itens foram classificados como Conforme, Não Conforme ou Não Aplicável.',
    validadeMeses: 12,
    itens: [
      'Terminais aéreos / captores íntegros e fixados',
      'Condutores de descida contínuos e bem fixados',
      'Conexões e emendas sem corrosão aparente',
      'Anéis de cintamento conforme projeto',
      'Caixas de inspeção acessíveis e identificadas',
      'Resistência de aterramento dentro do valor de referência',
      'Equipotencialização das massas metálicas da cobertura',
      'DPS instalados nos quadros conforme NBR 5419-4',
      'Estruturas metálicas interligadas ao SPDA',
      'Projeto / documentação do SPDA disponível',
    ],
  },
  {
    id: 'aterramento',
    titulo: 'Relatório de Medição de Aterramento',
    subtitulo: 'Medição de resistência ôhmica da malha de terra',
    objetivo: 'Registrar os valores de resistência de aterramento medidos na malha de terra da instalação, avaliando sua adequação aos valores de referência do projeto e das normas aplicáveis.',
    normas: [
      'NBR 5410:2004 — Instalações elétricas de baixa tensão',
      'NBR 5419:2015 — Proteção contra descargas atmosféricas',
      'NBR 15749 — Medição de resistência de aterramento',
    ],
    metodologia: 'Medição de resistência de aterramento pelo método da queda de potencial, utilizando terrômetro calibrado, em condições de solo registradas na data da medição. Verificação visual das conexões e da integridade dos eletrodos acessíveis. Os itens foram classificados como Conforme, Não Conforme ou Não Aplicável.',
    validadeMeses: 12,
    itens: [
      'Malha de aterramento identificada e acessível',
      'Conexões da malha íntegras, sem corrosão',
      'Resistência medida dentro do valor de referência do projeto',
      'Equipotencialização principal (BEP) adequada',
      'Condutores de proteção contínuos até os quadros',
      'Eletrodos complementares em bom estado',
      'Registros de medições anteriores disponíveis',
      'Croqui / projeto da malha disponível',
    ],
  },
];
