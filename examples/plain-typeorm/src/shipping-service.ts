import type { UnitOfWork } from 'typeorm-unit-of-work';
import { Order } from './order.js';

export class ShippingService {
  constructor(private readonly uow: UnitOfWork) {}

  async place(orderIds: readonly string[]): Promise<void> {
    await this.uow.run(async () => {
      await this.uow.getRepository(Order).save(orderIds.map((id) => Order.place(id)));
    });
  }

  async ship(orderIds: readonly string[]): Promise<void> {
    await this.uow.run(async () => {
      const orders = this.uow.getRepository(Order);
      for (const id of orderIds) {
        const order = await orders.findOneByOrFail({ id });
        order.ship();
        await orders.save(order);
      }
    });
  }
}
