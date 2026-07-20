# =============================================================================
#  ConectaVoucher - Configuracao base do MikroTik (RouterOS)  [MODO HOTSPOT]
#  Topologia:
#    ether1 -> WAN  : recebe o link da internet via DHCP client
#    ether2 -> LAN  : bridge para a UniFi (Wi-Fi), com Hotspot (captive portal)
#
#  Este arquivo esta no MODO HOTSPOT (ACCESS_MODE=hotspot no backend):
#  o celular conecta no Wi-Fi, recebe IP e cai no portal de compra. Cortesia
#  de 3 min e o tempo do voucher sao controlados pelo backend + limit-uptime.
#
#  Como aplicar:
#    1) Ajuste os itens marcados com <<< ALTERE >>>
#    2) Envie o arquivo e rode:  /import file-name=setup.rsc
#  Backup antes:  /system backup save name=antes-conectavoucher
# =============================================================================

# ------------------------------------------------------------------ 1) WAN
/ip dhcp-client
add interface=ether1 disabled=no use-peer-dns=yes add-default-route=yes comment="WAN uplink (ConectaVoucher)"

# ------------------------------------------------------------------ 2) LAN
# bridge para a UniFi (a UniFi entrega o Wi-Fi em modo AP/bridge)
/interface bridge
add name=bridge-lan comment="LAN p/ UniFi - ConectaVoucher"
/interface bridge port
add bridge=bridge-lan interface=ether2 comment="UniFi"

/ip address
add address=10.10.0.1/24 interface=bridge-lan comment="Gateway LAN"

# ------------------------------------------------------------------ 3) NAT + DNS
/ip firewall nat
add chain=srcnat out-interface=ether1 action=masquerade comment="NAT WAN ConectaVoucher"
/ip dns
set allow-remote-requests=yes servers=1.1.1.1,8.8.8.8

# ------------------------------------------------------------------ 4) DHCP p/ clientes
/ip pool
add name=hs-pool ranges=10.10.0.10-10.10.0.254 comment="Pool clientes Hotspot"
/ip dhcp-server
add name=hs-dhcp interface=bridge-lan address-pool=hs-pool lease-time=1h disabled=no
/ip dhcp-server network
add address=10.10.0.0/24 gateway=10.10.0.1 dns-server=1.1.1.1,8.8.8.8

# =============================================================================
#  5) HOTSPOT (captive portal)
#     O backend cria /ip/hotspot/user com limit-uptime (tempo do voucher) e o
#     portal loga o dispositivo apos o pagamento. Cortesia = ip-binding bypassed.
# =============================================================================
/ip hotspot profile
set [find default=yes] login-by=http-chap,http-pap,mac-cookie \
    html-directory=hotspot rate-limit="" \
    comment="ConectaVoucher"
/ip hotspot
add name=cv-hotspot interface=bridge-lan address-pool=hs-pool profile=default \
    disabled=no comment="Hotspot ConectaVoucher"

# Perfil de usuario: 1 sessao (1 dispositivo por voucher)
/ip hotspot user profile
set [find default=yes] shared-users=1 comment="ConectaVoucher 1 dispositivo"

# ---- Walled-garden: portal + Efi sempre acessiveis (mesmo sem pagar) ----
/ip hotspot walled-garden
add dst-host=*.efipay.com.br comment="Efi Pix"
add dst-host=*.gerencianet.com.br comment="Efi Pix (legado)"
add dst-host=*.pix.com.br comment="Pix"
# <<< ALTERE >>> dominio/IP onde o portal (backend) esta publicado:
add dst-host=portal.seuevento.com.br comment="Portal ConectaVoucher"

# Observacao sobre a cortesia:
#  Para pagar Pix a pessoa abre o app do banco (qualquer banco), o que exige
#  internet ampla. Por isso a cortesia de 3 min e feita pelo backend como
#  ip-binding type=bypassed (internet liberada) com scheduler que remove ao
#  fim do tempo. Nao precisa liberar cada banco no walled-garden.

# =============================================================================
#  6) ACESSO DA API para o backend
#     <<< ALTERE >>> senha do usuario api e a faixa do backend.
# =============================================================================
/user
add name=api group=full password="TROQUE_ESTA_SENHA" comment="ConectaVoucher backend"
/ip service
set api address=10.10.0.0/24 disabled=no
# API sobre TLS (recomendado se o backend estiver fora da LAN):
# set api-ssl disabled=no

# ------------------------------------------------------------------ 7) Firewall
/ip firewall filter
add chain=input action=accept connection-state=established,related comment="est/rel"
add chain=input action=accept protocol=tcp dst-port=8728 src-address=10.10.0.0/24 comment="API backend"
add chain=input action=accept protocol=tcp dst-port=8291 src-address=10.10.0.0/24 comment="Winbox LAN"
add chain=input action=drop in-interface=ether1 comment="Bloqueia gestao pela WAN"
add chain=forward action=accept connection-state=established,related
add chain=forward action=accept in-interface=bridge-lan out-interface=ether1 comment="LAN->WAN"

# =============================================================================
#  Verifique:  /ip hotspot print          (cv-hotspot rodando)
#              /ip dhcp-client print       (ether1 com endereco = WAN ok)
#              /ip hotspot active print     (dispositivos autenticados)
#              /ip hotspot ip-binding print (cortesias/bypass ativos)
# =============================================================================


# #############################################################################
#  ALTERNATIVA - MODO PPPoE (ACCESS_MODE=pppoe)
#  Use SOMENTE se os clientes forem roteadores/CPE que discam PPPoE.
#  Nao use junto com o Hotspot na mesma LAN. Descomente para usar.
# #############################################################################
# /ip pool add name=pppoe-pool ranges=10.10.10.10-10.10.10.254
# /ppp profile add name=voucher-default local-address=10.10.0.1 \
#     remote-address=pppoe-pool dns-server=1.1.1.1,8.8.8.8 only-one=yes
# /interface pppoe-server server add service-name=ConectaVoucher \
#     interface=bridge-lan one-session-per-host=yes \
#     default-profile=voucher-default authentication=pap,chap disabled=no
