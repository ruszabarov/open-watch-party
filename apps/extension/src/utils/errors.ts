export function getErrorMessage(error: Error, fallback = 'Unexpected error.'): string {
  return error.message || fallback;
}
