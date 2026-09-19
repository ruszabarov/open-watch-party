// Reserve queue order synchronously, before any tab, storage, or network await.
export class SessionLifecycle {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation, operation);
    this.tail = task.catch(() => undefined);
    return task;
  }
}
