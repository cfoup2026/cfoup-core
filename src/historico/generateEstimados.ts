import type {
  CalendarPolicy,
  ContraparteHistory,
} from '../calendar/CalendarPolicy.js';
import { deriveDataEsperada } from '../calendar/deriveDataEsperada.js';
import { addUTCDays } from '../utils/date.js';
import type {
  Confianca,
  EventoCaixa,
  EventoEstimado,
  Periodo,
  Recorrencia,
} from '../types/index.js';

/** Janela de tolerância (em dias) para a trava anti-duplicação. */
const ANTI_DUP_WINDOW_DIAS = 5;

/** Mapa Periodo → dias para projetar próxima ocorrência. */
const PERIODO_DAYS: Record<Periodo, number> = {
  semanal: 7,
  quinzenal: 14,
  mensal: 30,
  bimestral: 60,
  trimestral: 90,
};

/** Opções de geração. `geradoEm` define o início da janela de projeção;
 *  `janelaSemanas` define o tamanho (default 13). */
export interface GenerateEstimadosOptions {
  geradoEm: Date;
  janelaSemanas?: number;
  /** Calendário operacional usado para derivar `data_esperada` dos
   *  eventos gerados. Mesmo `BrazilCalendarPolicy` que adapters do Stage 1
   *  usam — passar a instância já existente do contexto. */
  calendar: CalendarPolicy;
}

/**
 * Gera `EventoCaixa` com `status='estimado'` projetando as recorrências
 * fortes do histórico para a janela de N semanas a partir de `geradoEm`.
 *
 * Algoritmo:
 *  1. Filtra `recorrencias` ativas com `confianca IN ('alta', 'media')`.
 *     Recorrências `baixa` ou inativas ficam de fora.
 *  2. Para cada elegível, projeta próximas ocorrências
 *     (`ultima_data + periodo_dias`, iterado) cobrindo `[geradoEm, fim]`.
 *  3. **Trava anti-duplicação**: se já existe `confirmado`/`realizado`
 *     com mesma `(contraparte_id, bucket_id, valor∈[classe_min, classe_max])`
 *     dentro de ±5 dias da data projetada, omite o estimado — o evento
 *     existente já cobre.
 *  4. Para datas sobreviventes, constrói `EventoEstimado` com
 *     `origem='historico'`, `origem_ref=recorrencia_id`, `confianca` 1
 *     nível abaixo da recorrência (alta→media, media→baixa), `data_esperada`
 *     derivada via `deriveDataEsperada` com hook `contraparteHistory` ativo.
 *
 * Função pura. Mesmo input → mesmo output (IDs determinísticos).
 */
export function generateEstimados(
  historico: {
    /** Map de ajuste por contraparte. `Map<string, ContraparteStats>` do
     *  Estágio 2.1 é estruturalmente assignável (covariância em ReadonlyMap). */
    contraparteHistory: ContraparteHistory;
    recorrencias: readonly Recorrencia[];
  },
  eventosExistentes: readonly EventoCaixa[],
  options: GenerateEstimadosOptions,
): EventoCaixa[] {
  const janelaSemanas = options.janelaSemanas ?? 13;
  const fim = addUTCDays(options.geradoEm, janelaSemanas * 7);

  const result: EventoCaixa[] = [];

  for (const rec of historico.recorrencias) {
    if (!rec.ativa) continue;
    if (rec.confianca !== 'alta' && rec.confianca !== 'media') continue;

    const periodoDias = PERIODO_DAYS[rec.periodo];

    // Projeta próximas datas a partir de ultima_data, iterando até cobrir
    // [geradoEm, fim].
    let proxima = addUTCDays(rec.ultima_data, periodoDias);
    while (proxima.getTime() <= fim.getTime()) {
      // Pula datas anteriores ao geradoEm — projeção é só para o futuro.
      if (proxima.getTime() >= options.geradoEm.getTime()) {
        if (!hasConflitante(proxima, rec, eventosExistentes)) {
          result.push(buildEstimado(proxima, rec, historico.contraparteHistory, options));
        }
      }
      proxima = addUTCDays(proxima, periodoDias);
    }
  }

  // Ordenação determinística por id.
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

/**
 * Verifica se já existe `confirmado`/`realizado` que cobre a data
 * projetada — chave: `(contraparte_id, bucket_id, valor∈classe)` +
 * janela ±5 dias.
 */
function hasConflitante(
  dataProjetada: Date,
  rec: Recorrencia,
  eventos: readonly EventoCaixa[],
): boolean {
  const dataMs = dataProjetada.getTime();
  const windowMs = ANTI_DUP_WINDOW_DIAS * 86_400_000;

  for (const e of eventos) {
    if (e.status !== 'confirmado' && e.status !== 'realizado') continue;
    if (e.contraparte_id !== rec.contraparte_id) continue;
    if (e.bucket_id !== rec.bucket_id) continue;
    if (e.valor < rec.valor_classe_min || e.valor > rec.valor_classe_max) continue;

    // Para realizado usa data_realizada; para confirmado usa data_vencimento.
    let eventDate: Date;
    if (e.status === 'realizado') {
      eventDate = e.data_realizada;
    } else {
      eventDate = e.data_vencimento;
    }
    const diff = Math.abs(eventDate.getTime() - dataMs);
    if (diff <= windowMs) return true;
  }

  return false;
}

/**
 * Constrói o `EventoEstimado` para uma data projetada de uma recorrência.
 * Não usa `buildEventoCaixaBase` (que rejeita `origem='historico'`); o
 * evento é construído diretamente com os campos herdados da recorrência.
 */
function buildEstimado(
  dataVencimento: Date,
  rec: Recorrencia,
  contraparteHistory: ContraparteHistory,
  options: GenerateEstimadosOptions,
): EventoEstimado {
  const dataEsperada = deriveDataEsperada(
    dataVencimento,
    options.calendar,
    contraparteHistory,
    rec.contraparte_id,
  );

  // Confiança do estimado: 1 nível abaixo da recorrência. Projetar é
  // menos seguro que observar.
  const confianca: Confianca = rec.confianca === 'alta' ? 'media' : 'baixa';

  const dateKey = dataVencimento.toISOString().slice(0, 10);
  const id = `historico_${rec.recorrencia_id}_${dateKey}`;

  const ev: EventoEstimado = {
    id,
    valor: rec.valor_mediano,
    direcao: rec.direcao,
    data_esperada: dataEsperada,
    bucket_id: rec.bucket_id,
    bucket_nome: rec.bucket_nome,
    cliente_id: rec.cliente_id,
    legal_entity_id: rec.legal_entity_id,
    origem: 'historico',
    criticidade: rec.criticidade,
    confianca,
    confianca_origem: 'sistema',
    is_transferencia: false,
    criado_em: options.geradoEm,
    criado_por: 'motor_historico',
    status: 'estimado',
    data_realizada: null,
    data_vencimento: dataVencimento,
    contraparte_id: rec.contraparte_id,
    origem_ref: rec.recorrencia_id,
  };
  if (rec.contraparte_tipo !== undefined) ev.contraparte_tipo = rec.contraparte_tipo;
  if (rec.source_company_code !== undefined) ev.source_company_code = rec.source_company_code;
  return ev;
}
