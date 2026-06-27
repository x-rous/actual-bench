type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const envLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || "info";

type LogMeta = Record<string, unknown>;

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[envLevel];
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

function write(level: LogLevel, message: string, meta?: LogMeta): void {
  if (!shouldLog(level)) return;

  const time = new Date().toISOString();
  const metaStr =
    meta && Object.keys(meta).length > 0
      ? " | " +
        Object.entries(meta)
          .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
          .join(" ")
      : "";

  const line = `${time} ${level}: ${message}${metaStr}`;

  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(message: string, meta?: LogMeta) {
    write("debug", message, meta);
  },

  info(message: string, meta?: LogMeta) {
    write("info", message, meta);
  },

  warn(message: string, meta?: LogMeta) {
    write("warn", message, meta);
  },

  error(message: string, meta?: LogMeta) {
    write("error", message, meta);
  },

  exception(message: string, error: unknown, meta?: LogMeta) {
    write("error", `${message} - ${serializeError(error)}`, meta);
  },

  child(context: LogMeta) {
    return {
      debug(message: string, meta?: LogMeta) {
        write("debug", message, { ...context, ...(meta ?? {}) });
      },
      info(message: string, meta?: LogMeta) {
        write("info", message, { ...context, ...(meta ?? {}) });
      },
      warn(message: string, meta?: LogMeta) {
        write("warn", message, { ...context, ...(meta ?? {}) });
      },
      error(message: string, meta?: LogMeta) {
        write("error", message, { ...context, ...(meta ?? {}) });
      },
      exception(message: string, error: unknown, meta?: LogMeta) {
        write("error", `${message} - ${serializeError(error)}`, {
          ...context,
          ...(meta ?? {}),
        });
      },
    };
  },
};
