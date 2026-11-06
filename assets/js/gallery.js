//const baseUrl = "https://us-central1-wpvlhc-aog-2026.cloudfunctions.net/api/v1/";
const galleryGrid = document.querySelector("#gallery-grid");
const galleryStatus = document.querySelector("#gallery-status");
const refreshGallery = document.querySelector("#gallery-refresh");
const loadMorePhotos = document.querySelector("#gallery-more");
const photoViewer = document.querySelector("#photo-viewer");
const photoViewerImage = document.querySelector("#photo-viewer-image");
const closePhotoViewer = document.querySelector("#gallery-close");
let nextGalleryCursor = null;
let galleryLoading = false;
const knownPhotos = new Set();

async function galleryRequest(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error?.message || "The gallery is temporarily unavailable. Please try again.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function showPhoto(photo) {
  photoViewerImage.src = photo.displayUrl;
  photoViewer.showModal();
}

function addPhoto(photo) {
  if (knownPhotos.has(photo.id)) return;
  knownPhotos.add(photo.id);

  const button = document.createElement("button");
  button.className = "gallery-photo";
  button.type = "button";
  button.setAttribute("aria-label", "View Christmas Gala photo");

  const image = document.createElement("img");
  image.src = photo.thumbnailUrl;
  image.alt = "";
  image.loading = "lazy";
  image.width = photo.width;
  image.height = photo.height;

  button.append(image);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      showPhoto(await galleryRequest(`gallery/photos/${encodeURIComponent(photo.id)}`));
    } catch (error) {
      galleryStatus.textContent = error.message;
      if (error.status === 404) {
        button.remove();
        knownPhotos.delete(photo.id);
      }
    } finally {
      button.disabled = false;
    }
  });

  let refreshedAt = 0;
  image.addEventListener("error", async () => {
    if (Date.now() - refreshedAt < 60_000) return;
    refreshedAt = Date.now();
    try {
      const refreshedPhoto = await galleryRequest(`gallery/photos/${encodeURIComponent(photo.id)}`);
      image.src = refreshedPhoto.thumbnailUrl;
    } catch (error) {
      if (error.status === 404) {
        button.remove();
        knownPhotos.delete(photo.id);
      }
    }
  });

  galleryGrid.append(button);
}

async function loadGallery(reset = false) {
  if (galleryLoading) return;
  galleryLoading = true;
  refreshGallery.disabled = true;
  loadMorePhotos.disabled = true;

  try {
    const query = new URLSearchParams({ limit: "20" });
    if (!reset && nextGalleryCursor) query.set("after", nextGalleryCursor);
    const result = await galleryRequest(`gallery/photos?${query}`);
    if (!Array.isArray(result.photos)) {
      throw new Error("The gallery response was not in the expected format.");
    }

    if (reset) {
      galleryGrid.replaceChildren();
      knownPhotos.clear();
    }
    result.photos.forEach(addPhoto);
    nextGalleryCursor = result.nextCursor;
    loadMorePhotos.hidden = !nextGalleryCursor;
    galleryStatus.textContent = knownPhotos.size
      ? `${knownPhotos.size} ${knownPhotos.size === 1 ? "photo" : "photos"}`
      : "The first memories will appear here soon.";
  } catch (error) {
    console.error("Unable to load gallery photos:", error);
    galleryStatus.textContent = error.message;
  } finally {
    galleryLoading = false;
    refreshGallery.disabled = false;
    loadMorePhotos.disabled = false;
  }
}

if (galleryGrid) {
  refreshGallery.addEventListener("click", () => loadGallery(true));
  loadMorePhotos.addEventListener("click", () => loadGallery());
  closePhotoViewer.addEventListener("click", () => photoViewer.close());
  photoViewer.addEventListener("close", () => photoViewerImage.removeAttribute("src"));
  photoViewer.addEventListener("click", (event) => {
    if (event.target === photoViewer) photoViewer.close();
  });

  loadGallery(true);
}
