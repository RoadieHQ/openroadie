import { render, screen } from '@testing-library/react';
import { RuleSummary, type RuleSummaryProps } from './relationship-rule-form';

const baseIntegrationProps: RuleSummaryProps = {
  sourceLabel: 'Service',
  targetLabel: 'GitHub team',
  sourceFieldExpression: 'spec.owner',
  targetFieldExpression: '',
  relationshipType: 'ownedBy',
  reciprocalRelationshipType: '',
  matchStrategy: 'exact',
  strategy: 'integration-backed',
  integrationName: 'GitHub',
};

// The request path renders as the integration name + path concatenated inside a
// single <code>, so match the <code> whose text contains the path fragment.
const pathCode = (fragment: string) => (_: string, el: Element | null) =>
  el?.tagName === 'CODE' && (el.textContent ?? '').includes(fragment);

describe('RuleSummary', () => {
  const placeholder = /Fill in the fields below/i;

  it('renders a summary for an integration-backed rule using a literal path', () => {
    render(
      <RuleSummary
        {...baseIntegrationProps}
        integrationConfig={{
          integrationId: 'gh-1',
          path: '/orgs/acme/teams',
          responseMatchExpression: 'slug',
        }}
      />,
    );

    expect(screen.queryByText(placeholder)).not.toBeInTheDocument();
    expect(screen.getByText(pathCode('/orgs/acme/teams'))).toBeInTheDocument();
  });

  it('renders a summary for an integration-backed rule that uses an advanced path expression instead of a literal path', () => {
    render(
      <RuleSummary
        {...baseIntegrationProps}
        integrationConfig={{
          integrationId: 'gh-1',
          path: '',
          pathExpression: '"/orgs/" & spec.org & "/teams"',
          responseMatchExpression: 'slug',
        }}
      />,
    );

    // Previously an empty `path` marked the rule incomplete even though the
    // editor accepts a path expression — it must now render a real summary.
    expect(screen.queryByText(placeholder)).not.toBeInTheDocument();
    expect(screen.getByText(pathCode('spec.org'))).toBeInTheDocument();
  });
});
