import type { Acknowledge, OperationResult } from '@open-watch-party/shared';
import { INVALID_PAYLOAD_ERROR } from './error';

type AckOperation<T> = () => OperationResult<T>;

export function acknowledge<TResponse>(
  acknowledgeResponse: Acknowledge<TResponse>,
  operation: AckOperation<TResponse>,
): void {
  const response = runAckOperation(operation);
  acknowledgeResponse(response);
}

function runAckOperation<TResponse>(
  operation: AckOperation<TResponse>,
): OperationResult<TResponse> {
  try {
    return operation();
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'Request failed.');
  }
}

export function success<TResponse>(data: TResponse): OperationResult<TResponse> {
  return { ok: true, data };
}

export function failure<TResponse = never>(error: string): OperationResult<TResponse> {
  return { ok: false, error };
}

export function invalidPayload<TResponse = never>(): OperationResult<TResponse> {
  return failure(INVALID_PAYLOAD_ERROR);
}
