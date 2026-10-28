const invitee = new URLSearchParams(window.location.search).get("name")?.trim();
if (invitee) {
  document.querySelectorAll("[data-invitee]").forEach((element) => {
    element.textContent = invitee;
  });
}

const rsvpForm = document.querySelector("#rsvp");
const bringSection = document.querySelector("#bring");
const rsvpMessage = document.querySelector("#rsvp-message");
const dishForm = document.querySelector("#dish-form");
const dishCount = document.querySelector("#dish-count");
const dishMessage = document.querySelector("#dish-message");

function updateDishCount() {
  const count = dishForm.querySelectorAll('input[name="dish"]:checked').length;
  dishCount.textContent = count
    ? `${count} ${count === 1 ? "item" : "items"} selected`
    : "Nothing selected yet";
}

rsvpForm.addEventListener("change", (event) => {
  const attending = event.target.value === "yes";
  bringSection.hidden = !attending;
  rsvpMessage.textContent = attending
    ? ""
    : "We’ll miss you, and hope to celebrate with you another time.";

  if (attending) {
    requestAnimationFrame(() => bringSection.scrollIntoView({ behavior: "smooth", block: "start" }));
  } else {
    dishForm.reset();
    dishMessage.textContent = "";
    updateDishCount();
  }
});

dishForm.addEventListener("change", updateDishCount);
dishForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const selectedDishes = [...dishForm.querySelectorAll('input[name="dish"]:checked')]
    .map((input) => input.value);

  if (selectedDishes.length === 0) {
    dishMessage.textContent = "Please choose at least one dish or drink.";
    dishForm.querySelector('input[name="dish"]').focus();
    return;
  }

  dishMessage.textContent = `Thank you! Your choices are ready to share: ${selectedDishes.join(", ")}.`;
});
