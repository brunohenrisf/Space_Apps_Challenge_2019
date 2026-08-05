# Dashboard moderno (estilo "glass") — pré-requisitos

O arquivo [`dashboard-moderno.yaml`](./dashboard-moderno.yaml) usa cartões da comunidade. Sem instalá-los, os cartões aparecem como **"Custom element doesn't exist"**.

---

## 1. Instalar o HACS

O HACS é a loja de complementos da comunidade. Funciona no Home Assistant Container (o nosso, via Docker) — não precisa de Supervisor.

```bash
sudo docker exec -it homeassistant bash -c "wget -O - https://get.hacs.xyz | bash -"
sudo docker restart homeassistant
```

Depois:

1. **Configurações → Dispositivos e Serviços → Adicionar integração → HACS**
2. Marque as caixas de confirmação e autorize com sua conta do GitHub (ele mostra um código para colar no site).
3. O HACS aparece no menu lateral.

---

## 2. Instalar os cartões

No HACS → aba **Frontend** → botão **Explorar e baixar repositórios** → busque e instale:

| Cartão | Para quê |
|---|---|
| **Mushroom** | Cartões `mushroom-template-card`, `mushroom-chips-card`, `mushroom-entity-card` |
| **card-mod** | Aplica o CSS do efeito de vidro fosco |
| **Mini Graph Card** | Gráfico suave de temperatura e umidade |

Depois de instalar os três: **recarregue a página com Ctrl+Shift+R** (limpa o cache do navegador). Se ainda assim os cartões não aparecerem, reinicie o Home Assistant.

> O **card-mod** exige um passo extra: em **Configurações → Painéis → recursos** (menu ⋮ → Recursos), confirme que existe uma entrada `/hacsfiles/lovelace-card-mod/card-mod.js` do tipo **Módulo JavaScript**. O HACS costuma criar sozinho.

---

## 3. Imagem de fundo (opcional)

O dashboard usa `/local/fundo.jpg`. Para colocar a sua:

```bash
sudo mkdir -p /DATA/AppData/homeassistant/www
# copie sua imagem para lá com o nome fundo.jpg
sudo cp /DATA/Media/fotos/paisagem.jpg /DATA/AppData/homeassistant/www/fundo.jpg
```

A pasta `/config/www/` do Home Assistant é servida como `/local/`. Se não quiser fundo, apague as linhas `background:` do YAML.

---

## 4. Tema escuro

O efeito de vidro fica muito melhor no escuro. Instale um tema pelo HACS (aba Frontend, busque por **iOS Themes**, **Bubble** ou **Metrology**), e depois:

**Perfil (canto inferior esquerdo) → Tema → escolha o tema → Modo escuro**

---

## 5. Aplicar o dashboard

1. **Configurações → Painéis → + Adicionar painel → Novo painel do zero** → nome `Casa`.
2. Anote a **URL** que ele criou (coluna URL da lista de painéis) — se não for `casa`, edite as linhas `navigation_path: /casa/...` do YAML para bater com ela, senão os cartões de cômodo não navegam.
3. Abra o painel → lápis ✏️ → menu ⋮ → **Editor de YAML bruto** → cole tudo → **Salvar**.

---

## 6. Ajustar os nomes das entidades

Os `entity_id` foram deduzidos dos nomes dos dispositivos. Confira os reais em **Ferramentas de Desenvolvedor → Estados** (filtre por `switch.`) e corrija o que não bater.

Dica: com **Localizar e substituir** (Ctrl+H) no editor de YAML fica rápido.

---

## 7. Ajustes recomendados no Home Assistant

- **Unidades em °C:** Configurações → Sistema → Geral → Sistema de unidades → **Métrico**.
- **Áreas:** atribua cada dispositivo a uma área (Sala, Cozinha, Quarto). Isso melhora a organização geral e habilita cartões automáticos por área.
- **Sensor TH indisponível:** verifique pilha/alcance do sensor — enquanto estiver offline, os cartões de temperatura e umidade ficam vazios.
