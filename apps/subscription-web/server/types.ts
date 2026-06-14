export interface Subscriber {
  name: string;
  email: string;
}

export interface SubscriberRecord extends Subscriber {
  id: string;
  status: string | null;
}

export interface SubscriberRepository {
  find(email: string): Promise<SubscriberRecord | null>;
  createPending(subscriber: Subscriber): Promise<void>;
  restorePending(id: string, subscriber: Subscriber): Promise<void>;
  activate(id: string): Promise<void>;
  unsubscribe(id: string): Promise<void>;
}

export interface ConfirmationLink {
  url: string;
  expiresAt: Date;
}

export interface ConfirmationMailer {
  sendConfirmation(
    subscriber: Subscriber,
    confirmationLink: ConfirmationLink,
  ): Promise<void>;
}

export interface SuccessMailer {
  sendSuccess(subscriber: Subscriber): Promise<void>;
}

export interface OwnerNotifier {
  notifyOwner(subscriber: Subscriber): Promise<void>;
}
