/** The error every adapter throws for a provider response it cannot use. */

export class ProviderHttpError extends Error {
  public readonly detail: string | undefined;

  public constructor(public readonly status: number, message = "The provider request failed.", detail?: string) {
    super(message);
    this.name = "ProviderHttpError";
    this.detail = detail;
  }
}
