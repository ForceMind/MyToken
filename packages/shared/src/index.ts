export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export class MyTokenError extends Error {
  readonly originalCause: unknown;

  constructor(
    readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "MyTokenError";
    this.originalCause = cause;
  }
}

const secretPatterns = [
  /Bearer\s+[A-Za-z0-9._~+-]+/giu,
  /\b(?:sk|myt_live|myt_test)_[A-Za-z0-9_-]+\b/gu,
  /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/gu,
];

export function redactText(value: string): string {
  let redacted = value;
  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
