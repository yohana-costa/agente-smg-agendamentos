function createAppError(message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

const badRequest = (message, details) => createAppError(message, 400, details);
const notFound = (message = "Registro nao encontrado.") => createAppError(message, 404);
const forbidden = (message = "Acesso negado.") => createAppError(message, 403);
const conflict = (message, details) => createAppError(message, 409, details);

module.exports = { createAppError, badRequest, notFound, forbidden, conflict };
