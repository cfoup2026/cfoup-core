import type {
  ContraparteTipo,
  Direcao,
  EventoCaixaBase,
  Origem,
} from '../types/index.js';
import type { AdapterContext } from './AdapterContext.js';
import { IngestaoError } from './IngestaoError.js';

/**
 * Input do `buildEventoCaixaBase`. Carrega os campos que dependem da
 * transação específica (valor, direção, datas, contraparte). Os campos
 * de sistema (bucket, criticidade, confiança, is_transferencia, criado_em,
 * criado_por) são preenchidos pelo helper com defaults da etapa 1.2.
 */
export interface BuildEventoCaixaBaseInput {
  /** Sistema-fonte (`'fkn'`, `'cef'`, etc). Vai pra `EventoCaixa.origem`. */
  origem: Origem;
  /** Identificador estável da transação na origem (ex: id do parser).
   *  Compõe o ID determinístico do evento. */
  origem_ref: string;
  /** Valor sempre positivo. Direção vive em `direcao`. */
  valor: number;
  /** Direção financeira do evento. */
  direcao: Direcao;
  /** Data esperada — passthrough nesta etapa. Em `realizado` deve ser
   *  igual a `data_realizada`; em `confirmado` igual a `data_vencimento`.
   *  Calendário operacional não é aplicado em 1.2. */
  data_esperada: Date;
  /** ID da contraparte na origem, quando conhecido. */
  contraparte_id?: string;
  /** Tipo da contraparte. */
  contraparte_tipo?: ContraparteTipo;
  /** Número de documento (NF, boleto, parcela) preservado raw. */
  documento_ref?: string;
  /** Mês/ano de competência contábil quando aplicável. */
  competencia?: string;
}

/** Verifica se um Date é válido (não-NaN). */
function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Constrói os campos comuns do `EventoCaixa` a partir do input do adapter
 * + contexto. Centraliza:
 *  - Validação de invariantes (`valor > 0`, `data_esperada` válida).
 *  - Defaults do estágio 1.2 (bucket técnico `pendente_classificacao`,
 *    `criticidade='pendente'`, `confianca='alta'`, `is_transferencia=false`).
 *  - Geração determinística do ID via template
 *    `${origem}_${origem_ref}_${cliente_id}_${legal_entity_id}`.
 *  - Cópia opcional de `source_company_code` do contexto.
 *
 * Retorna um `EventoCaixaBase` (sem `status`/`data_realizada`/`data_vencimento`).
 * O adapter é responsável por adicionar a variante de status apropriada
 * antes de devolver `EventoCaixa[]`.
 *
 * Lança `IngestaoError` para input inválido (princípio do nucleus:
 * falhar visivelmente).
 */
export function buildEventoCaixaBase(
  input: BuildEventoCaixaBaseInput,
  ctx: AdapterContext,
): EventoCaixaBase {
  if (
    typeof input.valor !== 'number' ||
    !Number.isFinite(input.valor) ||
    input.valor <= 0
  ) {
    throw new IngestaoError(
      `valor deve ser positivo, recebido: ${String(input.valor)} (origem_ref=${input.origem_ref})`,
    );
  }
  if (!isValidDate(input.data_esperada)) {
    throw new IngestaoError(
      `data_esperada ausente ou inválida (origem_ref=${input.origem_ref})`,
    );
  }

  const id = `${input.origem}_${input.origem_ref}_${ctx.cliente_id}_${ctx.legal_entity_id}`;

  const base: EventoCaixaBase = {
    id,
    valor: input.valor,
    direcao: input.direcao,
    data_esperada: input.data_esperada,
    bucket_id: 'pendente_classificacao',
    bucket_nome: 'Pendente de classificação',
    cliente_id: ctx.cliente_id,
    legal_entity_id: ctx.legal_entity_id,
    origem: input.origem,
    criticidade: 'pendente',
    confianca: 'alta',
    confianca_origem: 'sistema',
    is_transferencia: false,
    criado_em: new Date(),
    criado_por: 'sistema',
    origem_ref: input.origem_ref,
  };

  // Optionals — preenchidos só quando o input traz valor, respeitando
  // `exactOptionalPropertyTypes: true` do tsconfig (não escrever `undefined`).
  if (input.contraparte_id !== undefined) {
    base.contraparte_id = input.contraparte_id;
  }
  if (input.contraparte_tipo !== undefined) {
    base.contraparte_tipo = input.contraparte_tipo;
  }
  if (input.documento_ref !== undefined) {
    base.documento_ref = input.documento_ref;
  }
  if (input.competencia !== undefined) {
    base.competencia = input.competencia;
  }
  if (ctx.source_company_code !== undefined) {
    base.source_company_code = ctx.source_company_code;
  }

  return base;
}
