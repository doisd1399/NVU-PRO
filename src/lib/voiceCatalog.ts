/* Local, approved Brazilian voices. No runtime TTS or cloud generation. */
export const VOICE_CATALOG = {
  "driver_greeting_1": {
    "kind": "greeting",
    "role": "driver",
    "text": "Bem-vindo de volta. Vamos à próxima viagem."
  },
  "driver_greeting_2": {
    "kind": "greeting",
    "role": "driver",
    "text": "Bom ter você por aqui. Vamos seguir viagem."
  },
  "driver_greeting_3": {
    "kind": "greeting",
    "role": "driver",
    "text": "Ao seu lado, em cada viagem. Podemos começar."
  },
  "driver_greeting_4": {
    "kind": "greeting",
    "role": "driver",
    "text": "Bem-vindo. Vamos conferir seu próximo trabalho."
  },
  "driver_greeting_5": {
    "kind": "greeting",
    "role": "driver",
    "text": "A próxima etapa começa aqui. Vamos em frente."
  },
  "admin_greeting_1": {
    "kind": "greeting",
    "role": "admin",
    "text": "Bem-vindo de volta. A central de gestão está à sua disposição."
  },
  "admin_greeting_2": {
    "kind": "greeting",
    "role": "admin",
    "text": "Bom ter você por aqui. Vamos acompanhar sua empresa."
  },
  "admin_greeting_3": {
    "kind": "greeting",
    "role": "admin",
    "text": "Bem-vindo. Vamos conferir o andamento da operação."
  },
  "admin_greeting_4": {
    "kind": "greeting",
    "role": "admin",
    "text": "À sua disposição. Vamos organizar os próximos passos."
  },
  "admin_greeting_5": {
    "kind": "greeting",
    "role": "admin",
    "text": "Bem-vindo à central. Vamos cuidar da sua operação."
  },
  "page_operations": {
    "kind": "navigation",
    "role": "all",
    "text": "Vamos planejar as próximas operações."
  },
  "page_assign": {
    "kind": "navigation",
    "role": "all",
    "text": "Escolha a operação e quem vai assumir o trabalho."
  },
  "page_active_jobs": {
    "kind": "navigation",
    "role": "all",
    "text": "Acompanhe os trabalhos em andamento."
  },
  "page_team": {
    "kind": "navigation",
    "role": "all",
    "text": "Sua equipe, em um só lugar."
  },
  "page_recruitment": {
    "kind": "navigation",
    "role": "all",
    "text": "Vamos acompanhar as candidaturas."
  },
  "page_fleet": {
    "kind": "navigation",
    "role": "all",
    "text": "Vamos cuidar da sua frota."
  },
  "page_trips": {
    "kind": "navigation",
    "role": "all",
    "text": "Confira o histórico de viagens."
  },
  "page_partnerships": {
    "kind": "navigation",
    "role": "all",
    "text": "Vamos acompanhar suas parcerias."
  },
  "page_wallet": {
    "kind": "navigation",
    "role": "all",
    "text": "Confira as movimentações da empresa."
  },
  "event_new_job": {
    "kind": "event",
    "role": "driver",
    "text": "Você recebeu um novo trabalho."
  },
  "event_job_started": {
    "kind": "event",
    "role": "driver",
    "text": "Trabalho iniciado. Boa viagem."
  },
  "event_pro_ready": {
    "kind": "event",
    "role": "driver",
    "text": "Tudo pronto. Boa viagem."
  },
  "event_trip_saved": {
    "kind": "event",
    "role": "driver",
    "text": "Viagem registrada."
  },
  "event_job_completed": {
    "kind": "event",
    "role": "driver",
    "text": "Operação concluída. Bom trabalho."
  },
  "event_trip_failed": {
    "kind": "event",
    "role": "driver",
    "text": "Não foi possível registrar a viagem. Confira o aviso."
  },
  "event_trip_detected": {
    "kind": "event",
    "role": "driver",
    "text": "Viagem concluída. Preparando o registro."
  },
  "event_pause_needed": {
    "kind": "event",
    "role": "driver",
    "text": "Abra o menu de pausa para continuar."
  }
} as const;
export type VoiceCueId = keyof typeof VOICE_CATALOG;
export const GREETING_IDS = {
  driver: ["driver_greeting_1", "driver_greeting_2", "driver_greeting_3", "driver_greeting_4", "driver_greeting_5"],
  admin: ["admin_greeting_1", "admin_greeting_2", "admin_greeting_3", "admin_greeting_4", "admin_greeting_5"]
} as const;
