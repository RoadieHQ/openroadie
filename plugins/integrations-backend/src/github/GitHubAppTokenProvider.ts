export interface GitHubAppTokenProvider {
  getInstallationToken(
    appId: string,
    installationId: number,
    kmsKeyId: string,
    host?: string,
  ): Promise<string>;
  clearCache(installationId?: number): void;
}
