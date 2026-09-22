import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ObjectPropertyTree } from './object-property-tree';

// A K8s deployment as ingested: `images` is an array of image-ref strings, the
// side of the ECR ↔ deployments join the picker has to be able to target.
const deployment = {
  deployment_name: 'backstage-frontend',
  images: [
    '131774410247.dkr.ecr.eu-west-1.amazonaws.com/backstage-frontend:73acf00',
  ],
};

describe('ObjectPropertyTree', () => {
  it('picks the array itself when the picked value is an element of a primitive array', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ObjectPropertyTree value={deployment} onPick={onPick} />);

    // `images` is a container, so its element is the only pickable row — that
    // must still produce an expression that matches.
    await user.click(screen.getByRole('button', { name: /images/ }));
    await user.click(
      screen.getByRole('button', { name: /dkr\.ecr\.eu-west-1/ }),
    );

    expect(onPick).toHaveBeenCalledWith('$.images');
  });

  it('keeps the element wildcard when picking a field inside an array of objects', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <ObjectPropertyTree
        value={{ items: [{ full_name: 'octocat/hello' }] }}
        onPick={onPick}
      />,
    );

    await user.click(screen.getByRole('button', { name: /items/ }));
    await user.click(screen.getByRole('button', { name: '0' }));
    await user.click(screen.getByRole('button', { name: /octocat\/hello/ }));

    expect(onPick).toHaveBeenCalledWith('$.items[*].full_name');
  });
});
