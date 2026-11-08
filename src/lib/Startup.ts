/** Minimal logger surface so tests need no signale instance. */
export interface StartupLogger {
    error(...args: unknown[]): void;
}

/** The startup surface of the bot client. */
export interface StartupClient {
    start(token: string): Promise<void>;
    logger: StartupLogger;
}

/**
 * Await a startup task and terminate on failure.
 *
 * A rejected `client.start()` (invalid token, bind failure) used to be
 * fire-and-forget: antiCrash logged an unhandled rejection and the process
 * stayed alive without ever connecting. Startup failures are fatal instead, so
 * the supervisor can restart or surface the error.
 */
export async function startOrExit(
    start: () => Promise<unknown>,
    onError: (error: unknown) => void,
    exit: (code: number) => void = code => process.exit(code)
): Promise<void> {
    try {
        await start();
    } catch (error) {
        onError(error);
        exit(1);
    }
}

/** Bind `BootstrapClient.start` to the fail-fast startup policy. */
export async function startClientOrExit(
    client: StartupClient,
    token: string,
    exit: (code: number) => void = code => process.exit(code)
): Promise<void> {
    await startOrExit(
        () => client.start(token),
        error => client.logger.error('[CLIENT] startup failed; exiting:', error),
        exit
    );
}
