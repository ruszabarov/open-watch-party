import pino from 'pino';

export const logger = pino({
  level: process.env['NODE_ENV'] === 'test' ? 'silent' : (process.env['LOG_LEVEL'] ?? 'info'),
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export function getLogError(error: unknown): { name?: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return { message: String(error) };
}
