# Onde dá para ganhar deste mercado

Este documento é uma opinião, não um levantamento. Ele diz onde eu apostaria
e por quê — e o que já está construído no app para sustentar a aposta.

## O diagnóstico

O mercado inteiro — Alexa, Google, Apple Home, Tuya, Home Assistant — resolve
o mesmo problema do mesmo jeito: dá ao usuário um editor de regras SE/ENTÃO e
manda ele automatizar a própria casa.

Isso falha de um jeito muito previsível:

1. **O instalador escreve as rotinas no dia da entrega.** Oito regras, feitas
   por quem não mora ali, num dia em que ninguém ainda sabe como a casa vai
   ser usada.
2. **A vida muda e as regras não.** Nasce um filho, alguém passa a trabalhar
   em casa, o horário muda. As regras ficam erradas.
3. **Errado incomoda mais do que ausente.** Uma luz que acende na hora errada
   é pior que luz nenhuma automatizada. A família começa a cancelar na mão.
4. **Alguém desliga tudo.** O sistema vira interruptor caro, e o cliente conta
   para os amigos que automação "não vale a pena".

A resposta da indústria a isso tem sido *editores de regra melhores*. É a
resposta errada. O problema não é a ferramenta de autoria — é que **a autoria
está com a pessoa errada**.

## A aposta: a casa escreve, a pessoa aprova

Inverta o ônus. O painel registra cada ação manual — qual dispositivo, que
hora, que dia da semana, em que modo a casa estava. Depois de duas semanas ele
detecta repetição e **propõe** a rotina, em português:

> **A casa observou** — 85%
> Você acende a Luz da bancada entre 6h40 e 6h55 em quase todo dia útil.
> `11 dos últimos 13 dias úteis · nunca aos sábados`
> → Acender a Luz da bancada a 90%, 4600K, às 6h45, de segunda a sexta
> [ Criar rotina ] [ Agora não ] [ Nunca ]

Ninguém escreve regra. A casa rascunha; a pessoa edita. E o produto **melhora
com o tempo**, em vez de apodrecer — que é o oposto do modelo atual.

Três coisas fazem essa ideia se sustentar:

**Cabe no ESP32.** Isto não é aprendizado de máquina. É contagem de frequência
em janelas de tempo: histograma por dispositivo × faixa de 15 min × tipo de
dia. Umas 200 linhas e alguns KB de RAM. Sem nuvem, sem modelo, sem GPU.

**É exatamente o que a nuvem não consegue vender.** Google e Amazon fazem
sugestão de rotina — e precisam dos seus hábitos nos servidores deles. Uma
caixa que aprende sem que nada saia de casa é uma diferença que dá para
explicar em uma frase na mesa do cliente, num mercado em que privacidade é a
objeção número um.

**Fecha o laço nos dois sentidos.** A casa também propõe **recuar**:

> **A casa quer recuar** — 74%
> A rotina "Pôr do sol" foi cancelada na mão três vezes esta semana.
> `3 cancelamentos em 7 disparos · sempre antes das 18h30`
> → Suspender a rotina e perguntar de novo daqui a duas semanas

Esse segundo movimento é o que ninguém faz, e é o que impede o item 3 do
diagnóstico. Um sistema que percebe quando incomoda ganha permissão para
tentar de novo.

**Período supervisionado.** Rotina recém-aceita avisa antes de agir nos
primeiros dias. É o que faz alguém aceitar a *segunda* sugestão.

> Construído: `cartaoSugestao()` e o tratamento de `data-act="sug"` em
> `app/index.html`. As sugestões aparecem no Início (a mais fresca) e em
> Cenas e rotinas (todas).

## O que falta para a rotina ser mesmo elaborada

Rotina elaborada não é rotina com mais condições. É rotina que sabe **em que
estado a casa está**.

### Modos, não booleanos

Quase todo sistema fake isso com uma variável auxiliar. Um modo de verdade —
**Normal · Dormindo · Fora · Recebendo** — muda o que o *mesmo* gatilho faz:

| Gatilho | Normal | Dormindo | Recebendo |
|---|---|---|---|
| Presença na varanda, 23h | luz a 30%, 3 min | luz a 10%, sem som | não faz nada |
| Porta da frente abre | nada | acende corredor a 15% | nada |
| Consumo acima de 3 kW | nada | alerta | nada |

Sem modo, cada linha dessa tabela vira uma regra separada com exceções
aninhadas — e é aí que o cliente desiste.

> Construído: `MODOS`, o seletor no Início, e cada rotina com o campo `modos`.
> Rotina fora do modo atual aparece esmaecida e etiquetada "dorme agora".

### Rampa, não degrau

Acender em 20 minutos simulando o amanhecer é trivial de implementar (um timer
e uma interpolação) e é a coisa que mais impressiona em demonstração. Quase
nenhum sistema expõe isso na interface de dimmer. **Vale construir a seguir.**

### Ensaio

"Mostre o que essa rotina teria feito ontem." É a razão número um pela qual as
pessoas desconfiam de automação — não conseguem prever o que vai acontecer.
Um botão de ensaio, rodando a regra contra o histórico gravado, resolve a
desconfiança de uma vez. Ninguém no mercado tem isso.

## Presença por *quem*, não por movimento

O PIR do mercado dispara com o gato e não vê gente parada. Duas peças baratas
mudam o jogo, sem câmera nenhuma:

- **mmWave 24 GHz em Zigbee** (LD2410 e similares, hoje na faixa de R$ 60):
  detecta pessoa **parada**. Resolve a luz que apaga com você sentado no sofá,
  que é a reclamação mais comum de qualquer instalação.
- **Presença de telefone na rede**: o roteador já sabe quais celulares estão
  associados. Cruzando com o mmWave você tem *quem* + *onde*, sem câmera e sem
  nuvem.

Isso destrava rotina que hoje ninguém entrega: "quando só a Ana está em casa,
a casa se comporta assim". É diferenciação técnica barata e defensável.

## Comodidade: o que o usuário não precisa fazer

- **Convidado por QR.** Um QR na geladeira abre um PWA com só as luzes da área
  social, válido por 24 h. Sem conta, sem loja de aplicativo, sem cadastro. A
  visita usa e some.
- **Um botão físico que acerta pela hora.** Botão Zigbee de quatro cenas é o
  padrão do mercado e ninguém lembra qual é qual. Um botão só, contextual: às
  7h faz "bom dia", às 23h faz "boa noite". As pessoas amam botão físico; a
  indústria insiste em fazer aplicativo.
- **Não me atrapalhe.** Duas anulações manuais no mesmo contexto suspendem a
  rotina automaticamente e a devolvem como sugestão depois. É o laço de
  feedback que falta em todo mundo — e já está no app.

## Por onde eu começaria

1. **Registro de ações + sugestões** (2–3 semanas). É a aposta central e o que
   diferencia a proposta comercial. A interface já existe; falta o histograma
   no firmware.
2. **Modos no firmware** (1 semana). A interface já existe; falta o campo
   `modos` mudar o que o painel executa de fato.
3. **mmWave numa casa piloto** (dias). Compra barata, ganho imediato e
   perceptível.
4. **Rampa de amanhecer** (dias). O melhor retorno por linha de código em
   demonstração.

O resto — ensaio, convidado por QR, botão contextual — vem depois, quando as
três primeiras já estiverem provando o conceito numa casa de verdade.
