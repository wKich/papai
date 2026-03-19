export class KaneoApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: unknown,
  ) {
    super(message)
    this.name = 'KaneoApiError'
  }
}
