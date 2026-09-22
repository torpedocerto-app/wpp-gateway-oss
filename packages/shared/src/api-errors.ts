/**
 * Catálogo de erros da API pública (doc 03 §7).
 *
 * Clientes programam contra o `code` (string estável), nunca contra a mensagem
 * ou o HTTP status isoladamente.
 */

export const ApiErrorCode = {
  MISSING_TOKEN: 'MISSING_TOKEN',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  PROJECT_INACTIVE: 'PROJECT_INACTIVE',
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  MESSAGE_NOT_CANCELABLE: 'MESSAGE_NOT_CANCELABLE',
  INVALID_PHONE_NUMBER: 'INVALID_PHONE_NUMBER',
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  INVALID_SCHEDULE: 'INVALID_SCHEDULE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  DAILY_QUOTA_EXCEEDED: 'DAILY_QUOTA_EXCEEDED',
  NO_ACCOUNTS_AVAILABLE: 'NO_ACCOUNTS_AVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RECIPIENT_OPTED_OUT: 'RECIPIENT_OPTED_OUT',
  MEDIA_TOO_LARGE: 'MEDIA_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  MISSING_MEDIA_FILE: 'MISSING_MEDIA_FILE',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

interface ApiErrorSpec {
  http: number;
  retryable: boolean;
  message: string;
}

/** Especificação de cada erro: HTTP status, se é retryable, mensagem padrão. */
export const API_ERROR_SPEC: Record<ApiErrorCode, ApiErrorSpec> = {
  MISSING_TOKEN: { http: 401, retryable: false, message: 'Cabeçalho de autorização ausente' },
  INVALID_TOKEN: { http: 401, retryable: false, message: 'Token inválido' },
  TOKEN_REVOKED: { http: 401, retryable: false, message: 'Token revogado' },
  TOKEN_EXPIRED: { http: 401, retryable: false, message: 'Token expirado' },
  PROJECT_INACTIVE: { http: 403, retryable: false, message: 'Projeto desativado' },
  MESSAGE_NOT_FOUND: { http: 404, retryable: false, message: 'Mensagem não encontrada' },
  MESSAGE_NOT_CANCELABLE: {
    http: 409,
    retryable: false,
    message: 'A mensagem já saiu da fila e não pode ser cancelada',
  },
  INVALID_PHONE_NUMBER: {
    http: 422,
    retryable: false,
    message: 'O número informado não é válido',
  },
  TEXT_TOO_LONG: { http: 422, retryable: false, message: 'Texto acima de 4096 caracteres' },
  INVALID_SCHEDULE: {
    http: 422,
    retryable: false,
    message: 'Data de agendamento inválida (deve ser futura e até +30 dias)',
  },
  RATE_LIMIT_EXCEEDED: {
    http: 429,
    retryable: true,
    message: 'Limite de requisições excedido',
  },
  DAILY_QUOTA_EXCEEDED: {
    http: 429,
    retryable: true,
    message: 'Cota diária de mensagens do projeto excedida',
  },
  NO_ACCOUNTS_AVAILABLE: {
    http: 503,
    retryable: true,
    message: 'Nenhuma conta WhatsApp disponível no momento',
  },
  INTERNAL_ERROR: { http: 500, retryable: true, message: 'Erro interno' },
  RECIPIENT_OPTED_OUT: {
    http: 422,
    retryable: false,
    message: 'Destinatário optou por não receber mensagens',
  },
  MEDIA_TOO_LARGE: {
    http: 413,
    retryable: false,
    message: 'Arquivo acima do limite permitido (16MB)',
  },
  UNSUPPORTED_MEDIA_TYPE: {
    http: 415,
    retryable: false,
    message: 'Tipo de arquivo não suportado',
  },
  MISSING_MEDIA_FILE: { http: 422, retryable: false, message: 'Arquivo de mídia ausente' },
};

/** Corpo padrão de erro da API (doc 03 §7). */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Erro tipado, lançável, que carrega o código do catálogo. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly http: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: ApiErrorCode, details?: Record<string, unknown>) {
    const spec = API_ERROR_SPEC[code];
    super(spec.message);
    this.name = 'ApiError';
    this.code = code;
    this.http = spec.http;
    this.retryable = spec.retryable;
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}
