import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DepartmentService } from '../../services/department.service';

/**
 * A 422 in the shape the shared widget reads: `{ message, errors: { field: [msg] } }`.
 */
export function widgetValidationError(
  field: string,
  message: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({ message, errors: { [field]: [message] } });
}

/**
 * Resolve the department a widget visitor picked. Empty means none; anything
 * else must be an active department, so a visitor cannot route work into a
 * department the widget does not offer.
 */
export async function widgetDepartmentId(
  departments: DepartmentService,
  value: unknown,
): Promise<number | undefined> {
  if (value === undefined || value === null || value === '') return undefined;

  const id = typeof value === 'number' ? value : Number(value);
  const department =
    Number.isInteger(id) && id > 0
      ? await departments.findById(id).catch((error) => {
          if (error instanceof NotFoundException) return null;
          throw error;
        })
      : null;
  if (!department || department.isActive === false) {
    throw widgetValidationError('department_id', 'The selected department is invalid.');
  }
  return department.id;
}
