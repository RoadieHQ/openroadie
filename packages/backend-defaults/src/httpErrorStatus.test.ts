import { httpStatusFromExpressError } from './httpErrorStatus';

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('httpStatusFromExpressError', () => {
  it.each([
    [namedError('InputError'), 400],
    [namedError('NotAllowedError'), 403],
    [namedError('NotFoundError'), 404],
    [namedError('ConflictError'), 409],
  ])('maps %s to %i', (error, status) => {
    expect(httpStatusFromExpressError(error)).toBe(status);
  });

  it('keeps an explicit Express status', () => {
    expect(httpStatusFromExpressError({ status: 422 })).toBe(422);
  });
});
