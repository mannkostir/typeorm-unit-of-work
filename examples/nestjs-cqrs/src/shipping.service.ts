import { Inject, Injectable } from '@nestjs/common';
import { UnitOfWork } from 'typeorm-unit-of-work';
import { Transactional } from 'typeorm-unit-of-work-nestjs';
import { Order } from './order.js';

@Injectable()
export class ShippingService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork) {}

  @Transactional()
  async place(orderIds: readonly string[]): Promise<void> {
    await this.uow.getRepository(Order).save(orderIds.map((id) => Order.place(id)));
  }

  @Transactional()
  async ship(orderIds: readonly string[]): Promise<void> {
    const orders = this.uow.getRepository(Order);
    for (const id of orderIds) {
      const order = await orders.findOneByOrFail({ id });
      order.ship();
      await orders.save(order);
    }
  }
}
