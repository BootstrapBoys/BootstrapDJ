import type BootstrapClient from './BootstrapClient.js';

export interface EventOptions {
    name: string;
    one?: boolean;
}

/**
 * Base event contract.
 *
 * The loader discovers event classes, constructs one instance per file, and
 * binds `run` to the corresponding client/player event. `one` marks listeners
 * that should fire only once.
 */
export default class Event {
    public client: BootstrapClient;
    public one: boolean;
    public file: string;
    public name: string;
    public fileName: string;

    public constructor(client: BootstrapClient, file: string, options: EventOptions) {
        this.client = client;
        this.file = file;
        this.name = options.name;
        this.one = options.one ?? false;
        this.fileName = file.replace(/\.[^.]+$/, '');
    }

    /** Subclasses replace this with the concrete event signature. */
    public async run(..._args: unknown[]): Promise<unknown> {
        return await Promise.resolve();
    }
}
