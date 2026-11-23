import { invoke } from "@tauri-apps/api/core";

// =====================================================
// ELEMENTS
// =====================================================

const $ = (id) => document.getElementById(id);

const grid = $("videoGrid");
const queueList = $("queueList");
const toast = $("toast");

let library = {
  apiKey: "",
  regionCode: "NL",
  queue: [],
  history: [],
  playlists: [
    { id: "watch-later", name: "Watch later", videos: [] }
  ],
  accent: "red",
  alwaysOnTop: false
};

let ytPlayer = null;
let ytReady = false;
let pendingVideo = null;
let currentVideo = null;
let activeCategory = "";
let activeView = "home";

let toastTimer;
let saveTimer;
let progressTimer;

// =====================================================
// NOTIFICATIONS
// =====================================================

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}

// =====================================================
// INITIALIZATION
// =====================================================

async function initialize() {
  try {
    library = await invoke("load_library");

    if (!library.playlists?.length) {
      library.playlists = [
        { id: "watch-later", name: "Watch later", videos: [] }
      ];
    }

    if (!library.history) library.history = [];
    if (!library.queue) library.queue = [];
  } catch (error) {
    console.error(error);
    notify("Could not load local library.");
  }

  $("apiKey").value = library.apiKey || "";
  $("regionCode").value = library.regionCode || "NL";
  $("accent").value = library.accent || "red";
  $("alwaysOnTop").checked = Boolean(library.alwaysOnTop);
  $("autoPlayQueue").checked = library.autoPlayQueue !== false;

  applyAccent();
  renderQueue();
  renderPlaylistNav();

  if (library.alwaysOnTop) {
    invoke("set_always_on_top", { enabled: true }).catch(console.error);
  }

  loadYouTubeAPI();
  loadFeed();
}

// =====================================================
// SAVE / LOAD STATE
// =====================================================

function persist() {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(async () => {
    try {
      await invoke("save_library", { state: library });
    } catch (error) {
      console.error("Save failed:", error);
      notify("Could not save library.");
    }
  }, 250);
}

// =====================================================
// ACCENT COLOR
// =====================================================

function applyAccent() {
  document.body.dataset.accent = library.accent || "red";
}

// =====================================================
// YOUTUBE IFRAME API
// =====================================================

function loadYouTubeAPI() {
  window.onYouTubeIframeAPIReady = () => {
    ytReady = true;

    ytPlayer = new window.YT.Player("playerMount", {
      width: "100%",
      height: "100%",

      playerVars: {
        autoplay: 0,
        controls: 0,
        rel: 0,
        playsinline: 1,
        disablekb: 1,
        origin: window.location.origin
      },

      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      }
    });
  };

  const script = document.createElement("script");

  script.src = "https://www.youtube.com/iframe_api";
  script.async = true;

  document.head.appendChild(script);
}

function onPlayerReady() {
  if (pendingVideo) {
    ytPlayer.loadVideoById(pendingVideo.id);
    pendingVideo = null;
  }

  updatePlayerVolume();
}

function onPlayerStateChange(event) {
  if (!window.YT) return;

  const state = event.data;

  if (state === window.YT.PlayerState.PLAYING) {
    $("playButton").textContent = "Ⅱ";
  } else if (
    state === window.YT.PlayerState.PAUSED ||
    state === window.YT.PlayerState.ENDED
  ) {
    $("playButton").textContent = "▶";
  }

  if (state === window.YT.PlayerState.ENDED) {
    if (library.autoPlayQueue !== false) {
      playNext();
    }
  }
}

function onPlayerError(event) {
  const messages = {
    2: "Invalid video ID.",
    5: "HTML5 player error.",
    100: "Video unavailable.",
    101: "Embedding disabled by the video owner.",
    150: "Embedding disabled by the video owner."
  };

  notify(messages[event.data] || "YouTube playback error.");
}

// =====================================================
// VIDEO PLAYBACK
// =====================================================

function playVideo(video) {
  if (!video?.id) return;

  currentVideo = video;

  $("currentTitle").textContent = video.title;
  $("currentChannel").textContent = video.channel;
  $("playerPlaceholder").classList.add("hidden");

  if (ytReady && ytPlayer) {
    ytPlayer.loadVideoById(video.id);
  } else {
    pendingVideo = video;
  }

  addHistory(video);
}

function togglePlayback() {
  if (!ytReady || !ytPlayer || !currentVideo) {
    notify("Select a video first.");
    return;
  }

  const state = ytPlayer.getPlayerState();

  if (state === window.YT.PlayerState.PLAYING) {
    ytPlayer.pauseVideo();
  } else {
    ytPlayer.playVideo();
  }
}

