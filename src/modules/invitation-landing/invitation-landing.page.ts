import { INVITATION_APP_URL_SCHEME } from '../../config/constants.js';

export type InvitationLandingScope = 'project' | 'scan';

export interface InvitationLandingPageInput {
  token: string;
  scope: InvitationLandingScope | null;
  invitationBaseUrl: string;
  appleAppStoreId: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

export function buildInvitationLandingPage({
  token,
  scope,
  invitationBaseUrl,
  appleAppStoreId,
}: InvitationLandingPageInput): string {
  const scopeQuery = scope === null ? '' : `?scope=${scope}`;
  const universalLink = `${invitationBaseUrl}/invitations/${token}${scopeQuery}`;
  const appUrl = `${INVITATION_APP_URL_SCHEME}://invitations/${token}${scopeQuery}`;
  const smartAppBanner =
    appleAppStoreId === ''
      ? ''
      : `    <meta name="apple-itunes-app" content="app-id=${appleAppStoreId}, app-argument=${escapeHtml(universalLink)}" />\n`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>RoomScan invitation</title>
${smartAppBanner}    <style>
      :root {
        color-scheme: light dark;
      }

      * {
        box-sizing: border-box;
      }

      body {
        align-items: center;
        background: #f5f5f7;
        color: #1d1d1f;
        display: flex;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
        padding: 24px;
      }

      .card {
        background: #ffffff;
        border-radius: 16px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
        max-width: 360px;
        padding: 32px 24px;
        text-align: center;
        width: 100%;
      }

      .eyebrow {
        color: #6e6e73;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.04em;
        margin: 0 0 8px;
        text-transform: uppercase;
      }

      h1 {
        font-size: 20px;
        font-weight: 600;
        line-height: 1.35;
        margin: 0 0 24px;
      }

      .open {
        background: #0071e3;
        border-radius: 12px;
        color: #ffffff;
        display: inline-block;
        font-size: 17px;
        font-weight: 600;
        padding: 14px 20px;
        text-decoration: none;
        width: 100%;
      }

      .open:active {
        background: #0060c0;
      }

      @media (prefers-color-scheme: dark) {
        body {
          background: #000000;
          color: #f5f5f7;
        }

        .card {
          background: #1c1c1e;
          box-shadow: none;
        }

        .eyebrow {
          color: #98989d;
        }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <p class="eyebrow">RoomScan invitation</p>
      <h1>Open app to accept the invitation</h1>
      <a class="open" href="${escapeHtml(appUrl)}">Open</a>
    </main>
  </body>
</html>
`;
}
