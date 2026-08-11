import { describe, expect, it } from 'vitest';

import { buildInvitationEmail } from '../src/modules/share/share.email.js';
import type { InvitationEmailScope } from '../src/modules/share/share.email.js';

const DAY_SECONDS = 24 * 60 * 60;

const baseInput = {
  scope: 'project' as const,
  ownerDisplay: 'owner@example.com',
  recipientEmail: 'recipient@example.com',
  entityName: 'District 2 Apartment',
  invitationUrl: 'https://invite.roomscan.dev/invitations/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab',
  expiresInSeconds: 7 * DAY_SECONDS,
};

describe('buildInvitationEmail', () => {
  it('builds a project-scope invitation email', () => {
    const email = buildInvitationEmail(baseInput);

    expect(email.subject).toBe('owner@example.com shared a Project with you: District 2 Apartment');
    expect(email.html).toContain("You're invited to view a Project!");
    expect(email.html).toContain('Hi there,');
    expect(email.html).toContain('View Project Invitation');
    expect(email.html).toContain(baseInput.invitationUrl);
    expect(email.html).toContain('District 2 Apartment');
    expect(email.html).toContain('Access:</strong>');
    expect(email.html).toContain('View only');
    expect(email.html).toContain('This link will expire in 7 days');
    expect(email.text).toContain('View Project Invitation:');
    expect(email.text).toContain('Project: District 2 Apartment');
    expect(email.text).toContain('Access: View only');
  });

  it('uses a singular day label for a one-day expiry', () => {
    const email = buildInvitationEmail({ ...baseInput, expiresInSeconds: DAY_SECONDS });

    expect(email.html).toContain('This link will expire in 1 day');
  });

  it('escapes HTML in dynamic values', () => {
    const email = buildInvitationEmail({
      ...baseInput,
      entityName: '<script>alert(1)</script>',
      ownerDisplay: 'A&B <Owner>',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('A&amp;B &lt;Owner&gt;');
  });

  it('rejects unsupported scopes', () => {
    expect(() =>
      buildInvitationEmail({ ...baseInput, scope: 'scan' as InvitationEmailScope }),
    ).toThrow();
  });
});
