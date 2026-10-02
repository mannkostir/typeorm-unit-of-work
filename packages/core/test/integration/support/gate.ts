export interface Gate {
  readonly opened: Promise<void>;
  open(): void;
}

export function closedGate(): Gate {
  const opener = { open: () => {} };
  const opened = new Promise<void>((resolve) => {
    opener.open = resolve;
  });
  return { opened, open: () => opener.open() };
}
