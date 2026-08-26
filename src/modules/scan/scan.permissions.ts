import { AccessPermissionService } from '../../common/permissions/access-permission-service.js';
import { ScanNotFoundError } from './scan.errors.js';
import type { ScanRepository, ScanRole } from './scan.types.js';

export class ScanPermissionService {
  readonly #base: AccessPermissionService<ScanRole>;

  constructor(repository: ScanRepository) {
    this.#base = new AccessPermissionService(repository, () => new ScanNotFoundError(), 'OWNER');
  }

  requireView(scanId: string, userId: string): Promise<ScanRole> {
    return this.#base.requireView(scanId, userId);
  }
}
