export type InvitationEmailScope = 'project' | 'scan';

export interface InvitationEmailInput {
  scope: InvitationEmailScope;
  ownerDisplay: string;
  recipientEmail: string;
  entityName: string;
  invitationUrl: string;
  expiresInSeconds: number;
}

export interface InvitationEmailContent {
  subject: string;
  html: string;
  text: string;
}

const DAY_SECONDS = 24 * 60 * 60;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function inviteDays(expiresInSeconds: number): number {
  return Math.max(1, Math.ceil(expiresInSeconds / DAY_SECONDS));
}

function projectContent(input: InvitationEmailInput) {
  const owner = escapeHtml(input.ownerDisplay);
  const project = escapeHtml(input.entityName);
  const invitationUrl = escapeHtml(input.invitationUrl);

  return {
    subject: `${input.ownerDisplay} shared a Project with you: ${input.entityName}`,
    headline: "You're invited to view a Project!",
    body: `${owner} has invited you to view the project &quot;${project}&quot; on RoomScan. You will have full view access to all scans and notes inside this project.`,
    textBody: `${input.ownerDisplay} has invited you to view the project "${input.entityName}" on RoomScan. You will have full view access to all scans and notes inside this project.`,
    htmlMetadata: [
      ['Project', project],
      ['Owner', owner],
      ['Access', 'View only'],
    ],
    textMetadata: [
      ['Project', input.entityName],
      ['Owner', input.ownerDisplay],
      ['Access', 'View only'],
    ],
    ctaLabel: 'View Project Invitation',
    invitationUrl,
  };
}

function scanContent(input: InvitationEmailInput) {
  const owner = escapeHtml(input.ownerDisplay);
  const scan = escapeHtml(input.entityName);
  const invitationUrl = escapeHtml(input.invitationUrl);

  return {
    subject: `${input.ownerDisplay} shared a 3D Scan with you: ${input.entityName}`,
    headline: "You're invited to view a 3D Scan!",
    body: `${owner} has invited you to view the 3D scan &quot;${scan}&quot; on RoomScan. You will have view access to this scan and its attached notes.`,
    textBody: `${input.ownerDisplay} has invited you to view the 3D scan "${input.entityName}" on RoomScan. You will have view access to this scan and its attached notes.`,
    htmlMetadata: [
      ['Scan', scan],
      ['Owner', owner],
      ['Access', 'View only'],
    ],
    textMetadata: [
      ['Scan', input.entityName],
      ['Owner', input.ownerDisplay],
      ['Access', 'View only'],
    ],
    ctaLabel: 'View Scan Invitation',
    invitationUrl,
  };
}

export function buildInvitationEmail(input: InvitationEmailInput): InvitationEmailContent {
  if (input.scope !== 'project' && input.scope !== 'scan') {
    throw new Error(`Unsupported invitation email scope: ${String(input.scope)}`);
  }

  const content = input.scope === 'scan' ? scanContent(input) : projectContent(input);
  const days = inviteDays(input.expiresInSeconds);
  const footer = `This link will expire in ${days} day${days === 1 ? '' : 's'}. If you don't have the RoomScan app installed, you will be redirected to download it.`;
  const metadataRows = content.htmlMetadata
    .map(([label, value]) => `<tr><td><strong>${label}:</strong></td><td>${value}</td></tr>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f7; padding: 24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
            <tr>
              <td style="padding: 32px 40px;">
                <h1 style="margin: 0 0 16px 0; font-size: 24px; color: #1a1a2e;">${content.headline}</h1>
                <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.5; color: #333333;">Hi there,</p>
                <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.5; color: #333333;">${content.body}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f7; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
                  ${metadataRows}
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center">
                      <a href="${content.invitationUrl}" style="background-color: #0a84ff; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block;">${content.ctaLabel}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin: 24px 0 0 0; font-size: 12px; line-height: 1.5; color: #8a8a9a;">${escapeHtml(footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${content.headline}

Hi there,

${content.textBody}

${content.textMetadata.map(([label, value]) => `${label}: ${value}`).join('\n')}

${content.ctaLabel}: ${input.invitationUrl}

${footer}`;

  return { subject: content.subject, html, text };
}
