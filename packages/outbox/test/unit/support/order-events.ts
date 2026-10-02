export class OrderShipped {
  constructor(
    readonly orderId: string,
    readonly shippedAt: Date,
  ) {}
}

export class ExpressOrderShipped extends OrderShipped {}

export class OrderCancelled {
  constructor(readonly orderId: string) {}
}
