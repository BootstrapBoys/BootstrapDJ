import { Guild } from 'discord.js';

import { BootstrapClient, Event } from '../../core/index.js';
import { postGuildNotice } from '../../lib/GuildNotice.js';
import { stopSetupJanitor } from '../../lib/SetupSystem.js';

export default class GuildDelete extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'guildDelete' });
    }

    public async run(guild: Guild): Promise<unknown> {
        this.client.queue.get(guild.id)?.destroy();
        void this.client.db.deleteSession(guild.id).catch(() => {});
        const botId = this.client.user?.id;
        if (botId) void this.client.db.releaseSessionLease(guild.id, botId).catch(() => {});
        stopSetupJanitor(guild.id);
        return await postGuildNotice(this.client, guild, 'removed');
    }
}
