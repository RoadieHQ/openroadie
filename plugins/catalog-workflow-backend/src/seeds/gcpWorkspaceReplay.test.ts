/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  loadSeeds,
  probeFixtureAccess,
  runReplayCases,
  seedByName,
} from './replayHarness.test-utils';

// Throwaway keypair generated for this test; the mock never verifies the JWT
// assertion, but signing requires a structurally valid RSA key.
const THROWAWAY_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDQJlGXx07UkV0G
QCfAO9JSmayP60/0DpXyxdtonhyFi7eR2t422gDR44IcNheUJuAgnZz9ROtp4T1e
s7r3cq9SsyYIj7T0NzXlMNBfkFnDe3hDQfC0S/jPLVsyQaa3cQPOSxqF62tCE61Y
/Do2m+8woVbwsbxGgxVfgcgISaJn0VJgWqEq5P5yJ3LdOhd++GvgG6JYfE4lRndg
Hr9oHNpB+KBm9II1CC3YFmnlhXGHZzssFXD5qa14V+UtHiYHGOO569BY/NgPqM2k
OlrVvHzLwPen+ZAriQLN3I8ufWr6UnEmFJkvnLr0QudZwObVZ7fqsL/UvDdfmQQE
p4X4gGJXAgMBAAECggEADn2kb4caF1VZXw6HVew0O7jkGQ7ePZToXoLkv/dF8Awm
hvpwPuxVY0dN7w3a/V7peovOeplaNEBQh+/GQ+TRjNXY/36Vr+zKDT8lOonvndrS
KAiGq96gHzg+oZSNeTbed3WmDo2xpWN+TXQdz2ByufV5en89JsGIcuIznVQXANgj
BAYODqrtfjsPacyhrflOiwp/4OjnyJNxnunYeSmenaIQVNXgrRJdO1bUC6axKc2A
0V7AbkDaAcMNNi5Hbwp4xFxGXMg4drfDOvRM9ELX0wEYRaC57yPgAbwRMSCbZV58
jJ/w2z3Sv9bH5kghTIX7F04lJwvc4/F/d8CwxU8+7QKBgQD4fcOGamOdz0RyiTdP
WyBcaiAIR4LO7o+Qyq1iOpbR/GTvoxHH+7JApkaEmIcgNPoTrDfIc5nBY2QzKyjW
pIJUVqDxzFw3eR/UTNoIjYkojDApIJC9lLBSlkLoFRzWX+CM1YuqX2djlxuWmsKN
bINJtoIK52BpCni0BUpSlFUqowKBgQDWcHzI2PhSH4DNKgKkiFZHKH46vb+GXmY0
P1g0hqX/yPm6Tzja4fFVRDZxRGxjFLl8EFDrJ04pQ1K/GKCFpzcoEkvBLDn9M0rk
Qo7QN29jvjzSwLKMESXjC9vPX/lzIqEkBVIPCb0ZU1xaiJ8nocWQVJm899mp0OkF
f3s/AYb4vQKBgQC1QC6tTc7JnhSEIthINuTc47/nqhmczN/FMkDTxH6cPih1rxFa
OJolk+Md9o+hi2LZlKW/vapqKBA/TnzkS2yRDfspQ/IDuILh/QiQcoSYIeFDLnDF
B76xDs9Qr42wRJDqyRytshccymyiJtJAC+Wbj9c9EtX86Flwnec/YtjYVwKBgC5I
bxZmhgorlIAznghnCMApBD2ncKwOud5zAZWsri1r8kJ9ENdlRtJRe7KswvwLoBEf
8Gcgv6T2S+jE5viR47y5XjJeWlHE/VgQ6YQVQuxzRety/dZvaQ79Iz86BrwL8F22
7EQkpPTPYjKEJF3Ic7y4FcqMcCVP2st9/VrW+Iu9AoGAMu9MG7iU2mxCg++Fan/M
CY5aApiFDvM0flwAd6CL7+3wiJOeUme5N0X5t4gWugIkVpmoOhp32nE99f+943Vv
/UWL+gZQkox4+7lyCW/FEdPRWsQzXm88LU91h1J8Sa0e6fzuzdt2px7+YCy+PnIa
aNUCKI16TfdXc6mJ9chE7KI=
-----END PRIVATE KEY-----`;

const seeds = loadSeeds('gcp-workspace');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from a real single-admin Workspace: counts only.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-gcp-workspace',
    slug: 'gcp-workspace',
    name: 'Google Workspace',
    type: 'infrastructure',
    authType: 'oauth2-jwt-bearer',
    authConfig: mockBaseUrl => ({
      issuer: '${GCP_CLIENT_EMAIL}',
      privateKey: '${GCP_PRIVATE_KEY}',
      subject: '${GCP_WORKSPACE_ADMIN_EMAIL}',
      tokenUrl: `${mockBaseUrl}/token`,
      scope: 'https://www.googleapis.com/auth/admin.directory.user.readonly',
    }),
  },
  secrets: {
    GCP_CLIENT_EMAIL: 'replay@example.iam.gserviceaccount.com',
    GCP_PRIVATE_KEY: THROWAWAY_PRIVATE_KEY,
    GCP_WORKSPACE_ADMIN_EMAIL: 'admin@example.com',
  },
  cases: [
    {
      seed: seedByName(seeds, 'Google Workspace users'),
      expectedCount: 2,
    },
    {
      seed: seedByName(seeds, 'Google Workspace groups'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Google Workspace group members (per group)'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Google Workspace organizational units'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Google Workspace domains'),
      expectedCount: 1,
    },
  ],
});
