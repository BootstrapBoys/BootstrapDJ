import { Guild } from 'discord.js';

import { BootstrapClient, Event } from '../../core/index.js';
import { postGuildNotice } from '../../lib/GuildNotice.js';

export default class GuildCreate extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'guildCreate' });
    }

    public async run(guild: Guild): Promise<unknown> {
        return await postGuildNotice(this.client, guild, 'joined');
    }
}
