export class InvitationNotFoundError extends Error {
  constructor() {
    super('Invitation was not found');
    this.name = 'InvitationNotFoundError';
  }
}

export class InvitationAlreadySentError extends Error {
  constructor() {
    super('An invitation has already been sent to this email');
    this.name = 'InvitationAlreadySentError';
  }
}

export class InvitationAlreadyAcceptedError extends Error {
  constructor() {
    super('Invitation has already been accepted');
    this.name = 'InvitationAlreadyAcceptedError';
  }
}

export class ViewerAccessNotFoundError extends Error {
  constructor() {
    super('Viewer access was not found');
    this.name = 'ViewerAccessNotFoundError';
  }
}

export class InvitationExpiredError extends Error {
  constructor() {
    super('Invitation has expired');
    this.name = 'InvitationExpiredError';
  }
}

export class InvitationRevokedError extends Error {
  constructor() {
    super('Invitation has been revoked');
    this.name = 'InvitationRevokedError';
  }
}

export class InvitationDeclinedError extends Error {
  constructor() {
    super('Invitation has already been declined');
    this.name = 'InvitationDeclinedError';
  }
}

export class InvitationNotForUserError extends Error {
  constructor() {
    super('This invitation is not for the current user');
    this.name = 'InvitationNotForUserError';
  }
}

export class AccessAlreadyExistsError extends Error {
  constructor() {
    super('The user already has access to this project');
    this.name = 'AccessAlreadyExistsError';
  }
}

export class CannotAcceptOwnInvitationError extends Error {
  constructor() {
    super('The project owner cannot accept their own invitation');
    this.name = 'CannotAcceptOwnInvitationError';
  }
}

export class ProjectNotShareableError extends Error {
  constructor() {
    super('Project is not ready to be shared');
    this.name = 'ProjectNotShareableError';
  }
}

export class ScanNotShareableError extends Error {
  constructor() {
    super('Scan is not ready to be shared');
    this.name = 'ScanNotShareableError';
  }
}

export class ShareNoLongerAvailableError extends Error {
  constructor() {
    super('This project/scan is no longer available.');
    this.name = 'ShareNoLongerAvailableError';
  }
}

export class ShareLinkNotFoundError extends Error {
  constructor() {
    super('Share link was not found');
    this.name = 'ShareLinkNotFoundError';
  }
}

export class ShareLinkExpiredError extends Error {
  constructor() {
    super('Share link has expired');
    this.name = 'ShareLinkExpiredError';
  }
}

export class NotOwnerError extends Error {
  constructor() {
    super('Only the project owner can manage sharing');
    this.name = 'NotOwnerError';
  }
}

export class RecipientUserNotFoundError extends Error {
  constructor() {
    super('No user matches this user ID');
    this.name = 'RecipientUserNotFoundError';
  }
}

export class CannotInviteSelfError extends Error {
  constructor() {
    super('The resource owner cannot invite themselves');
    this.name = 'CannotInviteSelfError';
  }
}
