class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}
function requireRecord(snapshot, label) {
  if (!snapshot.exists)
    throw new ApiError(404, "NOT_FOUND", `${label} not found`);
  return snapshot.data();
}
module.exports = { ApiError, requireRecord };
