/* eslint-disable @typescript-eslint/no-unused-vars */
import { BootstrapClient, Event } from '../../structures/index.js';

export default class NodeRaw extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeRaw',
        });
    }
    public async run(payload: any): Promise<void> {
        //this.client.logger.debug(`Node raw event: ${JSON.stringify(payload)}`);
    }
}
