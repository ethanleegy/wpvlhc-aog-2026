const baseUrl = "https://us-central1-wpvlhc-aog-2026.cloudfunctions.net/api/v1/";
const params = new URLSearchParams(document.location.search);
const token = params.get("token");

window.onload = startLoad();

function startLoad() {
    const submit =  document.getElementById("submit")
    if (submit) {
        show = setTimeout(showPage, 500);
        checkTokenStatus();
        }
    const redirect = document.getElementById("redirect")
    if (redirect) {
        redirect.href = "/?token="+token;
    }
}

function showPage() {
  const showPages = document.querySelectorAll(".show-page");

  showPages.forEach((page) => {
    page.style.display = "block";
  });
}

const rsvpForm = document.querySelector("#rsvp");
const bringSection = document.querySelector("#bring");
const rsvpMessage = document.querySelector("#rsvp-message");
const submitButton = document.querySelector("#submit");
const submitWrapper = document.querySelector("#submit-wrapper");
const dishForm = document.querySelector("#dish-form");
const dishCount = document.querySelector("#dish-count");
const foodOptions = document.querySelector("#food-options");
const foodOptionsMessage = document.querySelector("#food-options-message");

loadFoodItems();

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

rsvpForm.addEventListener("change", (event) => {
  const attending = event.target.value === "yes";
  bringSection.hidden = !attending;
  submitWrapper.hidden = !event.target.value;
  rsvpMessage.textContent = attending
    ? ""
    : "We’ll miss you, and hope to celebrate with you another time.";

  if (attending) {
    requestAnimationFrame(() => bringSection.scrollIntoView({ behavior: "smooth", block: "start" }));
  } else {
    dishForm.reset();
    updateDishCount();
  }
});

rsvpForm.addEventListener("submit", submitResponse);
dishForm.addEventListener("change", updateDishCount);

//START Submit RSVP Response
async function submitResponse(event) {
  event.preventDefault();
  const rsvp = new FormData(rsvpForm).get("attendance");
  if (rsvp !== "yes" && rsvp !== "no") {
    rsvpMessage.textContent = "Please choose whether you’ll be joining us.";
    return;
  }
  if (!token) {
    rsvpMessage.textContent = "Please open your personal invitation link before submitting.";
    return;
  }

  const body = {
    rsvp,
    items: rsvp === "yes"
      ? Array.from(dishForm.querySelectorAll('input[name="dish"]:checked'), (input) => ({
          foodItemId: input.value,
          quantity: 1,
          notes: "",
        }))
      : [],
  };

  submitButton.disabled = true;
  rsvpMessage.textContent = "Submitting your response…";

  try {
    const response = await fetch(
      `${baseUrl}token/${encodeURIComponent(token)}/reply`,
      {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error?.message || "Unable to submit your response. Please try again.");
    }

    rsvpMessage.textContent = "Thank you! Your response has been submitted.";
  } catch (error) {
    console.error("Unable to submit RSVP:", error);
    rsvpMessage.textContent = error.message || "Unable to submit your response. Please try again.";
  } finally {
    submitButton.disabled = false;
  }
}

//END Submit RSVP Response

//START Check Token Status

async function checkTokenStatus() {
    if (token == null) {
        document.getElementById("submit").style.display = "none";
        return;
    }
    var url = (baseUrl + 'token/' + token + '/status');
    //baseUrl and token declared at the top

    try {
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Content-Type": "application/json"
        }
    })
    let tokenStatusBody = await response.json();
        if (tokenStatusBody.valid == false) {
          document.getElementById("submit").style.display = "none";
        }
        else {
          populateTokenData();
        }
        /* else if (tokenStatusBody.used == true && tokenStatusBody.valid == true) {
            // this says if the token is used, retrieve it anyway. It renders it like normal, but after populateTokenData() it disables all the buttons and inputs.
            let res = await populateTokenData();
            document.getElementsByClassName("rsvp")[0].classList.add("disabled")
            let button = document.getElementById("submit")
            button.value = "Submitted";
            button.disabled = true;
            let checkboxes = document.getElementsByClassName("guest-checkbox")
            for (i of checkboxes) {
                i.disabled = true;
            }

        }
          */

    } catch (error) {
        console.error(error.message);
    }
}

//END Check Token Status

//STart Populate Token Data

async function populateTokenData() {
  var url = (baseUrl + 'token/' + token);
  //baseUrl and token declared at the top

  try {
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        }
    })
    let tokenDetailsBody = await response.json();

    tokenDetailsBody.name ? document.getElementById("person-name").innerHTML = tokenDetailsBody.name: document.getElementById("person-name").innerHTML = "friend";

  } catch (error) {
    console.error(error.message);
  }
}