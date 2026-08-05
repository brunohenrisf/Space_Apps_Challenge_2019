# Wi-Fi no ZimaOS (notebook sem porta de rede)

O ZimaOS foi feito para os aparelhos ZimaBoard/ZimaCube, que usam cabo Ethernet — **não existe configuração de Wi-Fi na interface web**, e sem rede ele nem passa da tela `Searching for network address...`, porque toda a configuração inicial é feita pelo navegador.

Num notebook sem porta de rede isso é um impasse. Este documento é a solução, testada no Lenovo IdeaPad com ZimaOS 1.7.0.

---

## Por que não dá para simplesmente editar `/etc`

O ZimaOS usa atualização A/B (RAUC). O disco fica assim:

```
nvme0n1p1   vfat    casaos-boot
nvme0n1p2   squashfs          ← raiz A  (somente leitura)
nvme0n1p3   squashfs          ← raiz B  (somente leitura)
nvme0n1p7   ext4    casaos-overlay   ← alterações persistentes
nvme0n1p8   ext4    casaos-data      ← dados dos apps (/DATA)
```

As duas raízes são **squashfs** — imagem selada, impossível de montar com escrita. O `/etc` que o sistema enxerga é um **overlayfs**: a imagem embaixo, e a partição `casaos-overlay` por cima. Dentro dela:

| Pasta | Papel |
|---|---|
| `upper_etc/` | camada de escrita do `/etc` — **é aqui que se configura** |
| `work_etc/` | área de trabalho interna do overlayfs — não mexer |
| `var/` | camada de escrita de partes do `/var` |

Arquivo criado em `upper_etc/foo.conf` aparece como `/etc/foo.conf` no sistema rodando, e sobrevive à troca de partição numa atualização.

---

## Solução: configurar pelo Live USB

Necessário um pendrive com Ubuntu Desktop (dá para reaproveitar o do ZimaOS, já que ele está instalado no disco).

### 1. Boot e acesso confortável

Dê boot no pendrive, escolha **"Experimentar o Ubuntu"**, conecte no Wi-Fi pelo ícone de rede. Se a lista vier vazia (RF-kill de IdeaPad), rode `sudo rfkill unblock all` antes.

Para colar comandos de outro computador em vez de digitar no notebook:

```bash
sudo apt update && sudo apt install -y openssh-server
sudo systemctl start ssh
sudo passwd ubuntu     # a sessão live não tem senha
hostname -I            # o IP para o ssh
```

### 2. Montar a overlay

```bash
sudo -s
mkdir -p /mnt/overlay
mount /dev/nvme0n1p7 /mnt/overlay
ls /mnt/overlay        # deve mostrar upper_etc, work_etc, var
```

### 3. Criar os perfis de Wi-Fi

O ZimaOS traz NetworkManager habilitado, então basta um arquivo por rede. Duas redes com prioridades diferentes evitam que o servidor fique inacessível se a de 5 GHz oscilar.

```bash
mkdir -p /mnt/overlay/upper_etc/NetworkManager/system-connections
cd /mnt/overlay/upper_etc/NetworkManager/system-connections

cat > minha-rede-5g.nmconnection <<'EOF'
[connection]
id=MINHA_REDE_5G
type=wifi
autoconnect=true
autoconnect-priority=20

[wifi]
mode=infrastructure
ssid=MINHA_REDE_5G

[wifi-security]
key-mgmt=wpa-psk
psk=SENHA-DO-WIFI

[ipv4]
method=auto

[ipv6]
method=auto
EOF

# repita o bloco para a rede de 2,4 GHz com autoconnect-priority=10

chown root:root *.nmconnection
chmod 600      *.nmconnection
```

> ⚠️ **A permissão `600` é obrigatória.** O NetworkManager ignora silenciosamente qualquer arquivo de conexão com permissão mais aberta — é a causa nº 1 de "configurei e não conectou".

### 4. Desbloquear o rádio a cada boot (IdeaPad)

Em Lenovo IdeaPad o driver `ideapad_laptop` deixa o rádio bloqueado por RF-kill no boot. Sem isso, a interface nem sobe:

```bash
cat > /mnt/overlay/upper_etc/systemd/system/desbloqueia-wifi.service <<'EOF'
[Unit]
Description=Desbloqueia o radio Wi-Fi (RF-kill do IdeaPad)
Before=NetworkManager.service network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'for f in /sys/class/rfkill/rfkill*/soft; do echo 0 > "$f"; done'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

mkdir -p /mnt/overlay/upper_etc/systemd/system/multi-user.target.wants
ln -sf /etc/systemd/system/desbloqueia-wifi.service \
       /mnt/overlay/upper_etc/systemd/system/multi-user.target.wants/desbloqueia-wifi.service
```

O alvo do link é `/etc/...` (caminho de dentro do sistema), **não** `/mnt/...` — como o sistema não está rodando, o link é criado na mão no lugar do `systemctl enable`.

### 5. Reiniciar

```bash
cd /
umount /mnt/overlay
reboot
```

Tire o pendrive. A tela do ZimaOS deve trocar `Searching...` por um IP.

---

## Ajustes de notebook (depois, pelo sistema já rodando)

Com rede funcionando, entre no painel (`http://IP`), crie o usuário e use o terminal embutido ou SSH. **O `sudo` pede a sua senha do painel, não a de root:**

```bash
sudo -s

# Não dormir ao fechar a tampa
mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/tampa.conf <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
EOF
systemctl restart systemd-logind

# Desligar economia de energia do Wi-Fi (causa picos de latência)
mkdir -p /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/wifi-powersave.conf <<'EOF'
[connection]
wifi.powersave = 2
EOF
systemctl restart NetworkManager
```

Com o sistema rodando, escreva em `/etc` normalmente — a overlay cuida de persistir. **Não** monte `casaos-overlay` de novo em `/mnt` para escrever no `upper_etc`: escrever na camada superior de um overlayfs montado tem comportamento indefinido.

---

## Verificação

```bash
iw dev                          # o nome da interface no ZimaOS é wlan0
iw dev wlan0 get power_save     # deve dizer: Power save: off
```

Do outro computador, com `ping -t IP` rodando: reinicie o servidor (tem que voltar sozinho), confira a latência (3–8 ms estáveis, sem picos) e feche a tampa (tem que continuar respondendo).

---

## Atualizações do ZimaOS

A configuração fica na overlay, que é o lugar projetado para sobreviver à troca da partição raiz. Ainda assim, **teste logo depois da primeira atualização**, antes de depender do servidor.

Backup para restaurar rápido se algo se perder:

```bash
sudo tar -czf /DATA/backup-rede.tar.gz \
  /etc/NetworkManager/system-connections \
  /etc/NetworkManager/conf.d \
  /etc/systemd/system/desbloqueia-wifi.service \
  /etc/systemd/logind.conf.d
```

Se a rede sumir depois de uma atualização, é só repetir os passos 2–5 pelo Live USB.

---

## Vale a pena o ZimaOS neste hardware?

Honestamente, para um notebook de disco único: os dois recursos que justificam o ZimaOS — **RAID** e **máquinas virtuais** — precisam de vários discos e de RAM sobrando. O CasaOS sobre Ubuntu Server entrega o mesmo painel, com Wi-Fi funcionando de fábrica e liberdade total no sistema base (veja [GUIA-CASAOS.md](./GUIA-CASAOS.md)).

Este documento existe para quem já decidiu ficar no ZimaOS — e para o caso de uma atualização quebrar a rede.
