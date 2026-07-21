# =============================================================================
#  ConectaVoucher - Tunel WireGuard (MikroTik <-> VPS)   [RouterOS 7+]
#  A MikroTik disca para o VPS; o VPS passa a alcancar a API RouterOS pelo tunel.
#  Assim o backend na nuvem provisiona o Hotspot mesmo com a MikroTik na LAN.
#
#  Antes: gere o par de chaves do VPS (wg genkey) e tenha o IP publico do VPS.
#  <<< ALTERE >>> os campos marcados.
# =============================================================================

# 1) Interface WireGuard (gera o par de chaves da MikroTik automaticamente)
/interface/wireguard
add name=wg-cv listen-port=13231 comment="ConectaVoucher tunnel"

# IP da MikroTik dentro do tunel (= MIKROTIK_HOST no .env do backend)
/ip/address
add address=10.20.0.2/24 interface=wg-cv

# 2) Peer = VPS
/interface/wireguard/peers
add interface=wg-cv \
    public-key="<<< CHAVE_PUBLICA_DO_VPS >>>" \
    endpoint-address=<<< IP_PUBLICO_DO_VPS >>> endpoint-port=51820 \
    allowed-address=10.20.0.0/24 persistent-keepalive=25s \
    comment="VPS ConectaVoucher"

# 3) Expor a API RouterOS somente pelo tunel
/ip/service/set api address=10.20.0.0/24
/ip/firewall/filter
add chain=input in-interface=wg-cv protocol=tcp dst-port=8728 action=accept \
    comment="API RouterOS via WireGuard" place-before=0

# 4) Pegue a CHAVE PUBLICA da MikroTik para cadastrar como peer no VPS:
:put [/interface/wireguard/get wg-cv public-key]

# =============================================================================
#  No VPS (/etc/wireguard/wg0.conf):
#
#   [Interface]
#   Address = 10.20.0.1/24
#   ListenPort = 51820
#   PrivateKey = <CHAVE_PRIVADA_DO_VPS>
#   # NAT para os containers alcancarem a MikroTik pelo tunel:
#   PostUp   = iptables -t nat -A POSTROUTING -o wg0 -j MASQUERADE
#   PostDown = iptables -t nat -D POSTROUTING -o wg0 -j MASQUERADE
#
#   [Peer]
#   # MikroTik do evento (use a chave publica impressa no passo 4)
#   PublicKey = <CHAVE_PUBLICA_DA_MIKROTIK>
#   AllowedIPs = 10.20.0.2/32
#
#  Suba:  wg-quick up wg0   (e habilite: systemctl enable wg-quick@wg0)
#  Teste do VPS:  ping 10.20.0.2   e   nc -vz 10.20.0.2 8728
# =============================================================================
