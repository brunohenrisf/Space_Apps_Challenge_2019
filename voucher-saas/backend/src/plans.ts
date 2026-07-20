// Catálogo de planos de voucher.
// No produto final isto virá do banco, por evento/organizador (multi-tenant SaaS).

export interface Plan {
  id: string;
  time: string;
  minutes: number;
  price: number; // em reais
  desc: string;
  badge?: string;
}

export const PLANS: Plan[] = [
  { id: '1h',  time: '1 hora',   minutes: 60,   price: 5,  desc: 'Ideal para uma navegada rápida' },
  { id: '3h',  time: '3 horas',  minutes: 180,  price: 10, desc: 'Redes sociais e mensagens', badge: 'Mais vendido' },
  { id: '6h',  time: '6 horas',  minutes: 360,  price: 15, desc: 'Um período do evento' },
  { id: '12h', time: '12 horas', minutes: 720,  price: 22, desc: 'O dia inteiro no evento' },
  { id: '24h', time: '24 horas', minutes: 1440, price: 30, desc: 'Acesso liberado por 1 dia' },
];

export const findPlan = (id: string) => PLANS.find((p) => p.id === id);
