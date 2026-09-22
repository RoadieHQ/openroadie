import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from './code-block';

const relationshipRule = `export function matchWorkloadToRepo(
  workload: CatalogObject,
  repo: CatalogObject,
): boolean {
  const imageTag = workload.fields['spec.image.tag'];
  return repo.fields['latestCommitSha']?.startsWith(
    imageTag.replace('sha-', ''),
  );
}`;

const dataSourceConfig = `{
  "name": "aws-eks-clusters",
  "schedule": "*/30 * * * *",
  "integration": "aws",
  "extract": {
    "service": "eks",
    "operation": "ListClusters"
  }
}`;

/**
 * Shiki-highlighted code display for AI responses and catalog snippets. Use
 * it whenever the assistant returns code or structured config — it renders
 * plain text instantly and upgrades to highlighted tokens once loaded.
 */
const meta = {
  title: 'AiElements/CodeBlock',
  component: CodeBlock,
  parameters: { layout: 'padded' },
  args: {
    code: relationshipRule,
    language: 'typescript',
  },
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Line numbers help when discussing specific lines of a generated snippet. */
export const WithLineNumbers: Story = {
  args: {
    showLineNumbers: true,
  },
};

/**
 * Header with filename and copy action — use for downloadable/pasteable
 * artifacts like a data-source config, so users know where the code goes.
 */
export const WithHeader: Story = {
  args: {
    code: dataSourceConfig,
    language: 'json',
  },
  render: args => (
    <CodeBlock {...args}>
      <CodeBlockHeader>
        <CodeBlockTitle>
          <CodeBlockFilename>aws-eks-clusters.json</CodeBlockFilename>
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton onCopy={fn()} onError={fn()} />
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  ),
};
