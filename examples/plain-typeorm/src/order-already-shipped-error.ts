export class OrderAlreadyShippedError extends Error {
  constructor(readonly orderId: string) {
    super(`order ${orderId} is already shipped`);
    this.name = 'OrderAlreadyShippedError';
  }
}
