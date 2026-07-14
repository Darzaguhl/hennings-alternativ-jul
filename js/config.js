// Default API base URL and admin dashboard URL for local development, and
// as a fallback if a deploy doesn't override them. Render's Build Command
// overwrites this file per-environment (see render build settings), so
// main/production can stay identical commits while still pointing at
// different APIs/dashboards.
window.API_BASE_URL = "https://hennings-alternativ-jul-api-preprod.onrender.com";
window.ADMIN_URL = "https://hennings-alternativ-jul-admin-preprod.onrender.com";
