// Christmas Social 2026 menu: two contribution slots per item, except five for water.
// Each quantity is measured in the stated unit; repeated names are separate slots.
const menu = [
  { name: "Baked fish in cheese sauce", unit: "trays", description: "Tray of baked fish topped with cheese sauce, ready to serve." },
  { name: "Fried fish", unit: "trays", description: "Tray of fried fish, prepared and ready to serve." },
  { name: "Jerk pork", unit: "trays", description: "Tray of cooked jerk pork, sliced into serving portions." },
  { name: "Sweet and sour chicken", unit: "trays", description: "Tray of sweet and sour chicken with sauce, ready to serve." },
  { name: "Roast pork", unit: "trays", description: "Tray of roast pork, cooked and sliced for serving." },
  { name: "Ham", unit: "trays", description: "Tray of cooked ham, sliced and ready to serve." },
  { name: "Mince balls", unit: "trays", description: "Tray of cooked mince balls, arranged and ready to serve." },
  { name: "Meatloaf", unit: "trays", description: "Tray of cooked meatloaf, sliced into serving portions." },
  { name: "Fried rice", unit: "gallon", description: "Gallon of fried rice, prepared and ready to serve." },
  { name: "Festive rice", unit: "gallon", description: "Gallon of festive rice, prepared and ready to serve." },
  { name: "Vegetable rice", unit: "gallon", description: "Gallon of vegetable rice, prepared and ready to serve." },
  { name: "Peas and rice", unit: "gallon", description: "Gallon of peas and rice, prepared and ready to serve." },
  { name: "Vegetable chow mein", unit: "gallon", description: "Gallon of vegetable chow mein, prepared and ready to serve." },
  { name: "Potato salad", unit: "gallon", description: "Gallon of potato salad, prepared in a covered serving container." },
  { name: "Macaroni salad", unit: "gallon", description: "Gallon of macaroni salad, prepared in a covered serving container." },
  { name: "Macaroni and cheese", unit: "trays", description: "Tray of baked macaroni and cheese, ready to portion and serve." },
  { name: "Scalloped potatoes", unit: "trays", description: "Tray of baked scalloped potatoes, ready to portion and serve." },
  { name: "Sweet potato salad", unit: "gallon", description: "Gallon of sweet potato salad, prepared in a covered serving container." },
  { name: "Vegetable salad", unit: "gallon", description: "Gallon of prepared vegetable salad; bring any dressing separately." },
  { name: "Steamed vegetables", unit: "trays", description: "Tray of steamed vegetables, prepared and ready to serve." },
  { name: "Stir-fried vegetables", unit: "trays", description: "Tray of stir-fried vegetables, prepared and ready to serve." },
  { name: "Vegetable soup", unit: "gallon", description: "Gallon of vegetable soup in a covered container suitable for serving." },
  { name: "Soup", unit: "gallon", description: "Gallon of prepared soup. Specify the type of soup in your contribution notes." },
  { name: "Ital soup", unit: "gallon", description: "Gallon of Ital soup, prepared and ready to serve." },
  { name: "Sponge cake", unit: "cakes", description: "Whole sponge cake, ready to slice and serve." },
  { name: "Ice cream", unit: "tubs", description: "Tub of ice cream. Specify the flavour and tub size in your contribution notes." },
  { name: "Cheese straws", unit: "dozen", description: "Dozen cheese straws, baked and ready to serve." },
  { name: "Stuffed eggs", unit: "dozen", description: "Dozen stuffed egg halves, prepared and arranged for serving." },
  { name: "Mini pineapple tarts", unit: "dozen", description: "Dozen mini pineapple tarts, baked and ready to serve." },
  { name: "Sweets", unit: "packs", description: "Pack of individually wrapped sweets. Specify the pack size in your contribution notes." },
  { name: "Nuts", unit: "packs", description: "Pack of nuts for sharing. Specify the type and pack size in your contribution notes." },
  { name: "Sanitary cups", unit: "packs", description: "Pack of disposable drinking cups. Specify the cup size and number per pack in your notes." },
  { name: "Sanitary wares", unit: "packs", description: "Pack of disposable plates, cutlery or napkins. Specify the supplies and pack sizes in your notes." },
  { name: "Curry chicken breast", unit: "gallon", description: "Gallon of curry chicken breast with sauce, prepared and ready to serve." },
  { name: "Roti", unit: "dozen", description: "Dozen freshly prepared roti, packed and ready to serve." },
  { name: "Puri", unit: "dozen", description: "Dozen freshly prepared puri, packed and ready to serve." },
  { name: "Garlic pork", unit: "trays", description: "Tray of cooked garlic pork, prepared and ready to serve." },
  { name: "Mauby", unit: "gallon", description: "Gallon of prepared mauby, ready to pour and serve." },
  { name: "Ginger beer", unit: "gallon", description: "Gallon of prepared ginger beer, ready to pour and serve." },
  { name: "Sorrel", unit: "gallon", description: "Gallon of prepared sorrel drink, ready to pour and serve." },
  { name: "Drinks and juice", unit: "cases", description: "Case of bottled or canned soft drinks or juice. Specify the drink, container size and case count in your notes." },
  { name: "Water", unit: "cases", slots: 5, description: "Case of bottled water. Specify the bottle size and bottles per case in your contribution notes." },
].map((item) => ({ slots: 2, ...item }));

const foodSlots = menu.flatMap(({ name, unit, description, slots }) => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // These deployed IDs stay stable so reseeding after the rename cannot add duplicates.
  return Array.from({ length: slots }, (_, index) => ({
    id: `gala-food-${slug}-${String(index + 1).padStart(2, "0")}`,
    name, unit, description,
  }));
});

module.exports = { menu, foodSlots };
