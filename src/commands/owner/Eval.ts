import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageComponentInteraction,
} from 'discord.js';
import { inspect } from 'node:util';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

const OUTPUT_LIMIT = 2000;
const COLLECTOR_MS = 60_000;

export default class Eval extends Command {
    public constructor(client: BootstrapClient) {
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
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: true,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    private async deliver(
        client: BootstrapClient,
        ctx: Context,
        output: string,
        authorId: string
    ): Promise<void> {
        if (output.length > OUTPUT_LIMIT) {
            // A paste service is not a dependency; the transcript travels as a
            // file instead.
            await ctx.sendMessage({
                files: [
                    new AttachmentBuilder(Buffer.from(output, 'utf8'), { name: 'eval-output.txt' }),
                ],
            });
            return;
        }

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Danger)
                .setLabel(tr(ctx, 'longtail:owner.evalDelete'))
                .setCustomId('eval-delete')
        );
        const message = await ctx.sendMessage({
            content: `\`\`\`js\n${output}\n\`\`\``,
            components: [row],
        });
        const collector = message.createMessageComponentCollector({
            time: COLLECTOR_MS,
            filter: (interaction: MessageComponentInteraction) =>
                interaction.customId === 'eval-delete' && interaction.user.id === authorId,
        });
        collector.on('collect', async (interaction: MessageComponentInteraction) => {
            await interaction.deferUpdate();
            await message.delete();
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;
        const code = args.join(' ').trim();
        // An empty argument list silently evaluated to `undefined`, which reads
        // as a broken command; say so instead.
        client.logger.info(`[eval] user=${author.id} args=${args.length} length=${code.length}`);
        if (!code) {
            return await ctx.sendMessage({
                content: tr(ctx, 'longtail:owner.evalUsage'),
            });
        }

        try {
            let output: unknown = eval(code);
            if (output === client.config) output = tr(ctx, 'longtail:owner.evalNiceTry');
            const rendered = typeof output === 'string' ? output : inspect(output);
            await this.deliver(client, ctx, rendered, author.id);
        } catch (error) {
            await ctx.sendMessage(`\`\`\`js\n${error}\n\`\`\``);
        }
    }
}
