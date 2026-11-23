const videos = [
  {
    id: "aqz-KE-bpKQ",
    title: "Big Buck Bunny — Official Video",
    channel: "Blender Foundation",
    views: "Demo video",
    duration: "9:56"
  },
  {
    id: "jfKfPfyJRdk",
    title: "lofi hip hop radio — beats to relax / study to",
    channel: "Lofi Girl",
    views: "Live stream",
    duration: "LIVE"
  },
  {
    id: "ScMzIvxBSi4",
    title: "Relaxing nature sounds",
    channel: "YouTube",
    views: "Sample",
    duration: "—"
  },
  {
    id: "M7lc1UVf-VE",
    title: "YouTube IFrame Player API demo",
    channel: "YouTube",
    views: "Player demo",
    duration: "—"
  }
];

const grid = document.getElementById("videoGrid");
const player = document.getElementById("youtubePlayer");
const title = document.getElementById("videoTitle");
const toast = document.getElementById("toast");

let currentVideo = videos[0];
let toastTimer;

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

function loadVideo(video) {
  currentVideo = video;

  player.src =
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?autoplay=1&rel=0`;

  title.textContent = video.title;

  document.title = `${video.title} — LTX`;

  notify("Video loaded");
}

function renderCards() {
  grid.innerHTML = "";

  videos.forEach((video) => {
    const card = document.createElement("article");

    card.className = "video-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");

    card.setAttribute(
      "aria-label",
      `Play ${video.title}`
    );

    card.innerHTML = `
      <div class="thumbnail">
        <img
          src="https://img.youtube.com/vi/${video.id}/hqdefault.jpg"
          alt=""
          loading="lazy"
        >
        <span class="duration">${video.duration}</span>
      </div>

      <div class="video-title"></div>
      <div class="video-meta"></div>
    `;

    card.querySelector(".video-title").textContent =
      video.title;

    card.querySelector(".video-meta").textContent =
      `${video.channel} · ${video.views}`;

    card.addEventListener("click", () => {
      loadVideo(video);
    });

    card.addEventListener("keydown", (event) => {
      if (
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        loadVideo(video);
      }
    });

    grid.appendChild(card);
  });
}

/* Search */

document
  .getElementById("searchForm")
  .addEventListener("submit", (event) => {
    event.preventDefault();

    const query =
      document.getElementById("searchInput").value.trim();

    if (!query) return;

    const searchUrl =
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    window.open(searchUrl, "_blank");

    notify("Search opened in your browser");
  });

/* Open current video on YouTube */

document
  .getElementById("openYoutube")
  .addEventListener("click", () => {
    window.open(
      `https://www.youtube.com/watch?v=${currentVideo.id}`,
      "_blank"
    );
  });

/* Copy current video URL */

document
  .getElementById("copyVideo")
  .addEventListener("click", async () => {
    const url =
      `https://www.youtube.com/watch?v=${currentVideo.id}`;

    try {
      await navigator.clipboard.writeText(url);
      notify("Video link copied");
    } catch {
      notify(url);
    }
  });

/* Prototype buttons */

document
  .getElementById("settingsButton")
  .addEventListener("click", () => {
    notify("Settings are coming in the next build");
  });

document
  .getElementById("profileButton")
  .addEventListener("click", () => {
    notify("Account integration is not enabled");
  });

/* Sidebar navigation */

document
  .querySelectorAll(".nav-item[data-view]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll(".nav-item[data-view]")
        .forEach((item) => {
          item.classList.remove("active");
        });

      button.classList.add("active");

      if (button.dataset.view !== "Home") {
        notify(`${button.dataset.view} view is planned`);
      }
    });
  });

/* Category filters */

document
  .querySelectorAll(".filter")
  .forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll(".filter")
        .forEach((item) => {
          item.classList.remove("active");
        });

      button.classList.add("active");

      notify(`${button.textContent} filter selected`);
    });
  });

renderCards();
