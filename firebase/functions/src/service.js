const { randomBytes } = require("node:crypto");
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
function adminGuest(doc, config) {
  return {
    ...record(doc),
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
      const selectedIds = new Set(payload.items.map((item) => item.foodItemId));
      const affectedIds = [
        ...new Set([
          ...selectedIds,
          ...previous.map((item) => item.foodItemId),
        ]),
      ];
      const foodDocs = affectedIds.length
        ? await tx.getAll(...affectedIds.map((id) => foods.doc(id)))
        : [];
      const foodMap = new Map(foodDocs.map((doc) => [doc.id, doc]));
      const items = payload.items.map((item) => {
        const food = requireRecord(foodMap.get(item.foodItemId), "Food item");
        if (food.claimedBy && food.claimedBy !== token)
          throw new ApiError(
            409,
            "FOOD_ITEM_TAKEN",
            `The “${food.name}” slot has already been selected. Please choose another slot.`,
          );
        const held =
          previous.find((row) => row.foodItemId === item.foodItemId)
            ?.quantity || 0;
        if (!food.active && item.quantity > held)
          throw new ApiError(
            409,
            "FOOD_ITEM_INACTIVE",
            `The food item “${food.name}” is no longer available`,
          );
        return { ...item, name: food.name, unit: food.unit };
      });
      const now = FieldValue.serverTimestamp();
      tx.update(guestRef, {
        rsvp: payload.rsvp,
        respondedAt: now,
        updatedAt: now,
      });
      // One contribution document per guest. Repeated submissions replace rather than append.
      tx.set(contributionRef, { guestId: token, items, updatedAt: now });
      for (const doc of foodDocs) {
        if (selectedIds.has(doc.id)) {
          tx.update(doc.ref, { hasContributions: true, claimedBy: token });
        } else if (doc.exists && doc.data().claimedBy === token) {
          tx.update(doc.ref, { claimedBy: null });
        }
      }
      return { token, rsvp: payload.rsvp, items };
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
  };
  for (const guest of guests) {
    totals[guest.rsvp] += 1;
    const church = churchMap.get(guest.churchId);
    if (church) {
      church.invited += 1;
      church[guest.rsvp] += 1;
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
