import type { CalendarPolicy } from '../calendar/CalendarPolicy.js';

/**
 * Contexto compartilhado pelos adapters do estágio 1. Carrega a identidade
 * (cliente/legal entity), referências de origem e o calendário operacional
 * usado na derivação de `data_esperada`.
 *
 * Diferença vs Etapa 1.2: `calendar` deixou de ser opcional. Adapters
 * FKN AP/AR exigem calendar para mover `data_esperada` em vencimentos
 * que caem em fim de semana/feriado. Adapter CEF recebe calendar mas não
 * chama (todo evento CEF é `realizado`, sem aplicação de calendário).
 */
export interface AdapterContext {
  /** Tenant — empresa-cliente CFOup. */
  cliente_id: string;
  /** Pessoa jurídica dentro do cliente. */
  legal_entity_id: string;
  /** Código original da empresa no sistema-fonte (filial FKN, conta CEF, etc).
   *  Quando informado, vai pra `EventoCaixa.source_company_code`. */
  source_company_code?: string;
  /** Política de calendário operacional. Obrigatória a partir da Etapa 1.3. */
  calendar: CalendarPolicy;
}
