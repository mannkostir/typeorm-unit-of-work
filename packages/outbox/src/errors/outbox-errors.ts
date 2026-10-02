export class OutboxError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidOutboxOptionsError extends OutboxError {
  constructor(
    readonly option: string,
    reason: string,
  ) {
    super(`Invalid outbox option "${option}": ${reason}`);
  }
}

export class DuplicateOutboxRegistrationError extends OutboxError {
  constructor(readonly eventClassName: string) {
    super(`${eventClassName} is already registered with the outbox; register each event class once`);
  }
}

export class OutboxMappingError extends OutboxError {
  constructor(
    readonly eventType: string,
    reason: string,
    options?: ErrorOptions,
  ) {
    super(`Could not map an event to an outbox row of type "${eventType}": ${reason}`, options);
  }
}

export class UnsupportedDriverError extends OutboxError {
  constructor(readonly driverType: string) {
    super(`The outbox writes to Postgres only, but the DataSource uses the ${driverType} driver`);
  }
}
