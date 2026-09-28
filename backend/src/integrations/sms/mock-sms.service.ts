import { env } from '../../config/env';
import { OutboundSms, SmsSender } from './sms.interface';

export class MockSmsService implements SmsSender {
  public readonly outbox: OutboundSms[] = [];

  async send(message: OutboundSms): Promise<void> {
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

export const mockSmsService = new MockSmsService();