function seek(seconds) {
  if (!ytReady || !currentVideo) return;

  const current = ytPlayer.getCurrentTime();

  const duration = ytPlayer.getDuration();

  ytPlayer.seekTo(
    Math.max(0, Math.min(duration, current + seconds)),
    true
  );
}

function updatePlayerVolume() {
  if (!ytReady || !ytPlayer) return;

  const value = Number($("volumeSlider").value);

  ytPlayer.setVolume(value);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);

  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function updateProgress() {
  if (!ytReady || !ytPlayer || !currentVideo) return;

  const current = ytPlayer.getCurrentTime();
  const duration = ytPlayer.getDuration();

  if (!duration) return;

  $("seekBar").value = (current / duration) * 100;

  $("currentTime").textContent = formatTime(current);
  $("duration").textContent = formatTime(duration);
}

function startProgressTimer() {
  clearInterval(progressTimer);

  progressTimer = setInterval(updateProgress, 500);
}

// =====================================================
// HISTORY
// =====================================================

function addHistory(video) {
  library.history = library.history.filter(
    item => item.id !== video.id
  );

  library.history.unshift(video);

  library.history = library.history.slice(0, 100);

  persist();
}

// =====================================================
// QUEUE
// =====================================================

function addToQueue(video) {
  if (library.queue.some(item => item.id === video.id)) {
    notify("Already in queue.");
    return;
  }

  library.queue.push(video);

  renderQueue();
  persist();

  notify("Added to queue.");
}

function removeFromQueue(id) {
  library.queue = library.queue.filter(
    video => video.id !== id
  );

  renderQueue();
  persist();
}

function clearQueue() {
  library.queue = [];

  renderQueue();
  persist();

  notify("Queue cleared.");
}

function playNext() {
  const next = library.queue.shift();

  if (!next) {
    notify("Queue is empty.");
    renderQueue();
    persist();
    return;
  }

  renderQueue();
  persist();

  playVideo(next);
}

function playPrevious() {
  const previous = library.history.find(
    video => video.id !== currentVideo?.id
  );

  if (previous) playVideo(previous);
}

function renderQueue() {
  queueList.replaceChildren();

  $("queueCount").textContent =
    `${library.queue.length} videos`;

  library.queue.forEach((video, index) => {
    const item = document.createElement("div");
    item.className = "queue-item";

    const image = document.createElement("img");
    image.src = video.thumbnail;
    image.alt = "";
    image.loading = "lazy";

    const details = document.createElement("div");

    const play = document.createElement("button");
    play.className = "queue-title";
    play.textContent = video.title;

    play.addEventListener("click", () => {
      library.queue.splice(index, 1);

      playVideo(video);
      renderQueue();
      persist();
    });

    const channel = document.createElement("div");
    channel.className = "queue-channel";
    channel.textContent = video.channel;

    details.append(play, channel);

    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.title = "Remove from queue";

    remove.addEventListener("click", () => {
      removeFromQueue(video.id);
    });

    item.append(image, details, remove);

    queueList.appendChild(item);
  });
}

// =====================================================
// PLAYLISTS
// =====================================================

function getWatchLater() {
  let playlist = library.playlists.find(
    item => item.id === "watch-later"
  );

  if (!playlist) {
    playlist = {
      id: "watch-later",
      name: "Watch later",
      videos: []
    };

    library.playlists.unshift(playlist);
  }

  return playlist;
}

function saveToWatchLater(video) {
  const playlist = getWatchLater();

  if (playlist.videos.some(item => item.id === video.id)) {
    notify("Already saved.");
    return;
  }

  playlist.videos.unshift(video);

  persist();
  renderPlaylistNav();

  notify("Saved to Watch later.");
}

function createPlaylist() {
  const name = prompt("Enter a playlist name:");

  if (!name?.trim()) return;

  const playlist = {
    id: crypto.randomUUID(),
    name: name.trim(),
    videos: []
  };

  library.playlists.push(playlist);

  renderPlaylistNav();
  persist();

  notify("Playlist created.");
}

function addCurrentToPlaylist() {
  if (!currentVideo) {
    notify("Play a video first.");
    return;
  }

  const available = library.playlists
    .map(item => item.name)
    .join(", ");

  const name = prompt(
    `Enter playlist name:\n${available}`
  );

  if (!name) return;

  const playlist = library.playlists.find(
    item => item.name.toLowerCase() === name.trim().toLowerCase()
  );

  if (!playlist) {
    notify("Playlist not found.");
    return;
  }

  if (playlist.videos.some(video => video.id === currentVideo.id)) {
    notify("Video already in playlist.");
    return;
  }

  playlist.videos.unshift(currentVideo);

  persist();
  notify("Added to playlist.");
}

