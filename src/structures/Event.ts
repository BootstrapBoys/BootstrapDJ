import BootstrapClient from './BootstrapClient.js';

export default class Event {
    public client: BootstrapClient;
    public one: boolean;
    public file: string;
    public name: string;
    public fileName: string;
    constructor(client: BootstrapClient, file: string, options: EventOptions) {
        this.client = client;
        this.file = file;
        this.name = options.name;
        this.one = options.one || false;
        this.fileName = file.split('.')[0];
    }
    public async run(..._args: any[]): Promise<any> {
        return await Promise.resolve();
    }
}

interface EventOptions {
    name: string;
    one?: boolean;
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
