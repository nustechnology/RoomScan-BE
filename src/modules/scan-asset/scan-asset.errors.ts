export class ScanAssetNotFoundError extends Error {
  constructor() {
    super('Asset was not found');
    this.name = 'ScanAssetNotFoundError';
  }
}

export class AssetNotReadyError extends Error {
  constructor() {
    super('Asset has not been uploaded yet');
    this.name = 'AssetNotReadyError';
  }
}

export class UploadSessionExpiredError extends Error {
  constructor() {
    super('Upload session has expired');
    this.name = 'UploadSessionExpiredError';
  }
}

export class AssetUploadFailedError extends Error {
  constructor() {
    super('Asset upload could not be verified');
    this.name = 'AssetUploadFailedError';
  }
}

export class StorageUnavailableError extends Error {
  constructor() {
    super('Storage provider is unavailable');
    this.name = 'StorageUnavailableError';
  }
}

export class InvalidAssetRequestError extends Error {
  constructor() {
    super('Asset metadata is invalid');
    this.name = 'InvalidAssetRequestError';
  }
}

export class ModelAlreadyCompletedError extends Error {
  constructor() {
    super('Completed scan model cannot be overwritten');
    this.name = 'ModelAlreadyCompletedError';
  }
}
