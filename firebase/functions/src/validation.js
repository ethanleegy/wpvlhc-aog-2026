const Joi = require("joi");
const { ApiError } = require("./errors");

const id = Joi.string().pattern(/^[A-Za-z0-9_-]{1,80}$/);
const token = Joi.string().pattern(/^[a-f0-9]{24}$/);
const requestId = Joi.string().pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const text = (max) => Joi.string().trim().max(max);
const churchFields = { name: text(160), active: Joi.boolean() };
const foodFields = {
  name: text(160),
  unit: text(40),
  description: text(500).allow(""),
  active: Joi.boolean(),
};
const foodCreate = Joi.object({
  ...foodFields,
  name: foodFields.name.required(),
  unit: foodFields.unit.required(),
  description: foodFields.description.default(""),
  active: foodFields.active.default(true),
});
const plusOneFields = {
  plusOne: Joi.boolean(),
  plusOneName: Joi.when("plusOne", {
    is: true,
    then: text(160).required(),
    otherwise: Joi.string().valid(""),
  }),
};
// Updates omit both fields to preserve the saved companion; no defaults here.
function checkPlusOne(value, helpers) {
  return value.plusOne === undefined && value.plusOneName !== undefined
    ? helpers.error("any.invalid")
    : value;
}
const guestFields = {
  name: text(160),
  personalizedName: text(160).allow(""),
  churchId: id,
  active: Joi.boolean(),
  ...plusOneFields,
};
const replyItems = Joi.array()
  .max(30)
  .unique("foodItemId")
  .items(
    Joi.object({
      foodItemId: id.required(),
      quantity: Joi.number().integer().min(1).max(10000).required(),
      notes: text(500).allow("").default(""),
    }),
  )
  .required();
const schemas = {
  token: Joi.object({ token: token.required() }),
  id: Joi.object({ id: id.required() }),
  guestId: Joi.object({ id: token.required() }),
  login: Joi.object({
    username: text(120).required(),
    password: Joi.string().max(72, "utf8").required(),
  }),
  churchCreate: Joi.object({
    ...churchFields,
    name: churchFields.name.required(),
    active: churchFields.active.default(true),
  }),
  churchPatch: Joi.object(churchFields).min(1),
  foodCreate,
  foodPatch: Joi.object(foodFields).min(1),
  foodImport: Joi.object({ requestId: requestId.required(), items: Joi.array().items(foodCreate).min(1).max(10).required() }),
  foodDelete: Joi.object({ confirmation: Joi.string().valid("delete") }),
  foodBulkDelete: Joi.object({ ids: Joi.array().items(id.required()).unique().min(1).max(50).required(), confirmation: Joi.string().valid("delete") }),
  guestDelete: Joi.object({ confirmation: Joi.string().valid("delete") }),
  guestBulkDelete: Joi.object({ ids: Joi.array().items(token.required()).unique().min(1).max(50).required(), confirmation: Joi.string().valid("delete") }),
  guestCreate: Joi.object({
    ...guestFields,
    name: guestFields.name.required(),
    churchId: id.required(),
    personalizedName: guestFields.personalizedName.default(""),
    active: guestFields.active.default(true),
  }).custom(checkPlusOne),
  guestPatch: Joi.object(guestFields).min(1).custom(checkPlusOne),
  registration: Joi.object({
    requestId: requestId.required(),
    name: guestFields.name.required(),
    ...plusOneFields,
    items: replyItems,
  }).custom(checkPlusOne),
  reply: Joi.object({
    rsvp: Joi.string().valid("yes", "no").required(),
    ...plusOneFields,
    items: replyItems,
  }).custom(checkPlusOne).custom((value, helpers) =>
    value.rsvp === "no" && (value.items.length || value.plusOne === true)
      ? helpers.error("any.invalid")
      : value,
  ),
  list: Joi.object({
    churchId: id,
    rsvp: Joi.string().valid("yes", "no", "pending"),
    limit: Joi.number().integer().min(1).max(100).default(50),
    after: token,
  }),
  report: Joi.object({ churchId: id }),
  empty: Joi.object({}),
};
function validate(schema, value, convert = false) {
  const result = schema
    .required()
    .validate(value, { abortEarly: false, allowUnknown: false, convert });
  if (result.error)
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Please check the request fields",
      result.error.details.map((item) => ({
        field: item.path.join("."),
        message: item.message,
      })),
    );
  return result.value;
}
function input(schema, source = "body") {
  return (req, res, next) => {
    try {
      res.locals[source] = validate(schema, req[source], source === "query");
      next();
    } catch (error) {
      next(error);
    }
  };
}
module.exports = { schemas, validate, input };
