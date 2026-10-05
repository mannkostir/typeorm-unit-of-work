export class ScenarioLog {
  readonly #lines: string[] = [];

  record(line: string): void {
    this.#lines.push(line);
  }

  lines(): readonly string[] {
    return [...this.#lines];
  }
}
