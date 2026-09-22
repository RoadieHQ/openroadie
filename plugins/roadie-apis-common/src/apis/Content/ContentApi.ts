export type GetContentResponse = {
  content: string;
  media: Record<string, string>;
  links: Record<string, string>;
};

export interface ContentApi {
  getContent(
    contentPath: string,
    basePath?: string,
    forceUpdate?: boolean,
  ): Promise<GetContentResponse>;
}
