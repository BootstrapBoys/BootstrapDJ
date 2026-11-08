import type { PlaybackLoggerPort } from './PlaybackEngine.js';

/** Minimal logger surface; keeps the engine free of the BootstrapClient type. */
export interface LoggerLike {
    warn(message: string): void;
    error(message: string): void;
}

export class DispatcherLoggerPort implements PlaybackLoggerPort {
    public constructor(private readonly logger: LoggerLike) {}

    public warn(message: string): void {
        this.logger.warn(message);
    }

    public error(message: string): void {
        this.logger.error(message);
    }
}
