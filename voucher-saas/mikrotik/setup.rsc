# =============================================================================
#  ConectaVoucher - Configuracao base do MikroTik (RouterOS)
#  Topologia:
#    ether1 -> WAN  : recebe o link da internet via DHCP client
#    ether2 -> LAN  : bridge para a UniFi, com servidor PPPoE
#
#  Como aplicar:
#    1) Ajuste os itens marcados com <<< ALTERE >>>
#    2) Envie o arquivo para o roteador e rode:  /import file-name=setup.rsc
#     (ou cole trecho a trecho no terminal do Winbox)
#
#  ATENCAO: revise antes de rodar em producao. Este script assume um roteador
#  praticamente limpo. Faca backup: /system backup save name=antes-conectavoucher
# =============================================================================

# ------------------------------------------------------------------ 1) WAN
# ether1 recebe o link por DHCP (rota default + DNS do provedor)
/ip dhcp-client
add interface=ether1 disabled=no use-peer-dns=yes add-default-route=yes comment="WAN uplink (ConectaVoucher)"

# ------------------------------------------------------------------ 2) LAN
# bridge para a UniFi (a UniFi entrega o Wi-Fi; o MikroTik roteia/autentica)
/interface bridge
add name=bridge-lan comment="LAN p/ UniFi - ConectaVoucher"
/interface bridge port
add bridge=bridge-lan interface=ether2 comment="UniFi"

/ip address
add address=10.10.0.1/24 interface=bridge-lan comment="Gateway LAN"

# ------------------------------------------------------------------ 3) NAT
# Compartilha a internet da WAN para a LAN
/ip firewall nat
add chain=srcnat out-interface=ether1 action=masquerade comment="NAT WAN ConectaVoucher"

# ------------------------------------------------------------------ 4) DNS
/ip dns
set allow-remote-requests=yes servers=1.1.1.1,8.8.8.8

# =============================================================================
#  5) SERVIDOR PPPoE  (modo padrao: ACCESS_MODE=pppoe)
#     O backend cria um /ppp/secret por voucher e um scheduler que o encerra
#     quando o tempo acaba (o secret nao tem limite de tempo nativo).
# =============================================================================
/ip pool
add name=pppoe-pool ranges=10.10.10.10-10.10.10.254 comment="Pool PPPoE"

# Perfil base: 1 sessao por usuario (1 dispositivo por voucher)
/ppp profile
add name=voucher-default local-address=10.10.0.1 remote-address=pppoe-pool \
    dns-server=1.1.1.1,8.8.8.8 only-one=yes comment="ConectaVoucher base"

# (Opcional) Perfis por plano com limite de banda (rate-limit rx/tx):
# add name=voucher-3h parent=voucher-default rate-limit="5M/5M"
# add name=voucher-24h parent=voucher-default rate-limit="10M/10M"

# Servidor PPPoE publicado na bridge da LAN
/interface pppoe-server server
add service-name=ConectaVoucher interface=bridge-lan one-session-per-host=yes \
    default-profile=voucher-default authentication=pap,chap disabled=no \
    comment="Servidor PPPoE ConectaVoucher"

# =============================================================================
#  6) (ALTERNATIVA) HOTSPOT p/ captive portal de celular  (ACCESS_MODE=hotspot)
#     Use este bloco se os clientes forem CELULARES (auto-redirect + cortesia).
#     NAO use PPPoE e Hotspot ao mesmo tempo na mesma LAN. Descomente para usar.
# -----------------------------------------------------------------------------
# /ip pool add name=hs-pool ranges=10.10.20.10-10.10.20.254
# /ip dhcp-server add name=hs-dhcp interface=bridge-lan address-pool=hs-pool disabled=no lease-time=1h
# /ip dhcp-server network add address=10.10.0.0/24 gateway=10.10.0.1 dns-server=1.1.1.1,8.8.8.8
# /ip hotspot profile set [find default=yes] login-by=http-chap,http-pap html-directory=hotspot
# /ip hotspot add name=cv-hotspot interface=bridge-lan address-pool=hs-pool profile=default disabled=no
# # Walled-garden: portal + Efi sempre acessiveis (mesmo sem pagar):
# /ip hotspot walled-garden add dst-host=*.efipay.com.br comment="Efi Pix"
# /ip hotspot walled-garden add dst-host=*.gerencianet.com.br comment="Efi Pix"
# /ip hotspot walled-garden add dst-host=<<< SEU_DOMINIO_DO_PORTAL >>> comment="Portal ConectaVoucher"

# =============================================================================
#  7) ACESSO DA API para o backend (ConectaVoucher)
#     <<< ALTERE >>> IP do servidor onde roda o backend e a senha do usuario.
# =============================================================================
/user
add name=api group=full password="TROQUE_ESTA_SENHA" comment="ConectaVoucher backend"
/ip service
set api address=10.10.0.0/24 disabled=no
# Para API sobre TLS (recomendado se o backend estiver fora da LAN):
# set api-ssl disabled=no

# ------------------------------------------------------------------ 8) Firewall
# Protege a gestao e libera o trafego da LAN para a internet
/ip firewall filter
add chain=input action=accept connection-state=established,related comment="est/rel"
add chain=input action=accept protocol=tcp dst-port=8728 src-address=10.10.0.0/24 comment="API backend"
add chain=input action=accept protocol=tcp dst-port=8291 src-address=10.10.0.0/24 comment="Winbox LAN"
add chain=input action=drop in-interface=ether1 comment="Bloqueia gestao pela WAN"
add chain=forward action=accept connection-state=established,related
add chain=forward action=accept in-interface=bridge-lan out-interface=ether1 comment="LAN->WAN"

# =============================================================================
#  Fim. Verifique:  /interface pppoe-server server print
#                    /ip dhcp-client print   (ether1 com endereco = WAN ok)
#                    /ppp active print        (sessoes ativas)
# =============================================================================
