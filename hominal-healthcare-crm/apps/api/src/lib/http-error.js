export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || null;
  }
}

export function assertFound(data, message) {
  if (!data) {
    throw new HttpError(404, message || "Record not found");
  }
  return data;
}
