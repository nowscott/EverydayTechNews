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
  activate(id: string): Promise<void>;
}

export interface ConfirmationMailer {
  sendConfirmation(subscriber: Subscriber, confirmationUrl: string): Promise<void>;
}

export interface OwnerNotifier {
  notifyOwner(subscriber: Subscriber): Promise<void>;
}
