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

// Throwaway keypair generated for this test; the mock server never verifies
// the JWT assertion, but signing requires a structurally valid RSA key.
const THROWAWAY_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDC1NECt59ToVkI
guaxOHvkF/EIOh/1WClRstzHQGhzzqM0yorCMWLj5pMHm7QURDMX1Ytvw0xraajz
GcUBLkmCjd/+WD/sZIAqwYvawOA8OO/qk7HD/H/hLGFsoYjZd0n61u8BKK03xlQZ
rzl9NSRW+VWHbR2hl3gudYb3so15lRTKV85A2UeZwfcFUIhR/WJ6NDomS5FWOKP/
CUlHFDh4UdZJpxWuek9ZPPKUIel8NS79C3E1kT+0/eL8Im6BrLS8TAhHUUMlN5Iq
ODPq5T6o4CuUfra1opOv+NwFewGMGfxsgBKKvRibrc8M5c7KwKby2ZVXn98sW+UP
3wCLyM0zAgMBAAECggEAXDvmtMwcA7nrDdH2h2hvklRZOaVWss3pRbGQvk06BbUJ
43iNRxCdObnS2jO2hS+iJoLkL2U7/M+4+Vk2P/BbQZCLvXumy3DqkhMtc8KChVAJ
GDqSWe9j1MQvXP9960GDRtpQrHJGypQ8BSrEYwdw7DG+cU3RTMoJzai62/Ft82Ow
aK1xDcF/Cfo4LozwgfTjGqlYX6GlE1ZL9Jjva70Z/KohOtWj5p2EgYqXOStE0iS4
35zeVaUVt2QcE88iZgsiFTPXFDLxPoFLgKkHkTR7y73qYTnYDXcHEvg78sNtBbxE
eml5y1hKvbLnTxcqBPhVEJEPcg7NQJ+D4unqCeTWVQKBgQD/VujowjLdYXbOLROq
mCiIzgnPASUk5c1OAZ8inRHb2yhEYFEVKTwSQ/oMsNNz7sxN6atqg7474woaCUsG
T4SkiHLUcrZK9eIWUPK0Ds0G2YDbhQrAeeEsPWcVTGrVJSD7trldF5yiqweD7Epz
9hrW6pBcXX9NKZWgVCmvr5+4tQKBgQDDVdZLoawUxAj7pWWB3pI1Vec0Dj+fDGoz
+67LEtAJDh8UT5IB68yFyvY+3hd8MgSnqRi+ac/aCS3065py8RYvlFGiwqVx52+j
6LamxmOiegC7QXMiaY7C9VZWv7xBbvQRFl20mOE6/0LrTRw/QgYTa9+wSiAdLXCL
v5mzAJUnRwKBgQDbLv6VtwY0tRJn35fvK9g3vy36TRBWgRFgcdHpw4zt/k2tjERt
9syDHWkK9cs9zHICO6CSuW5WOAmW2f1V+HJzTlHL/oBvDmy6HViJqd7jj1emmKjn
GnhpInhXdxaJyupqSKsLt1YU6N11qCMtMchOTmIHd5bsZNL1Iun5zrc7tQKBgDDP
7Woe73qM9lW0IiaO8OhlHA6VFO7w0kVFOovCmrv4jGmt7KWQQB6a9mgFZccCVMl0
5xsGJAuvSY2vpnvcpRekr7XFgERzeiFykNoiL1m1tSMWGuhZinRLjJTG+ws658Cx
Xx83KOluSlG0hj+EhzIpPc+25kmERmCVs5nYpm0XAoGBAIjqwK/sPzn7V1dhXIB8
qrY8hzY6nLM2Lnpyxu3x7bwX78ro3g319M1hkIxBsbvFpHMRgxlIUyt7bLmCNCUn
cWSn2FOKKQP5FMCrfRJFPYFADEuoLDkelu3LsTrVm9urmqCvw7OvKvFqxfQ3aBtP
VBI4s4gF6m82oAMHXPelyPVc
-----END PRIVATE KEY-----`;

const seeds = loadSeeds('gcp-resources');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from an account with an organization: 2 folders and a
// tag key chained off organizations:search.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-gcp-resources',
    slug: 'gcp-resources',
    name: 'GCP Resources',
    type: 'infrastructure',
    authType: 'oauth2-jwt-bearer',
    authConfig: mockBaseUrl => ({
      issuer: '${GCP_CLIENT_EMAIL}',
      privateKey: '${GCP_PRIVATE_KEY}',
      tokenUrl: `${mockBaseUrl}/token`,
      scope: 'https://www.googleapis.com/auth/cloud-platform.read-only',
    }),
  },
  secrets: {
    GCP_CLIENT_EMAIL: 'replay@example.iam.gserviceaccount.com',
    GCP_PRIVATE_KEY: THROWAWAY_PRIVATE_KEY,
  },
  cases: [
    {
      seed: seedByName(seeds, 'GCP organizations'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'GCP folders'),
      expectedCount: 2,
    },
    {
      seed: seedByName(seeds, 'GCP projects'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'GCP tag keys (per organization)'),
      expectedCount: 1,
    },
  ],
});
