import { DiscoveryApi, ErrorApi, FetchApi } from '@roadiehq/core-plugin-api';
import parseGitUrl from 'git-url-parse';
import { ContentApi } from './ContentApi';

type ContentResponse = {
  content?: string;
  resolvedPath: string;
};

type MediaContentResponse = {
  content: string;
};

const mimeTypeMap: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const mimeTypeLookup = (href: string): string | undefined => {
  const match = href.match(/\.([a-zA-Z]*)$/);
  const extension = match ? match[1] : undefined;
  return extension ? mimeTypeMap[extension.toLowerCase()] : undefined;
};

export class ContentClient implements ContentApi {
  private readonly errorApi: ErrorApi;
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(deps: {
    discoveryApi: DiscoveryApi;
    errorApi: ErrorApi;
    fetchApi: FetchApi;
  }) {
    this.errorApi = deps.errorApi;
    this.discoveryApi = deps.discoveryApi;
    this.fetchApi = deps.fetchApi;
  }

  async getContent(
    contentPath: string,
    basePath?: string,
    forceUpdate?: boolean,
  ): Promise<{
    content: string;
    media: Record<string, string>;
    links: Record<string, string>;
  }> {
    const contentUrl = await this.discoveryApi.getBaseUrl('content');
    const response = await this.fetchApi.fetch(`${contentUrl}/`, {
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({ location: contentPath, forceUpdate, basePath }),
    });
    const responseBody = (await response.json()) as ContentResponse;
    const content = responseBody.content;
    const resolvedPath = responseBody.resolvedPath;
    const { name: repo, owner, ref: branch } = parseGitUrl(resolvedPath);

    if (!content) {
      return {
        content: 'Failed to retrieve content from integration',
        media: {},
        links: {},
      };
    }

    const mediaLinks = [
      ...content.matchAll(
        /\[([^[\]]*)\]\((.*?)(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg)(.*)\)/gim,
      ),
    ].map(match => [match[2], match[3]].join(''));

    const media: Record<string, string> = {};

    for (const href of mediaLinks) {
      const mimeType = mimeTypeLookup(href);
      const url = new URL(href, response.url);

      if (mimeType && url.host.includes('github.com')) {
        const requestPath = url.pathname.replace(
          // eslint-disable-next-line security/detect-non-literal-regexp
          new RegExp(`/${owner}/${repo}/blob/${branch}`),
          `/repos/${owner}/${repo}/contents`,
        );
        try {
          const contentResponse = await this.fetchApi.fetch(
            `${contentUrl}/?location=${requestPath}`,
          );
          const contentResponseBody =
            (await contentResponse.json()) as MediaContentResponse;
          media[href] =
            `data:${mimeType};base64,${contentResponseBody.content.replaceAll(
              '\n',
              '',
            )}`;
        } catch (e: unknown) {
          this.errorApi.post(e instanceof Error ? e : new Error(String(e)));
        }
      }
    }

    const markdownLinks = [
      ...content.matchAll(/\[([^[\]]*)\]\((?!https?:\/\/)(.*?)(\.md)\)/gim),
    ].map(match => [match[2], match[3]].join(''));
    const links: Record<string, string> = {};
    for (const markdownLink of markdownLinks) {
      links[markdownLink] =
        `https://github.com/${owner}/${repo}/blob/${branch}/${markdownLink}`;
    }
    return { content, media, links };
  }
}
