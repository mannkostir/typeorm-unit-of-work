export interface OutboxRowContent {
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: string | null;
}

export interface OutboxRow extends OutboxRowContent {
  readonly id: string;
}
