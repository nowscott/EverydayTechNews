export interface Subscriber {
  name: string;
  email: string;
}

export interface SubscriberRepository {
  exists(email: string): Promise<boolean>;
  create(subscriber: Subscriber): Promise<void>;
}

export interface SubscriptionNotifier {
  notify(subscriber: Subscriber): Promise<void>;
}
