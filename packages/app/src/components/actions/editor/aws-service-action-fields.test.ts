import type { AwsServiceActionRequest } from '@roadiehq/actions-common';
import { updateAwsOperationRequest } from './aws-service-action-fields';

const request: AwsServiceActionRequest = {
  backendType: 'aws',
  mode: 'service-api',
  service: 'lambda',
  operation: 'CustomOperation',
  profile: '123456789012',
  region: 'eu-west-1',
  method: 'PATCH',
  path: '/custom',
  headers: [{ key: 'x-custom', value: 'value' }],
  body: '{"custom":true}',
};

describe('updateAwsOperationRequest', () => {
  it('keeps custom request fields while its operation name is edited', () => {
    expect(updateAwsOperationRequest(request, 'CustomOperationTwo')).toEqual({
      ...request,
      operation: 'CustomOperationTwo',
    });
  });

  it('clears known-operation defaults when switching to a custom operation', () => {
    expect(
      updateAwsOperationRequest(
        { ...request, operation: 'GetFunction' },
        'CustomOperation',
      ),
    ).toMatchObject({
      operation: 'CustomOperation',
      method: 'POST',
      path: '/',
      headers: [],
      body: '',
    });
  });

  it('uses canonical metadata when a known operation is typed', () => {
    expect(
      updateAwsOperationRequest(
        { ...request, operation: 'GetFunction' },
        'listfunctions',
      ),
    ).toMatchObject({
      operation: 'ListFunctions',
      method: 'GET',
      path: '/2015-03-31/functions/',
      headers: [],
      body: '',
    });
  });
});
