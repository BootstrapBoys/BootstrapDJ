import type { ColorResolvable } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

/**
 * Toggles the guild's stay-connected flag. Enabling it also materialises a
 * player for the caller's voice channel so 24/7 mode has something to keep
 * alive; disabling only clears the flag and leaves playback untouched.
 */
export default class StayConnected extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: '247',
            description: {
                content: 'set the bot to stay in the vc',
                examples: ['247'],
                usage: '247',
            },
            category: 'config',
            aliases: ['stay'],
            cooldown: 3,
            args: false,
            player: { voice: true, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: ['ManageGuild'],
            },
            slashCommand: true,
            options: [],
        });
    }

    private reply(client: BootstrapClient, ctx: Context, text: string, colour: ColorResolvable): Promise<unknown> {
        return ctx.sendMessage({ embeds: [client.embed().setColor(colour).setDescription(text)] });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        const textChannel = ctx.channel;
        const voiceChannel = ctx.voiceChannel;
        if (!guild || !textChannel) return;
        if (!voiceChannel) {
            return await this.reply(
                client,
                ctx,
                'You must be connected to a voice channel to use 24/7 mode.',
                client.color.red
            );
        }

        if (await client.db.get_247(guild.id)) {
            await client.db.delete_247(guild.id);
            return await this.reply(client, ctx, '**247 mode has been disabled**', client.color.red);
        }

        await client.db.set_247(guild.id, textChannel.id, voiceChannel.id);
        if (!client.queue.get(guild.id)) {
            await client.queue.create(
                guild,
                voiceChannel,
                textChannel,
                client.shoukaku.options.nodeResolver(client.shoukaku.nodes)
            );
        }
        return await this.reply(client, ctx, '**247 mode has been enabled**', client.color.main);
    }
}
