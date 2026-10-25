/**
 * Validates body + query + params together against a strict Zod schema.
 * Nothing from `req.body` reaches a handler unparsed.
 */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      const details = result.error.issues.slice(0, 6).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      return res.status(422).json({ error: "Please check the highlighted fields.", details });
    }

    req.valid = result.data;
    return next();
  };
}
