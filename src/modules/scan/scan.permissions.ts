import { ScanNotFoundError } from './scan.errors.js';
import type { ScanRepository, ScanRole } from './scan.types.js';

export class ScanPermissionService {
  readonly #repository: ScanRepository;

  constructor(repository: ScanRepository) {
    this.#repository = repository;
  }

  async requireView(scanId: string, userId: string): Promise<ScanRole> {
    const role = await this.#repository.findAccessRole(scanId, userId);

    if (role === null) {
      throw new ScanNotFoundError();
    }

    return role;
  }
}