function renderPlaylistNav() {
  const container = $("playlistNav");
  container.replaceChildren();

  library.playlists.forEach(playlist => {
    const button = document.createElement("button");

    button.className = "nav-item";
    button.dataset.playlist = playlist.id;

    const icon = document.createElement("span");
    icon.textContent = "▤";

    const label = document.createElement("span");
    label.textContent = playlist.name;

    button.append(icon, label);

    button.addEventListener("click", () => {
      showPlaylist(playlist);
    });

    container.appendChild(button);
  });
}

function showPlaylist(playlist) {
  activeView = "playlist";

  $("feedTitle").textContent = playlist.name;
  $("feedStatus").textContent =
    `${playlist.videos.length} saved videos`;

  renderVideos(playlist.videos);
}

// =====================================================
// VIDEO CARDS
// =====================================================

function renderVideos(videos) {
  grid.replaceChildren();

  if (!videos.length) {
    const empty = document.createElement("div");

    empty.className = "empty-state";
    empty.textContent = "Nothing here yet.";

    grid.appendChild(empty);
    return;
  }

  videos.forEach(video => {
    const card = document.createElement("article");
    card.className = "video-card";

    const thumbnail = document.createElement("div");
    thumbnail.className = "thumbnail";

    const image = document.createElement("img");
    image.src = video.thumbnail;
    image.alt = "";
    image.loading = "lazy";

    thumbnail.appendChild(image);

    const title = document.createElement("h3");
    title.textContent = video.title;

    const channel = document.createElement("p");
    channel.textContent = video.channel;

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const queueButton = document.createElement("button");
    queueButton.textContent = "+ Queue";

    queueButton.addEventListener("click", event => {
      event.stopPropagation();
      addToQueue(video);
    });

    const saveButton = document.createElement("button");
    saveButton.textContent = "♡ Save";

    saveButton.addEventListener("click", event => {
      event.stopPropagation();
      saveToWatchLater(video);
    });

    actions.append(queueButton, saveButton);

    card.append(
      thumbnail,
      title,
      channel,
      actions
    );

    card.addEventListener("click", () => {
      playVideo(video);
    });

    grid.appendChild(card);
  });
}

// =====================================================
// YOUTUBE DISCOVERY
// =====================================================

function categoryQuery() {
  const categories = {
    "10": "music",
    "20": "gaming",
    "27": "education",
    "25": "news",
    "28": "science"
  };

  return categories[activeCategory] || "popular videos";
}

async function loadFeed() {
  activeView = "home";

  $("feedTitle").textContent =
    activeCategory ? "Explore" : "Recommended";

  $("feedStatus").textContent = "Loading videos...";

  if (!library.apiKey) {
    $("feedStatus").textContent =
      "Add your YouTube API key in Settings to discover videos.";

    renderVideos([]);
    return;
  }

  try {
    let videos;

    if (activeCategory) {
      videos = await invoke("search_videos", {
        apiKey: library.apiKey,
        query: categoryQuery(),
        category: activeCategory
      });
    } else {
      videos = await invoke("trending_videos", {
        apiKey: library.apiKey,
        regionCode: library.regionCode
      });
    }

    $("feedStatus").textContent =
      `${videos.length} videos found`;

    renderVideos(videos);
  } catch (error) {
    $("feedStatus").textContent = String(error);
    renderVideos([]);
  }
}

async function searchVideos(query) {
  if (!library.apiKey) {
    notify("Add an API key in Settings first.");
    $("settingsDialog").showModal();
    return;
  }

  $("feedTitle").textContent = "Search results";
  $("feedStatus").textContent = "Searching...";

  activeView = "search";

  try {
    const videos = await invoke("search_videos", {
      apiKey: library.apiKey,
      query,
      category: activeCategory || null
    });

    $("feedStatus").textContent =
      `${videos.length} results for "${query}"`;

    renderVideos(videos);
  } catch (error) {
    $("feedStatus").textContent = String(error);
    renderVideos([]);
  }
}

// =====================================================
// NAVIGATION
// =====================================================

function showLocalPage(type) {
  activeView = type;

  if (type === "history") {
    $("feedTitle").textContent = "History";
    $("feedStatus").textContent =
      `${library.history.length} recently watched videos`;

    renderVideos(library.history);
  }

  if (type === "watch-later") {
    const playlist = getWatchLater();
    showPlaylist(playlist);
  }
}

document.querySelectorAll(".nav-item[data-view]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item[data-view]")
      .forEach(item => item.classList.remove("active"));

    button.classList.add("active");

    const view = button.dataset.view;

    if (view === "home" || view === "explore") {
      activeCategory = "";
      loadFeed();
    } else {
      showLocalPage(view);
    }
  });
});

