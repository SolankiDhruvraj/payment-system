import winston from 'winston';

const { combine, timestamp, errors, json, colorize, simple, printf } = winston.format;

// ─── Custom Log Format for Development ───────────────────────────────────────
const devFormat = printf(({ level, message, timestamp, service, ...meta }) => {
  const metaStr = Object.keys(meta).length ? `\n  ${JSON.stringify(meta, null, 2)}` : '';
  return `${timestamp} [${service || 'payment-system'}] ${level}: ${message}${metaStr}`;
});

// ─── Logger Factory ───────────────────────────────────────────────────────────
const createLogger = () => {
  const isDev = process.env.NODE_ENV !== 'production';

  const transports = [
    // Always log errors to a dedicated file
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: combine(timestamp(), errors({ stack: true }), json()),
    }),
    // Combined log for all levels
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: combine(timestamp(), errors({ stack: true }), json()),
    }),
  ];

  // Human-readable console output in development
  if (isDev) {
    transports.push(
      new winston.transports.Console({
        format: combine(
          colorize(),
          timestamp({ format: 'HH:mm:ss' }),
          errors({ stack: true }),
          devFormat
        ),
      })
    );
  } else {
    // Structured JSON for production log aggregators (Datadog, CloudWatch, etc.)
    transports.push(
      new winston.transports.Console({
        format: combine(timestamp(), errors({ stack: true }), json()),
      })
    );
  }

  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: {
      service: 'payment-system',
      environment: process.env.NODE_ENV || 'development',
    },
    transports,
    // Prevent unhandled promise rejections from crashing the logger
    exitOnError: false,
  });
};

const logger = createLogger();

export default logger;
