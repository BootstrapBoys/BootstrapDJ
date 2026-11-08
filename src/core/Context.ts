import {
    APIInteractionGuildMember,
    BaseMessageOptions,
    ChatInputCommandInteraction,
    type Client,
    CommandInteraction,
    DMChannel,
    Guild,
    GuildMember,
    GuildMemberResolvable,
    GuildTextBasedChannel,
    InteractionReplyOptions,
    InteractionResponse,
    Message,
    PartialDMChannel,
    PartialGroupDMChannel,
    TextChannel,
    User,
    VoiceBasedChannel,
} from 'discord.js';

import type { BootstrapClient } from './index.js';

type OutboundPayload = string | BaseMessageOptions;

/** The gateway client is a BootstrapClient at runtime; narrow it once here. */
function isBotClient(client: Client): client is BootstrapClient {
    return 'config' in client && 'queue' in client && 'db' in client;
}

/** Convert either accepted option shape into the command's string args. */
function readOptionValue(option: unknown): string {
    if (option === null || typeof option !== 'object' || !('value' in option)) return '';
    const value = option.value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value) ?? '';
}

/**
 * One reply surface for slash commands and prefix commands.
 *
 * The transport still matters in three places, and only here: whether a first
 * reply is deferred, whether a slash response is private, and whether a
 * message can be deleted later. Commands see a single API and never inspect
 * `interaction` vs `message` themselves.
 */
export default class Context {
    public ctx: CommandInteraction | Message;
    public interaction: ChatInputCommandInteraction | null;
    public message: Message | null;
    public id: string;
    public channelId: string;
    public client: BootstrapClient;
    public author: User | null;
    public channel:
        | PartialDMChannel
        | PartialGroupDMChannel
        | GuildTextBasedChannel
        | TextChannel
        | DMChannel
        | null;
    public guild: Guild | null;
    public createdAt: Date;
    public createdTimestamp: number;
    public member: GuildMemberResolvable | GuildMember | APIInteractionGuildMember | null;
    public args: string[] = [];
    /** The most recent reply, so editMessage/sendFollowUp can target it. */
    public msg: Message | null = null;
    /** Slash feedback is private unless the command or guild opts out. */
    public ephemeral: boolean;
    /** Per-guild auto-delete override in seconds; null falls back to config. */
    public deleteAfter: number | null = null;

    private deleteTimer: NodeJS.Timeout | null = null;

    public constructor(
        ctx: ChatInputCommandInteraction | Message,
        args: readonly unknown[],
        ephemeral: boolean = true
    ) {
        this.ctx = ctx;
        this.interaction = ctx instanceof ChatInputCommandInteraction ? ctx : null;
        this.message = ctx instanceof Message ? ctx : null;
        this.id = ctx.id;
        this.channelId = ctx.channelId;
        if (!isBotClient(ctx.client)) {
            throw new Error('Context requires a BootstrapClient');
        }
        this.client = ctx.client;
        this.author = ctx instanceof Message ? ctx.author : ctx.user;
        this.channel = ctx.channel;
        this.guild = ctx.guild;
        this.createdAt = ctx.createdAt;
        this.createdTimestamp = ctx.createdTimestamp;
        this.member = ctx.member;
        this.ephemeral = ephemeral;
        this.replaceArgs(args);
    }

    private get slash(): ChatInputCommandInteraction {
        if (!this.interaction) throw new Error('Context is not tied to an interaction');
        return this.interaction;
    }

    private get prefixChannel(): GuildTextBasedChannel {
        if (!this.message) throw new Error('Context is not tied to a message');
        if (!this.message.inGuild()) {
            throw new Error('Prefix replies require a guild message');
        }
        return this.message.channel;
    }

    public get isInteraction(): boolean {
        return this.ctx instanceof ChatInputCommandInteraction;
    }

    public setArgs(args: readonly unknown[]): void {
        this.replaceArgs(args);
    }

    private replaceArgs(args: readonly unknown[]): void {
        this.args = this.isInteraction
            ? args.map(readOptionValue)
            : args.map(value => String(value));
    }

    public get voiceChannel(): VoiceBasedChannel | null {
        const member = this.member;
        if (!member || typeof member === 'string') return null;
        if (!('voice' in member)) return null;
        return member.voice?.channel ?? null;
    }

