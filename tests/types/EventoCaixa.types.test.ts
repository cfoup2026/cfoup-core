/**
 * Type tests do `EventoCaixa` — validados pelo `tsc --noEmit`.
 *
 * Estratégia: cada `it()` constrói um valor `EventoCaixa` (positivo) ou
 * usa `@ts-expect-error` (negativo) para garantir que o compilador barra
 * o cenário descrito. Sem dependência externa (não requer `tsd`).
 *
 * Como o vitest também executa estes arquivos em runtime, cada teste
 * apenas atribui uma const e descarta — sem assertions de runtime.
 */
import { describe, it } from 'vitest';
import type {
  EventoCaixa,
  EventoConfirmado,
  EventoEstimado,
  EventoPendente,
  EventoRealizado,
} from '../../src/types/index.js';

/** Conjunto base de campos sempre obrigatórios (15 campos, sem `status`). */
const baseFields = {
  id: 'evt_001',
  valor: 100,
  direcao: 'saida' as const,
  data_esperada: new Date('2026-04-15T00:00:00.000Z'),
  bucket_id: 'pendente_classificacao',
  bucket_nome: 'Pendente',
  cliente_id: 'cli_alpha',
  legal_entity_id: 'le_alpha_main',
  origem: 'cef' as const,
  criticidade: 'pendente' as const,
  confianca: 'alta' as const,
  confianca_origem: 'sistema' as const,
  is_transferencia: false,
  criado_em: new Date('2026-04-15T12:00:00.000Z'),
  criado_por: 'sistema',
};

describe('EventoCaixa — variantes válidas compilam', () => {
  it('realizado válido', () => {
    const ev: EventoCaixa = {
      ...baseFields,
      status: 'realizado',
      data_realizada: new Date('2026-04-15T00:00:00.000Z'),
    };
    void ev;
  });

  it('realizado com data_vencimento opcional', () => {
    const ev: EventoCaixa = {
      ...baseFields,
      status: 'realizado',
      data_realizada: new Date('2026-04-15T00:00:00.000Z'),
      data_vencimento: new Date('2026-04-10T00:00:00.000Z'),
    };
    void ev;
  });

  it('confirmado válido', () => {
    const ev: EventoCaixa = {
      ...baseFields,
      status: 'confirmado',
      data_realizada: null,
      data_vencimento: new Date('2026-04-20T00:00:00.000Z'),
    };
    void ev;
  });

  it('estimado válido (sem data_vencimento)', () => {
    const ev: EventoCaixa = {
      ...baseFields,
      status: 'estimado',
      data_realizada: null,
    };
    void ev;
  });

  it('pendente válido (sem data_vencimento)', () => {
    const ev: EventoCaixa = {
      ...baseFields,
      status: 'pendente',
      data_realizada: null,
    };
    void ev;
  });

  it('evento com todos os opcionais preenchidos compila', () => {
    const ev: EventoCaixa = {
      ...baseFields,
      status: 'confirmado',
      data_realizada: null,
      data_vencimento: new Date('2026-04-20T00:00:00.000Z'),
      contraparte_id: 'cp_001',
      contraparte_tipo: 'fornecedor',
      source_company_code: 'FKN-001',
      origem_ref: 'ref_external_01',
      documento_ref: 'NF-12345',
      confirmado_por: 'usr_owner',
      confirmado_em: new Date('2026-04-14T10:00:00.000Z'),
      competencia: '2026-04',
      cenario_id: 'cen_base',
      observacao: 'Aluguel comercial mensal',
    };
    void ev;
  });
});

describe('EventoCaixa — discriminator por status', () => {
  it('narrowing por status funciona como guard', () => {
    // Tomar como parâmetro força o tipo a permanecer EventoCaixa (union)
    // em vez de ser narrowed pelo TS-flow ao literal de criação.
    function check(ev: EventoCaixa): void {
      if (ev.status === 'confirmado') {
        // Narrowed para EventoConfirmado: data_vencimento é Date (não optional).
        const vcto: Date = ev.data_vencimento;
        void vcto;
      }
      if (ev.status === 'realizado') {
        // Narrowed para EventoRealizado: data_realizada é Date (não null).
        const dr: Date = ev.data_realizada;
        void dr;
      }
    }
    check({
      ...baseFields,
      status: 'confirmado',
      data_realizada: null,
      data_vencimento: new Date('2026-04-20T00:00:00.000Z'),
    });
  });

  it('variantes individuais são tipos próprios e narrowable', () => {
    const real: EventoRealizado = {
      ...baseFields,
      status: 'realizado',
      data_realizada: new Date(),
    };
    const conf: EventoConfirmado = {
      ...baseFields,
      status: 'confirmado',
      data_realizada: null,
      data_vencimento: new Date(),
    };
    const est: EventoEstimado = {
      ...baseFields,
      status: 'estimado',
      data_realizada: null,
    };
    const pend: EventoPendente = {
      ...baseFields,
      status: 'pendente',
      data_realizada: null,
    };
    void real;
    void conf;
    void est;
    void pend;
  });
});

