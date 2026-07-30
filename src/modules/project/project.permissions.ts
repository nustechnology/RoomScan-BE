import { ProjectNotFoundError } from './project.errors.js';
import type { ProjectRepository, ProjectRole } from './project.types.js';

export class ProjectPermissionService {
  readonly #repository: ProjectRepository;

  constructor(repository: ProjectRepository) {
    this.#repository = repository;
  }

  async requireView(projectId: string, userId: string): Promise<ProjectRole> {
    const role = await this.#repository.findAccessRole(projectId, userId);

    if (role === null) {
      throw new ProjectNotFoundError();
    }

    return role;
  }

  async requireOwner(projectId: string, userId: string): Promise<void> {
    const role = await this.requireView(projectId, userId);

    if (role !== 'OWNER') {
      throw new ProjectNotFoundError();
    }
  }
}
