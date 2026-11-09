const { randomBytes, createHash } = require("node:crypto");
const { FieldValue, FieldPath } = require("firebase-admin/firestore");
const { ApiError, requireRecord } = require("./errors");

function inviteUrl(siteUrl, token) {
  const url = new URL(siteUrl);
  url.searchParams.set("token", token);
  return url.href;
}
function serial(value) {
  if (value?.toDate instanceof Function) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serial);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serial(item)]),
    );
  return value;
}
function record(doc) {
  return serial({ id: doc.id, ...doc.data() });
}
function plusOneDetails(value) {
  const plusOne = value.plusOne === true;
  return { plusOne, plusOneName: plusOne ? value.plusOneName : "" };
}
function adminGuest(doc, config) {
  return {
    ...record(doc),
    ...plusOneDetails(doc.data()),
    token: doc.id,
    uniqueUrl: inviteUrl(config.siteUrl, doc.id),
  };
}
function assertActive(guest) {
  if (!guest.active)
    throw new ApiError(
      410,
      "INVITATION_INACTIVE",
      "This invitation is no longer active. Please contact the church.",
    );
}
function createService(db, config) {
  const guests = db.collection("InvitedGuests");
  const churches = db.collection("Churches");
  const foods = db.collection("FoodItems");
  const contributions = db.collection("FoodContributions");
  const registrationRequests = db.collection("PublicRegistrationRequests");
  const foodImportRequests = db.collection("FoodImportRequests");

  async function importFoods(payload) {
    const fingerprint = createHash("sha256").update(JSON.stringify(payload.items.map(({ name, unit, description, active }) => ({ name, unit, description, active })))).digest("hex");
    // Persisted retry namespace for Christmas Social; changing it would duplicate imports.
    const key = createHash("sha256").update(`gala-2026:food-import:${payload.requestId.toLowerCase()}`).digest("hex");
    const receiptRef = foodImportRequests.doc(key);
    const refs = payload.items.map(() => foods.doc());
    return db.runTransaction(async (tx) => {
      const prior = await tx.get(receiptRef);
      if (prior.exists) {
        if (prior.data().fingerprint !== fingerprint) throw new ApiError(409, "REQUEST_CHANGED", "This import request already contains different food items.");
        return { created: false, receipt: prior.data().receipt };
      }
      const now = FieldValue.serverTimestamp();
      payload.items.forEach((item, index) => tx.create(refs[index], { ...item, hasContributions: false, claimedBy: null, createdAt: now, updatedAt: now }));
      const receipt = { ids: refs.map((ref) => ref.id), count: refs.length };
      tx.create(receiptRef, { fingerprint, receipt, createdAt: now });
      return { created: true, receipt };
    });
  }

  async function deleteFoods(ids, confirmation) {
    return db.runTransaction(async (tx) => {
      const selected = new Set(ids);
      const [foodDocs, contributionDocs] = await Promise.all([
        tx.getAll(...ids.map((id) => foods.doc(id))), tx.get(contributions),
      ]);
      const affected = contributionDocs.docs.filter((doc) => doc.data().items?.some((item) => selected.has(item.foodItemId)));
      if ((affected.length || foodDocs.some((doc) => doc.data()?.claimedBy)) && confirmation !== "delete")
        throw new ApiError(409, "FOOD_DELETE_CONFIRMATION_REQUIRED", "Selected food items have guest commitments. Type delete to remove the items and their food choices.");
      if (affected.length > 200) throw new ApiError(409, "DELETE_TOO_LARGE", "This deletion affects too many contribution records. Delete fewer food items at a time.");
      const guestRefs = [...new Set(affected.map((doc) => doc.data().guestId))].map((id) => guests.doc(id));
      const guestDocs = guestRefs.length ? await tx.getAll(...guestRefs) : [];
      const now = FieldValue.serverTimestamp();
      let removedChoices = 0;
      for (const doc of affected) {
        const previous = doc.data().items;
        const items = previous.filter((item) => !selected.has(item.foodItemId));
        removedChoices += previous.length - items.length;
        tx.update(doc.ref, { items, updatedAt: now });
      }
      for (const doc of guestDocs) if (doc.exists) tx.update(doc.ref, { updatedAt: now });
      for (const doc of foodDocs) if (doc.exists) tx.delete(doc.ref);
      return { deletedIds: foodDocs.filter((doc) => doc.exists).map((doc) => doc.id), missingIds: foodDocs.filter((doc) => !doc.exists).map((doc) => doc.id), affectedGuests: affected.length, removedChoices };
    });
  }

  async function deleteGuests(ids, confirmation) {
    if (confirmation !== "delete") throw new ApiError(409, "GUEST_DELETE_CONFIRMATION_REQUIRED", "Type delete to permanently remove these people, their plus-ones and contributions.");
    return db.runTransaction(async (tx) => {
      const groups = [];
      for (let index = 0; index < ids.length; index += 10) groups.push(ids.slice(index, index + 10));
      const [guestDocs, contributionDocs, foodSnapshots, requestSnapshots] = await Promise.all([
        tx.getAll(...ids.map((id) => guests.doc(id))),
        tx.getAll(...ids.map((id) => contributions.doc(id))),
        Promise.all(groups.map((group) => tx.get(foods.where("claimedBy", "in", group)))),
        Promise.all(groups.map((group) => tx.get(registrationRequests.where("registration.token", "in", group)))),
      ]);
      const claimedFoods = foodSnapshots.flatMap((snapshot) => snapshot.docs);
      const receipts = requestSnapshots.flatMap((snapshot) => snapshot.docs);
      const existingGuests = guestDocs.filter((doc) => doc.exists);
      const existingContributions = contributionDocs.filter((doc) => doc.exists);
      if (existingGuests.length + existingContributions.length + claimedFoods.length + receipts.length > 450)
        throw new ApiError(409, "DELETE_TOO_LARGE", "This deletion affects too many food choices. Select fewer people at a time.");
      const now = FieldValue.serverTimestamp();
      for (const doc of claimedFoods) tx.update(doc.ref, { claimedBy: null, updatedAt: now });
      for (const doc of existingContributions) tx.delete(doc.ref);
      for (const doc of existingGuests) tx.delete(doc.ref);
      // Keep only a retry tombstone: erase the name, companion, choices and token.
      for (const doc of receipts) tx.set(doc.ref, { fingerprint: doc.data().fingerprint, deletedAt: now });
      return {
        deletedIds: existingGuests.map((doc) => doc.id),
        missingIds: guestDocs.filter((doc) => !doc.exists).map((doc) => doc.id),
        releasedFoodSlots: claimedFoods.length,
        removedChoices: existingContributions.reduce((total, doc) => total + (doc.data().items?.length || 0), 0),
      };
    });
  }

  async function prepareFoodSelection(tx, token, selected, previous = []) {
    const selectedIds = new Set(selected.map((item) => item.foodItemId));
    const affectedIds = [
      ...new Set([...selectedIds, ...previous.map((item) => item.foodItemId)]),
    ];
    const foodDocs = affectedIds.length
      ? await tx.getAll(...affectedIds.map((id) => foods.doc(id)))
      : [];
    const foodMap = new Map(foodDocs.map((doc) => [doc.id, doc]));
    const items = selected.map((item) => {
      const food = requireRecord(foodMap.get(item.foodItemId), "Food item");
      if (food.claimedBy && food.claimedBy !== token)
        throw new ApiError(
          409,
          "FOOD_ITEM_TAKEN",
          `The “${food.name}” slot has already been selected. Please choose another slot.`,
        );
      const held = previous.find((row) => row.foodItemId === item.foodItemId)?.quantity || 0;
      if (!food.active && item.quantity > held)
        throw new ApiError(
          409,
          "FOOD_ITEM_INACTIVE",
          `The food item “${food.name}” is no longer available`,
        );
      return { ...item, name: food.name, unit: food.unit };
    });
    return { items, selectedIds, foodDocs };
  }

  function writeFoodSelection(tx, token, selection, now) {
    // One contribution document per guest; replacements also release old slots.
    tx.set(contributions.doc(token), { guestId: token, items: selection.items, updatedAt: now });
    for (const doc of selection.foodDocs) {
      if (selection.selectedIds.has(doc.id)) {
        tx.update(doc.ref, { hasContributions: true, claimedBy: token });
      } else if (doc.exists && doc.data().claimedBy === token) {
        tx.update(doc.ref, { claimedBy: null });
      }
    }
  }

  async function publicGuest(token) {
    const data = await db.runTransaction(
      async (tx) => {
        const guest = requireRecord(
          await tx.get(guests.doc(token)),
          "Invitation",
        );
        assertActive(guest);
        const [church, contribution] = await Promise.all([
          tx.get(churches.doc(guest.churchId)),
          tx.get(contributions.doc(token)),
        ]);
        return {
          token,
          name: guest.name,
          personalizedName: guest.personalizedName || guest.name,
          church: { id: guest.churchId, name: church.data()?.name || "" },
          rsvp: guest.rsvp,
          ...plusOneDetails(guest),
          items: contribution.data()?.items || [],
          respondedAt: guest.respondedAt,
          updatedAt: guest.updatedAt,
        };
      },
      { readOnly: true },
    );
    return serial(data);
  }

  async function saveReply(token, payload, admin = false) {
    return db.runTransaction(async (tx) => {
      const guestRef = guests.doc(token);
      const contributionRef = contributions.doc(token);
      const [guestDoc, previousDoc] = await Promise.all([
        tx.get(guestRef),
        tx.get(contributionRef),
      ]);
      const guest = requireRecord(guestDoc, "Invitation");
      if (!admin) assertActive(guest);
      const previous = previousDoc.data()?.items || [];
      const selection = await prepareFoodSelection(tx, token, payload.items, previous);
      const companion = plusOneDetails(payload.rsvp === "no" ? {} : payload.plusOne === undefined ? guest : payload);
      const now = FieldValue.serverTimestamp();
      tx.update(guestRef, {
        rsvp: payload.rsvp,
        ...companion,
        respondedAt: now,
        updatedAt: now,
      });
      writeFoodSelection(tx, token, selection, now);
      return { token, rsvp: payload.rsvp, ...companion, items: selection.items };
    });
  }

  async function registerGuest(payload) {
    const companion = plusOneDetails(payload);
    // Keep deployed request keys stable when changing the event's display name.
    const requestKey = createHash("sha256")
      .update(`gala-2026:registration:${payload.requestId.toLowerCase()}`)
      .digest("hex");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({
        name: payload.name,
        items: payload.items
          .map(({ foodItemId, quantity, notes }) => ({ foodItemId, quantity, notes }))
          .sort((a, b) => a.foodItemId.localeCompare(b.foodItemId)),
        // Keep the original no-companion fingerprint valid across this release.
        ...(companion.plusOne ? companion : {}),
      }))
      .digest("hex");
    const requestRef = registrationRequests.doc(requestKey);
    const token = randomBytes(12).toString("hex");
    const churchId = "wpvlhc-aog";
    return db.runTransaction(async (tx) => {
      const prior = await tx.get(requestRef);
      if (prior.exists) {
        if (prior.data().fingerprint !== fingerprint)
          throw new ApiError(409, "REQUEST_CHANGED", "This request ID already belongs to a different registration. Use the guest code to update the saved response.");
        if (prior.data().deletedAt) throw new ApiError(410, "REGISTRATION_DELETED", "This registration was deleted by management. A new registration requires a new request ID.");
        // Return the original receipt without overwriting subsequent RSVP/admin edits.
        const receipt = prior.data().registration;
        return { created: false, registration: { ...receipt, ...plusOneDetails(receipt) } };
      }
      const church = await tx.get(churches.doc(churchId));
      if (!church.exists || !church.data().active)
        throw new ApiError(503, "REGISTRATION_UNAVAILABLE", "Guest registration is temporarily unavailable. Please contact the church.");
      const selection = await prepareFoodSelection(tx, token, payload.items);
      const now = FieldValue.serverTimestamp();
      const registration = {
        token, name: payload.name, churchId, rsvp: "yes", ...companion, items: selection.items,
      };
      tx.create(guests.doc(token), {
        name: payload.name, personalizedName: "", churchId, active: true,
        rsvp: "yes", registrationSource: "public",
        ...companion,
        respondedAt: now, createdAt: now, updatedAt: now,
      });
      writeFoodSelection(tx, token, selection, now);
      tx.create(requestRef, { fingerprint, registration, createdAt: now });
      return { created: true, registration };
    });
  }

  async function createGuest(payload) {
    const token = randomBytes(12).toString("hex");
    await db.runTransaction(async (tx) => {
      const church = requireRecord(
        await tx.get(churches.doc(payload.churchId)),
        "Church",
      );
      if (!church.active)
        throw new ApiError(409, "CHURCH_INACTIVE", "Choose an active church");
      const now = FieldValue.serverTimestamp();
      tx.create(guests.doc(token), {
        ...payload,
        ...plusOneDetails(payload),
        rsvp: "pending",
        respondedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    return adminGuest(await guests.doc(token).get(), config);
  }

  async function patchGuest(id, payload) {
    await db.runTransaction(async (tx) => {
      const current = requireRecord(await tx.get(guests.doc(id)), "Guest");
      if (current.rsvp === "no" && payload.plusOne === true)
        throw new ApiError(400, "VALIDATION_ERROR", "Record an attending RSVP before adding a plus-one.", [
          { field: "plusOne", message: "A declined guest cannot bring a plus-one." },
        ]);
      if (payload.churchId && payload.churchId !== current.churchId) {
        const church = requireRecord(
          await tx.get(churches.doc(payload.churchId)),
          "Church",
        );
        if (!church.active)
          throw new ApiError(409, "CHURCH_INACTIVE", "Choose an active church");
      }
      tx.update(guests.doc(id), {
        ...payload,
        ...(payload.plusOne === undefined ? {} : plusOneDetails(payload)),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return adminGuest(await guests.doc(id).get(), config);
  }

  async function listGuests(query) {
    let ref = guests.orderBy(FieldPath.documentId());
    if (query.churchId) ref = ref.where("churchId", "==", query.churchId);
    if (query.rsvp) ref = ref.where("rsvp", "==", query.rsvp);
    if (query.after) ref = ref.startAfter(query.after);
    const snapshot = await ref.limit(query.limit + 1).get();
    return {
      guests: snapshot.docs
        .slice(0, query.limit)
        .map((doc) => adminGuest(doc, config)),
      nextCursor:
        snapshot.size > query.limit ? snapshot.docs[query.limit - 1].id : null,
    };
  }

  async function list(collection, publicOnly = false) {
    const snapshot = await (
      publicOnly ? collection.where("active", "==", true) : collection
    ).get();
    return snapshot.docs
      .map(record)
      .filter((item) => !publicOnly || !item.claimedBy)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  async function create(collection, payload) {
    const ref = collection.doc();
    const now = FieldValue.serverTimestamp();
    await ref.create({
      ...payload,
      ...(collection.id === "FoodItems"
        ? { hasContributions: false, claimedBy: null }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
    return record(await ref.get());
  }
  async function patch(collection, id, payload) {
    const ref = collection.doc(id);
    await db.runTransaction(async (tx) => {
      const current = requireRecord(await tx.get(ref), "Record");
      if (
        collection.id === "FoodItems" &&
        current.hasContributions &&
        payload.unit &&
        payload.unit !== current.unit
      ) {
        throw new ApiError(
          409,
          "UNIT_LOCKED",
          "This item has contributions. Create a new item to use a different unit.",
        );
      }
      tx.update(ref, { ...payload, updatedAt: FieldValue.serverTimestamp() });
    });
    return record(await ref.get());
  }

  async function report(churchId) {
    const data = await db.runTransaction(
      async (tx) => {
        const [guestDocs, churchDocs, foodDocs, contributionDocs] =
          await Promise.all([
            tx.get(
              churchId ? guests.where("churchId", "==", churchId) : guests,
            ),
            tx.get(churches),
            tx.get(foods),
            tx.get(contributions),
          ]);
        if (churchId && !churchDocs.docs.some((doc) => doc.id === churchId))
          throw new ApiError(404, "NOT_FOUND", "Church not found");
        return {
          guests: guestDocs.docs.map((doc) => adminGuest(doc, config)),
          churches: churchDocs.docs.map(record),
          foodItems: foodDocs.docs.map(record),
          contributions: contributionDocs.docs.map(record),
        };
      },
      { readOnly: true },
    );
    return buildReport(data, churchId);
  }
  async function getGuest(id) {
    return db.runTransaction(
      async (tx) => {
        const [guest, contribution] = await Promise.all([
          tx.get(guests.doc(id)),
          tx.get(contributions.doc(id)),
        ]);
        requireRecord(guest, "Guest");
        return {
          ...adminGuest(guest, config),
          items: contribution.data()?.items || [],
        };
      },
      { readOnly: true },
    );
  }
  return {
    publicGuest,
    getGuest,
    saveReply,
    registerGuest,
    createGuest,
    patchGuest,
    listGuests,
    report,
    listChurches: () => list(churches),
    createChurch: (data) => create(churches, data),
    patchChurch: (id, data) => patch(churches, id, data),
    listFoods: (publicOnly = false) => list(foods, publicOnly),
    createFood: (data) => create(foods, data),
    patchFood: (id, data) => patch(foods, id, data),
    importFoods,
    deleteFoods,
    deleteGuests,
  };
}

function buildReport(data, churchId) {
  const guests = data.guests.filter(
    (guest) => guest.active && (!churchId || guest.churchId === churchId),
  );
  const guestMap = new Map(guests.map((guest) => [guest.id, guest]));
  const churchRows = data.churches
    .filter((church) => !churchId || church.id === churchId)
    .map((church) => ({
      churchId: church.id,
      name: church.name,
      invited: 0,
      yes: 0,
      no: 0,
      pending: 0,
      contributors: 0,
      plusOnes: 0,
      attendingPeople: 0,
    }));
  const churchMap = new Map(
    churchRows.map((church) => [church.churchId, church]),
  );
  const totals = {
    invited: guests.length,
    yes: 0,
    no: 0,
    pending: 0,
    contributors: 0,
    plusOnes: 0,
    attendingPeople: 0,
  };
  for (const guest of guests) {
    totals[guest.rsvp] += 1;
    const plusOnes = guest.rsvp === "yes" && guest.plusOne === true ? 1 : 0;
    const attendingPeople = guest.rsvp === "yes" ? 1 + plusOnes : 0;
    totals.plusOnes += plusOnes;
    totals.attendingPeople += attendingPeople;
    const church = churchMap.get(guest.churchId);
    if (church) {
      church.invited += 1;
      church[guest.rsvp] += 1;
      church.plusOnes += plusOnes;
      church.attendingPeople += attendingPeople;
    }
  }
  const foods = data.foodItems.map((food) => ({
    foodItemId: food.id,
    name: food.name,
    unit: food.unit,
    active: food.active,
    quantity: 0,
    contributors: 0,
  }));
  const foodMap = new Map(foods.map((food) => [food.foodItemId, food]));
  const pledges = [];
  for (const contribution of data.contributions) {
    const guest = guestMap.get(contribution.guestId);
    if (!guest || guest.rsvp !== "yes" || !contribution.items.length) continue;
    totals.contributors += 1;
    const church = churchMap.get(guest.churchId);
    if (church) church.contributors += 1;
    for (const item of contribution.items) {
      const food = foodMap.get(item.foodItemId);
      if (food) {
        food.quantity += item.quantity;
        food.contributors += 1;
      }
      pledges.push({
        guestId: guest.id,
        guestName: guest.name,
        churchId: guest.churchId,
        churchName: church?.name || "",
        foodItemId: item.foodItemId,
        foodName: food?.name || item.name,
        unit: item.unit,
        quantity: item.quantity,
        notes: item.notes,
      });
    }
  }
  const detailedGuests = guests.map((guest) => ({
    ...guest,
    ...plusOneDetails(guest),
    churchName: churchMap.get(guest.churchId)?.name || "",
  }));
  return {
    generatedAt: new Date().toISOString(),
    churchId: churchId || null,
    totals,
    churches: churchRows,
    foodItems: foods,
    guests: detailedGuests,
    contributions: pledges,
  };
}
module.exports = { createService, inviteUrl, serial, buildReport };
