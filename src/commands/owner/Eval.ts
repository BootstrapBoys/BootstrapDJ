import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageComponentInteraction,
} from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Eval extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'eval',
            description: {
                content: 'Evaluate code',
                examples: ['eval'],
                usage: 'eval',
            },
            category: 'dev',
            aliases: ['ev'],
            cooldown: 3,
            args: false,
            player: {
                voice: false,
                dj: false,
                active: false,
                djPerm: null,
            },
            permissions: {
                dev: true,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;
        const code = args.join(' ').trim();
        // Logged because an empty argument list silently evaluated to
        // `undefined`, which looks like a broken command.
        client.logger.info(
            `[eval] user=${author.id} args=${args.length} length=${code.length}`
        );
        if (!code)
            return await ctx.sendMessage({
                content: 'Usage: `!eval <javascript>` — the code argument arrived empty.',
            });
        try {
            let evaled = eval(code);

            if (evaled == client.config) evaled = 'Nice try';

            const button = new ButtonBuilder()
                .setStyle(ButtonStyle.Danger)
                .setLabel('Delete')
                .setCustomId('eval-delete');
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

            if (typeof evaled !== 'string') evaled = (await import('node:util')).inspect(evaled);

            if (evaled.length > 2000) {
                // hasteb.in stopped responding; attach the output instead of
                // depending on a third-party paste service.
                return await ctx.sendMessage({
                    files: [
                        new AttachmentBuilder(Buffer.from(evaled, 'utf8'), {
                            name: 'eval-output.txt',
                        }),
                    ],
                });
            } else {
                const msg = await ctx.sendMessage({
                    content: `\`\`\`js\n${evaled}\n\`\`\``,
                    components: [row],
                });
                const filter = (i: MessageComponentInteraction): boolean =>
                    i.customId === 'eval-delete' && i.user.id === author.id;
                const collector = msg.createMessageComponentCollector({
                    time: 60000,
                    filter: filter,
                });
                collector.on('collect', async (i: MessageComponentInteraction) => {
                    await i.deferUpdate();
                    await msg.delete();
                });
            }
        } catch (e) {
            ctx.sendMessage(`\`\`\`js\n${e}\n\`\`\``);
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
