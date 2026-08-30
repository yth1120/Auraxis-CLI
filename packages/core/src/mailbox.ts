import fsp from 'node:fs/promises';
import path from 'node:path';
import { getAppPaths } from './config.js';
import { mailMessageSchema, parseJsonObject } from './validation.js';

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  createdAt: number;
}

export class SessionMailbox {
  constructor(private readonly file: string) {}

  static global(): SessionMailbox {
    return new SessionMailbox(path.join(getAppPaths().home, 'mailbox.json'));
  }

  private async read(): Promise<MailMessage[]> {
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      const value = parseJsonObject(raw);
      if (!Array.isArray(value?.messages)) return [];
      return value.messages.flatMap((item) => {
        const parsed = mailMessageSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
    } catch {
      return [];
    }
  }

  private async write(messages: MailMessage[]): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(this.file, `${JSON.stringify({ messages: messages.slice(-500) }, null, 2)}\n`, 'utf8');
  }

  async send(from: string, to: string, text: string): Promise<MailMessage> {
    const messages = await this.read();
    const message: MailMessage = {
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      from,
      to,
      text,
      createdAt: Date.now(),
    };
    messages.push(message);
    await this.write(messages);
    return message;
  }

  async list(to: string, limit = 50): Promise<MailMessage[]> {
    const messages = await this.read();
    return messages.filter((message) => message.to === to).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
}