describe('EventoCaixa — bloqueios de compilação', () => {
  it('realizado SEM data_realizada → não compila', () => {
    // @ts-expect-error data_realizada é obrigatório quando status='realizado'
    const ev: EventoCaixa = {
      ...baseFields,
      status: 'realizado',
    };
    void ev;
  });

  it('confirmado SEM data_vencimento → não compila', () => {
    // @ts-expect-error data_vencimento é obrigatório quando status='confirmado'
    const ev: EventoCaixa = {
      ...baseFields,
      status: 'confirmado',
      data_realizada: null,
    };
    void ev;
  });

  it('confirmado com data_realizada=Date (não null) → não compila', () => {
    // @ts-expect-error em status='confirmado', data_realizada é obrigatoriamente null
    const ev: EventoCaixa = {
      ...baseFields,
      status: 'confirmado',
      data_realizada: new Date(),
      data_vencimento: new Date(),
    };
    void ev;
  });

  it('estimado com data_realizada=Date → não compila', () => {
    // @ts-expect-error em status='estimado', data_realizada é obrigatoriamente null
    const ev: EventoCaixa = {
      ...baseFields,
      status: 'estimado',
      data_realizada: new Date(),
    };
    void ev;
  });

  it('SEM cliente_id → não compila', () => {
    const { cliente_id: _omit, ...withoutCliente } = baseFields;
    void _omit;
    // @ts-expect-error cliente_id é obrigatório
    const ev: EventoCaixa = {
      ...withoutCliente,
      status: 'realizado',
      data_realizada: new Date(),
    };
    void ev;
  });

  it('SEM legal_entity_id → não compila', () => {
    const { legal_entity_id: _omit, ...rest } = baseFields;
    void _omit;
    // @ts-expect-error legal_entity_id é obrigatório
    const ev: EventoCaixa = {
      ...rest,
      status: 'realizado',
      data_realizada: new Date(),
    };
    void ev;
  });

  it('SEM is_transferencia → não compila', () => {
    const { is_transferencia: _omit, ...rest } = baseFields;
    void _omit;
    // @ts-expect-error is_transferencia é obrigatório
    const ev: EventoCaixa = {
      ...rest,
      status: 'realizado',
      data_realizada: new Date(),
    };
    void ev;
  });

  it('origem fora do enum → não compila', () => {
    const ev: EventoCaixa = {
      ...baseFields,
      // @ts-expect-error 'boleto' não pertence ao enum Origem
      origem: 'boleto',
      status: 'realizado',
      data_realizada: new Date(),
    };
    void ev;
  });

  it('direcao fora do enum → não compila', () => {
    const ev: EventoCaixa = {
      ...baseFields,
      // @ts-expect-error 'in' não pertence ao enum Direcao (valores válidos: 'entrada' | 'saida')
      direcao: 'in',
      status: 'realizado',
      data_realizada: new Date(),
    };
    void ev;
  });

  it('status fora do enum → não compila', () => {
    const ev: EventoCaixa = {
      ...baseFields,
      // @ts-expect-error 'cancelado' não pertence ao enum Status
      status: 'cancelado',
    };
    void ev;
  });

  it('confianca fora do enum → não compila', () => {
    const ev: EventoCaixa = {
      ...baseFields,
      // @ts-expect-error 'altissima' não pertence ao enum Confianca
      confianca: 'altissima',
      status: 'realizado',
      data_realizada: new Date(),
    };
    void ev;
  });

  it('contraparte_tipo fora do enum → não compila', () => {
    const ev: EventoCaixa = {
      ...baseFields,
      status: 'realizado',
      data_realizada: new Date(),
      // @ts-expect-error 'parceiro' não pertence ao enum ContraparteTipo
      contraparte_tipo: 'parceiro',
    };
    void ev;
  });
});
