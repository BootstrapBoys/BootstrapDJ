import { ApplicationCommandOptionType, type Attachment } from 'discord.js';

import { defineMusicCommand, type MusicRunContext } from '../../lib/musicCommand.js';
import { runPlayRequest } from '../../lib/PlayRequest.js';

/** Discord's standard non-boosted attachment ceiling. */
const MAX_LOCAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function attachmentFrom(ctx: MusicRunContext['ctx']): Attachment | undefined {
    return ctx.isInteraction
        ? (ctx.interaction?.options.getAttachment('file') ?? undefined)
        : ctx.message?.attachments.first();
}

async function reject(
    client: MusicRunContext['client'],
    ctx: MusicRunContext['ctx'],
    description: string
): Promise<void> {
    await ctx.sendMessage({
        embeds: [client.embed().setColor(client.color.red).setDescription(description)],
    });
}

export default defineMusicCommand({
    name: 'playlocal',
    description: {
        content: 'Plays an audio or video file uploaded to Discord',
        examples: ['playlocal file:<attachment>'],
        usage: 'playlocal <file>',
    },
    aliases: ['plocal'],
    args: false,
    dj: false,
    active: false,
    requirePlayer: false,
    defer: true,
    clientPermissions: ['SendMessages', 'ViewChannel', 'EmbedLinks', 'Connect', 'Speak'],
    options: [
        {
            name: 'file',
            description: 'The audio or video file to play',
            type: ApplicationCommandOptionType.Attachment,
            required: true,
        },
    ],
    run: async ({ client, ctx }) => {
        const attachment = attachmentFrom(ctx);
        if (!attachment) {
            return await reject(client, ctx, 'Attach an audio or video file to play.');
        }
        const contentType = attachment.contentType ?? '';
        if (!contentType.startsWith('audio/') && !contentType.startsWith('video/')) {
            return await reject(client, ctx, 'The attachment must be an audio or video file.');
        }
        if (attachment.size > MAX_LOCAL_ATTACHMENT_BYTES) {
            return await reject(
                client,
                ctx,
                'The attachment is too large. The maximum size is 25 MB.'
            );
        }
        return await runPlayRequest(client, ctx, [attachment.url], 'queue');
    },
});
