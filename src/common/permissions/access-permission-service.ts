export interface AccessRoleRepository<TRole extends string> {
  findAccessRole(resourceId: string, userId: string): Promise<TRole | null>;
}

/**
 * Missing, deleted, revoked, and inaccessible resources intentionally collapse
 * to the same not-found error to avoid existence disclosure — do not change
 * this for callers of requireView/requireOwner.
 */
export class AccessPermissionService<TRole extends string> {
  readonly #repository: AccessRoleRepository<TRole>;
  readonly #notFound: () => Error;
  readonly #ownerRole: TRole;

  constructor(repository: AccessRoleRepository<TRole>, notFound: () => Error, ownerRole: TRole) {
    this.#repository = repository;
    this.#notFound = notFound;
    this.#ownerRole = ownerRole;
  }

  async requireView(resourceId: string, userId: string): Promise<TRole> {
    const role = await this.#repository.findAccessRole(resourceId, userId);

    if (role === null) {
      throw this.#notFound();
    }

    return role;
  }

  async requireOwner(resourceId: string, userId: string): Promise<void> {
    const role = await this.requireView(resourceId, userId);

    if (role !== this.#ownerRole) {
      throw this.#notFound();
    }
  }
}
