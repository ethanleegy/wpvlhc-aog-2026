const Joi = require("joi");
const { ApiError } = require("./errors");

const id = Joi.string().pattern(/^[A-Za-z0-9_-]{1,80}$/);
const token = Joi.string().pattern(/^[a-f0-9]{24}$/);
const text = (max) => Joi.string().trim().max(max);
const churchFields = { name: text(160), active: Joi.boolean() };
const foodFields = {
  name: text(160),
  unit: text(40),
  description: text(500).allow(""),
  active: Joi.boolean(),
};
const guestFields = {
  name: text(160),
  personalizedName: text(160).allow(""),
  churchId: id,
  active: Joi.boolean(),
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
  foodCreate: Joi.object({
    ...foodFields,
    name: foodFields.name.required(),
    unit: foodFields.unit.required(),
    description: foodFields.description.default(""),
    active: foodFields.active.default(true),
  }),
  foodPatch: Joi.object(foodFields).min(1),
  guestCreate: Joi.object({
    ...guestFields,
    name: guestFields.name.required(),
    churchId: id.required(),
    personalizedName: guestFields.personalizedName.default(""),
    active: guestFields.active.default(true),
  }),
  guestPatch: Joi.object(guestFields).min(1),
  registration: Joi.object({
    requestId: Joi.string()
      .pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      .required(),
    name: guestFields.name.required(),
    items: replyItems,
  }),
  reply: Joi.object({
    rsvp: Joi.string().valid("yes", "no").required(),
    items: replyItems,
  }).custom((value, helpers) =>
    value.rsvp === "no" && value.items.length
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
