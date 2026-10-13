import { badRequest } from '../utils/errors.js';

/** Validates req.body / req.query / req.params with zod schemas and replaces them with parsed values. */
export const validate = (schemas) => (req, _res, next) => {
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return next(badRequest(`Invalid ${part}`, details));
    }
    req[part] = result.data;
  }
  return next();
};
