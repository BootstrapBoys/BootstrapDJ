import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import { endIncident, formatDuration } from '../../utils/NodeStatus.js';

export default class NodeConnect extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeConnect',
        });
    }
    public async run(node: string): Promise<void> {
        const recoveredMs = endIncident();
        if (recoveredMs === null) {
            const ready = `Lavalink node "${node}" is ready!`;
            this.client.logger.success(ready);
            BotLog.send(this.client, ready, 'success');
        } else {
            const recovered = `Lavalink node "${node}" recovered after ${formatDuration(recoveredMs)}.`;
            this.client.logger.success(recovered);
            BotLog.send(this.client, recovered, 'success');
        }

        let data = await this.client.db.get_247();
        if (!data) return;
        if (!Array.isArray(data)) {
            data = [data];
        }
        for (const main of data) {
            const index = data.indexOf(main);
            setTimeout(async () => {
                const guild = this.client.guilds.cache.get(main.guildId);
                if (!guild) return;
                const channel = guild.channels.cache.get(main.textId);
                if (!channel) return;
                const vc = guild.channels.cache.get(main.voiceId);
                if (!vc) return;
                await this.client.queue.create(guild, vc, channel);
            }, index * 1000);
        }
    }
}
