const baseUrl = "https://us-central1-CHANGEME.cloudfunctions.net/api/v1/";
const params = new URLSearchParams(document.location.search);
const token = params.get("token");

window.onload = startLoad();

function startLoad() {
    const submit =  document.getElementById("submit")
    if (submit) {
        show = setTimeout(showPage, 2000);
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

function updateDishCount() {
  const count = dishForm.querySelectorAll('input[name="dish"]:checked').length;
  dishCount.textContent = count
    ? `${count} ${count === 1 ? "item" : "items"} selected`
    : "Nothing selected yet";
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
      ? [
          { foodItemId: "food-07", quantity: 12, notes: "Vegetarian" },
          { foodItemId: "food-11", quantity: 20, notes: "" },
        ]
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

//START Check Token Status

async function checkTokenStatus() {
    if (token == null) {
        //document.getElementById("submit").style.display = "none";     
        return;
    }
    var url = (baseUrl + 'token/' + token + '/status');
    //baseUrl and token declared at the top

    try {
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        }
    })
    let tokenStatusBody = await response.json();
        if (tokenStatusBody.valid == false) {
            document.getElementById("submit").style.display = "none";     
        }
        else if (tokenStatusBody.used == false && tokenStatusBody.valid == true) {
            populateTokenData();
        }
        else if (tokenStatusBody.used == true && tokenStatusBody.valid == true) {
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

    } catch (error) {
        console.error(error.message);
    }
}

//END Check Token Status

dishForm.addEventListener("change", updateDishCount);