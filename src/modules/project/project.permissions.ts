import { AccessPermissionService } from '../../common/permissions/access-permission-service.js';
import { ProjectNotFoundError } from './project.errors.js';
import type { ProjectRepository, ProjectRole } from './project.types.js';

export class ProjectPermissionService {
  readonly #base: AccessPermissionService<ProjectRole>;

  constructor(repository: ProjectRepository) {
    this.#base = new AccessPermissionService(repository, () => new ProjectNotFoundError(), 'OWNER');
  }

  requireView(projectId: string, userId: string): Promise<ProjectRole> {
    return this.#base.requireView(projectId, userId);
  }

  requireOwner(projectId: string, userId: string): Promise<void> {
    return this.#base.requireOwner(projectId, userId);
  }
}
