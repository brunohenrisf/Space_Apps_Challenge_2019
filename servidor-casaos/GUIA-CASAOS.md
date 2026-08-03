# Guia: Montar um servidor CasaOS num notebook velho

Este guia transforma um notebook antigo em um servidor doméstico com [CasaOS](https://casaos.zimaspace.com/) — uma interface web simples para gerenciar apps em Docker (Plex/Jellyfin, Nextcloud, Pi-hole, qBittorrent, Home Assistant, etc.).

---

## 1. Requisitos mínimos

| Item | Mínimo recomendado |
|---|---|
| CPU | 64 bits (qualquer Intel/AMD dos últimos ~15 anos) |
| RAM | 2 GB (4 GB ou mais para rodar vários apps) |
| Armazenamento | 16 GB (SSD deixa tudo muito mais rápido) |
| Rede | Cabo Ethernet de preferência (Wi-Fi funciona, mas é menos estável) |

Vantagens de usar notebook: tem "nobreak grátis" (a bateria segura quedas de energia), consome pouca energia e é silencioso.

> **Atenção:** tudo que estiver no HD do notebook será apagado na instalação do Linux. Faça backup antes.

---

## 2. Preparar o pendrive de instalação

O CasaOS não é um sistema operacional — ele roda em cima de um Linux. A base mais recomendada é o **Debian 12** ou **Ubuntu Server 24.04 LTS**.

1. Baixe a ISO:
   - Debian: https://www.debian.org/download (imagem *netinst*)
   - Ubuntu Server: https://ubuntu.com/download/server
2. Baixe o [balenaEtcher](https://etcher.balena.io/) (ou Rufus, no Windows).
3. Grave a ISO num pendrive de 4 GB ou mais.

---

## 3. Instalar o Linux no notebook

1. Ligue o notebook com o pendrive espetado e entre no menu de boot (geralmente `F12`, `F9`, `Esc` ou `F2` na tela inicial).
2. Selecione o pendrive e inicie o instalador.
3. Durante a instalação:
   - **Idioma/teclado:** escolha o seu (Português do Brasil / ABNT2).
   - **Nome da máquina:** algo como `servidor` ou `casaos`.
   - **Particionamento:** use o disco inteiro (guiado).
   - **Debian:** na seleção de software, **desmarque** os ambientes gráficos (GNOME etc.) e **marque** "SSH server" e "standard system utilities". Servidor não precisa de interface gráfica.
   - **Ubuntu Server:** marque a opção de instalar o **OpenSSH server**.
4. Ao terminar, remova o pendrive e reinicie.

---

## 4. Ajustes essenciais para notebook servidor

Faça login no terminal do notebook (ou via SSH de outro computador: `ssh usuario@IP-DO-NOTEBOOK`).

### 4.1 Não desligar ao fechar a tampa

Por padrão o Linux suspende o notebook quando a tampa fecha. Para um servidor isso é fatal:

```bash
sudo nano /etc/systemd/logind.conf
```

Altere/descomente estas linhas:

```ini
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
```

Salve (`Ctrl+O`, `Enter`) e saia (`Ctrl+X`), depois aplique:

```bash
sudo systemctl restart systemd-logind
```

### 4.2 Desativar suspensão automática

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

### 4.3 Ligar sozinho quando a energia voltar (opcional)

Procure na BIOS/UEFI a opção **"Restore on AC Power Loss"** / **"Power On After Power Failure"** e ative. Nem todo notebook tem.

### 4.4 Atualizar o sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl
```

---

## 5. Instalar o CasaOS

Um único comando (ele instala o Docker automaticamente se não existir):

```bash
curl -fsSL https://get.casaos.io | sudo bash
```

Ao final, o instalador mostra o endereço de acesso, algo como:

```
CasaOS is running at: http://192.168.1.50
```

---

## 6. Primeiro acesso

1. Em qualquer computador ou celular **na mesma rede**, abra o navegador e acesse `http://IP-DO-NOTEBOOK` (se não souber o IP, rode `ip a` no notebook).
2. Crie o usuário e a senha do painel.
3. Pronto — você está no painel do CasaOS.

Dica: fixe o IP do notebook no roteador (reserva de DHCP) para o endereço nunca mudar.

---

## 7. Apps recomendados para começar

Na **App Store** do CasaOS, com um clique você instala:

- **Jellyfin** — servidor de mídia (filmes/séries/música), tipo um "Netflix pessoal" e gratuito.
- **Nextcloud** — sua nuvem de arquivos privada (substitui Google Drive/Dropbox).
- **Pi-hole** — bloqueador de anúncios para toda a rede.
- **qBittorrent** — downloads direto no servidor.
- **Home Assistant** — automação residencial.
- **Syncthing** — sincronização de arquivos entre dispositivos.
- **File Browser** — já vem embutido, gerencia os arquivos do servidor pelo navegador.

---

## 8. Acesso de fora de casa (opcional)

A forma mais simples e segura, sem abrir portas no roteador:

1. Instale o **Tailscale** no servidor:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
2. Instale o app do Tailscale no celular/computador e entre na mesma conta.
3. Acesse o CasaOS pelo IP Tailscale (algo como `http://100.x.y.z`) de qualquer lugar do mundo.

Evite expor o CasaOS diretamente à internet via redirecionamento de portas — o painel não foi feito para isso.

---

## 9. Manutenção

```bash
# Atualizar o sistema (faça de vez em quando)
sudo apt update && sudo apt upgrade -y

# Atualizar o CasaOS
curl -fsSL https://get.casaos.io/update | sudo bash

# Ver uso de disco, memória e serviços
df -h
free -h
sudo systemctl status casaos
```

- **Bateria:** se o notebook ficar 24/7 na tomada, o ideal é limitar a carga a ~60–80% se a BIOS permitir; caso contrário, tudo bem — a bateria vira um nobreak.
- **Temperatura:** deixe o notebook em local ventilado e limpe a saída de ar de vez em quando. Monitorar: `sudo apt install lm-sensors && sensors`.

---

## 10. Problemas comuns

| Problema | Solução |
|---|---|
| Não acha o CasaOS no navegador | Confirme o IP com `ip a`; verifique se está na mesma rede; teste `sudo systemctl status casaos`. |
| Notebook desliga ao fechar a tampa | Refaça o passo 4.1 e reinicie o `systemd-logind`. |
| Instalador do CasaOS falha | Verifique a internet (`ping google.com`) e rode o comando de novo — o script é idempotente. |
| App não abre após instalar | Aguarde 1–2 min (o Docker baixa a imagem) e veja os logs do app no próprio painel. |
| Wi-Fi caindo | Prefira cabo Ethernet; se impossível, desative economia de energia do Wi-Fi: `sudo iw dev wlan0 set power_save off`. |
