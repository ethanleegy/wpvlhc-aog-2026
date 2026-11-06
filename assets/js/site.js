const baseUrl = "https://us-central1-wpvlhc-aog-2026.cloudfunctions.net/api/v1/";
const invitationSections = document.querySelectorAll(".show-page");
if (invitationSections.length) setTimeout(showPage, 500);

function showPage() {
  const showPages = document.querySelectorAll(".show-page");

  showPages.forEach((page) => {
    page.style.display = "block";
  });
}

const rsvpForm = document.querySelector("#rsvp");
const bringSection = document.querySelector("#bring");
const guestDetails = document.querySelector("#guest-details");
const rsvpMessage = document.querySelector("#rsvp-message");
const submitButton = document.querySelector("#submit");
const submitWrapper = document.querySelector("#submit-wrapper");
const dishForm = document.querySelector("#dish-form");
const dishCount = document.querySelector("#dish-count");
const foodOptions = document.querySelector("#food-options");
const foodOptionsMessage = document.querySelector("#food-options-message");
let pendingRegistration = null;

function updateDishCount() {
  const count = dishForm.querySelectorAll('input[name="dish"]:checked').length;
  dishCount.textContent = count
    ? `${count} ${count === 1 ? "item" : "items"} selected`
    : "Nothing selected yet";
}

async function loadFoodItems() {
  try {
    const response = await fetch(`${baseUrl}food-items`, {
      method: "GET",
      credentials: "omit",
      headers: { "Accept": "application/json" },
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error?.message || "Unable to load the menu. Please try again.");
    }
    if (!Array.isArray(result.foodItems)) {
      throw new Error("The menu response was not in the expected format.");
    }

    const options = document.createDocumentFragment();
    result.foodItems.forEach((item, index) => {
      const label = document.createElement("label");
      label.className = "group relative flex min-h-[54px] cursor-pointer items-center gap-[9px] border-r border-b border-[#fffaf1]/25 px-[10px] py-2 font-display text-sm leading-[1.35] transition-colors hover:bg-white/7 md:min-h-[68px] md:gap-[12px] md:px-[14px]";

      const input = document.createElement("input");
      input.className = "peer sr-only";
      input.type = "checkbox";
      input.name = "dish";
      input.value = item.id;

      const number = document.createElement("span");
      number.className = "shrink-0 font-sans text-[9px] tracking-[.1em] text-gold";
      number.textContent = String(index + 1).padStart(2, "0");

      const details = document.createElement("span");
      details.className = "min-w-0 flex-1 leading-tight";

      const name = document.createElement("span");
      name.className = "block text-sm leading-tight";
      name.textContent = item.name;
      details.append(name);

      /*
      if (item.description) {
        const description = document.createElement("span");
        description.className = "mt-0.5 block font-sans text-[10px] leading-[1.35] text-[#fffaf1]/65";
        description.textContent = item.description;
        details.append(description);
      }
      */

      const unit = document.createElement("span");
      unit.className = "mt-0.5 block font-sans text-[9px] leading-none text-[#fffaf1]/65";
      unit.textContent = item.unit;
      details.append(unit);

      const marker = document.createElement("span");
      marker.className = "ml-auto grid size-[21px] shrink-0 place-items-center rounded-full border border-[#fffaf1]/50 font-sans text-sm text-transparent transition-colors peer-checked:border-gold peer-checked:bg-gold peer-checked:text-forest peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[#fffaf1]";
      marker.setAttribute("aria-hidden", "true");
      marker.textContent = "+";

      label.append(input, number, details, marker);
      options.append(label);
    });

    foodOptions.replaceChildren(options);
    foodOptionsMessage.textContent = result.foodItems.length
      ? ""
      : "There are no food options available right now.";
  } catch (error) {
    console.error("Unable to load food items:", error);
    foodOptionsMessage.textContent = error.message || "Unable to load the menu. Please try again.";
  }
}

if (rsvpForm && dishForm) {
  loadFoodItems();
  rsvpForm.addEventListener("change", (event) => {
    if (event.target.name !== "attendance") return;
    const attending = event.target.value === "yes";
    guestDetails.hidden = !attending;
    bringSection.hidden = !attending;
    submitWrapper.hidden = !attending;
    rsvpMessage.textContent = attending
      ? "Scroll down to choose what to bring and submit your RSVP ↓"
      : "We’ll miss you, and hope to celebrate with you another time. No response was submitted.";

    if (!attending) {
      dishForm.reset();
      updateDishCount();
    }
  });

  rsvpForm.addEventListener("submit", submitResponse);
  dishForm.addEventListener("change", updateDishCount);
}

//START Submit RSVP Response
async function submitResponse(event) {
  event.preventDefault();
  const formData = new FormData(rsvpForm);
  const rsvp = formData.get("attendance");
  if (rsvp !== "yes" && rsvp !== "no") {
    rsvpMessage.textContent = "Please choose whether you’ll be joining us.";
    return;
  }
  if (rsvp !== "yes") {
    rsvpMessage.textContent = "Only attending RSVPs can be submitted from this page.";
    return;
  }
  const submittedName = formData.get("name");
  const name = typeof submittedName === "string" ? submittedName.trim() : "";
  if (!name) {
    rsvpMessage.textContent = "Please enter your name.";
    document.getElementById("guest-name").focus();
    return;
  }

  const body = {
    name,
    items: Array.from(dishForm.querySelectorAll('input[name="dish"]:checked'), (input) => ({
      foodItemId: input.value,
      quantity: 1,
      notes: "",
    })),
  };
  const fingerprint = JSON.stringify(body);
  if (!pendingRegistration || pendingRegistration.fingerprint !== fingerprint) {
    pendingRegistration = { requestId: crypto.randomUUID(), fingerprint };
  }

  submitButton.disabled = true;
  rsvpMessage.textContent = "Submitting your response…";

  try {
    const response = await fetch(
      `${baseUrl}registrations`,
      {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, requestId: pendingRegistration.requestId }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error?.message || "Unable to submit your response. Please try again.");
    }

    rsvpMessage.textContent = "Thank you! Your response has been submitted.";
    pendingRegistration = null;
    window.location.href = "/thank-you";
  } catch (error) {
    console.error("Unable to submit RSVP:", error);
    rsvpMessage.textContent = error.message || "Unable to submit your response. Please try again.";
  } finally {
    submitButton.disabled = false;
  }
}

//END Submit RSVP Response