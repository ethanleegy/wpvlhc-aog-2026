const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function getDb() {
  if (!getApps().length) initializeApp();
  return getFirestore();
}
module.exports = { getDb };
