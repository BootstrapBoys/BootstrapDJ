import type BootstrapClient from './BootstrapClient.js';

export interface EventOptions {
    name: string;
    one?: boolean;
}

/**
 * Base event contract.
 *
 * The loader constructs one instance per event file and binds `run` to the
 * matching client or player event. `one` marks listeners that fire once.
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
        this.one = options.one === true;
        this.fileName = file.replace(/\.[^.]+$/, '');
    }

    /** Subclasses replace this with the concrete event signature. */
    public async run(..._args: unknown[]): Promise<unknown> {
        return await Promise.resolve();
    }
}