    /** Acknowledge before slow work so Discord's three-second deadline is met. */
    public async defer(ephemeral: boolean = false): Promise<void> {
        if (!this.interaction || this.interaction.deferred || this.interaction.replied) return;
        await this.interaction.deferReply({ ephemeral });
    }

    private async resolveReply(response: Message | InteractionResponse<boolean>): Promise<Message> {
        return response instanceof Message ? response : await this.slash.fetchReply();
    }

    private scoped(content: OutboundPayload): string | InteractionReplyOptions {
        if (!this.isInteraction || !this.ephemeral) return content;
        if (typeof content === 'string') return { content, ephemeral: true };
        return { ...content, ephemeral: true };
    }

    /** An ephemeral reply or a component message is exempt from auto-delete. */
    private exemptFromDelete(content: OutboundPayload): boolean {
        if (this.isInteraction && this.ephemeral) return true;
        if (typeof content === 'string') return false;
        if (content.components && content.components.length > 0) return true;
        return 'ephemeral' in content && content.ephemeral === true;
    }

    private cancelPendingDelete(): void {
        if (!this.deleteTimer) return;
        clearTimeout(this.deleteTimer);
        this.deleteTimer = null;
    }

    private scheduleDelete(
        content: OutboundPayload,
        remove: () => Promise<unknown>,
        seconds?: number
    ): void {
        this.cancelPendingDelete();
        if (this.exemptFromDelete(content)) return;

        const delaySeconds = seconds ?? this.deleteAfter ?? this.client.config.deleteAfter;
        if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) return;

        const timer = setTimeout(() => {
            this.deleteTimer = null;
            void Promise.resolve()
                .then(remove)
                .catch(() => {});
        }, delaySeconds * 1000);
        timer.unref();
        this.deleteTimer = timer;
    }

    private async sendAsMessage(content: OutboundPayload, seconds?: number): Promise<Message> {
        const sent = await this.prefixChannel.send(content);
        this.msg = sent;
        this.scheduleDelete(
            content,
            async () => {
                await sent.delete();
            },
            seconds
        );
        return sent;
    }

    public async sendMessage(content: OutboundPayload, deleteAfter?: number): Promise<Message> {
        if (!this.interaction) return await this.sendAsMessage(content, deleteAfter);

        const interaction = this.interaction;
        const response = interaction.deferred
            ? await interaction.editReply(content)
            : await interaction.reply(this.scoped(content));
        this.msg = await this.resolveReply(response);
        this.scheduleDelete(
            content,
            async () => {
                await interaction.deleteReply();
            },
            deleteAfter
        );
        return this.msg;
    }

    public async editMessage(content: OutboundPayload): Promise<Message> {
        if (!this.interaction) {
            if (!this.msg) throw new Error('No message to edit');
            const edited = await this.msg.edit(content);
            this.msg = edited;
            this.scheduleDelete(content, async () => {
                await edited.delete();
            });
            return edited;
        }

        const interaction = this.interaction;
        if (!this.msg && !interaction.deferred) {
            throw new Error('No interaction message to edit');
        }
        const edited = await interaction.editReply(content);
        this.msg = edited;
        this.scheduleDelete(content, async () => {
            await interaction.deleteReply();
        });
        return edited;
    }

    /** Acknowledge and immediately show content, for callers that defer late. */
    public async sendDeferMessage(content: OutboundPayload): Promise<Message> {
        if (!this.interaction) return await this.sendAsMessage(content);

        const interaction = this.interaction;
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: this.ephemeral });
        }
        const sent = await interaction.editReply(content);
        this.msg = sent;
        this.scheduleDelete(content, async () => {
            await interaction.deleteReply();
        });
        return sent;
    }

    public async sendFollowUp(content: OutboundPayload): Promise<void> {
        if (!this.interaction) {
            await this.sendAsMessage(content);
            return;
        }

        const interaction = this.interaction;
        const sent = await interaction.followUp(this.scoped(content));
        this.msg = sent;
        this.scheduleDelete(content, async () => {
            await sent.delete();
        });
    }

    public get deferred(): boolean {
        return this.interaction ? this.interaction.deferred : this.msg !== null;
    }
}
