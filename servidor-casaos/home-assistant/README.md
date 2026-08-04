# Home Assistant no servidor CasaOS

Guia de instalação e do dashboard (`dashboard.yaml`) para o Home Assistant rodando no mesmo notebook do CasaOS/Jellyfin.

---

## 1. Instalar

### Opção A — App Store do CasaOS (mais fácil)

Painel do CasaOS → **App Store** → busque **Home Assistant** → instalar. Acesse em `http://10.0.0.103:8123`.

### Opção B — Docker com rede do host (recomendado)

A descoberta automática de dispositivos (Chromecast, TV LG, lâmpadas Tuya/Sonoff, ESPHome) depende de mDNS/broadcast, que só funciona bem com `--network host`:

```bash
sudo docker run -d \
  --name homeassistant \
  --restart unless-stopped \
  --privileged \
  --network host \
  -v /DATA/AppData/homeassistant:/config \
  -v /run/dbus:/run/dbus:ro \
  -e TZ=America/Sao_Paulo \
  ghcr.io/home-assistant/home-assistant:stable
```

> Nota: esta é a versão **Container**, que não tem a loja de add-ons (Supervisor). Para o uso normal — integrações, automações, dashboards — não faz falta.

### Primeiro acesso

`http://10.0.0.103:8123` → criar conta → definir localização → ele já sugere os dispositivos que encontrou na rede.

---

## 2. Integrações que valem a pena aqui

Em **Configurações → Dispositivos e Serviços → Adicionar integração**:

| Integração | Para quê |
|---|---|
| **LG webOS Smart TV** | Ligar/desligar a TV, controlar volume, abrir o Jellyfin nela |
| **Jellyfin** | Ver o que está sendo assistido e o tamanho da biblioteca |
| **System Monitor** | CPU, RAM, disco e temperatura do próprio servidor |
| **Mobile App** | Presença por GPS, notificações no celular |
| **Speedtest.net** | Histórico da velocidade da internet |

Para o **System Monitor** funcionar com os sensores usados no dashboard, adicione ao `configuration.yaml` (fica em `/DATA/AppData/homeassistant/`):

```yaml
sensor:
  - platform: systemmonitor
    resources:
      - type: processor_use
      - type: processor_temperature
      - type: memory_use_percent
      - type: disk_use_percent
        arg: /
      - type: last_boot
```

Reinicie o Home Assistant depois de editar.

---

## 3. Aplicar o dashboard

1. **Configurações → Painéis → Adicionar painel → Painel próprio**
2. Abra o painel → ícone de lápis (editar) → menu ⋮ → **Editor de YAML bruto**
3. Cole o conteúdo de [`dashboard.yaml`](./dashboard.yaml) e salve.

### Adaptar aos seus dispositivos

Os nomes de entidade no arquivo (`light.sala`, `switch.tomada_tv`, ...) são exemplos. Para ver os seus:

**Ferramentas de Desenvolvedor → Estados** — lista todas as entidades reais.

Troque os `entity:` pelos seus nomes e **apague os cartões de dispositivos que você não tem** (um cartão apontando para entidade inexistente aparece como "Entity not available").

---

## 4. Automações úteis para quem tem servidor

Exemplos para colar em **Configurações → Automações → Editar em YAML**:

```yaml
# Avisar no celular se o disco do servidor passar de 85%
alias: Avisar disco cheio
trigger:
  - platform: numeric_state
    entity_id: sensor.disk_use_percent
    above: 85
action:
  - service: notify.mobile_app_SEU_CELULAR
    data:
      title: Servidor
      message: "Disco em {{ states('sensor.disk_use_percent') }}% — hora de limpar."
```

```yaml
# Modo filme: apaga as luzes quando algo começa a tocar na TV
alias: Modo filme
trigger:
  - platform: state
    entity_id: media_player.lg_webos_tv
    to: playing
action:
  - service: light.turn_off
    target:
      entity_id: light.sala
```

---

## 5. Backup

Toda a configuração (dashboards, automações, integrações) vive em `/DATA/AppData/homeassistant`:

```bash
sudo tar -czf /DATA/backup-homeassistant-$(date +%F).tar.gz /DATA/AppData/homeassistant
```

Copie o arquivo para outro lugar (PC ou HD externo) — sem isso, uma reinstalação perde tudo.
