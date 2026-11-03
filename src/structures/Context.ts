import {
    APIInteractionGuildMember,
    ChatInputCommandInteraction,
    CommandInteraction,
    DMChannel,
    Guild,
    GuildMember,
    GuildMemberResolvable,
    GuildTextBasedChannel,
    Message,
    PartialDMChannel,
    PartialGroupDMChannel,
    TextChannel,
    User,
    VoiceBasedChannel,
} from 'discord.js';

import { BootstrapClient } from './index.js';

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
        | null = null;
    public guild: Guild | null;
    public createdAt: Date;
    public createdTimestamp: number;
    public member: GuildMemberResolvable | GuildMember | APIInteractionGuildMember | null;
    public args: any[] = [];
    public msg: any;
    /** Slash command feedback is private unless the command opts out. */
    public ephemeral: boolean;
    private deleteTimer: NodeJS.Timeout | null = null;
    constructor(ctx: ChatInputCommandInteraction | Message, args: any[], ephemeral: boolean = true) {
        this.ctx = ctx;
        this.interaction = this.ctx instanceof ChatInputCommandInteraction ? this.ctx : null;
        this.message = this.ctx instanceof Message ? this.ctx : null;
        this.channel = this.ctx.channel;
        this.id = ctx.id;
        this.channelId = ctx.channelId;
        this.client = ctx.client as BootstrapClient;
        this.author = ctx instanceof Message ? ctx.author : ctx.user;
        this.channel = ctx.channel;
        this.guild = ctx.guild;
        this.createdAt = ctx.createdAt;
        this.createdTimestamp = ctx.createdTimestamp;
        this.member = ctx.member;
        this.ephemeral = ephemeral;
        this.setArgs(args);
    }


    /** Typed accessors: the constructor sets exactly one of the two, and
     * `isInteraction` reflects that, so these cannot disagree in practice. */
    private get cmd(): ChatInputCommandInteraction {
        if (!this.interaction) throw new Error('Context is not tied to an interaction');
        return this.interaction;
    }

    private get messageChannel(): TextChannel {
        if (!this.message) throw new Error('Context is not tied to a message');
        return this.message.channel as TextChannel;
    }

    public get isInteraction(): boolean {
        return this.ctx instanceof ChatInputCommandInteraction;
    }

    public setArgs(args: readonly any[]): void {
        if (this.isInteraction) {
            this.args = args.map((arg: { value: any }) => arg.value);
        } else {
            this.args = [...args];
        }
    }


    /**
     * The invoking member's voice channel. The handler already rejects members
     * who are not connected, so null here means they left during the invocation.
     */
    public get voiceChannel(): VoiceBasedChannel | null {
        const member = this.member;
        if (!member || typeof member !== 'object' || !('voice' in member)) return null;
        return member.voice?.channel ?? null;
    }
    /**
     * Acknowledge the interaction before slow work (Lavalink searches, playlist
     * resolution). Discord fails the command if the first reply takes over 3s.
     */
    public async defer(ephemeral: boolean = false): Promise<void> {
        if (!this.isInteraction) return;
        if (this.cmd.deferred || this.cmd.replied) return;
        await this.cmd.deferReply({ ephemeral });
    }

    private ephemeralPayload(content: any): any {
        if (!this.isInteraction || !this.ephemeral) return content;
        if (content && typeof content === 'object' && !Array.isArray(content))
            return { ...content, ephemeral: true };
        return { content: String(content), ephemeral: true };
    }

    public async sendMessage(content: any, deleteAfter?: number): Promise<Message> {
        if (this.isInteraction) {
            this.msg = this.deferred
                ? await this.cmd.editReply(content)
                : await this.cmd.reply(this.ephemeralPayload(content));
            this.armDelete(content, 'reply', deleteAfter);
            return this.msg;
        } else {
            this.msg = await this.messageChannel.send(content);
            this.armDelete(content, 'message', deleteAfter);
            return this.msg;
        }
    }

    /**
     * (Re)arm deletion of this context's reply so command output doesn't
     * linger. Called after every send/edit — the last thing displayed decides
     * the lifetime. Messages carrying components (pickers, paginators) are
     * exempt, and an exempt edit cancels a pending timer.
     */
    private armDelete(content: any, target: 'reply' | 'message', seconds?: number): void {
        if (this.deleteTimer) {
            clearTimeout(this.deleteTimer);
            this.deleteTimer = null;
        }
        const timeout = seconds ?? this.client.config.deleteAfter;
        if (!timeout || timeout <= 0) return;
        if (this.isInteraction && this.ephemeral) return;
        if (content?.components?.length) return;
        if (content?.ephemeral) return;
        const timer = setTimeout(() => {
            const removal =
                target === 'reply'
                    ? this.cmd.deleteReply()
                    : Promise.resolve(this.msg).then((msg: Message) => msg?.delete?.());
            Promise.resolve(removal).catch(() => {});
        }, timeout * 1000);
        (timer as unknown as { unref?: () => void }).unref?.();
        this.deleteTimer = timer;
    }
    public async editMessage(content: any): Promise<Message> {
        if (this.isInteraction) {
            if (this.msg || this.deferred) {
                this.msg = await this.cmd.editReply(content);
                this.armDelete(content, 'reply');
            }
            return this.msg;
        } else {
            if (this.msg) {
                this.msg = await this.msg.edit(content);
                this.armDelete(content, 'message');
            }
            return this.msg;
        }
    }
    public async sendDeferMessage(content: any): Promise<Message> {
        if (this.isInteraction) {
            this.msg = await this.cmd.deferReply({ ephemeral: this.ephemeral, fetchReply: true });
            this.armDelete(content, 'reply');
            return this.msg;
        } else {
            this.msg = await this.messageChannel.send(content);
            this.armDelete(content, 'message');
            return this.msg;
        }
    }
    public async sendFollowUp(content: any): Promise<void> {
        if (this.isInteraction) {
            this.msg = await this.cmd.followUp(this.ephemeralPayload(content));
            this.armDelete(content, 'message');
        } else {
            this.msg = await this.messageChannel.send(content);
            this.armDelete(content, 'message');
        }
    }
    public get deferred(): boolean {
        if (this.isInteraction) return this.cmd.deferred;
        return Boolean(this.msg);
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