document.querySelectorAll(".category").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".category")
      .forEach(item => item.classList.remove("active"));

    button.classList.add("active");

    activeCategory = button.dataset.category;

    loadFeed();
  });
});

// =====================================================
// SETTINGS
// =====================================================

function openSettings() {
  $("apiKey").value = library.apiKey || "";
  $("regionCode").value = library.regionCode || "NL";
  $("accent").value = library.accent || "red";
  $("alwaysOnTop").checked = Boolean(library.alwaysOnTop);

  $("settingsDialog").showModal();
}

$("settingsForm").addEventListener("submit", async event => {
  event.preventDefault();

  library.apiKey = $("apiKey").value.trim();
  library.regionCode = $("regionCode").value;
  library.accent = $("accent").value;
  library.alwaysOnTop = $("alwaysOnTop").checked;
  library.autoPlayQueue = $("autoPlayQueue").checked;

  try {
    await invoke("set_always_on_top", {
      enabled: library.alwaysOnTop
    });

    applyAccent();

    await invoke("save_library", {
      state: library
    });

    $("settingsDialog").close();

    notify("Settings saved.");

    if (library.apiKey) loadFeed();
  } catch (error) {
    notify(`Settings error: ${error}`);
  }
});

$("settingsButton").addEventListener("click", openSettings);
$("topSettings").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", () => {
  $("settingsDialog").close();
});

// =====================================================
// SEARCH
// =====================================================

$("searchForm").addEventListener("submit", event => {
  event.preventDefault();

  const query = $("searchInput").value.trim();

  if (query) searchVideos(query);
});

// =====================================================
// PLAYER BUTTONS
// =====================================================

$("playButton").addEventListener("click", togglePlayback);

$("backButton").addEventListener("click", () => seek(-10));
$("forwardButton").addEventListener("click", () => seek(10));

$("previousButton").addEventListener("click", playPrevious);
$("nextButton").addEventListener("click", playNext);

$("volumeSlider").addEventListener("input", updatePlayerVolume);

$("muteButton").addEventListener("click", () => {
  if (!ytReady || !ytPlayer) return;

  if (ytPlayer.isMuted()) {
    ytPlayer.unMute();
    $("muteButton").textContent = "♪";
  } else {
    ytPlayer.mute();
    $("muteButton").textContent = "×";
  }
});

$("speedSelect").addEventListener("change", () => {
  if (!ytReady || !ytPlayer) return;

  ytPlayer.setPlaybackRate(
    Number($("speedSelect").value)
  );
});

$("seekBar").addEventListener("change", () => {
  if (!ytReady || !ytPlayer || !currentVideo) return;

  const duration = ytPlayer.getDuration();
  const percentage = Number($("seekBar").value) / 100;

  ytPlayer.seekTo(duration * percentage, true);
});

$("queueCurrent").addEventListener("click", () => {
  if (currentVideo) addToQueue(currentVideo);
});

$("saveCurrent").addEventListener("click", () => {
  if (currentVideo) saveToWatchLater(currentVideo);
});

// =====================================================
// REMAINING CONTROLS
// =====================================================

$("newPlaylist").addEventListener("click", createPlaylist);

$("clearQueue").addEventListener("click", clearQueue);

$("autoPlayQueue").addEventListener("change", event => {
  library.autoPlayQueue = event.target.checked;
  persist();
});

$("refreshButton").addEventListener("click", loadFeed);

$("miniToggle").addEventListener("click", () => {
  document.body.classList.toggle("mini-mode");
});

$("playlistNav").addEventListener("click", event => {
  const button = event.target.closest("[data-playlist]");

  if (!button) return;

  const playlist = library.playlists.find(
    item => item.id === button.dataset.playlist
  );

  if (playlist) showPlaylist(playlist);
});

// Extra playlist action on the player
const playlistButton = document.createElement("button");
playlistButton.className = "secondary-button";
playlistButton.textContent = "+ Playlist";
playlistButton.addEventListener("click", addCurrentToPlaylist);

$("now-playing-actions-placeholder")?.appendChild(playlistButton);

// =====================================================
// KEYBOARD SHORTCUTS
// =====================================================

document.addEventListener("keydown", event => {
  const target = event.target;

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    $("settingsDialog").open
  ) {
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  }

  if (event.key === "ArrowLeft") {
    seek(-10);
  }

  if (event.key === "ArrowRight") {
    seek(10);
  }

  if (event.key.toLowerCase() === "m") {
    $("muteButton").click();
  }
});

// =====================================================
// START
// =====================================================

startProgressTimer();
initialize();
