export class KaneoValidationError extends Error {
  constructor(
    message: string,
    public readonly validationError: unknown,
  ) {
    super(message)
    this.name = 'KaneoValidationError'
  }
}
