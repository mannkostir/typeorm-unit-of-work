import { Controller, Global, Inject, Injectable, Module, Scope } from '@nestjs/common';
import { CqrsModule, EventBus, EventsHandler, type IEventHandler } from '@nestjs/cqrs';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, EntitySchema } from 'typeorm';
import { AggregateRoot, UnitOfWork } from 'typeorm-unit-of-work';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CqrsEventBusPublisher } from '../src/cqrs-event-bus-publisher';
import { Transactional } from '../src/transactional.decorator';
import { TransactionalBindingError } from '../src/transactional-binding-error';
import { UnitOfWorkModule } from '../src/unit-of-work.module';

class OrderPlaced {
  constructor(readonly orderId: string) {}
}

class Order extends AggregateRoot {
  id = '';

  static place(id: string): Order {
    const order = new Order();
    order.id = id;
    order.addDomainEvent(new OrderPlaced(id));
    return order;
  }
}

const orderSchema = new EntitySchema<Order>({
  name: 'Order',
  target: Order,
  columns: { id: { type: String, primary: true } },
});

const DATA_SOURCE = Symbol('DATA_SOURCE');

@Global()
@Module({
  providers: [
    {
      provide: DATA_SOURCE,
      useFactory: () =>
        new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [orderSchema], synchronize: true }).initialize(),
    },
  ],
  exports: [DATA_SOURCE],
})
class DatabaseModule {}

@EventsHandler(OrderPlaced)
class OrderPlacedRecorder implements IEventHandler<OrderPlaced> {
  readonly received: OrderPlaced[] = [];

  handle(event: OrderPlaced): void {
    this.received.push(event);
  }
}

@Injectable()
class OrderService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork) {}

  @Transactional()
  async place(id: string): Promise<void> {
    await this.uow.getRepository(Order).save(Order.place(id));
  }

  @Transactional()
  async placeThenFail(id: string): Promise<void> {
    await this.uow.getRepository(Order).save(Order.place(id));
    throw new Error('payment declined');
  }

  @Transactional({ commitWhen: (outcome: unknown) => outcome !== 'discard' })
  async placeWithOutcome(id: string, outcome: string): Promise<string> {
    await this.uow.getRepository(Order).save(Order.place(id));
    return outcome;
  }

  @Transactional()
  async managerInside(): Promise<unknown> {
    return this.uow.manager;
  }

  async managerWithoutDecorator(): Promise<unknown> {
    return this.uow.manager;
  }
}

class FactoryMadeService {
  constructor(private readonly uow: UnitOfWork) {}

  @Transactional()
  async managerInside(): Promise<unknown> {
    return this.uow.manager;
  }
}

function unitOfWorkModule() {
  return UnitOfWorkModule.forRootAsync({
    inject: [DATA_SOURCE, EventBus],
    useFactory: (dataSource: DataSource, eventBus: EventBus) => ({
      dataSource,
      publisher: new CqrsEventBusPublisher(eventBus),
      onAfterCommitError: (error: unknown) => {
        throw error;
      },
    }),
  });
}

async function compile(metadata: Parameters<typeof Test.createTestingModule>[0]): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule(metadata).compile();
  return moduleRef.init();
}

describe('UnitOfWorkModule', () => {
  let moduleRef: TestingModule;
  let service: OrderService;
  let dataSource: DataSource;

  const storedOrders = () => dataSource.getRepository(Order).count();

  beforeEach(async () => {
    moduleRef = await compile({
      imports: [DatabaseModule, CqrsModule.forRoot(), unitOfWorkModule()],
      providers: [
        OrderService,
        OrderPlacedRecorder,
        { provide: FactoryMadeService, inject: [UnitOfWork], useFactory: (uow: UnitOfWork) => new FactoryMadeService(uow) },
      ],
    });
    service = moduleRef.get(OrderService);
    dataSource = moduleRef.get<DataSource>(DATA_SOURCE);
  });

  afterEach(async () => {
    await moduleRef.close();
    await dataSource.destroy();
  });

  it('commits a @Transactional method and delivers its events to the event bus after commit', async () => {
    await service.place('o-1');

    expect({ stored: await storedOrders(), received: moduleRef.get(OrderPlacedRecorder).received }).toEqual({
      stored: 1,
      received: [new OrderPlaced('o-1')],
    });
  });

  it('rolls back a @Transactional method that throws and delivers nothing', async () => {
    await expect(service.placeThenFail('o-1')).rejects.toThrow('payment declined');

    expect({ stored: await storedOrders(), received: moduleRef.get(OrderPlacedRecorder).received }).toEqual({
      stored: 0,
      received: [],
    });
  });

  it('applies the run options given to the decorator', async () => {
    const outcome = await service.placeWithOutcome('o-1', 'discard');

    expect({ outcome, stored: await storedOrders() }).toEqual({ outcome: 'discard', stored: 0 });
  });

  it('runs a @Transactional method inside a transaction', async () => {
    expect(await service.managerInside()).not.toBe(dataSource.manager);
  });

  it('binds @Transactional methods of providers built by a factory', async () => {
    expect(await moduleRef.get(FactoryMadeService).managerInside()).not.toBe(dataSource.manager);
  });

  it('leaves methods without the decorator outside a transaction', async () => {
    expect(await service.managerWithoutDecorator()).toBe(dataSource.manager);
  });

  it('exposes the UnitOfWork for injection', () => {
    expect(moduleRef.get(UnitOfWork)).toBeInstanceOf(UnitOfWork);
  });
});

describe('UnitOfWorkModule bootstrap checks', () => {
  @Injectable({ scope: Scope.REQUEST })
  class RequestScopedService {
    @Transactional()
    async run(): Promise<void> {}
  }

  @Injectable({ scope: Scope.TRANSIENT })
  class TransientService {
    @Transactional()
    async run(): Promise<void> {}
  }

  @Controller()
  class OrdersController {
    @Transactional()
    async create(): Promise<void> {}
  }

  it('fails bootstrap for @Transactional on a request-scoped provider', async () => {
    await expect(
      compile({ imports: [DatabaseModule, CqrsModule.forRoot(), unitOfWorkModule()], providers: [RequestScopedService] }),
    ).rejects.toBeInstanceOf(TransactionalBindingError);
  });

  it('fails bootstrap for @Transactional on a transient provider', async () => {
    await expect(
      compile({ imports: [DatabaseModule, CqrsModule.forRoot(), unitOfWorkModule()], providers: [TransientService] }),
    ).rejects.toBeInstanceOf(TransactionalBindingError);
  });

  it('fails bootstrap for @Transactional on a controller', async () => {
    await expect(
      compile({ imports: [DatabaseModule, CqrsModule.forRoot(), unitOfWorkModule()], controllers: [OrdersController] }),
    ).rejects.toBeInstanceOf(TransactionalBindingError);
  });
});
