export interface OutboundSms {
  to: string;
  text: string;
}

export interface SmsSender {
  send(message: OutboundSms): Promise<void>;
}
