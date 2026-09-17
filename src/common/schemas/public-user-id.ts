import {
  PUBLIC_USER_ID_ALPHABET,
  PUBLIC_USER_ID_LENGTH,
  PUBLIC_USER_ID_PATTERN,
} from '../identifiers/public-user-id.js';
import { z } from '../../openapi/zod.js';

const CANONICAL_PATTERN = new RegExp(`^[${PUBLIC_USER_ID_ALPHABET}]{${PUBLIC_USER_ID_LENGTH}}$`);

/**
 * A public user id supplied by a client. Accepted in either case because users
 * retype ids by hand; the service normalizes it to the stored uppercase form.
 */
export const PublicUserIdInputSchema = z
  .string()
  .trim()
  .length(PUBLIC_USER_ID_LENGTH)
  .regex(PUBLIC_USER_ID_PATTERN, 'Public user id is malformed')
  .openapi({ example: 'GP5HS2WKBE' });

/**
 * A public user id as the API returns it. Always the canonical uppercase form,
 * so the published pattern must not suggest a client may receive lower case.
 */
export const PublicUserIdSchema = z
  .string()
  .length(PUBLIC_USER_ID_LENGTH)
  .regex(CANONICAL_PATTERN, 'Public user id is malformed')
  .openapi({ example: 'GP5HS2WKBE' });
