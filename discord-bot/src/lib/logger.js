import { pino } from 'pino';
import { config } from '../config.js';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: config.log.level,
  base: { app: 'hugotaslot-bot' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app' },
    },
  }),
});

export function child(bindings) {
  return logger.child(bindings);
}
