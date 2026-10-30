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
} from 'discord.js';

import { Lavamusic } from './index.js';

export default class Context {
    public ctx: CommandInteraction | Message;
    public interaction: ChatInputCommandInteraction | null;
    public message: Message | null;
    public id: string;
    public channelId: string;
    public client: Lavamusic;
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
    public args: any[];
    public msg: any;
    private deleteTimer: NodeJS.Timeout | null = null;
    constructor(ctx: ChatInputCommandInteraction | Message, args: any[]) {
        this.ctx = ctx;
        this.interaction = this.ctx instanceof ChatInputCommandInteraction ? this.ctx : null;
        this.message = this.ctx instanceof Message ? this.ctx : null;
        this.channel = this.ctx.channel;
        this.id = ctx.id;
        this.channelId = ctx.channelId;
        this.client = ctx.client as Lavamusic;
        this.author = ctx instanceof Message ? ctx.author : ctx.user;
        this.channel = ctx.channel;
        this.guild = ctx.guild;
        this.createdAt = ctx.createdAt;
        this.createdTimestamp = ctx.createdTimestamp;
        this.member = ctx.member;
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

    public setArgs(args: any[]): void {
        if (this.isInteraction) {
            this.args = args.map((arg: { value: any }) => arg.value);
        } else {
            this.args = args;
        }
    }
    public async sendMessage(content: any, deleteAfter?: number): Promise<Message> {
        if (this.isInteraction) {
            this.msg = this.cmd.reply(content);
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
            if (this.msg) {
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
            this.msg = await this.cmd.deferReply({ fetchReply: true });
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
            this.msg = await this.cmd.followUp(content);
            this.armDelete(content, 'message');
        } else {
            this.msg = await this.messageChannel.send(content);
            this.armDelete(content, 'message');
        }
    }
    public get deferred(): boolean | Promise<any> {
        if (this.isInteraction) {
            return this.cmd.deferred;
        }

        if (this.msg) return true;

        return false;
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
