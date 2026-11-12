// Sem acesso à produção: o painel só lê as ofertas do motorista; aqui não há nenhuma.
export function useDriverRewards(_driverId: string | null | undefined) { return { offers: [] as any[], ready: true, error: null }; }
