import { env } from '../../config/env';
import { EmailSender, OutboundEmail } from './email.interface';

export class MockEmailService implements EmailSender {
  public readonly outbox: OutboundEmail[] = [];

  async send(message: OutboundEmail): Promise<void> {
    if (env.NODE_ENV === 'production') {
      return;
    }

    this.outbox.push(message);
    if (this.outbox.length > 20) {
      this.outbox.shift();
    }
  }

  clear(): void {
    this.outbox.length = 0;
  }
}

export const mockEmailService = new MockEmailService();
